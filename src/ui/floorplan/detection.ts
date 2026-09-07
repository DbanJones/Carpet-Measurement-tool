/** Local room-outline and evidence-qualified door-symbol suggestions; measurements remain calibrated and reviewable. */
import { isSimplePolygon } from '@engine/geometry';
import { nearestEdge, pixelPolygonArea, pointInPixelPolygon, type Px } from './tracing';
import { outlinesOverlap } from './outlineEditing';
import { recognizeDoorwaySymbols, type DetectedDoorway } from './doorwaySymbols';
import { includeDoorThresholdFloor, resolveDoorThreshold } from './doorwayThresholds';
import type { PlanReading } from '@engine/types';
import type { DetectedStaircase } from './staircaseDetection';
export type { DetectedDoorway } from './doorwaySymbols';

export interface DetectionImage { width: number; height: number; data: Uint8ClampedArray }
export interface InferredGap { a: Px; b: Px }
export type DetectionResult =
  | { ok: true; polygon: Px[]; measurementPolygon?: Px[]; inferredGaps: InferredGap[]; detectedDoorways?: DetectedDoorway[]; message?: string }
  | { ok: false; reason: string };
export type RoomDetectionCandidate = Extract<DetectionResult, { ok: true }>;
export interface AllRoomsDetectionOptions {
  mmPerPx?: number;
  /** Existing room/stair outlines in the input image's coordinates. */
  excludePolygons?: Px[][];
  /** Review batches are bounded even when a page contains many symbols. Maximum 100. */
  maxRooms?: number;
  includeStaircases?: boolean;
  reading?: PlanReading;
}
export type AllRoomsDetectionResult =
  | { ok: true; candidates: RoomDetectionCandidate[]; staircases?: DetectedStaircase[]; message: string; omitted: number; truncated: boolean }
  | { ok: false; reason: string };
export interface DetectionControl { cancelled?: () => boolean; onProgress?: (progress: number) => void }
export const DETECTION_MAX_SIDE = 1200;
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Convert a downsampled result back to the original plan coordinate system. */
export function mapDetectionResult(result: DetectionResult, scaleX: number, scaleY = scaleX): DetectionResult {
  if (!result.ok) return result;
  const map = (p: Px) => ({ x: p.x * scaleX, y: p.y * scaleY });
  return { ...result, polygon: result.polygon.map(map), inferredGaps: result.inferredGaps.map((g) => ({ a: map(g.a), b: map(g.b) })),
    ...(result.measurementPolygon ? { measurementPolygon: result.measurementPolygon.map(map) } : {}),
    ...(result.detectedDoorways ? { detectedDoorways: result.detectedDoorways.map(door => ({ ...door, a: map(door.a), b: map(door.b),
      ...(door.hinge ? { hinge: map(door.hinge) } : {}), ...(door.leafEnd ? { leafEnd: map(door.leafEnd) } : {}),
    })) } : {}),
  };
}

export function mapAllRoomsDetectionResult(result: AllRoomsDetectionResult, scaleX: number, scaleY = scaleX): AllRoomsDetectionResult {
  if (!result.ok) return result;
  const map = (point: Px) => ({ x: point.x * scaleX, y: point.y * scaleY });
  return { ...result, candidates: result.candidates.map(candidate => mapDetectionResult(candidate, scaleX, scaleY) as RoomDetectionCandidate), ...(result.staircases ? { staircases: result.staircases.map(stair => ({ ...stair, polygon: stair.polygon.map(map), treads: stair.treads.map(tread => ({ a: map(tread.a), b: map(tread.b) })) })) } : {}) };
}

/**
 * Suggest every enclosed room in two bounded raster passes at most. Connected components are
 * labelled once, so neither image preparation nor flood-fill is repeated for each room/seed.
 * The result is deliberately a review batch, never an instruction to add measured rooms.
 */
