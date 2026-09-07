import type { Point, Step } from '@engine/types';
import { isSimplePolygon, polygonAreaMm2 } from '@engine/geometry';
import { measuredStepGeometry, outlinedStep } from './stepGeometry';

type TreadGeometry = ReturnType<typeof measuredStepGeometry>;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: Point, b: Point) => distance(a, b) < .05;

/** The two string edges in walking order, independent of polygon winding or turn direction. */
export function treadSides(piece: TreadGeometry): [Point[], Point[]] | undefined {
  const edge = (a: number, b: number, pair: [number, number]) => a === pair[0] && b === pair[1] || a === pair[1] && b === pair[0];
  const path = (start: number, end: number): Point[] | undefined => {
    if (start === end) return [piece.points[start]!];
    for (const direction of [-1, 1]) {
      const points = [piece.points[start]!];
      let at = start;
      for (let count = 0; count < piece.points.length; count++) {
        const next = (at + direction + piece.points.length) % piece.points.length;
        if (edge(at, next, piece.entry) || edge(at, next, piece.exit)) break;
        points.push(piece.points[next]!);
        if (next === end) return points;
        at = next;
      }
    }
  };
  const a = path(piece.entry[0], piece.exit[0]), b = path(piece.entry[1], piece.exit[1]);
  return a && b ? [a, b] : undefined;
}

function fromSides(step: Step, left: Point[], right: Point[]): Step | undefined {
  const compact = (points: Point[]) => points.filter((point, index) => !index || !same(point, points[index - 1]!));
  const a = compact(left), b = compact(right);
  const points = [...a, ...b.slice().reverse()];
  if (points.length > 64 || !isSimplePolygon(points) || polygonAreaMm2(points) < 100) return;
  const result = outlinedStep({ ...step, outline: undefined }, points, [0, points.length - 1], [a.length - 1, a.length]);
  // Removing every turning riser must not leave a single folded-back tread.
  return Math.abs(result.plan!.turn ?? 0) <= 170 ? result : undefined;
}

function divideSide(points: Point[]): [Point[], Point[]] {
  if (points.length === 1) return [points, points];
  const lengths = points.slice(1).map((point, index) => distance(points[index]!, point));
  const half = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let travelled = 0;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (travelled + length >= half - 1e-7) {
      const from = points[index]!, to = points[index + 1]!;
      const fraction = length ? (half - travelled) / length : 0;
      const midpoint = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
      return [[...points.slice(0, index + 1), midpoint], [midpoint, ...points.slice(index + 1)]];
    }
    travelled += length;
  }
  return [points, points.slice(-1)];
}

/** Divide a measured footprint without disturbing its outside walls or either adjoining tread. */
export function splitTread(step: Step, addedId: string): [Step, Step] | undefined {
  if (!step.plan) return;
  const sides = treadSides(measuredStepGeometry(step, step.plan));
  if (!sides) return;
  const [a, b] = sides.map(divideSide) as [[Point[], Point[]], [Point[], Point[]]];
  const first = fromSides(step, a[0], b[0]), second = fromSides({ ...step, id: addedId }, a[1], b[1]);
  return first && second ? [first, second] : undefined;
}

/** Remove an internal riser by joining its two measured footprints along their shared edge. */
export function mergeTreads(first: Step, second: Step, survivor: Step): Step | undefined {
  if (!first.plan || !second.plan) return;
  const a = treadSides(measuredStepGeometry(first, first.plan)), b = treadSides(measuredStepGeometry(second, second.plan));
  if (!a || !b || !same(a[0].at(-1)!, b[0][0]!) || !same(a[1].at(-1)!, b[1][0]!)) return;
  return fromSides(survivor, [...a[0], ...b[0].slice(1)], [...a[1], ...b[1].slice(1)]);
}
