import { describe, it, expect } from 'vitest';
import {
  snapOrthogonal,
  closeEnough,
  nearestEdge,
  projectOntoEdge,
  pixelsToMm,
  pixelDistance,
  mmPerPxFromCalibration,
  traceToPolygon,
  roomPlanTransform,
  mmToPx,
  pxToMm,
  doorwayFromPoints,
  pointInPixelPolygon,
  pixelPolygonArea,
  clampZoom,
  svgPoints,
} from './tracing';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];

describe('pixelDistance / closeEnough', () => {
  it('measures euclidean distance', () => {
    expect(pixelDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pixelDistance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
  it('closeEnough is inclusive of the tolerance', () => {
    expect(closeEnough({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true);
    expect(closeEnough({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.9)).toBe(false);
  });
});

describe('snapOrthogonal', () => {
  it('snaps to the horizontal when the move is mostly horizontal', () => {
    expect(snapOrthogonal({ x: 10, y: 10 }, { x: 50, y: 14 })).toEqual({ x: 50, y: 10 });
  });
  it('snaps to the vertical when the move is mostly vertical', () => {
    expect(snapOrthogonal({ x: 10, y: 10 }, { x: 13, y: -40 })).toEqual({ x: 10, y: -40 });
  });
  it('ties go horizontal', () => {
    expect(snapOrthogonal({ x: 0, y: 0 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 0 });
  });
});

describe('projectOntoEdge / nearestEdge', () => {
  it('projects onto the interior of an edge', () => {
    const hit = projectOntoEdge(square, 0, { x: 40, y: 7 });
    expect(hit).toMatchObject({ edgeIndex: 0, t: 0.4, distance: 7 });
    expect(hit.point).toEqual({ x: 40, y: 0 });
  });
  it('clamps beyond the ends of an edge', () => {
    expect(projectOntoEdge(square, 0, { x: -30, y: 5 }).t).toBe(0);
    expect(projectOntoEdge(square, 0, { x: 130, y: 5 }).t).toBe(1);
  });
  it('wraps the closing edge', () => {
    const hit = projectOntoEdge(square, 3, { x: -5, y: 30 });
    expect(hit.edgeIndex).toBe(3);
    expect(hit.t).toBeCloseTo(0.5);
    expect(hit.point).toEqual({ x: 0, y: 30 });
  });
  it('finds the closest edge', () => {
    expect(nearestEdge(square, { x: 50, y: 3 })).toMatchObject({ edgeIndex: 0, distance: 3 });
    expect(nearestEdge(square, { x: 97, y: 30 })).toMatchObject({ edgeIndex: 1, distance: 3 });
    expect(nearestEdge(square, { x: 50, y: 70 })).toMatchObject({ edgeIndex: 2, distance: 10 });
    expect(nearestEdge(square, { x: 2, y: 30 })).toMatchObject({ edgeIndex: 3, distance: 2 });
  });
  it('returns null for a degenerate polygon', () => {
    expect(nearestEdge([], { x: 0, y: 0 })).toBeNull();
    expect(nearestEdge([{ x: 1, y: 1 }], { x: 0, y: 0 })).toBeNull();
  });
});

describe('pixelsToMm / calibration', () => {
  it('scales and rounds to whole millimetres', () => {
    expect(pixelsToMm([{ x: 10.04, y: 20.5 }], 12.3)).toEqual([{ x: 123, y: 252 }]);
  });
  it('derives mm per pixel from two points and a real distance', () => {
    expect(mmPerPxFromCalibration({ x: 0, y: 0 }, { x: 0, y: 200 }, 4000)).toBe(20);
    expect(mmPerPxFromCalibration({ x: 10, y: 10 }, { x: 13, y: 14 }, 762)).toBeCloseTo(152.4);
  });
  it('rejects coincident points or a non-positive distance', () => {
    expect(mmPerPxFromCalibration({ x: 5, y: 5 }, { x: 5, y: 5 }, 762)).toBeNull();
    expect(mmPerPxFromCalibration({ x: 0, y: 0 }, { x: 5, y: 5 }, 0)).toBeNull();
    expect(mmPerPxFromCalibration({ x: 0, y: 0 }, { x: 5, y: 5 }, NaN)).toBeNull();
  });
  it('traceToPolygon scales, cleans and normalises to the origin', () => {
    const poly = traceToPolygon(
      [
        { x: 100, y: 50 },
        { x: 150, y: 50 }, // collinear, dropped
        { x: 300, y: 50 },
        { x: 300, y: 200 },
        { x: 100, y: 200 },
      ],
      10,
    );
    expect(poly).toEqual([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 1500 },
      { x: 0, y: 1500 },
    ]);
  });
});

describe('roomPlanTransform', () => {
  const room = {
    shape: { kind: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1500 }, { x: 0, y: 1500 }] },
    source: { floorPlanId: 'plan', pixelPolygon: [{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 200 }, { x: 100, y: 200 }] },
  };
  it('maps millimetres back onto the raster and inverts', () => {
    const t = roomPlanTransform(room)!;
    expect(t.pxPerMm).toBeCloseTo(0.1);
    expect(mmToPx(t, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(mmToPx(t, { x: 2000, y: 1500 })).toEqual({ x: 300, y: 200 });
    const back = pxToMm(t, { x: 200, y: 125 });
    expect(back.x).toBeCloseTo(1000);
    expect(back.y).toBeCloseTo(750);
  });
  it('is null for rooms not traced from a plan', () => {
    expect(roomPlanTransform({ shape: { kind: 'rectangle', length: 4000, width: 3000 } })).toBeNull();
  });
});

describe('doorwayFromPoints', () => {
  const mmSquare = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  it('places the opening on the best-fitting edge between the two projections', () => {
    const d = doorwayFromPoints(mmSquare, { x: 500, y: 40 }, { x: 1300, y: -20 })!;
    expect(d).toMatchObject({ edgeIndex: 0, offset: 500, width: 800 });
    expect(d.maxDistance).toBe(40);
  });
  it('orders the points along the edge whichever way they were clicked', () => {
    const d = doorwayFromPoints(mmSquare, { x: 3990, y: 2000 }, { x: 4010, y: 1200 })!;
    expect(d).toMatchObject({ edgeIndex: 1, offset: 1200, width: 800 });
  });
  it('returns null when the opening would have no width', () => {
    expect(doorwayFromPoints(mmSquare, { x: 500, y: 0 }, { x: 500, y: 0 })).toBeNull();
    expect(doorwayFromPoints([], { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('hit testing helpers', () => {
  it('pointInPixelPolygon', () => {
    expect(pointInPixelPolygon({ x: 50, y: 30 }, square)).toBe(true);
    expect(pointInPixelPolygon({ x: 150, y: 30 }, square)).toBe(false);
    expect(pointInPixelPolygon({ x: 0, y: 30 }, square)).toBe(true);
  });
  it('pixelPolygonArea', () => {
    expect(pixelPolygonArea(square)).toBe(6000);
  });
  it('clampZoom keeps zoom in range', () => {
    expect(clampZoom(0.01)).toBe(0.05);
    expect(clampZoom(0.1)).toBe(0.1); // large uploaded plans can fit a phone viewport
    expect(clampZoom(10)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(NaN)).toBe(1);
  });
  it('svgPoints formats to one decimal', () => {
    expect(svgPoints([{ x: 1.26, y: 2 }, { x: 3, y: 4.04 }])).toBe('1.3,2 3,4');
  });
});