export function detectAllRooms(image: DetectionImage, options: AllRoomsDetectionOptions = {}, control: DetectionControl = {}): AllRoomsDetectionResult {
  const cancelled = () => control.cancelled?.() ?? false;
  if (cancelled()) return fail('Detection cancelled.');
  control.onProgress?.(0.02);
  const analysis = analyse(image, options);
  if ('ok' in analysis) return analysis;
  if (cancelled()) return fail('Detection cancelled.');
  const exclusions = (options.excludePolygons ?? []).filter(polygon => polygon.length >= 3 && polygon.length <= 512
    && polygon.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).slice(0, 500);
  const maxRooms = Math.max(1, Math.min(100, Math.floor(Number.isFinite(options.maxRooms) ? options.maxRooms! : 60)));
  const first = allRegions(analysis, maxRooms, false, control, 0.1, 0.45, exclusions);
  if (!first.ok) return first;
  let candidates = first.candidates;
  let truncated = first.truncated;
  // Match cleaned outlines to an independently enclosed original room. A thin partition must
  // never disappear merely because a second pass produces a prettier combined rectangle.
  if (candidates.some(candidate => candidate.polygon.length > 6)) {
    const cleanAnalysis = analyse(image, options, true);
    if (!('ok' in cleanAnalysis)) {
      const cleaned = allRegions(cleanAnalysis, maxRooms, true, control, 0.5, 0.85, exclusions);
      if (!cleaned.ok) return cleaned;
      candidates = candidates.map(candidate => {
        if (candidate.polygon.length <= 6) return candidate;
        const area = pixelPolygonArea(candidate.polygon);
        return cleaned.candidates.find(other => {
          const otherArea = pixelPolygonArea(other.polygon);
          return other.polygon.length < candidate.polygon.length && otherArea >= area * 0.98 && otherArea <= area * 1.12
            && candidate.polygon.every(point => pointInPixelPolygon(point, other.polygon)
              // Simplification can move a wall face by up to 2.25 analysis pixels; do not
              // discard a valid cleaned room because one original corner is just outside it.
              || (nearestEdge(other.polygon, point)?.distance ?? Infinity) <= 2.5 * Math.max(analysis.sx, analysis.sy));
        }) ?? candidate;
      });
    }
  }
  if (cancelled()) return fail('Detection cancelled.');
  control.onProgress?.(0.9);
  let omitted = first.omitted;
  // A room's outer boundary includes furniture islands. Drop enclosed symbols/bed outlines,
  // as well as duplicate outlines arising from optional fine-stroke cleanup.
  candidates = candidates.filter((candidate, index, all) => {
    const area = pixelPolygonArea(candidate.polygon);
    const nested = all.some((other, otherIndex) => otherIndex !== index
      && (pixelPolygonArea(other.polygon) > area + 1 || (Math.abs(pixelPolygonArea(other.polygon) - area) <= 1 && otherIndex < index))
      && candidate.polygon.every(point => pointInPixelPolygon(point, other.polygon)));
    const exists = exclusions.some(polygon => outlinesOverlap(candidate.polygon, polygon));
    if (nested || exists) omitted++;
    return !nested && !exists;
  });
  // Read in plan order, keeping a stable order across repeated runs.
  candidates.sort((a, b) => Math.min(...a.polygon.map(p => p.y)) - Math.min(...b.polygon.map(p => p.y))
    || Math.min(...a.polygon.map(p => p.x)) - Math.min(...b.polygon.map(p => p.x)));
  if (candidates.length > maxRooms) { omitted += candidates.length - maxRooms; truncated = true; candidates = candidates.slice(0, maxRooms); }
  for (let index = 0; index < candidates.length; index++) {
    if (cancelled()) return fail('Detection cancelled.');
    candidates[index] = includeCandidateThresholds(candidates[index]!, analysis,
      [...exclusions, ...candidates.filter((_, other) => other !== index).map(candidate => candidate.polygon)]);
  }
  control.onProgress?.(1);
  return {
    ok: true, candidates, omitted, truncated,
    message: candidates.length
      ? `${candidates.length} room ${candidates.length === 1 ? 'outline is' : 'outlines are'} ready to review. Check walls and dashed door closures before adding rooms.${truncated ? ' This batch is limited; add reviewed rooms and scan again for the rest.' : ''}`
      : exclusions.length ? 'No new enclosed rooms were found. Existing rooms are skipped; draw any remaining open or unclear spaces.'
        : 'No clear enclosed rooms were found. Check the scale, then click inside a room or draw its outline.',
  };
}

