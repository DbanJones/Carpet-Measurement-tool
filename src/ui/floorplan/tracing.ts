/**
 * Pure helpers for floor-plan calibration and tracing.
 *
 * Two coordinate spaces meet here:
 * - plan PIXELS (`Px`): coordinates on the uploaded raster, independent of the on-screen zoom;
 * - MILLIMETRES (`Point`): the engine's room coordinates, always normalised so min x/y = 0.
 *
 * Everything in this module is deterministic and DOM-free so it can be unit tested.
 */
import type { Doorway, Mm, Point, Polygon, Room } from '@engine/types';
import { boundingBox, normalizePolygon, shapeToPolygon } from '@engine/geometry';

/** A point on the plan raster, in image pixels (fractional when placed at zoom > 100%). */
export interface Px {
  x: number;
  y: number;
}

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export function pixelDistance(a: Px, b: Px): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Snap `p` onto the horizontal or vertical line through `prev`, whichever it is closer to. */
export function snapOrthogonal(prev: Px, p: Px): Px {
  const dx = Math.abs(p.x - prev.x);
  const dy = Math.abs(p.y - prev.y);
  return dx >= dy ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y };
}

/** True when the two points are within `tol` (same units as the points) of each other. */
export function closeEnough(a: Px, b: Px, tol: number): boolean {
  return pixelDistance(a, b) <= tol;
}

export interface EdgeHit {
  /** Edge i runs from vertex i to vertex i+1 (wrapping). */
  edgeIndex: number;
  /** Position along the edge, 0 at its start vertex, 1 at its end (clamped). */
  t: number;
  /** Distance from the query point to the projected point. */
  distance: number;
  /** The projected point on the edge. */
  point: Px;
}

/** Project `p` onto one edge of the polygon (clamped to the segment). */
export function projectOntoEdge(polygon: Px[], edgeIndex: number, p: Px): EdgeHit {
  const n = polygon.length;
  const a = polygon[edgeIndex % n]!;
  const b = polygon[(edgeIndex + 1) % n]!;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  const point = { x: a.x + vx * t, y: a.y + vy * t };
  return { edgeIndex: edgeIndex % n, t, distance: pixelDistance(p, point), point };
}

/** The polygon edge closest to `p`, or null for a degenerate polygon (< 2 vertices). */
export function nearestEdge(polygon: Px[], p: Px): EdgeHit | null {
  if (polygon.length < 2) return null;
  let best: EdgeHit | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const hit = projectOntoEdge(polygon, i, p);
    if (!best || hit.distance < best.distance) best = hit;
  }
  return best;
}

/** Scale plan pixels to millimetres (rounded to whole mm — the engine likes integers). */
export function pixelsToMm(points: Px[], mmPerPx: number): Point[] {
  return points.map((p) => ({ x: Math.round(p.x * mmPerPx), y: Math.round(p.y * mmPerPx) }));
}

/** Millimetres per pixel from two clicked points and the real distance between them; null if unusable. */
export function mmPerPxFromCalibration(a: Px, b: Px, distance: Mm): number | null {
  const px = pixelDistance(a, b);
  if (!(px > 0) || !(distance > 0) || !Number.isFinite(distance)) return null;
  return distance / px;
}

/** A traced pixel outline as an engine polygon: scaled to mm, cleaned and moved so min x/y = 0. */
export function traceToPolygon(points: Px[], mmPerPx: number): Polygon {
  return normalizePolygon(pixelsToMm(points, mmPerPx));
}

/**
 * Maps a traced room's millimetre polygon back onto the plan raster: `px = originPx + mm * pxPerMm`.
 * Derived from the room's own pixel outline and shape (not the plan's current calibration), so
 * overlays stay put even if the user later re-calibrates the plan.
 */
export interface PlanTransform {
  originPx: Px;
  pxPerMm: number;
}

