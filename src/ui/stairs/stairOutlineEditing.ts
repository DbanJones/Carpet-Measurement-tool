import type { Landing, Point, Staircase } from '@engine/types';
import { isSimplePolygon, polygonAreaMm2 } from '@engine/geometry';
import { validStairOutlinePoints, validStepOutline } from '@engine/stairOutlines';
import { stairPlanGeometry, type StairPlanPiece } from './stairLayout';
import { outlinedStep } from './stepGeometry';
import { outlinesOverlap } from '../floorplan/outlineEditing';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const radians = (degrees: number) => degrees * Math.PI / 180;
const valid = (points: Point[]) => points.every((p, index) => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6
  && distance(p, points[(index + 1) % points.length]!) >= .05) && isSimplePolygon(points) && polygonAreaMm2(points) >= 100;
export function stairOutlineCornerIndices(piece: StairPlanPiece): number[] {
  if (piece.kind === 'landing') return piece.points.map((_, index) => index);
  if (piece.cornerIndices?.length) return piece.cornerIndices;
  const boundary = [...new Set([...(piece.entry ?? [0, 1]), ...(piece.exit ?? [3, 2]).slice().reverse()])];
  // Expose square border corners too; the sampled points along a smooth arc are not handles.
  const additional = piece.points.flatMap((point, index, points) => {
    if (boundary.includes(index)) return [];
    const before = points[(index + points.length - 1) % points.length]!, after = points[(index + 1) % points.length]!;
    const dot = (point.x - before.x) * (after.x - point.x) + (point.y - before.y) * (after.y - point.y);
    const denominator = distance(before, point) * distance(point, after);
    return denominator > 1e-7 && dot / denominator < Math.cos(20 * Math.PI / 180) ? [index] : [];
  });
  return [...boundary, ...additional];
}

export function outlinedLanding(landing: Landing, points: Point[], position: Point, heading: number): Landing {
  const angle = radians(heading);
  const local = points.map(point => ({ x: (point.x - position.x) * Math.sin(angle) - (point.y - position.y) * Math.cos(angle), y: (point.x - position.x) * Math.cos(angle) + (point.y - position.y) * Math.sin(angle) }));
  const width = Math.max(1, Math.ceil(Math.max(...local.map(p => p.x)) - Math.min(...local.map(p => p.x)) - 1e-7));
  const length = Math.max(1, Math.ceil(Math.max(...local.map(p => p.y)) - Math.min(...local.map(p => p.y)) - 1e-7));
  return { ...landing, width, length, outline: local.map(p => ({ x: p.x / width, y: p.y / length })) };
}

/** Old route sketches may contain wedges despite a rectangular measurement schedule. Preserve
 * their displayed boundaries on the first corner edit and adopt conservative measured bounds. */
export function prepareCornerEditing(staircase: Staircase): Staircase {
  if (staircase.steps.every(step => step.plan)) return staircase;
  const displayed = stairPlanGeometry(staircase, { normalize: false });
  let prepared: Staircase = { ...staircase, drawing: undefined, steps: staircase.steps.map(step => {
    if (step.plan) return step;
    const piece = displayed.pieces.find(item => item.id === step.id)!;
    const start = piece.start ?? piece.points[0]!;
    const heading = piece.heading ?? 90;
    return outlinedStep({ ...step, plan: { ...start, heading, turn: (piece.endHeading ?? heading) - heading } }, piece.points, piece.entry ?? [0, 1], piece.exit ?? [3, 2], stairOutlineCornerIndices(piece));
  }) };
  if (staircase.drawing) for (const landing of prepared.landings) {
    const previous = displayed.pieces.find(item => item.id === landing.id)!;
    const anchor = stairPlanGeometry(prepared, { normalize: false }).pieces.find(item => item.id === landing.id)!;
    const next = outlinedLanding({ ...landing, outlineExit: previous.exit }, previous.points, anchor.start!, anchor.heading!);
    prepared = { ...prepared, landings: prepared.landings.map(item => item.id === landing.id ? next : item) };
  }
  return prepared;
}