function allRegions(analysis: Analysis, maxRooms: number, cleaned: boolean, control: DetectionControl, from: number, to: number, exclusions: Px[][]):
  { ok: true; candidates: RoomDetectionCandidate[]; omitted: number; truncated: boolean } | { ok: false; reason: string } {
  const { w, h, sx, sy, scale, bridged } = analysis;
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const minArea = scale ? Math.max(40, 500_000 / (scale * scale)) : Math.max(64, w * h * 0.0005);
  const minSpan = scale ? Math.max(4, 300 / scale) : 5;
  const regions: Array<{ id: number; first: number; size: number; seed: Px }> = [];
  let id = 0, visited = 0;
  for (let start = 0; start < labels.length; start++) {
    if (bridged[start] || labels[start]) continue;
    if (control.cancelled?.()) return fail('Detection cancelled.');
    id++;
    let head = 0, tail = 1;
    queue[0] = start;
    labels[start] = id;
    let minX = w, maxX = 0, minY = h, maxY = 0, touchesEdge = false;
    while (head < tail) {
      const current = queue[head++]!;
      const x = current % w, y = Math.floor(current / w);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      for (let direction = 0; direction < 4; direction++) {
        if ((direction === 0 && x === 0) || (direction === 1 && x === w - 1)
          || (direction === 2 && y === 0) || (direction === 3 && y === h - 1)) continue;
        const next = direction === 0 ? current - 1 : direction === 1 ? current + 1 : direction === 2 ? current - w : current + w;
        if (!labels[next] && !bridged[next]) { labels[next] = id; queue[tail++] = next; }
      }
      if (head % 32768 === 0) {
        if (control.cancelled?.()) return fail('Detection cancelled.');
        control.onProgress?.(from + (to - from) * 0.65 * (visited + head) / labels.length);
      }
    }
    visited += tail;
    if (touchesEdge || tail < minArea || tail > w * h * 0.85 || maxX - minX < minSpan || maxY - minY < minSpan) continue;
    // A decorative page frame encloses the house's exterior, not another room.
    if ((maxX - minX) > w * 0.9 && (maxY - minY) > h * 0.9) continue;
    const centreX = (minX + maxX) / 2, centreY = (minY + maxY) / 2;
    let seed = start, closest = Infinity;
    for (let i = 0; i < tail; i++) {
      const pixel = queue[i]!, x = pixel % w, y = Math.floor(pixel / w);
      const distance = (x - centreX) ** 2 + (y - centreY) ** 2;
      if (distance < closest) { closest = distance; seed = pixel; }
    }
    regions.push({ id, first: start, size: tail, seed: { x: seed % w + 0.5, y: Math.floor(seed / w) + 0.5 } });
  }
  // Overscan accommodates symbols and already measured rooms without unbounded tracing.
  regions.sort((a, b) => b.size - a.size);
  const excludedBounds = exclusions.map(polygon => ({ polygon,
    minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
    minY: Math.min(...polygon.map(p => p.y)), maxY: Math.max(...polygon.map(p => p.y)),
  }));
  // Skip already measured regions before applying the trace cap. Otherwise repeated batches
  // on a large multi-apartment sheet would keep reconsidering the same first 120 regions.
  const eligible = regions.filter(region => {
    const seed = { x: region.seed.x * sx, y: region.seed.y * sy };
    return !excludedBounds.some(bounds => seed.x >= bounds.minX && seed.x <= bounds.maxX && seed.y >= bounds.minY
      && seed.y <= bounds.maxY && pointInPixelPolygon(seed, bounds.polygon));
  });
  const limit = Math.min(300, Math.max(120, maxRooms * 3));
  const work = eligible.slice(0, limit);
  const candidates: RoomDetectionCandidate[] = [];
  let omitted = regions.length - work.length;
  for (let i = 0; i < work.length; i++) {
    if (control.cancelled?.()) return fail('Detection cancelled.');
    const region = work[i]!;
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === region.id;
    const result = traceRegion(analysis, inside, region.first, region.seed, cleaned);
    if (result.ok && pixelPolygonArea(result.polygon) / (sx * sy) <= w * h * 0.85) candidates.push(result);
    else omitted++;
    control.onProgress?.(from + (to - from) * (0.65 + 0.35 * (i + 1) / work.length));
  }
  return { ok: true, candidates, omitted, truncated: eligible.length > limit };
}

