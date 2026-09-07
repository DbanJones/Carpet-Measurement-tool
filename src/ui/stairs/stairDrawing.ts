import type { Point, Staircase, StairDrawing } from '@engine/types';
import { validateDrawing } from '@engine/stairDrawing';
import type { StairPlanPiece } from './stairLayout';

export { validateDrawing, MAX_STAIR_DRAWING_POINTS } from '@engine/stairDrawing';

export interface StairDrawingGeometry {
  pieces: StairPlanPiece[];
  route: Point[];
  width: number;
  height: number;
  /** geometryPoint = sketchPoint * scale + offset; useful for stable node editing. */
  drawingTransform: { scale: number; offsetX: number; offsetY: number };
}

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const interpolate = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const lengthOr = (value: number | undefined, fallback = 1): number => Number.isFinite(value) && value! > 0 ? Math.min(1e7, value!) : fallback;

/** Compact editable directions for an existing staircase; this never changes its measurements. */
export function defaultDrawing(staircase: Staircase): StairDrawing {
  if (staircase.drawing && !validateDrawing(staircase.drawing.points)) return structuredClone(staircase.drawing);
  const landing = staircase.landings.find((item) => item.kind !== 'top' && item.afterStepIndex < staircase.steps.length - 1);
  const firstWinder = staircase.steps.findIndex((step) => step.kind === 'winder');
  const kind = staircase.layout?.kind ?? (landing ? landing.kind === 'half' ? 'half_turn' : 'quarter_turn' : firstWinder >= 0 ? 'quarter_turn' : 'straight');
  const direction = staircase.layout?.direction === 'left' ? -1 : 1;
  const turnAt = staircase.layout?.turnStartIndex ?? (landing ? landing.afterStepIndex + 1 : firstWinder >= 0 ? firstWinder : Math.floor(staircase.steps.length / 2));
  const lower = Math.max(30, Math.min(140, 160 * turnAt / Math.max(1, staircase.steps.length)));
  if (kind === 'straight') return { points: [{ x: 0, y: 0 }, { x: 0, y: 180 }] };
  if (kind === 'quarter_turn') return { points: [{ x: 0, y: 0 }, { x: 0, y: lower }, { x: direction * (180 - lower), y: lower }] };
  if (kind === 'half_turn') return { points: [{ x: 0, y: 0 }, { x: 0, y: lower }, { x: direction * 75, y: lower }, { x: direction * 75, y: lower - Math.max(40, 160 - lower) }] };
  const sweep = Math.max(15, Math.min(330, staircase.layout?.curveAngle ?? 180)) * Math.PI / 180;
  const count = Math.max(3, Math.ceil(sweep / (Math.PI / 4)));
  return { points: Array.from({ length: count + 1 }, (_, index) => {
    const angle = sweep * index / count;
    return { x: direction * 100 * (1 - Math.cos(angle)), y: 100 * Math.sin(angle), ...(index > 0 && index < count ? { curve: true } : {}) };
  }) };
}

/** Round the selected bends with tangent quadratic arcs. End points always stay fixed. */
function sampleRoute(drawing: StairDrawing): Point[] {
  const nodes = drawing.points;
  const route: Point[] = [{ x: nodes[0]!.x, y: nodes[0]!.y }];
  const append = (point: Point) => { if (distance(route.at(-1)!, point) > 1e-8) route.push(point); };
  for (let i = 1; i < nodes.length - 1; i++) {
    const before = nodes[i - 1]!, current = nodes[i]!, after = nodes[i + 1]!;
    if (!current.curve) { append({ x: current.x, y: current.y }); continue; }
    const trim = Math.min(distance(before, current), distance(current, after)) * .38;
    const start = interpolate(current, before, trim / distance(before, current));
    const end = interpolate(current, after, trim / distance(current, after));
    append(start);
    for (let part = 1; part <= 16; part++) {
      const t = part / 16, u = 1 - t;
      append({ x: u * u * start.x + 2 * u * t * current.x + t * t * end.x, y: u * u * start.y + 2 * u * t * current.y + t * t * end.y });
    }
  }
  append({ x: nodes.at(-1)!.x, y: nodes.at(-1)!.y });
  return route;
}

interface MeasuredPiece {
  id: string;
  kind: StairPlanPiece['kind'];
  label: string;
  stepIndex?: number;
  length: number;
  width: number;
}

