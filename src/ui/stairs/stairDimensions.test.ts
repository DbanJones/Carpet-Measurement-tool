import type { Point, Staircase } from '@engine/types';
import { makeSteps } from '@store/projectStore';
import { isSimplePolygon } from '@engine/geometry';
import { curveSteps, editableSteps, moveSteps } from './stepEditing';
import { stairDimensions, setStairSideLength, setStairCornerAngle, setStairPointPosition } from './stairDimensions';
import { stairCornerHandles } from './stairShapeEditing';
import { stairPlanGeometry } from './stairLayout';
import { raisedStairSurfaces } from './stairPhysicalGeometry';

const stairs = (): Staircase => ({ id: 'stairs', name: 'Main stairs', productId: 'carpet', steps: makeSteps(6), landings: [], method: 'cap_and_band', openSides: 'none' });
const close = (a: Point, b: Point) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(.001);
const pieces = (staircase: Staircase) => stairPlanGeometry(staircase, { normalize: false }).pieces;

it('measures every actual side and corner and matches the main diagram handle labels', () => {
  const source = editableSteps(stairs()), id = source.steps[2]!.id;
  const dims = stairDimensions(source, id)!;
  expect(dims.sides.map(side => Math.round(side.length))).toEqual([860, source.steps[2]!.going, 860, source.steps[2]!.going]);
  expect(dims.corners.map(corner => corner.angle)).toEqual([90, 90, 90, 90]);
  const handles = stairCornerHandles(source, id);
  dims.corners.forEach(corner => close(corner.point, handles[Number(corner.label) - 1]!));
});

it('sets a physical side length, keeping its anchor and the shared neighbouring edge connected', () => {
  const source = editableSteps(stairs()), id = source.steps[2]!.id;
  const dims = stairDimensions(source, id)!, before = pieces(source);
  const edit = setStairSideLength(source, id, 0, 1000);
  expect(edit.error).toBeUndefined(); expect(edit.staircase).not.toBe(source);
  const after = stairDimensions(edit.staircase, id)!;
  expect(after.sides[0]!.length).toBeCloseTo(1000, 6);
  close(after.corners[0]!.point, dims.corners[0]!.point);
  const movedFrom = dims.corners[1]!.point, movedTo = after.corners[1]!.point;
  before.forEach((piece, i) => piece.points.forEach((point, index) => close(pieces(edit.staircase)[i]!.points[index]!, Math.hypot(point.x - movedFrom.x, point.y - movedFrom.y) < .001 ? movedTo : point)));
  expect(edit.staircase.steps[2]!.width).toBeGreaterThan(source.steps[2]!.width);
  expect(edit.staircase.steps.map(step => step.rise)).toEqual(source.steps.map(step => step.rise));
  const physical = raisedStairSurfaces(edit.staircase).surfaces.find(surface => surface.id === id)!;
  const shift = { x: physical.points[0]!.x - after.points[0]!.x, y: physical.points[0]!.y - after.points[0]!.y };
  physical.points.forEach((point, index) => close(point, { x: after.points[index]!.x + shift.x, y: after.points[index]!.y + shift.y }));
});

it('sets custom and right angles without moving the corner, changing outgoing length or breaking the polygon', () => {
  const source = editableSteps(stairs()), id = source.steps[2]!.id, original = stairDimensions(source, id)!;
  const edited = setStairCornerAngle(source, id, 0, 100);
  expect(edited.error).toBeUndefined();
  const dims = stairDimensions(edited.staircase, id)!;
  expect(dims.corners[0]!.angle).toBeCloseTo(100, 6);
  close(dims.corners[0]!.point, original.corners[0]!.point);
  expect(dims.sides[0]!.length).toBeCloseTo(original.sides[0]!.length, 6);
  const squared = setStairCornerAngle(edited.staircase, id, 0, 90);
  expect(stairDimensions(squared.staircase, id)!.corners[0]!.angle).toBeCloseTo(90, 6);
  expect(pieces(squared.staircase).every(piece => isSimplePolygon(piece.points))).toBe(true);
});

it('exposes curved-edge path lengths and every sampled point without treating arc chords as a bounding width', () => {
  const source = stairs(), id = source.steps[2]!.id;
  const curved = curveSteps(source, source.steps.slice(2, 5).map(step => step.id), -90, 150, 'round');
  const dims = stairDimensions(curved, id)!;
  expect(dims.corners).toHaveLength(4); expect(dims.points.length).toBeGreaterThan(dims.corners.length);
  const sideIndex = dims.sides.findIndex(side => side.curved), side = dims.sides[sideIndex]!;
  const first = dims.points[side.pointIndices[0]!]!, last = dims.points[side.pointIndices.at(-1)!]!;
  expect(side.length).toBeGreaterThan(Math.hypot(last.x - first.x, last.y - first.y));
  const edit = setStairSideLength(curved, id, sideIndex, side.length * 1.02);
  expect(edit.error).toBeUndefined();
  const changed = stairDimensions(edit.staircase, id)!;
  expect(changed.points).toHaveLength(dims.points.length);
  expect(changed.sides[sideIndex]!.length).toBeCloseTo(side.length * 1.02, 5);
  const sampled = side.pointIndices[1]!, point = changed.points[sampled]!;
  expect(setStairPointPosition(edit.staircase, id, sampled, { x: point.x + 1, y: point.y }).error).toBeUndefined();
});

it('edits all six true corners of a square winder with labels matching the main top-down handles', () => {
  const source = stairs(), curved = curveSteps(source, source.steps.slice(1, 4).map(step => step.id), -90, 150, 'square');
  const id = curved.steps[2]!.id, dims = stairDimensions(curved, id)!;
  expect(dims.corners).toHaveLength(6); expect(dims.sides).toHaveLength(6);
  const handles = stairCornerHandles(curved, id);
  dims.corners.forEach(corner => close(corner.point, handles[Number(corner.label) - 1]!));
});

it('rejects invalid dimensions, crossed polygons and new collisions with a nonadjacent flight atomically', () => {
  const source = editableSteps(stairs()), id = source.steps[0]!.id, dims = stairDimensions(source, id)!;
  for (const edit of [setStairSideLength(source, id, 0, 0), setStairCornerAngle(source, id, 0, NaN), setStairPointPosition(source, id, 1, dims.points[3]!), setStairPointPosition(source, id, 1, dims.points[0]!)]) {
    expect(edit.staircase).toBe(source); expect(edit.error).toBeTruthy();
  }
  const offset = moveSteps(source, [source.steps[4]!.id], { x: 1000, y: -1000 });
  const invalid = setStairSideLength(offset, id, 0, 2200);
  expect(invalid.staircase).toBe(offset); expect(invalid.error).toMatch(/overlap/);
});

it('preserves existing deliberate overlaps and skips unchanged numeric values', () => {
  const source = editableSteps(stairs()), id = source.steps[0]!.id;
  const offset = moveSteps(source, [source.steps[4]!.id], { x: 300, y: -1000 });
  expect(setStairSideLength(offset, id, 0, 850).error).toBeUndefined();
  expect(setStairSideLength(source, id, 0, 860)).toEqual({ staircase: source });
  expect(setStairCornerAngle(source, id, 0, 90)).toEqual({ staircase: source });
  expect(stairDimensions(source, 'missing')).toBeUndefined();
});