/**
 * Input/output coordinates are image pixels. Work is bounded to a 1200 px long side; RGBA is
 * composited onto white so transparent PNG backgrounds are not mistaken for black walls.
 * Door gaps are bridged only between substantial straight dark runs. Every result is a preview.
 */
export function detectRoom(image: DetectionImage, seed: Px, options: { mmPerPx?: number } = {}): DetectionResult {
  let analysis: Analysis | undefined;
  const original = detectOutline(image, seed, options, false, value => { analysis = value; });
  const finish = (result: DetectionResult) => result.ok && analysis ? includeCandidateThresholds(result, analysis) : result;
  if (!original.ok || original.polygon.length <= 6) return finish(original);
  // Door swings and furniture are often finer than walls. Compare a second outline with those
  // fine strokes removed, but never let this erase a partition and merge whole rooms: the area
  // must remain close to the first independently enclosed region.
  const cleaned = detectOutline(image, seed, options, true);
  if (!cleaned.ok) return finish(original);
  const originalArea = pixelPolygonArea(original.polygon), cleanedArea = pixelPolygonArea(cleaned.polygon);
  if (cleanedArea < originalArea * 0.98 || cleanedArea > originalArea * 1.12 || cleaned.polygon.length >= original.polygon.length) return finish(original);
  return finish(cleaned);
}

interface Analysis { w: number; h: number; sx: number; sy: number; scale?: number; walls: Uint8Array; ink: Uint8Array; bridged: Uint8Array; gaps: InferredGap[] }

function includeCandidateThresholds(candidate: RoomDetectionCandidate, analysis: Analysis, neighbours: Px[][] = []): RoomDetectionCandidate {
  if (!candidate.detectedDoorways?.length) return candidate;
  const local = mapDetectionResult(candidate, 1 / analysis.sx, 1 / analysis.sy) as RoomDetectionCandidate;
  let polygon = local.polygon;
  const detectedDoorways: DetectedDoorway[] = [];
  const warnings = new Set<string>();
  for (const originalDoor of local.detectedDoorways ?? []) {
    const resolved = resolveDoorThreshold(originalDoor, analysis.gaps, Math.min(32, Math.max(8, analysis.scale ? 400 / analysis.scale : 24)));
    const result = includeDoorThresholdFloor(polygon, resolved.door, resolved.wallDepth,
      { width: analysis.w, height: analysis.h, walls: analysis.walls });
    if (!result.ok) {
      detectedDoorways.push({ ...originalDoor, floorIncluded: false, floorWarning: result.reason }); warnings.add(result.reason); continue;
    }
    const fullPolygon = result.polygon.map(p => ({ x: p.x * analysis.sx, y: p.y * analysis.sy }));
    if (neighbours.some(other => outlinesOverlap(fullPolygon, other))) {
      const reason = 'A doorway recess meets another room. Check the shared threshold before including its floor.';
      detectedDoorways.push({ ...originalDoor, floorIncluded: false, floorWarning: reason });
      warnings.add(reason);
      continue;
    }
    polygon = result.polygon;
    detectedDoorways.push({ ...resolved.door, floorIncluded: true });
  }
  const result = mapDetectionResult({ ...local, polygon, detectedDoorways,
    measurementPolygon: local.measurementPolygon ?? local.polygon,
    message: warnings.size ? [...warnings].join(' ') : 'The straight doorway thresholds include the floor beneath each door. Check the walls and threshold positions before adding the room.',
  }, analysis.sx, analysis.sy) as RoomDetectionCandidate;
  return result;
}