function measuredPieces(staircase: Staircase): MeasuredPiece[] {
  const pieces: MeasuredPiece[] = [];
  const landingsAfter = (index: number) => {
    for (const landing of staircase.landings.filter((item) => Math.max(-1, Math.min(staircase.steps.length - 1, item.afterStepIndex)) === index)) {
      pieces.push({ id: landing.id, kind: 'landing', label: `${landing.kind} landing`, length: lengthOr(landing.length), width: lengthOr(landing.width) });
    }
  };
  landingsAfter(-1);
  staircase.steps.forEach((step, index) => {
    const going = lengthOr(step.going);
    pieces.push({ id: step.id, kind: step.kind === 'winder' ? 'winder' : 'tread', label: `Step ${index + 1}: ${step.kind}`, stepIndex: index,
      length: step.kind === 'winder' ? (going + lengthOr(step.goingNarrow, going)) / 2 : going, width: lengthOr(step.width) });
    landingsAfter(index);
  });
  return pieces;
}

function cumulativeLengths(route: Point[]): number[] {
  const lengths = [0];
  for (let i = 1; i < route.length; i++) lengths.push(lengths[i - 1]! + distance(route[i - 1]!, route[i]!));
  return lengths;
}

/** The capped offset bisects a join, so neighbouring treads share the same boundary. */
function joinNormal(route: Point[], index: number): Point {
  const current = route[index]!;
  const previous = route[Math.max(0, index - 1)]!;
  const next = route[Math.min(route.length - 1, index + 1)]!;
  const beforeLength = distance(previous, current), afterLength = distance(current, next);
  const before = beforeLength ? { x: -(current.y - previous.y) / beforeLength, y: (current.x - previous.x) / beforeLength } : undefined;
  const after = afterLength ? { x: -(next.y - current.y) / afterLength, y: (next.x - current.x) / afterLength } : undefined;
  if (!before) return after ?? { x: 1, y: 0 };
  if (!after) return before;
  const sum = { x: before.x + after.x, y: before.y + after.y };
  const magnitude = Math.hypot(sum.x, sum.y);
  if (magnitude < 1e-8) return after;
  const unit = { x: sum.x / magnitude, y: sum.y / magnitude };
  const factor = Math.min(1.6, 1 / Math.max(.001, unit.x * after.x + unit.y * after.y));
  return { x: unit.x * factor, y: unit.y * factor };
}

function crossing(a: Point, b: Point, c: Point, d: Point): Point | undefined {
  const ab = { x: b.x - a.x, y: b.y - a.y }, cd = { x: d.x - c.x, y: d.y - c.y };
  const denominator = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(denominator) < 1e-8) return;
  const delta = { x: c.x - a.x, y: c.y - a.y };
  const t = (delta.x * cd.y - delta.y * cd.x) / denominator;
  const u = (delta.x * ab.y - delta.y * ab.x) / denominator;
  if (t <= 1e-8 || t >= 1 - 1e-8 || u <= 1e-8 || u >= 1 - 1e-8) return;
  return interpolate(a, b, t);
}

/**
 * The inside offset of a corner folds back when a tread is closer than half a width to the bend.
 * Collapse that loop to its shared inside vertex, retaining an entry for every route station.
 * Nearby treads then fan around the corner instead of drawing bow-tie polygons over one another.
 */
function resolveOffsetLoops(points: Point[]): Point[] {
  const result = points.map(point => ({ ...point }));
  for (let pass = 0; pass < points.length; pass++) {
    let changed = false;
    outer: for (let i = 0; i < result.length - 1; i++) {
      if (distance(result[i]!, result[i + 1]!) < 1e-7) continue;
      for (let j = i + 2; j < result.length - 1; j++) {
        if (distance(result[j]!, result[j + 1]!) < 1e-7) continue;
        const point = crossing(result[i]!, result[i + 1]!, result[j]!, result[j + 1]!);
        if (!point) continue;
        for (let k = i + 1; k <= j; k++) result[k] = { ...point };
        changed = true;
        break outer;
      }
    }
    if (!changed) break;
  }
  return result;
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const squared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = squared ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / squared)) : 0;
  return distance(point, interpolate(a, b, t));
}

/** A non-blocking width check: drawings can remain schematic while dimensions are reviewed. */
export function drawingClearanceWarning(staircase: Staircase, drawing: StairDrawing = staircase.drawing ?? defaultDrawing(staircase)): string | null {
  if (validateDrawing(drawing.points)) return null;
  const route = drawing.points, lengths = cumulativeLengths(route);
  const measured = measuredPieces(staircase);
  const measuredLength = measured.reduce((sum, piece) => sum + piece.length, 0);
  const scale = measuredLength / Math.max(1e-8, cumulativeLengths(sampleRoute(drawing)).at(-1)!);
  const width = Math.max(1, ...staircase.steps.map(step => lengthOr(step.width)));
  for (let i = 0; i < route.length - 1; i++) {
    for (let j = i + 2; j < route.length - 1; j++) {
      // Local turns share their inside edge legitimately; check separated flights only.
      const midpointSeparation = (lengths[j]! + lengths[j + 1]! - lengths[i]! - lengths[i + 1]!) / 2;
      if (midpointSeparation * scale < width * 1.5) continue;
      const a = route[i]!, b = route[i + 1]!, c = route[j]!, d = route[j + 1]!;
      const separation = Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)) * scale;
      if (separation < width - 1) return 'The flights are closer together than the measured stair width. Widen the gap or check the dimensions; this remains a schematic drawing.';
    }
  }
  return null;
}

