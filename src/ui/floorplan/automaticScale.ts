import type { PlanReading, PlanTextLine, Point } from '@engine/types';
import { formatM } from '@engine/units';
import { detectRoom, type DetectionImage } from './detection';
import { dimensionTextLines, readDimensionPairs, readRoomName, suggestRoomText, type ReadDimensionPair } from './planText';
import { pixelPolygonArea, pointInPixelPolygon } from './tracing';

export interface SuggestedScale {
  a: Point; b: Point; distance: number; mmPerPx: number;
  polygon: Point[];
  roomName?: string;
  printedLabel: string;
  checkLabel: string;
  matchedRooms: number;
  /** Supplied by the hook, tying confirmation to the image and reading that produced the preview. */
  sourceKey?: string;
}
export interface ScaleInference { suggestion?: SuggestedScale; reason?: string }
export interface ScaleInferenceControl { cancelled?: () => boolean; maxVerifications?: number }
interface PrintedPair { line: PlanTextLine; pair: ReadDimensionPair }
interface Bounds { left: number; right: number; top: number; bottom: number }
interface Match extends SuggestedScale { error: number }

const corners = (bounds: Bounds): Point[] => [{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }, { x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom }];
const usable = (line: PlanTextLine) => (line.reviewed || line.confidence >= 70) && line.width > 0 && line.height > 0
  && [line.x, line.y, line.width, line.height].every(Number.isFinite);

/** PDF text rows can be split into individual items; join only adjacent items on the same baseline. */
function printedPairs(reading: PlanReading): PrintedPair[] {
  const result: PrintedPair[] = [];
  for (const line of dimensionTextLines(reading.lines.filter(usable))) {
    const pairs = readDimensionPairs(line.text);
    // Competing dimensions in one line cannot be selected safely, except equivalent metric/imperial pairs.
    if (!pairs.length || pairs.some(pair => Math.min(pair.widthMm, pair.heightMm) < 900 || Math.max(pair.widthMm, pair.heightMm) > 25000)) continue;
    const pair = pairs[0]!;
    if (pairs.some(other => Math.abs(other.widthMm / pair.widthMm - 1) > .03 || Math.abs(other.heightMm / pair.heightMm - 1) > .03)) continue;
    if (result.some(other => Math.abs(other.line.x + other.line.width / 2 - line.x - line.width / 2) < 5
      && Math.abs(other.line.y + other.line.height / 2 - line.y - line.height / 2) < 5)) continue;
    result.push({ line, pair });
  }
  return result;
}

function mask(image: DetectionImage, reading: PlanReading) {
  const { width, height, data } = image;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    const alpha = data[i * 4 + 3]! / 255;
    const shade = 255 + alpha * (.2126 * data[i * 4]! + .7152 * data[i * 4 + 1]! + .0722 * data[i * 4 + 2]! - 255);
    ink[i] = shade < 190 ? 1 : 0;
  }
  const wallInk = ink.slice();
  // Printed letters must not serve as wall evidence, even when their vertical strokes align.
  for (const line of reading.lines.slice(0, 2000)) {
    for (let y = Math.max(0, Math.floor(line.y - 2)); y < Math.min(height, Math.ceil(line.y + line.height + 2)); y++) {
      wallInk.fill(0, y * width + Math.max(0, Math.floor(line.x - 2)), y * width + Math.min(width, Math.ceil(line.x + line.width + 2)));
    }
  }
  return { ink, wallInk };
}

/** Structural runs are located before a physical scale exists; no door width or DPI is assumed. */
function surroundingWalls(image: DetectionImage, wallInk: Uint8Array, line: PlanTextLine): Bounds[] {
  const { width, height } = image;
  const cx = line.x + line.width / 2, cy = line.y + line.height / 2;
  const radius = Math.max(14, Math.min(34, Math.round(Math.max(width, height) * .025)));
  const wallAt = (at: number, other: number, vertical: boolean) => {
    let dark = 0, total = 0;
    for (let delta = -radius; delta <= radius; delta++) {
      const x = vertical ? at : Math.round(other + delta), y = vertical ? Math.round(other + delta) : at;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      total++; dark += wallInk[y * width + x]!;
    }
    return total >= radius * 1.5 && dark / total >= .72;
  };
  const find = (start: number, other: number, sign: number, vertical: boolean) => {
    const stops: number[] = [];
    const limit = vertical ? width : height;
    let runStart = 0, runLength = 0;
    for (let at = Math.round(start); at > 1 && at < limit - 2; at += sign) {
      const isWall = wallAt(at, other, vertical);
      if (isWall) { if (!runLength) runStart = at; runLength++; }
      else {
        // Thin outlines of beds, tables and door leaves cannot bootstrap a physical room scale.
        if (runLength >= 3) { stops.push(sign < 0 ? runStart + 1 : runStart); if (stops.length === 3) break; }
        runLength = 0;
      }
    }
    return stops;
  };
  // A dimension is often centred on a window or an open door. Sample parallel rays too;
  // the independent room detection below must still verify the resulting four wall faces.
  const sample = (start: number, other: number, sign: number, vertical: boolean) => {
    const nearby = [0, -1.8, 1.8].flatMap(offset => find(start, other + offset * radius, sign, vertical));
    const found = nearby.length ? nearby : [-3.2, 3.2].flatMap(offset => find(start, other + offset * radius, sign, vertical));
    return [...new Set(found)].sort((a, b) => Math.abs(a - start) - Math.abs(b - start)).slice(0, 4);
  };
  const left = sample(cx, cy, -1, true), right = sample(cx, cy, 1, true);
  const top = sample(cy, cx, -1, false), bottom = sample(cy, cx, 1, false);
  const result: Bounds[] = [];
  for (const l of left) for (const r of right) for (const t of top) for (const b of bottom) {
    const w = r - l, h = b - t;
    if (w < Math.max(45, line.height * 5) || h < Math.max(45, line.height * 5)
      || l > line.x - 3 || r < line.x + line.width + 3 || t > line.y - 3 || b < line.y + line.height + 3
      || w * h > width * height * .65 || (w > width * .85 && h > height * .85)) continue;
    result.push({ left: l, right: r, top: t, bottom: b });
  }
  return result;
}