function analyse(image: DetectionImage, options: { mmPerPx?: number }, removeFineStrokes = false): Analysis | { ok: false; reason: string } {
  const { width: sourceW, height: sourceH, data } = image;
  if (!Number.isInteger(sourceW) || !Number.isInteger(sourceH) || sourceW < 3 || sourceH < 3 || sourceW * sourceH > 40_000_000 || data.length !== sourceW * sourceH * 4) {
    return fail('This image cannot be analysed. Try tracing the room instead.');
  }
  const factor = Math.min(1, DETECTION_MAX_SIDE / Math.max(sourceW, sourceH));
  const w = Math.max(3, Math.round(sourceW * factor));
  const h = Math.max(3, Math.round(sourceH * factor));
  const sx = sourceW / w;
  const sy = sourceH / h;
  const walls = new Uint8Array(w * h);
  const ink = new Uint8Array(w * h);
  const luminance = (px: number, py: number) => {
    const i = (Math.min(sourceH - 1, py) * sourceW + Math.min(sourceW - 1, px)) * 4;
    const alpha = data[i + 3]! / 255;
    return 255 + alpha * (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]! - 255);
  };
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      // Four samples retain thin walls better than a single nearest-neighbour sample.
      const ax = Math.floor(col * sx), ay = Math.floor(row * sy);
      const bx = Math.floor((col + 0.75) * sx), by = Math.floor((row + 0.75) * sy);
      const shade = Math.min(luminance(ax, ay), luminance(bx, ay), luminance(ax, by), luminance(bx, by));
      walls[row * w + col] = shade < 185 ? 1 : 0;
      ink[row * w + col] = shade < 220 ? 1 : 0;
    }
  }
  const scale = options.mmPerPx && options.mmPerPx > 0 && Number.isFinite(options.mmPerPx) ? options.mmPerPx * Math.max(sx, sy) : undefined;
  if (removeFineStrokes) {
    // Remove fine printed strokes at either raster scale. A 5px opening is only used when
    // 5px represents less than 100mm; the caller still rejects any merge of real rooms.
    const radius = scale && scale < 20 ? 2 : 1;
    const eroded = new Uint8Array(w * h);
    for (let row = radius; row < h - radius; row++) for (let col = radius; col < w - radius; col++) {
      const i = row * w + col;
      if (!walls[i]) continue;
      let solid = true;
      for (let dy = -radius; dy <= radius && solid; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (!walls[i + dy * w + dx]) { solid = false; break; }
      }
      if (solid) eroded[i] = 1;
    }
    walls.fill(0);
    for (let row = radius; row < h - radius; row++) for (let col = radius; col < w - radius; col++) {
      const i = row * w + col;
      if (eroded[i]) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) walls[i + dy * w + dx] = 1;
    }
  }
  const bridged = walls.slice();
  const gaps: InferredGap[] = [];
  let tooManyGaps = false;
  // Without a physical calibration, repair only tiny raster breaks, never assume a door width.
  const maxGap = scale ? Math.min(120, Math.max(2, Math.round(1000 / scale))) : 2;
  const support = scale ? Math.max(4, Math.round(350 / scale)) : 5;
  const cornerSymbols = new Map<string, boolean>();
  const bridgeLines = (vertical: boolean) => {
    const lines = vertical ? w : h;
    const length = vertical ? h : w;
    const index = (line: number, offset: number) => vertical ? offset * w + line : line * w + offset;
    for (let line = 0; line < lines; line++) {
      let offset = 0;
      let previousEnd = -1;
      let previousLength = 0;
      let previousCorner = false;
      while (offset < length) {
        if (!walls[index(line, offset)]) { offset++; continue; }
        const start = offset;
        while (offset < length && walls[index(line, offset)]) offset++;
        const runLength = offset - start;
        // Thin door arcs must not interrupt two strong wall runs on either side of an opening.
        // At a corner the short jamb may be only the thickness of the perpendicular wall.
        // Count that structural return as support; thin leaves/text alone cannot supply it.
        let cornerSupport = false;
        if (runLength >= 3 && runLength < support) {
          const at = Math.floor((start + offset - 1) / 2);
          const x = vertical ? line : at, y = vertical ? at : line;
          let count = 1;
          for (const sign of [-1, 1]) for (let distance = 1; distance < support; distance++) {
            const col = x + (vertical ? sign * distance : 0), row = y + (vertical ? 0 : sign * distance);
            if (col < 0 || row < 0 || col >= w || row >= h || !walls[row * w + col]) break;
            count++;
          }
          cornerSupport = count >= support;
        }
        if (runLength < support && !cornerSupport) continue;
        const gapLength = start - previousEnd;
        if (previousEnd >= 0 && gapLength > 0 && gapLength <= maxGap && previousLength >= support && (runLength >= support || cornerSupport)) {
          const candidate = vertical
              ? { a: { x: line + 0.5, y: previousEnd }, b: { x: line + 0.5, y: start } }
              : { a: { x: previousEnd, y: line + 0.5 }, b: { x: start, y: line + 0.5 } };
          let supported = true;
          if (previousCorner || cornerSupport) {
            const key = `${vertical ? 'v' : 'h'}:${Math.round(line / 4)}:${Math.round(previousEnd / 2)}:${Math.round(start / 2)}`;
            if (!cornerSymbols.has(key) && cornerSymbols.size < 128) {
              cornerSymbols.set(key, recognizeDoorwaySymbols({ width: w, height: h, ink, mmPerPx: scale }, [candidate])
                .some(door => door.evidence === 'swing-arc'));
            }
            supported = cornerSymbols.get(key) ?? false;
          }
          if (supported) {
            for (let p = previousEnd; p < start; p++) bridged[index(line, p)] = 1;
            if (gaps.length < 12000) gaps.push(candidate);
            else tooManyGaps = true;
          } else if (cornerSupport) continue; // An unproven short return must not interrupt two existing strong runs.
        }
        previousEnd = offset;
        previousLength = cornerSupport ? support : runLength;
        previousCorner = cornerSupport;
      }
    }
  };
  bridgeLines(false);
  bridgeLines(true);
  if (tooManyGaps) return fail('This plan contains too much detail to detect a room reliably. Draw the room outline instead.');
  return { w, h, sx, sy, scale, walls, ink, bridged, gaps };
}

