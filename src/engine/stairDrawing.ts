import type { Point } from './types';

export const MAX_STAIR_DRAWING_POINTS = 16;
const EPSILON = 1e-6;

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.abs(cross(a, b, p)) <= EPSILON
    && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON || abC < -EPSILON && abD > EPSILON)
    && (cdA > EPSILON && cdB < -EPSILON || cdA < -EPSILON && cdB > EPSILON))
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Validate the open walking line, allowing distinct, parallel flights of a U-shaped staircase. */
export function validateDrawing(points: readonly Point[]): string | null {
  if (points.length < 2) return 'Add at least two points, from the bottom of the stairs to the top.';
  if (points.length > MAX_STAIR_DRAWING_POINTS) return `Use up to ${MAX_STAIR_DRAWING_POINTS} points for the staircase direction.`;
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e6 || Math.abs(point.y) > 1e6)) {
    return 'Use finite points within the drawing canvas.';
  }
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!, current = points[i]!;
    if (Math.hypot(current.x - previous.x, current.y - previous.y) < EPSILON) return 'Move or remove points that sit on top of each other.';
    if (i > 1) {
      const before = points[i - 2]!;
      const ax = previous.x - before.x, ay = previous.y - before.y;
      const bx = current.x - previous.x, by = current.y - previous.y;
      if (Math.abs(ax * by - ay * bx) < EPSILON && ax * bx + ay * by < 0) return 'Leave space between the returning flights; the walking line cannot double back on itself.';
    }
    for (let j = 1; j < i - 1; j++) {
      if (intersects(points[j - 1]!, points[j]!, previous, current)) return 'The walking line crosses itself. Move a corner to separate the flights.';
    }
  }
  return null;
}
