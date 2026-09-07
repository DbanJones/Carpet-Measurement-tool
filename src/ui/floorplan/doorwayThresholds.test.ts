import { describe, expect, it } from 'vitest';
import { includeDoorThresholdFloor, resolveDoorThreshold, unionDoorRectangle } from './doorwayThresholds';
import type { DetectedDoorway } from './doorwaySymbols';
import { pixelPolygonArea, pointInPixelPolygon, type Px } from './tracing';
import { outlinesOverlap } from './outlineEditing';

const rectangle = (x: number, y: number, width: number, height: number): Px[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];
const door: DetectedDoorway = { a: { x: 40, y: 105 }, b: { x: 60, y: 105 }, hinge: { x: 40, y: 105 },
  leafEnd: { x: 40, y: 80 }, evidence: 'swing-arc', confidence: 'high' };
function success(result: ReturnType<typeof includeDoorThresholdFloor>) {
  expect(result.ok, !result.ok ? result.reason : undefined).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.polygon;
}

describe('straight threshold floor geometry', () => {
  it('adds only the doorway-width half-wall recess and leaves the rest of the room unchanged', () => {
    const outline = success(includeDoorThresholdFloor(rectangle(0, 0, 100, 100), door, 10));
    expect(outline).toHaveLength(8);
    expect(pixelPolygonArea(outline)).toBe(10100);
    expect(pointInPixelPolygon({ x: 50, y: 104 }, outline)).toBe(true);
    expect(pointInPixelPolygon({ x: 39, y: 104 }, outline)).toBe(false);
    expect(pointInPixelPolygon({ x: 50, y: 106 }, outline)).toBe(false);
  });

  it('puts adjoining rooms on the exact same threshold without overlap or an under-door gap', () => {
    const upper = success(includeDoorThresholdFloor(rectangle(0, 0, 100, 100), door, 10));
    const lower = success(includeDoorThresholdFloor(rectangle(0, 110, 100, 100), door, 10));
    expect(outlinesOverlap(upper, lower)).toBe(false);
    expect(pixelPolygonArea(upper) + pixelPolygonArea(lower)).toBe(20200);
    for (const y of [100.5, 104.5, 105.5, 109.5]) {
      expect([upper, lower].filter(outline => pointInPixelPolygon({ x: 50, y }, outline))).toHaveLength(1);
    }
    expect(upper).toContainEqual(door.a);
    expect(lower).toContainEqual(door.a);
  });

  it('fills a carved-out swing sector and replaces it with the straight closed threshold', () => {
    const carved = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 60, y: 100 },
      { x: 58, y: 90 }, { x: 50, y: 82 }, { x: 40, y: 80 }, { x: 40, y: 100 }, { x: 0, y: 100 }];
    const outline = success(includeDoorThresholdFloor(carved, door, 10));
    expect(pixelPolygonArea(outline)).toBe(10100);
    expect(pointInPixelPolygon({ x: 45, y: 95 }, outline)).toBe(true);
    expect(outline).toContainEqual(door.a);
    expect(outline).toContainEqual(door.b);
  });

  it('does not use a convex hull that fills unrelated room concavities', () => {
    const lShape = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 100 }, { x: 0, y: 100 }];
    const outline = success(includeDoorThresholdFloor(lShape, door, 10));
    expect(pointInPixelPolygon({ x: 80, y: 80 }, outline)).toBe(false);
    expect(pixelPolygonArea(outline) - pixelPolygonArea(lShape)).toBe(100);
  });

  it('refuses a doorway rectangle crossing a thick structural partition', () => {
    const walls = new Uint8Array(220 * 220);
    for (let y = 96; y < 112; y++) for (let x = 46; x < 55; x++) walls[y * 220 + x] = 1;
    expect(includeDoorThresholdFloor(rectangle(0, 0, 100, 100), door, 10, { width: 220, height: 220, walls }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/wall crosses/) });
  });

  it('does not mistake a thin printed leaf for a structural partition', () => {
    const walls = new Uint8Array(220 * 220);
    for (let y = 80; y < 108; y++) for (let x = 40; x < 42; x++) walls[y * 220 + x] = 1;
    const outline = success(includeDoorThresholdFloor(rectangle(0, 0, 100, 100), door, 10, { width: 220, height: 220, walls }));
    expect(pixelPolygonArea(outline)).toBe(10100);
  });

  it('derives the same centreline and width from opposite faces of a wall', () => {
    const gaps = Array.from({ length: 10 }, (_, i) => ({ a: { x: 40, y: 100.5 + i }, b: { x: 60, y: 100.5 + i } }));
    const upper = resolveDoorThreshold({ ...door, a: { x: 40, y: 100.5 }, b: { x: 60, y: 100.5 } }, gaps);
    const lower = resolveDoorThreshold({ ...door, a: { x: 40, y: 109.5 }, b: { x: 60, y: 109.5 } }, gaps);
    expect(upper.door.a).toEqual({ x: 40, y: 105 });
    expect(upper.door.b).toEqual({ x: 60, y: 105 });
    expect(lower).toEqual(upper);
    expect(upper.wallDepth).toBe(10);
  });

  it('retains the full jamb width when leaf ink narrows some rows through the opening', () => {
    const gaps = Array.from({ length: 10 }, (_, i) => ({ a: { x: i < 5 ? 41 : 40, y: 100.5 + i }, b: { x: i < 5 ? 59 : 60, y: 100.5 + i } }));
    const result = resolveDoorThreshold({ ...door, a: { x: 41, y: 100.5 }, b: { x: 59, y: 100.5 } }, gaps);
    expect(result.door.a).toEqual({ x: 40, y: 105 });
    expect(result.door.b).toEqual({ x: 60, y: 105 });
  });

  it('rejects disconnected additions and retains an already-contained rectangle', () => {
    const room = rectangle(0, 0, 100, 100);
    expect(unionDoorRectangle(room, rectangle(200, 200, 10, 10))).toBeNull();
    expect(pixelPolygonArea(unionDoorRectangle(room, rectangle(20, 20, 10, 10))!)).toBe(10000);
  });
});