function detectOutline(image: DetectionImage, seed: Px, options: { mmPerPx?: number }, removeFineStrokes = false, capture?: (analysis: Analysis) => void): DetectionResult {
  const analysis = analyse(image, options, removeFineStrokes);
  if ('ok' in analysis) return analysis;
  capture?.(analysis);
  const { w, h, sx, sy, scale, walls, bridged } = analysis;
  if (!Number.isFinite(seed.x) || !Number.isFinite(seed.y) || seed.x < 0 || seed.y < 0 || seed.x >= image.width || seed.y >= image.height) {
    return fail('Click a clear area inside the room on the plan.');
  }
  const x = Math.min(w - 1, Math.floor(seed.x / sx));
  const y = Math.min(h - 1, Math.floor(seed.y / sy));
  if (walls[y * w + x]) return fail('That point is on a wall, label or furniture. Click a clear area inside the room.');
  if (bridged[y * w + x]) return fail('An inferred wall crosses that point. Try another clear point, or draw the room outline.');

  const filled = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 1;
  queue[0] = y * w + x;
  filled[queue[0]!] = 1;
  let first = queue[0]!;
  let touchesEdge = false;
  while (head < tail) {
    const current = queue[head++]!;
    const col = current % w, row = Math.floor(current / w);
    if (current < first) first = current;
    if (col === 0 || row === 0 || col === w - 1 || row === h - 1) { touchesEdge = true; break; }
    for (let direction = 0; direction < 4; direction++) {
      const next = direction === 0 ? current - 1 : direction === 1 ? current + 1 : direction === 2 ? current - w : current + w;
      if (!filled[next] && !bridged[next]) { filled[next] = 1; queue[tail++] = next; }
    }
  }
  if (touchesEdge) return fail('The outline escapes through an opening or reaches the edge of the plan. Use Draw outline or Rectangle for this room.');
  const minArea = scale ? Math.max(40, 500_000 / (scale * scale)) : 64;
  if (tail < minArea) return fail('That enclosed area is too small to identify as a room. Click away from labels and furniture, or draw its outline.');
  if (tail > w * h * 0.85) return fail('The detected area covers almost the whole image. Draw the room outline instead.');

  const inside = (col: number, row: number) => col >= 0 && row >= 0 && col < w && row < h && filled[row * w + col] === 1;
  return traceRegion(analysis, inside, first, { x: x + 0.5, y: y + 0.5 }, removeFineStrokes);
}