export function roomPlanTransform(room: Pick<Room, 'shape' | 'source'>): PlanTransform | null {
  const pixelPolygon = room.source?.pixelPolygon;
  if (!pixelPolygon || pixelPolygon.length < 2) return null;
  let mmPolygon: Polygon;
  try {
    mmPolygon = shapeToPolygon(room.shape);
  } catch {
    return null;
  }
  if (mmPolygon.length < 2) return null;
  const pb = boundingBox(pixelPolygon);
  const mb = boundingBox(mmPolygon);
  const pxW = pb.maxX - pb.minX;
  const pxH = pb.maxY - pb.minY;
  const mmW = mb.maxX - mb.minX;
  const mmH = mb.maxY - mb.minY;
  // Use the larger span for the ratio (more precise); fall back to the other if it is degenerate.
  let pxPerMm: number;
  if (mmW >= mmH && mmW > 0) pxPerMm = pxW / mmW;
  else if (mmH > 0) pxPerMm = pxH / mmH;
  else return null;
  if (!(pxPerMm > 0) || !Number.isFinite(pxPerMm)) return null;
  return { originPx: { x: pb.minX - mb.minX * pxPerMm, y: pb.minY - mb.minY * pxPerMm }, pxPerMm };
}

export function mmToPx(t: PlanTransform, p: Point): Px {
  return { x: t.originPx.x + p.x * t.pxPerMm, y: t.originPx.y + p.y * t.pxPerMm };
}

export function pxToMm(t: PlanTransform, p: Px): Point {
  return { x: (p.x - t.originPx.x) / t.pxPerMm, y: (p.y - t.originPx.y) / t.pxPerMm };
}

export type DoorwayPlacement = Pick<Doorway, 'edgeIndex' | 'offset' | 'width'> & {
  /** How far the further of the two clicks was from the chosen edge (same units as the polygon). */
  maxDistance: number;
};

/**
 * Turn two clicks on/near a wall into a doorway on that wall: both points are projected onto the
 * single edge that fits them best (smallest combined distance); the opening runs between the
 * projections. Returns null when the polygon is degenerate or the opening would be narrower than 1.
 */
export function doorwayFromPoints(polygon: Point[], a: Point, b: Point): DoorwayPlacement | null {
  if (polygon.length < 2) return null;
  let bestEdge = -1;
  let bestScore = Infinity;
  let bestA: EdgeHit | null = null;
  let bestB: EdgeHit | null = null;
  for (let i = 0; i < polygon.length; i++) {
    const ha = projectOntoEdge(polygon, i, a);
    const hb = projectOntoEdge(polygon, i, b);
    const score = ha.distance + hb.distance;
    if (score < bestScore) {
      bestScore = score;
      bestEdge = i;
      bestA = ha;
      bestB = hb;
    }
  }
  if (bestEdge < 0 || !bestA || !bestB) return null;
  const start = polygon[bestEdge]!;
  const end = polygon[(bestEdge + 1) % polygon.length]!;
  const len = pixelDistance(start, end);
  const t0 = Math.min(bestA.t, bestB.t);
  const t1 = Math.max(bestA.t, bestB.t);
  const width = Math.round((t1 - t0) * len);
  if (width < 1) return null;
  return {
    edgeIndex: bestEdge,
    offset: Math.round(t0 * len),
    width,
    maxDistance: Math.max(bestA.distance, bestB.distance),
  };
}

/** Ray-cast point-in-polygon for pixel outlines (boundary counts as inside). */
export function pointInPixelPolygon(p: Px, polygon: Px[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (projectOntoEdge(polygon, j, p).distance < 1e-6) return true;
    const intersects = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Absolute shoelace area of a pixel polygon (px²), used to prefer the smallest room under a click. */
export function pixelPolygonArea(polygon: Px[]): number {
  let s = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

/** SVG `points` attribute for a polyline/polygon. */
export function svgPoints(points: Px[]): string {
  return points.map((p) => `${round1(p.x)},${round1(p.y)}`).join(' ');
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
