import type { Point, Step } from '@engine/types';
import type { StairPlanPiece } from './stairLayout';
import { measuredStepGeometry } from './stepGeometry';

export type StepResizeDimension = 'width' | 'going';
export type StepResizePatch = Partial<Pick<Step, StepResizeDimension>>;
export interface StepResizeHandle {
  dimension: StepResizeDimension;
  position: Point;
  /** Direction in plan space in which this measurement increases. */
  direction: Point;
  /** Measured millimetres per millimetre travelled along direction. */
  sensitivity: number;
}
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const normalAngle = (angle: number) => ((angle + 540) % 360) - 180;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function middleOfEdge(points: Point[]): Point {
  const lengths = points.slice(1).map((point, index) => distance(points[index]!, point));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (remaining <= length && length > 0) {
      const a = points[index]!, b = points[index + 1]!;
      return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length };
    }
    remaining -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}

function handlePosition(piece: Pick<StairPlanPiece, 'points' | 'start' | 'end' | 'heading' | 'endHeading'>, dimension: StepResizeDimension): Point {
  const points = piece.points;
  if (points.length < 4) return piece.end ?? points[0] ?? { x: 0, y: 0 };
  const turning = Math.abs(normalAngle((piece.endHeading ?? 90) - (piece.heading ?? 90))) > .001;
  if (turning) {
    const outerEdge = points.slice(Math.floor(points.length / 2));
    return dimension === 'width' ? middleOfEdge(outerEdge) : outerEdge[0]!;
  }
  return dimension === 'width' ? midpoint(points[1]!, points[2]!) : piece.end ?? midpoint(points[2]!, points[3]!);
}

/** Place handles on the tread edges and account for curved geometry when converting movement. */
export function stepResizeHandles(step: Step, piece: StairPlanPiece): StepResizeHandle[] {
  const heading = piece.heading ?? step.plan?.heading ?? 90;
  const turn = normalAngle((piece.endHeading ?? heading) - heading);
  const plan = { ...(piece.start ?? { x: 0, y: 0 }), heading, turn };
  const base = measuredStepGeometry(step, plan);
  return (['width', 'going'] as const).map(dimension => {
    // Numerical differentiation follows the actual measured radial tread, including
    // the change of angle when its widest going changes with a fixed narrow edge.
    const increment = Math.max(.1, step[dimension] * .0001);
    const changed = measuredStepGeometry({ ...step, [dimension]: step[dimension] + increment }, plan);
    const before = handlePosition(base, dimension), after = handlePosition(changed, dimension);
    const dx = (after.x - before.x) / increment, dy = (after.y - before.y) / increment;
    const length = Math.hypot(dx, dy);
    const angle = heading * Math.PI / 180;
    return { dimension, position: handlePosition(piece, dimension),
      direction: length > .00001 ? { x: dx / length, y: dy / length } : dimension === 'width' ? { x: Math.sin(angle), y: -Math.cos(angle) } : { x: Math.cos(angle), y: Math.sin(angle) },
      sensitivity: length > .00001 ? Math.min(20, 1 / length) : dimension === 'width' ? 2 : 1 };
  });
}

export function minimumStepResize(step: Step, dimension: StepResizeDimension): number {
  return dimension === 'going' && step.kind === 'winder' && !step.outline ? Math.max(10, (step.goingNarrow ?? 0) + 1) : 10;
}

export function resizeStepDimension(step: Step, dimension: StepResizeDimension, delta: number): StepResizePatch {
  if (!Number.isFinite(delta)) return {};
  return { [dimension]: Math.max(minimumStepResize(step, dimension), Math.min(1000000, Math.round(step[dimension] + delta))) };
}

export function resizeStepByVector(step: Step, handle: StepResizeHandle, delta: Point): StepResizePatch {
  return resizeStepDimension(step, handle.dimension, (delta.x * handle.direction.x + delta.y * handle.direction.y) * handle.sensitivity);
}