function traceRegion(analysis: Analysis, inside: (col: number, row: number) => boolean, first: number, seed: Px, removeFineStrokes = false): DetectionResult {
  const { w, h, sx, sy, gaps } = analysis;
  // Follow directed grid edges with the room on the right. Start at the first filled pixel's top.
  const boundary = (col: number, row: number, direction: number) => {
    switch (direction) {
      case 0: return inside(col, row) && !inside(col, row - 1);
      case 1: return inside(col - 1, row) && !inside(col, row);
      case 2: return inside(col - 1, row - 1) && !inside(col - 1, row);
      default: return inside(col, row - 1) && !inside(col - 1, row - 1);
    }
  };
  const start = { x: first % w, y: Math.floor(first / w) };
  let cursor = { ...start };
  let direction = 0;
  const outline: Px[] = [{ ...start }];
  let complete = false;
  for (let steps = 0; steps < Math.min(w * h * 4, 100000); steps++) {
    cursor = { x: cursor.x + [1, 0, -1, 0][direction]!, y: cursor.y + [0, 1, 0, -1][direction]! };
    if (cursor.x === start.x && cursor.y === start.y) { complete = true; break; }
    const next = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4].find((d) => boundary(cursor.x, cursor.y, d));
    if (next === undefined) break;
    if (next !== direction) outline.push({ ...cursor });
    direction = next;
  }
  if (!complete || outline.length < 3 || outline.length > 4096) return fail('A clear room boundary could not be found. Draw the room outline instead.');
  const polygon = simplifyClosed(outline, removeFineStrokes ? 2.25 : 1.25);
  const originalArea = pixelPolygonArea(outline);
  if (polygon.length > 128 || polygon.length < 3 || new Set(polygon.map((p) => `${p.x},${p.y}`)).size !== polygon.length
    || !isSimplePolygon(polygon) || !pointInPixelPolygon(seed, polygon)
    || Math.abs(pixelPolygonArea(polygon) - originalArea) > originalArea * 0.025) {
    return fail('The boundary is too irregular to detect reliably. Use Draw outline for this room.');
  }
  // Keep only inferred spans adjoining this room, then collapse parallel pixel rows of one wall.
  const groups = new Map<string, { a: Px; b: Px; last: number; count: number }>();
  for (const originalGap of gaps) {
    let gap = originalGap;
    const vertical = gap.a.x === gap.b.x;
    let from = Infinity, to = -Infinity;
    for (let p = Math.ceil(vertical ? gap.a.y : gap.a.x); p < (vertical ? gap.b.y : gap.b.x); p++) {
      const col = vertical ? Math.floor(gap.a.x) : p;
      const row = vertical ? p : Math.floor(gap.a.y);
      if (vertical ? inside(col - 1, row) || inside(col + 1, row) : inside(col, row - 1) || inside(col, row + 1)) {
        from = Math.min(from, p);
        to = Math.max(to, p + 1);
      }
    }
    if (!Number.isFinite(from)) continue;
    gap = vertical ? { a: { x: gap.a.x, y: from }, b: { x: gap.b.x, y: to } }
      : { a: { x: from, y: gap.a.y }, b: { x: to, y: gap.b.y } };
    const key = vertical ? `v:${gap.a.y}:${gap.b.y}` : `h:${gap.a.x}:${gap.b.x}`;
    const at = vertical ? gap.a.x : gap.a.y;
    const existing = groups.get(key);
    if (existing && at - existing.last <= 5) {
      const midpoint = ((vertical ? existing.a.x : existing.a.y) * existing.count + at) / (existing.count + 1);
      if (vertical) existing.a.x = existing.b.x = midpoint;
      else existing.a.y = existing.b.y = midpoint;
      existing.count++;
      existing.last = at;
    } else groups.set(existing ? `${key}:${at}` : key, { a: { ...gap.a }, b: { ...gap.b }, count: 1, last: at });
  }
  const inferredGaps = [...groups.values()].map(({ a, b }) => ({ a, b }));
  if (inferredGaps.length > 32) return fail('Too many wall gaps make this outline uncertain. Draw the room outline instead.');
  return mapDetectionResult({
    ok: true,
    polygon,
    inferredGaps,
    detectedDoorways: recognizeDoorwaySymbols({ width: w, height: h, ink: analysis.ink, mmPerPx: analysis.scale }, inferredGaps),
    message: inferredGaps.length
      ? 'Dashed lines close possible door openings. Check every wall and adjust the outline before adding the room.'
      : 'Check the suggested outline follows the inside of the walls. Labels, furniture and open doorways can affect detection.',
  }, sx, sy);
}

