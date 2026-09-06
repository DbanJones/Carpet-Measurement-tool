import {
  shapeToPolygon,
  polygonAreaM2,
  polygonPerimeter,
  boundingBox,
  isRectilinear,
  verticalSlabs,
  walkToPolygon,
  fixingPerimeter,
  clipToXRange,
  areaInRange,
  normalizePolygon,
  pointInPolygon,
  extentOverRange,
  applyWallFeatures,
  doorwayProblem,
  edgeLength,
  hasOverlappingDoorways,
  isSimplePolygon,
  normalizeEdgeIndex,
  openingLength,
  rectanglePolygon,
} from './geometry';
import type { Doorway } from './types';

describe('shapeToPolygon', () => {
  it('rectangle 4.2 x 3.5 m', () => {
    const p = shapeToPolygon({ kind: 'rectangle', length: 4200, width: 3500 });
    expect(p).toHaveLength(4);
    expect(polygonAreaM2(p)).toBeCloseTo(14.7, 6);
    expect(polygonPerimeter(p)).toBe(15400);
    expect(isRectilinear(p)).toBe(true);
  });

  it('L-shape removes the cut-out area in every corner', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const p = shapeToPolygon({ kind: 'l_shape', length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: corner });
      expect(p).toHaveLength(6);
      expect(polygonAreaM2(p)).toBeCloseTo(30 - 3, 6);
      expect(polygonPerimeter(p)).toBe(22000); // perimeter of an L equals the bounding rectangle's
      expect(isRectilinear(p)).toBe(true);
    }
  });

  it('rectangle with a bay window (out) and a chimney breast (in)', () => {
    const p = shapeToPolygon({
      kind: 'rectangle_with_features',
      length: 5000,
      width: 4000,
      features: [
        { id: 'bay', wall: 'top', offset: 1000, width: 2000, depth: 600 },
        { id: 'cb', wall: 'bottom', offset: 1500, width: 1400, depth: -350 },
      ],
    });
    expect(isRectilinear(p)).toBe(true);
    expect(polygonAreaM2(p)).toBeCloseTo(20 + 1.2 - 0.49, 6);
    const bb = boundingBox(p);
    expect(bb.length).toBe(5000);
    expect(bb.width).toBe(4600);
  });

  it('walking the walls builds an L', () => {
    const p = walkToPolygon([
      { turn: 'straight', length: 6000 },
      { turn: 'right', length: 3000 },
      { turn: 'right', length: 2000 },
      { turn: 'left', length: 2000 },
      { turn: 'right', length: 4000 },
    ]);
    expect(polygonAreaM2(p)).toBeCloseTo(6 * 3 + 4 * 2, 6);
  });

  it('normalizes duplicate and collinear points', () => {
    const p = normalizePolygon([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 1000 },
      { x: 0, y: 1000 },
      { x: 0, y: 0 },
    ]);
    expect(p).toHaveLength(4);
  });
});

describe('verticalSlabs', () => {
  it('a rectangle is a single slab', () => {
    const s = verticalSlabs(shapeToPolygon({ kind: 'rectangle', length: 4000, width: 3000 }));
    expect(s).toEqual([{ x0: 0, x1: 4000, y0: 0, y1: 3000 }]);
  });

  it('an L-shape is two slabs', () => {
    const p = shapeToPolygon({ kind: 'l_shape', length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: 'top-right' });
    const s = verticalSlabs(p);
    expect(s).toEqual([
      { x0: 0, x1: 4000, y0: 0, y1: 5000 },
      { x0: 4000, x1: 6000, y0: 1500, y1: 5000 },
    ]);
    expect(extentOverRange(s, 0, 6000)).toEqual({ y0: 0, y1: 5000 });
    expect(extentOverRange(s, 4500, 6000)).toEqual({ y0: 1500, y1: 5000 });
  });

  it('diagonal walls use the bounding extent of the clipped edges', () => {
    // a rectangle with one corner cut off diagonally
    const p = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 3000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const s = verticalSlabs(p);
    // the diagonal slab still needs the full extent, so it merges with its neighbour
    expect(s).toEqual([{ x0: 0, x1: 4000, y0: 0, y1: 3000 }]);
    expect(polygonAreaM2(p)).toBeCloseTo(12 - 0.5, 6);
    // a genuine step in extent is kept separate
    const stepped = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 1000 },
      { x: 3000, y: 2000 },
      { x: 3000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    expect(verticalSlabs(stepped)).toEqual([
      { x0: 0, x1: 3000, y0: 0, y1: 3000 },
      { x0: 3000, x1: 4000, y0: 0, y1: 2000 },
    ]);
  });

  it('a bay window slab is deeper', () => {
    const p = shapeToPolygon({
      kind: 'rectangle_with_features',
      length: 5000,
      width: 4000,
      features: [{ id: 'bay', wall: 'top', offset: 1000, width: 2000, depth: 600 }],
    });
    const s = verticalSlabs(p);
    expect(s).toEqual([
      { x0: 0, x1: 1000, y0: 600, y1: 4600 },
      { x0: 1000, x1: 3000, y0: 0, y1: 4600 },
      { x0: 3000, x1: 5000, y0: 600, y1: 4600 },
    ]);
  });
});

