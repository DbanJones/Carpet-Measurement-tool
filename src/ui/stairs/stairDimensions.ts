import type { Point, Staircase } from '@engine/types';
import { stairPlanGeometry } from './stairLayout';
import { reshapeStairOutline, stairCornerHandles } from './stairShapeEditing';

export interface StairDimensionCorner { label: string; pointIndex: number; point: Point; angle: number }
export interface StairDimensionSide {
  label: string; startCorner: number; endCorner: number;
  pointIndices: number[]; length: number; curved: boolean;
}
export interface StairDimensions { points: Point[]; corners: StairDimensionCorner[]; sides: StairDimensionSide[] }
export type StairDimensionEdit = { staircase: Staircase; error?: string };
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const orientation = (points: Point[]) => Math.sign(points.reduce((area, point, i) => { const next = points[(i + 1) % points.length]!; return area + point.x * next.y - next.x * point.y; }, 0)) || 1;
function cornerAngle(points: Point[], index: number): number {
  const a = points[(index + points.length - 1) % points.length]!, b = points[index]!, c = points[(index + 1) % points.length]!;
  const before = Math.atan2(a.y - b.y, a.x - b.x), after = Math.atan2(c.y - b.y, c.x - b.x);
  return ((orientation(points) * (before - after) * 180 / Math.PI) % 360 + 360) % 360;
}

/** Real tread geometry in staircase millimetres. Arc lengths follow the displayed curved path. */
export function stairDimensions(staircase: Staircase, stepId: string): StairDimensions | undefined {
  if (!staircase.steps.some(step => step.id === stepId)) return;
  const piece = stairPlanGeometry(staircase, { normalize: false }).pieces.find(piece => piece.id === stepId);
  if (!piece || piece.points.length < 3) return;
  const points = piece.points;
  const handleIndices = stairCornerHandles(staircase, stepId).map(handle => points.findIndex(point => distance(handle, point) < .001)).filter(index => index >= 0);
  const cornerIndices = [...new Set(handleIndices.length >= 3 ? handleIndices : points.map((_, index) => index))].sort((a, b) => a - b);
  // Match the numbered handles on the main top-down drawing, even when that handle order
  // differs from the perimeter order of a sampled curve or square outside corner.
  const corners = cornerIndices.map((pointIndex, index) => ({ label: String((handleIndices.indexOf(pointIndex) >= 0 ? handleIndices.indexOf(pointIndex) : index) + 1), pointIndex, point: points[pointIndex]!, angle: cornerAngle(points, pointIndex) }));
  const sides = corners.map((corner, index): StairDimensionSide => {
    const endCorner = (index + 1) % corners.length, last = corners[endCorner]!.pointIndex;
    const pointIndices = [corner.pointIndex];
    while (pointIndices.at(-1) !== last && pointIndices.length <= points.length) pointIndices.push((pointIndices.at(-1)! + 1) % points.length);
    const length = pointIndices.slice(1).reduce((sum, next, i) => sum + distance(points[pointIndices[i]!]!, points[next]!), 0);
    return { label: `${corner.label}–${corners[endCorner]!.label}`, startCorner: index, endCorner, pointIndices, length,
      curved: pointIndices.length > 2 && length - distance(corner.point, corners[endCorner]!.point) > .01 };
  });
  return { points, corners, sides };
}

function apply(staircase: Staircase, stepId: string, points: Point[]): StairDimensionEdit {
  const next = reshapeStairOutline(staircase, stepId, points);
  return next === staircase ? { staircase, error: 'That change would cross, collapse or overlap a tread or connected neighbour. Try a smaller adjustment.' } : { staircase: next };
}

/** Keep the selected side's first corner fixed and preserve its direction/curve while resizing. */
export function setStairSideLength(staircase: Staircase, stepId: string, sideIndex: number, length: number): StairDimensionEdit {
  const dimensions = stairDimensions(staircase, stepId), side = dimensions?.sides[sideIndex];
  if (!dimensions || !side) return { staircase, error: 'Select an existing tread side.' };
  if (!Number.isFinite(length) || length < 1 || length > 100000) return { staircase, error: 'Enter a side length between 1 mm and 100 m.' };
  if (Math.abs(length - side.length) < .001) return { staircase };
  if (side.length < .001) return { staircase, error: 'This side has no measurable length.' };
  const anchor = dimensions.points[side.pointIndices[0]!]!, factor = length / side.length;
  const moved = new Set(side.pointIndices.slice(1));
  const points = dimensions.points.map((point, index) => moved.has(index) ? { x: anchor.x + (point.x - anchor.x) * factor, y: anchor.y + (point.y - anchor.y) * factor } : point);
  return apply(staircase, stepId, points);
}

/** Keep this corner and its incoming side fixed; rotate its outgoing side without changing length. */
export function setStairCornerAngle(staircase: Staircase, stepId: string, cornerIndex: number, angle: number): StairDimensionEdit {
  const dimensions = stairDimensions(staircase, stepId), corner = dimensions?.corners[cornerIndex];
  if (!dimensions || !corner) return { staircase, error: 'Select an existing tread corner.' };
  if (!Number.isFinite(angle) || angle < 1 || angle > 359) return { staircase, error: 'Enter a corner angle between 1° and 359°.' };
  if (Math.abs(angle - corner.angle) < .001) return { staircase };
  const rotation = orientation(dimensions.points) * (corner.angle - angle) * Math.PI / 180;
  const moved = new Set(dimensions.sides[cornerIndex]!.pointIndices.slice(1));
  const points = dimensions.points.map((point, index) => {
    if (!moved.has(index)) return point;
    const x = point.x - corner.point.x, y = point.y - corner.point.y;
    return { x: corner.point.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: corner.point.y + x * Math.sin(rotation) + y * Math.cos(rotation) };
  });
  return apply(staircase, stepId, points);
}

/** Every polygon point is addressable; even intermediate arc points retain their shared joins. */
export function setStairPointPosition(staircase: Staircase, stepId: string, pointIndex: number, position: Point): StairDimensionEdit {
  const dimensions = stairDimensions(staircase, stepId), point = dimensions?.points[pointIndex];
  if (!dimensions || !point) return { staircase, error: 'Select an existing tread point.' };
  if (![position.x, position.y].every(Number.isFinite) || Math.max(Math.abs(position.x), Math.abs(position.y)) >= 1000000) return { staircase, error: 'Enter finite staircase coordinates below 1,000 m.' };
  if (distance(point, position) < .001) return { staircase };
  return apply(staircase, stepId, dimensions.points.map((point, index) => index === pointIndex ? position : point));
}