/**
 * Place the measured tread sequence along a drawn walking line. Sketch units are scaled to the
 * total measured going (winders use their centre going), and widths stay in measured millimetres.
 * This is explanatory plan geometry only: never a source of cut sizes or quantity changes.
 */
export function drawingGeometry(staircase: Staircase, drawing: StairDrawing = staircase.drawing ?? defaultDrawing(staircase)): StairDrawingGeometry {
  const usable = validateDrawing(drawing.points) ? { points: [{ x: 0, y: 0 }, { x: 0, y: 100 }] } : drawing;
  const rawRoute = sampleRoute(usable);
  const rawLengths = cumulativeLengths(rawRoute);
  const rawLength = rawLengths.at(-1)!;
  const measured = measuredPieces(staircase);
  const totalLength = measured.reduce((sum, piece) => sum + piece.length, 0) || 100;
  const scale = totalLength / Math.max(1e-8, rawLength);
  const route = rawRoute.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  const lengths = rawLengths.map((length) => length * scale);
  const boundaries = [0];
  for (const piece of measured) boundaries.push(boundaries.at(-1)! + piece.length);
  const allLengths = [...lengths, ...boundaries].sort((a, b) => a - b).filter((length, index, values) => index === 0 || length - values[index - 1]! > 1e-7);
  let segment = 0;
  const sampled = allLengths.map((length) => {
    while (segment < route.length - 2 && lengths[segment + 1]! < length - 1e-7) segment++;
    const amount = Math.max(0, Math.min(1, (length - lengths[segment]!) / Math.max(1e-8, lengths[segment + 1]! - lengths[segment]!)));
    return interpolate(route[segment]!, route[segment + 1]!, amount);
  });
  const normals = sampled.map((_, index) => joinNormal(sampled, index));
  const borders = new Map<number, { left: Point[]; right: Point[] }>();
  for (const width of new Set(measured.map(piece => piece.width))) {
    const offset = (sign: number) => resolveOffsetLoops(sampled.map((point, index) => ({ x: point.x + normals[index]!.x * width / 2 * sign, y: point.y + normals[index]!.y * width / 2 * sign })));
    borders.set(width, { left: offset(1), right: offset(-1) });
  }
  const pieces = measured.map((piece, pieceIndex): StairPlanPiece => {
    const first = boundaries[pieceIndex]!, last = boundaries[pieceIndex + 1]!;
    const indices = allLengths.flatMap((length, index) => length >= first - 1e-7 && length <= last + 1e-7 ? [index] : []);
    const border = borders.get(piece.width)!;
    const side = (index: number, sign: number): Point => (sign === 1 ? border.left : border.right)[index]!;
    return { id: piece.id, kind: piece.kind, label: piece.label, ...(piece.stepIndex !== undefined ? { stepIndex: piece.stepIndex } : {}),
      start: sampled[indices[0]!]!, end: sampled[indices.at(-1)!]!,
      heading: Math.atan2(sampled[Math.min(sampled.length - 1, indices[0]! + 1)]!.y - sampled[indices[0]!]!.y, sampled[Math.min(sampled.length - 1, indices[0]! + 1)]!.x - sampled[indices[0]!]!.x) * 180 / Math.PI,
      endHeading: Math.atan2(sampled[indices.at(-1)!]!.y - sampled[Math.max(0, indices.at(-1)! - 1)]!.y, sampled[indices.at(-1)!]!.x - sampled[Math.max(0, indices.at(-1)! - 1)]!.x) * 180 / Math.PI,
      entry: [0, indices.length * 2 - 1], exit: [indices.length - 1, indices.length],
      points: [...indices.map((index) => side(index, 1)), ...indices.slice().reverse().map((index) => side(index, -1))] };
  });
  const allPoints = [...sampled, ...pieces.flatMap((piece) => piece.points)];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of allPoints) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const shift = (point: Point): Point => ({ x: point.x - minX, y: point.y - minY });
  return { pieces: pieces.map((piece) => ({ ...piece, points: piece.points.map(shift), ...(piece.start ? { start: shift(piece.start) } : {}), ...(piece.end ? { end: shift(piece.end) } : {}) })), route: sampled.map(shift), width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY), drawingTransform: { scale, offsetX: -minX, offsetY: -minY } };
}
