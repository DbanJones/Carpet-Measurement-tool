import type { Point, Staircase } from '@engine/types';
import { editableSteps, reconcileStepPlans } from './stepEditing';
import { defaultStairLayout, stairPlanGeometry } from './stairLayout';
import { outlinedLanding, prepareCornerEditing, reshapeStairOutline, stairOutlineCornerIndices as indices } from './stairOutlineEditing';
export { reshapeStairOutline } from './stairOutlineEditing';
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Raw world coordinates. Handle order follows the footprint perimeter and remains stable during a drag. */
export function stairCornerHandles(staircase: Staircase, id: string): Point[] {
  const piece = stairPlanGeometry(staircase, { normalize: false }).pieces.find(piece => piece.id === id);
  return piece ? indices(piece).map(index => piece.points[index]!) : [];
}

/** Move a shared boundary once: touching treads update together, keeping their other corners fixed. */
export function reshapeStairCorner(staircase: Staircase, id: string, cornerIndex: number, position: Point): Staircase {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return staircase;
  const prepared = prepareCornerEditing(staircase);
  const original = stairPlanGeometry(prepared, { normalize: false });
  const target = original.pieces.find(piece => piece.id === id);
  if (!target) return staircase;
  const pointIndex = indices(target)[cornerIndex];
  const from = pointIndex === undefined ? undefined : target.points[pointIndex];
  if (!from || distance(from, position) < .001) return staircase;
  return reshapeStairOutline(staircase, id, target.points.map((point, index) => index === pointIndex ? position : point));
}

/** One familiar notched shape, then individual corner editing for the actual survey. */
export function setLandingOutline(staircase: Staircase, id: string, shape: 'rectangle' | 'l_shape'): Staircase {
  const prepared = editableSteps(staircase);
  const landing = prepared.landings.find(item => item.id === id);
  if (!landing) return staircase;
  const reset = { ...prepared, landings: prepared.landings.map(item => item.id === id ? { ...item, outline: undefined, outlineExit: undefined } : item) };
  if (shape === 'rectangle') return reconcileStepPlans(prepared, reset);
  const piece = stairPlanGeometry(reset, { normalize: false }).pieces.find(item => item.id === id)!;
  const [a, b, c, d] = piece.points as [Point, Point, Point, Point];
  const mid = (p: Point, q: Point): Point => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const left = landing.kind === 'quarter' && defaultStairLayout(staircase).direction === 'left';
  const points = left ? [a, b, mid(b, c), mid(a, c), mid(c, d), d] : [a, b, c, mid(c, d), mid(a, c), mid(d, a)];
  const outlineExit: [number, number] = landing.kind === 'half' ? [1, 0] : landing.kind === 'top' ? [3, 2] : left ? [0, 5] : [2, 1];
  const changed = outlinedLanding({ ...landing, outlineExit }, points, piece.start!, piece.heading!);
  return reconcileStepPlans(prepared, { ...prepared, landings: prepared.landings.map(item => item.id === id ? changed : item) });
}