describe('clipping and doorways', () => {
  it('clips to an x-range and measures area within it', () => {
    const p = shapeToPolygon({ kind: 'l_shape', length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: 'top-right' });
    expect(areaInRange(p, 0, 4000) / 1e6).toBeCloseTo(20, 6);
    expect(areaInRange(p, 4000, 6000) / 1e6).toBeCloseTo(7, 6);
    expect(clipToXRange(p, 4000, 6000).length).toBe(4);
  });

  it('fixing perimeter subtracts doorways', () => {
    const p = shapeToPolygon({ kind: 'rectangle', length: 4000, width: 3000 });
    const per = fixingPerimeter(p, [
      { id: 'd1', edgeIndex: 0, offset: 500, width: 838, transition: 'carpet' },
      { id: 'd2', edgeIndex: 2, offset: 3500, width: 900, transition: 'hard_floor' }, // clamped to edge end
    ]);
    expect(per).toBe(14000 - 838 - 500);
  });

  it('point in polygon', () => {
    const p = shapeToPolygon({ kind: 'l_shape', length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: 'top-right' });
    expect(pointInPolygon({ x: 1000, y: 1000 }, p)).toBe(true);
    expect(pointInPolygon({ x: 5000, y: 500 }, p)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, p)).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// Outlines and doorways that the UI can produce but the engine used to mishandle
// ---------------------------------------------------------------------------

describe('bad doorway positions', () => {
  const rect = rectanglePolygon(4000, 3000);

  it('a negative edge index is wrapped, not read off the end of the array', () => {
    // poly[-1] is undefined and the non-null assertions downstream used to throw out of the whole
    // estimate; DoorwaysEditor writes -1 for "the wall this used to sit on is gone".
    expect(normalizeEdgeIndex(rect, -1)).toBe(3);
    expect(normalizeEdgeIndex(rect, 7)).toBe(3);
    expect(() => edgeLength(rect, -1)).not.toThrow();
    expect(edgeLength(rect, -1)).toBe(3000);
    expect(fixingPerimeter(rect, [{ id: 'd', edgeIndex: -1, offset: 100, width: 900, transition: 'carpet' }])).toBe(14000 - 900);
  });

  it('reports a doorway whose wall no longer exists rather than reattaching it to another', () => {
    expect(doorwayProblem(rect, { id: 'd', edgeIndex: 5, offset: 100, width: 900, transition: 'carpet' })).toBe('no_such_edge');
    expect(doorwayProblem(rect, { id: 'd', edgeIndex: -1, offset: 100, width: 900, transition: 'carpet' })).toBe('no_such_edge');
    // starts past the end of a 3 m wall
    expect(doorwayProblem(rect, { id: 'd', edgeIndex: 1, offset: 3500, width: 900, transition: 'carpet' })).toBe('past_edge_end');
    expect(doorwayProblem(rect, { id: 'd', edgeIndex: 0, offset: 100, width: 900, transition: 'carpet' })).toBeNull();
  });

  it('merges openings that overlap on one wall instead of deducting them twice', () => {
    const a: Doorway = { id: 'a', edgeIndex: 0, offset: 100, width: 900, transition: 'carpet' };
    const b: Doorway = { id: 'b', edgeIndex: 0, offset: 200, width: 900, transition: 'carpet' };
    // 100–1000 and 200–1100 are one 1000 mm hole, not 1800 mm of hole
    expect(openingLength(rect, [a, b])).toBe(1000);
    expect(fixingPerimeter(rect, [a, b])).toBe(14000 - 1000);
    expect(hasOverlappingDoorways(rect, [a, b])).toBe(true);
    // openings on different walls, and openings that merely touch, are not overlaps
    expect(hasOverlappingDoorways(rect, [a, { ...b, edgeIndex: 2 }])).toBe(false);
    expect(openingLength(rect, [a, { ...b, offset: 1000 }])).toBe(1800);
  });
});

describe('outlines that cross themselves', () => {
  it('clamps a recess deeper than the room instead of building a bowtie', () => {
    // 4 x 3 m room with a 3.5 m deep chimney breast on the 3 m axis: the wall would come out through
    // the far side, cancelling part of the shoelace area and growing the bounding box.
    const poly = normalizePolygon(applyWallFeatures(4000, 3000, [{ id: 'f', wall: 'bottom', offset: 1000, width: 1400, depth: -3500 }]));
    expect(isSimplePolygon(poly)).toBe(true);
    expect(boundingBox(poly).width).toBe(3000); // not 3500
    expect(polygonAreaM2(poly)).toBeCloseTo(7.8, 6); // clamped area, not the 7.1 the bowtie reported
  });

  it('isSimplePolygon spots a crossed outline', () => {
    expect(isSimplePolygon(rectanglePolygon(4000, 3000))).toBe(true);
    expect(
      isSimplePolygon([
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 0, y: 3000 },
        { x: 4000, y: 3000 },
      ]),
    ).toBe(false);
  });
});