function scaleFor(bounds: Bounds, pair: ReadDimensionPair) {
  const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  return [[pair.widthMm, pair.heightMm], [pair.heightMm, pair.widthMm]].map(([w, h]) => {
    const sx = w! / width, sy = h! / height;
    return { mmPerPx: (sx + sy) / 2, error: Math.abs(sx - sy) / Math.max(sx, sy), widthMm: w!, heightMm: h! };
  }).sort((a, b) => a.error - b.error)[0]!;
}

function rectangularBounds(polygon: Point[]): Bounds | undefined {
  if (polygon.length < 4 || polygon.length > 24) return;
  const bounds = { left: Math.min(...polygon.map(p => p.x)), right: Math.max(...polygon.map(p => p.x)), top: Math.min(...polygon.map(p => p.y)), bottom: Math.max(...polygon.map(p => p.y)) };
  const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top;
  // An inward door swing may survive room detection. It cannot change the four measured wall
  // faces when at least 60% of every face is independently visible and 94% of the box is floor.
  // Large alcoves and connected living/dining areas cannot pass this check.
  if (pixelPolygonArea(polygon) < w * h * .94) return;
  const coverage = [0, 0, 0, 0];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    if (Math.abs(a.x - bounds.left) <= 2.5 && Math.abs(b.x - bounds.left) <= 2.5) coverage[0]! += Math.abs(b.y - a.y);
    if (Math.abs(a.x - bounds.right) <= 2.5 && Math.abs(b.x - bounds.right) <= 2.5) coverage[1]! += Math.abs(b.y - a.y);
    if (Math.abs(a.y - bounds.top) <= 2.5 && Math.abs(b.y - bounds.top) <= 2.5) coverage[2]! += Math.abs(b.x - a.x);
    if (Math.abs(a.y - bounds.bottom) <= 2.5 && Math.abs(b.y - bounds.bottom) <= 2.5) coverage[3]! += Math.abs(b.x - a.x);
  }
  if (coverage.some((value, i) => value < (i < 2 ? h : w) * .6)) return;
  return bounds;
}

function clearSeeds(image: DetectionImage, ink: Uint8Array, bounds: Bounds, line: PlanTextLine): Point[] {
  const points: Point[] = [];
  const centre = { x: line.x + line.width / 2, y: line.y + line.height / 2 };
  for (const dy of [2, -2, 3, -3, 0]) for (const dx of [0, -2, 2, -4, 4]) {
    const x = Math.round(centre.x + dx * line.height), y = Math.round(centre.y + dy * line.height);
    if (x < bounds.left + 5 || x > bounds.right - 5 || y < bounds.top + 5 || y > bounds.bottom - 5) continue;
    let dark = false;
    for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (ink[yy * image.width + xx]) dark = true;
    if (!dark) points.push({ x, y });
    if (points.length === 3) return points;
  }
  return points;
}