function simplifyClosed(points: Px[], tolerance: number): Px[] {
  if (points.length <= 4) return points;
  let split = 1;
  let greatest = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i]!.x - points[0]!.x, points[i]!.y - points[0]!.y);
    if (d > greatest) { split = i; greatest = d; }
  }
  const simplify = (line: Px[]) => {
    const keep = new Uint8Array(line.length);
    keep[0] = keep[line.length - 1] = 1;
    const work: Array<[number, number]> = [[0, line.length - 1]];
    while (work.length) {
      const [a, b] = work.pop()!;
      const p = line[a]!, q = line[b]!;
      const dx = q.x - p.x, dy = q.y - p.y;
      const len2 = dx * dx + dy * dy;
      let farthest = -1, distance = tolerance;
      for (let i = a + 1; i < b; i++) {
        const r = line[i]!;
        const t = len2 ? Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.y - p.y) * dy) / len2)) : 0;
        const d = Math.hypot(r.x - p.x - t * dx, r.y - p.y - t * dy);
        if (d > distance) { distance = d; farthest = i; }
      }
      if (farthest >= 0) { keep[farthest] = 1; work.push([a, farthest], [farthest, b]); }
    }
    return line.filter((_, i) => keep[i]);
  };
  return [...simplify(points.slice(0, split + 1)).slice(0, -1), ...simplify([...points.slice(split), points[0]!]).slice(0, -1)];
}