/** Apply an entire measured outline atomically, including sampled curves and shared edges. */
export function reshapeStairOutline(staircase: Staircase, id: string, points: Point[]): Staircase {
  const prepared = prepareCornerEditing(staircase);
  const original = stairPlanGeometry(prepared, { normalize: false });
  const target = original.pieces.find(piece => piece.id === id);
  if (!target || points.length !== target.points.length || !valid(points)
    || points.every((point, index) => distance(point, target.points[index]!) < .001)) return staircase;
  const polygons = new Map<string, Point[]>();
  for (const piece of original.pieces) {
    const next = piece.points.map(point => {
      const index = target.points.findIndex(from => distance(point, from) < .05);
      return index >= 0 && distance(point, points[index]!) >= .001 ? { ...points[index]! } : point;
    });
    if (next.every((point, index) => point === piece.points[index])) continue;
    if (!valid(next)) return staircase;
    polygons.set(piece.id, next);
  }
  let result: Staircase = { ...prepared, steps: prepared.steps.map(step => {
    const points = polygons.get(step.id);
    const piece = original.pieces.find(piece => piece.id === step.id)!;
    return points ? outlinedStep(step, points, piece.entry ?? [0, 1], piece.exit ?? [3, 2], stairOutlineCornerIndices(piece)) : step;
  }) };
  // A landing is attached to the incoming flight. Convert after step edits so its world corners
  // stay exactly where the user placed them, even if the preceding shared edge has moved.
  for (const landing of result.landings) {
    const points = polygons.get(landing.id);
    if (!points) continue;
    const piece = stairPlanGeometry(result, { normalize: false }).pieces.find(piece => piece.id === landing.id)!;
    result = { ...result, landings: result.landings.map(item => item.id === landing.id ? outlinedLanding(item, points, piece.start!, piece.heading!) : item) };
  }
  // If an edited exit has no coincident next corner (different widths or a landing), continue
  // the rest of the staircase from the changed exit while preserving each deliberate offset.
  const current = stairPlanGeometry(result, { normalize: false });
  let lastChanged = -1;
  original.pieces.forEach((piece, index) => { if (polygons.has(piece.id)) lastChanged = index; });
  const previousExit = original.pieces[lastChanged], nextExit = current.pieces.find(piece => piece.id === previousExit?.id);
  if (previousExit?.end && nextExit?.end) {
    const headingDelta = (nextExit.endHeading ?? 0) - (previousExit.endHeading ?? 0);
    const rotation = radians(((headingDelta + 180) % 360 + 360) % 360 - 180);
    const following = new Set(original.pieces.slice(lastChanged + 1).filter(piece => piece.stepIndex !== undefined).map(piece => piece.id));
    result = { ...result, steps: result.steps.map(step => {
      if (!following.has(step.id) || !step.plan) return step;
      const x = step.plan.x - previousExit.end!.x, y = step.plan.y - previousExit.end!.y;
      return { ...step, plan: { ...step.plan, x: nextExit.end!.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: nextExit.end!.y + x * Math.sin(rotation) + y * Math.cos(rotation), heading: step.plan.heading + rotation * 180 / Math.PI } };
    }) };
  }
  if (result.steps.some(step => step.outline && !validStepOutline(step.outline)) || result.landings.some(landing => landing.outline && !validStairOutlinePoints(landing.outline))) return staircase;
  const finished = stairPlanGeometry(result, { normalize: false }).pieces;
  for (let i = 0; i < finished.length; i++) for (let j = i + 2; j < finished.length; j++) {
    const a = finished[i]!, b = finished[j]!;
    const beforeA = original.pieces.find(piece => piece.id === a.id)!, beforeB = original.pieces.find(piece => piece.id === b.id)!;
    // Existing deliberate projections/legacy drawings remain editable. A new collision with
    // a different flight is rejected alongside crossed or collapsed neighbouring treads.
    if (outlinesOverlap(a.points, b.points) && !outlinesOverlap(beforeA.points, beforeB.points)) return staircase;
  }
  return result;
}