/** Local, review-only scale inference. Both printed lengths must independently fit real room walls. */
export function inferSuggestedScale(image: DetectionImage, reading: PlanReading | undefined, control: ScaleInferenceControl = {}): ScaleInference {
  if (!reading) return { reason: 'Reading the plan text first.' };
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 20 || image.height < 20
    || image.width * image.height > 1_500_000 || image.data.length < image.width * image.height * 4) return { reason: 'This image could not be analysed for scale. Set a known wall length manually.' };
  const pairs = printedPairs(reading);
  if (!pairs.length) return { reason: 'No clear pair of room dimensions was read. Check decimal points and units, or set a known wall length manually.' };
  if (pairs.length > 12) return { reason: 'This page has too many dimension labels to cross-check safely. Set one known wall length manually.' };
  const { ink, wallInk } = mask(image, reading);
  const matches: Match[] = [];
  let verifications = 0, conflictingRoom = false, exhausted = false;
  const budget = Math.max(1, Math.min(18, control.maxVerifications ?? 12));
  const started = Date.now();
  for (const printed of pairs) {
    if (control.cancelled?.()) return {};
    if (verifications >= budget || Date.now() - started > 11000) { exhausted = true; break; }
    const candidateBounds = surroundingWalls(image, wallInk, printed.line).map(bounds => ({ bounds, scale: scaleFor(bounds, printed.pair) }))
      .filter(item => item.scale.error <= .045 && item.scale.mmPerPx > .05 && item.scale.mmPerPx < 1000)
      .sort((a, b) => a.scale.error - b.scale.error || (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top) - (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top));
    let matched: Match | undefined;
    for (const candidate of candidateBounds.slice(0, 3)) {
      const preliminary = corners(candidate.bounds);
      const names = reading.lines.filter(usable).filter(line => readRoomName(line.text) && pointInPixelPolygon({ x: line.x + line.width / 2, y: line.y + line.height / 2 }, preliminary));
      if (new Set(names.map(line => readRoomName(line.text))).size !== 1) continue;
      for (const seed of clearSeeds(image, ink, candidate.bounds, printed.line).slice(0, 2)) {
        if (control.cancelled?.()) return {};
        if (verifications >= budget || Date.now() - started > 11000) { exhausted = true; break; }
        verifications++;
        const result = detectRoom(image, seed, { mmPerPx: candidate.scale.mmPerPx });
        if (!result.ok) continue;
        const measurement = ('measurementPolygon' in result ? result.measurementPolygon as Point[] | undefined : undefined) ?? result.polygon;
        const bounds = rectangularBounds(measurement);
        if (!bounds || pixelPolygonArea(measurement) > image.width * image.height * .65) continue;
        // The independently detected room must agree with the wall runs used to bootstrap scale.
        if (Math.abs(bounds.left - candidate.bounds.left) > 5 || Math.abs(bounds.right - candidate.bounds.right) > 5
          || Math.abs(bounds.top - candidate.bounds.top) > 5 || Math.abs(bounds.bottom - candidate.bounds.bottom) > 5) continue;
        const text = suggestRoomText(reading, measurement);
        if (!text.name || !text.dimensions || text.dimensions.confidence < 70) continue;
        if (text.dimensions.ambiguous) { conflictingRoom = true; continue; }
        const scale = scaleFor(bounds, text.dimensions);
        if (scale.error > .04) continue;
        const horizontal = bounds.right - bounds.left >= bounds.bottom - bounds.top;
        const a = { x: bounds.left, y: bounds.top };
        const b = horizontal ? { x: bounds.right, y: bounds.top } : { x: bounds.left, y: bounds.bottom };
        const distance = horizontal ? scale.widthMm : scale.heightMm;
        const mmPerPx = distance / Math.hypot(b.x - a.x, b.y - a.y);
        const secondary = horizontal ? scale.heightMm : scale.widthMm;
        matched = { a, b, distance, mmPerPx, polygon: measurement, roomName: text.name, printedLabel: text.dimensions.label,
          checkLabel: `The other side also matches ${formatM(secondary)} (within ${Math.max(1, Math.ceil(scale.error * 100))}%).`, matchedRooms: 1, error: scale.error };
        break;
      }
      if (matched) break;
    }
    if (matched && !matches.some(match => Math.hypot(match.a.x - matched!.a.x, match.a.y - matched!.a.y) < 8)) matches.push(matched);
  }
  if (exhausted) return { reason: 'Not all printed dimensions could be cross-checked in time. Set a known wall length manually.' };
  if (conflictingRoom) return { reason: 'Some printed dimensions conflict inside the same room. Correct the plan text or set the scale manually.' };
  if (!matches.length) return { reason: 'The printed dimensions could not be matched to two clear room walls. Set a known wall length manually.' };
  const ordered = [...matches].sort((a, b) => a.mmPerPx - b.mmPerPx);
  const median = ordered[Math.floor(ordered.length / 2)]!.mmPerPx;
  if (ordered.some(match => Math.abs(match.mmPerPx / median - 1) > .05)) return { reason: 'Different rooms suggest different scales. Check the printed dimensions or set the scale manually.' };
  const best = [...matches].sort((a, b) => a.error - b.error || b.distance - a.distance)[0]!;
  const { error: _error, ...suggestion } = best;
  suggestion.matchedRooms = matches.length;
  if (matches.length > 1) suggestion.checkLabel += ` ${matches.length} rooms agree on the scale.`;
  return { suggestion };
}
