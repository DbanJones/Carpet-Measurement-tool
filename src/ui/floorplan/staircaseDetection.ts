import type { PlanReading, Point } from '@engine/types';
import type { DetectionImage } from './detection';
import { unionDoorRectangle } from './doorwayThresholds';

export interface DetectedStaircase {
  polygon: Point[];
  treads: Array<{ a: Point; b: Point }>;
  widthMm: number;
  goingMm: number;
  lengthMm: number;
  estimatedRisers: number;
  visibleTreads: number;
  headingDegrees: number;
  layout: 'straight' | 'turning';
  confidence: 'high' | 'medium';
  name?: string;
  message: string;
}
export interface StaircaseDetectionOptions { mmPerPx: number; reading?: PlanReading }
export interface StaircaseDetectionResult { candidates: DetectedStaircase[]; message: string }
interface Band { at: number; start: number; end: number; thickness: number }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Local drawing evidence only. A label cannot create a staircase or determine its rise/direction. */
export function detectStaircases(image: DetectionImage, options: StaircaseDetectionOptions, control: { cancelled?: () => boolean } = {}): StaircaseDetectionResult {
  const empty = (message: string): StaircaseDetectionResult => ({ candidates: [], message });
  const { width, height, data } = image, { mmPerPx, reading } = options;
  if (!Number.isFinite(mmPerPx) || mmPerPx <= 0) return empty('Confirm the plan scale before finding stairs.');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 20 || height < 20 || width * height > 1_600_000 || data.length < width * height * 4) return empty('This image could not be checked for stairs.');
  if (control.cancelled?.()) return empty('Stair detection cancelled.');
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    const alpha = data[i * 4 + 3]! / 255;
    ink[i] = 255 + alpha * (.2126 * data[i * 4]! + .7152 * data[i * 4 + 1]! + .0722 * data[i * 4 + 2]! - 255) < 218 ? 1 : 0;
  }
  // OCR strokes, dimension underlines and text baselines are not tread evidence.
  for (const line of reading?.lines.slice(0, 2000) ?? []) {
    if (![line.x, line.y, line.width, line.height].every(Number.isFinite)) continue;
    if (line.text.replace(/[^a-z0-9]/gi, '').length < 3 || (!line.reviewed && line.confidence < 40)) continue;
    const prefix = line.text.match(/^[^a-z0-9]*/i)?.[0].length ?? 0;
    const textLeft = line.x + prefix * line.width / Math.max(1, line.text.length);
    for (let y = Math.max(0, Math.floor(line.y - 1)); y < Math.min(height, Math.ceil(line.y + line.height + 1)); y++) {
      ink.fill(0, y * width + Math.max(0, Math.floor(textLeft)), y * width + Math.min(width, Math.ceil(line.x + line.width + 1)));
    }
  }
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height ? ink[Math.round(y) * width + Math.round(x)]! : 0;
  const minWidth = Math.max(9, 480 / mmPerPx), maxWidth = Math.min(200, 1900 / mmPerPx);
  const minGap = Math.max(3, 110 / mmPerPx), maxGap = Math.max(minGap, 380 / mmPerPx);
  const maxThickness = Math.max(2, Math.min(4, 70 / mmPerPx));
  const candidates: DetectedStaircase[] = [];
  const partialFlights = new Set<DetectedStaircase>();
  const point = (along: number, across: number, vertical: boolean): Point => vertical ? { x: across, y: along } : { x: along, y: across };
  const raySupport = (a: Point, b: Point) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    let hits = 0;
    for (let i = 2; i < steps - 1; i++) {
      const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
      if (dark(x, y) || dark(x - .7, y) || dark(x + .7, y) || dark(x, y - .7) || dark(x, y + .7)) hits++;
    }
    return hits / Math.max(1, steps - 3);
  };
  for (const vertical of [true, false]) {
    if (control.cancelled?.()) return empty('Stair detection cancelled.');
    const alongLimit = vertical ? height : width, acrossLimit = vertical ? width : height;
    const raw: Band[] = [];
    for (let at = 1; at < alongLimit - 1; at++) {
      let start = -1, last = -1, darkCount = 0;
      const flush = () => {
        const length = last - start + 1;
        if (start >= 0 && length >= minWidth && length <= maxWidth && darkCount / length >= .8) raw.push({ at, start, end: last, thickness: 1 });
        start = -1; darkCount = 0;
      };
      for (let across = 1; across < acrossLimit - 1; across++) {
        const p = point(at, across, vertical);
        if (dark(p.x, p.y)) { if (start < 0) start = across; last = across; darkCount++; }
        else if (start >= 0 && across - last > 1) flush();
      }
      flush();
    }
    // A thick wall counts once, then is discarded; it cannot become several parallel steps.
    const bands: Band[] = [];
    for (const run of raw) {
      let previous: Band | undefined;
      for (let i = bands.length - 1; i >= 0; i--) {
        const band = bands[i]!;
        if (run.at - band.at > 12) break;
        if (run.at - band.at <= (band.thickness + 1) / 2 + 1 && Math.abs(run.start - band.start) <= 2 && Math.abs(run.end - band.end) <= 2) { previous = band; break; }
      }
      if (previous) { previous.at = (previous.at * previous.thickness + run.at) / (previous.thickness + 1); previous.thickness++; }
      else bands.push({ ...run });
    }
    const thin = bands.filter(band => band.thickness <= maxThickness).slice(0, 7000);
    for (let index = 0; index < thin.length; index++) {
      if (index % 64 === 0 && control.cancelled?.()) return empty('Stair detection cancelled.');
      const first = thin[index]!, span = first.end - first.start;
      const aligned = thin.slice(index + 1).filter(band => band.at > first.at + minGap && band.at < first.at + maxGap * 24
        && Math.abs(band.start - first.start) <= Math.max(3, span * .16) && Math.abs(band.end - first.end) <= Math.max(3, span * .16));
      for (const second of aligned.filter(band => band.at - first.at <= maxGap).slice(0, 2)) {
        const gap = second.at - first.at, group = [first, second];
        for (const next of aligned) {
          const delta = next.at - group.at(-1)!.at;
          if (delta > gap * 1.25 + 1) break;
          if (delta >= gap * .75 - 1 && delta <= gap * 1.25 + 1) group.push(next);
        }
        if (group.length < 3) continue;
        let start = median(group.map(b => b.start)), end = median(group.map(b => b.end));
        const firstAt = first.at, lastAt = group.at(-1)!.at;
        const railAt = (across: number) => [0, -1, 1, -2, 2].map(offset => ({ at: across + offset, support: raySupport(point(firstAt, across + offset, vertical), point(lastAt, across + offset, vertical)) })).sort((a, b) => b.support - a.support)[0]!;
        const sideA = railAt(start), sideB = railAt(end);
        if (sideA.support >= .72) start = sideA.at;
        if (sideB.support >= .72) end = sideB.at;
        const treadWidth = end - start;
        if ((lastAt - firstAt) / treadWidth < .55) continue;
        // Repeated lines must connect to side rails, as on a flight of stairs. Loose hatching fails.
        const rails = [sideA, sideB].filter(side => side.support >= .72).length;
        if (rails < 2) continue;
        let low = firstAt, high = lastAt, fanLines: Array<{ a: Point; b: Point }> = [];
        for (const sign of [-1, 1]) {
          const at = sign < 0 ? firstAt : lastAt;
          let best: Array<{ a: Point; b: Point }> = [];
          for (const hingeAcross of [start, end]) for (const offset of [0, .25, .5, .75, 1]) {
            const hingeAt = at + sign * gap * offset;
            const hinge = point(hingeAt, hingeAcross, vertical), other = hingeAcross === start ? end : start;
            const rays: Array<{ a: Point; b: Point }> = [];
            for (let fraction = .25; fraction <= 1.55; fraction += .08) {
              const ray = { a: hinge, b: point(hingeAt + sign * treadWidth * fraction, other, vertical) };
              if (raySupport(ray.a, ray.b) >= .81 && (!rays.length || Math.hypot(ray.b.x - rays.at(-1)!.b.x, ray.b.y - rays.at(-1)!.b.y) > treadWidth * .24)) rays.push(ray);
            }
            if (rays.length > best.length) best = rays;
          }
          if (best.length >= 2) {
            fanLines.push(...best);
            const extents = best.flatMap(ray => [ray.a, ray.b]).map(p => vertical ? p.y : p.x);
            if (sign < 0) low = Math.min(low, ...extents); else high = Math.max(high, ...extents);
          }
        }
        // A fan cannot extend through a substantial transverse wall into the next room.
        for (const sign of [-1, 1]) {
          const edge = sign < 0 ? low : high, from = sign < 0 ? firstAt : lastAt;
          for (let at = from + sign * 3; sign < 0 ? at > edge : at < edge; at += sign) {
            let covered = 0;
            for (let across = start + 2; across < end - 2; across++) {
              if ([-1, 0, 1].every(delta => { const p = point(at + delta, across, vertical); return dark(p.x, p.y); })) covered++;
            }
            if (covered >= Math.max(1, treadWidth - 4) * .8) { if (sign < 0) low = at + 2; else high = at - 2; break; }
          }
        }
        fanLines = fanLines.filter(ray => [ray.a, ray.b].every(p => (vertical ? p.y : p.x) >= low && (vertical ? p.y : p.x) <= high));
        const nearbyLabel = reading?.lines.find(line => (line.reviewed || line.confidence >= 45) && /\b(?:stairs?|staircase|up|down|dn)\b/i.test(line.text)
          && Math.hypot(line.x + line.width / 2 - point((low + high) / 2, (start + end) / 2, vertical).x, line.y + line.height / 2 - point((low + high) / 2, (start + end) / 2, vertical).y) < treadWidth * 2);
        const partial = group.length < 5 && !fanLines.length && !nearbyLabel;
        const polygon = [point(low, start, vertical), point(low, end, vertical), point(high, end, vertical), point(high, start, vertical)];
        const centre = point((low + high) / 2, (start + end) / 2, vertical);
        const overlapping = candidates.find(candidate => {
          const xs = candidate.polygon.map(p => p.x), ys = candidate.polygon.map(p => p.y);
          return centre.x >= Math.min(...xs) - 3 && centre.x <= Math.max(...xs) + 3 && centre.y >= Math.min(...ys) - 3 && centre.y <= Math.max(...ys) + 3;
        });
        if (overlapping && overlapping.headingDegrees === (vertical ? 90 : 0)) continue;
        const candidate: DetectedStaircase = { polygon, treads: [...group.map(b => ({ a: point(b.at, start, vertical), b: point(b.at, end, vertical) })), ...fanLines],
          widthMm: Math.round(treadWidth * mmPerPx), goingMm: Math.round(median(group.slice(1).map((band, i) => band.at - group[i]!.at)) * mmPerPx), lengthMm: Math.round((high - low) * mmPerPx),
          visibleTreads: group.length + fanLines.length, estimatedRisers: group.length + fanLines.length + 1,
          headingDegrees: vertical ? 90 : 0, layout: fanLines.length ? 'turning' : 'straight', confidence: group.length >= 7 && nearbyLabel ? 'high' : 'medium',
          ...(nearbyLabel ? { name: 'Stairs' } : {}), message: `${group.length} regularly spaced tread lines${fanLines.length ? ' and a possible turning section' : ''} found. Confirm the full route, number of risers and direction; rise cannot be read from a floor plan.` };
        const joined = overlapping && (overlapping.layout === 'turning' || candidate.layout === 'turning') ? unionDoorRectangle(overlapping.polygon, polygon) : null;
        if (overlapping && joined) {
          overlapping.polygon = joined;
          overlapping.treads.push(...candidate.treads.filter(tread => !overlapping.treads.some(other => Math.hypot(tread.a.x - other.a.x, tread.a.y - other.a.y) < 3 && Math.hypot(tread.b.x - other.b.x, tread.b.y - other.b.y) < 3)));
          overlapping.layout = 'turning'; overlapping.visibleTreads = overlapping.treads.length; overlapping.estimatedRisers = overlapping.visibleTreads + 1;
          overlapping.lengthMm = Math.round((overlapping.estimatedRisers - 1) * overlapping.goingMm);
          overlapping.message = 'Connected flights and a possible turning section found. Confirm the full route, number of risers and direction; rise cannot be read from a floor plan.';
          partialFlights.delete(overlapping);
        } else if (!overlapping) { candidates.push(candidate); if (partial) partialFlights.add(candidate); }
        break;
      }
      if (candidates.length >= 20) break;
    }
  }
  const accepted = candidates.filter(candidate => !partialFlights.has(candidate)).sort((a, b) => Math.min(...a.polygon.map(p => p.x)) - Math.min(...b.polygon.map(p => p.x)) || Math.min(...a.polygon.map(p => p.y)) - Math.min(...b.polygon.map(p => p.y))).slice(0, 20);
  return { candidates: accepted, message: accepted.length ? `${accepted.length} possible staircase${accepted.length === 1 ? '' : 's'} found. Review the route and step count before adding.` : 'No clear repeated stair treads were found. You can draw stairs manually.' };
}
