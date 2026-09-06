/**
 * Planar geometry for rooms. Pure functions over `Polygon` (mm coordinates).
 *
 * Coordinate system: x runs along the room's `length`, y along its `width`; y grows "downwards"
 * on screen (SVG convention). Winding order is not significant; areas are absolute.
 */
import type { Mm, M2, Point, Polygon, RoomShape, WallFeature, Doorway } from './types';
import { mm2ToM2 } from './units';

const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Shape -> polygon
// ---------------------------------------------------------------------------

export function rectanglePolygon(length: Mm, width: Mm): Polygon {
  return [
    { x: 0, y: 0 },
    { x: length, y: 0 },
    { x: length, y: width },
    { x: 0, y: width },
  ];
}

/** Convert any RoomShape into a clean polygon (duplicates and collinear points removed). */
export function shapeToPolygon(shape: RoomShape): Polygon {
  switch (shape.kind) {
    case 'rectangle':
      return rectanglePolygon(shape.length, shape.width);
    case 'polygon':
      return normalizePolygon(shape.points);
    case 'l_shape': {
      const { length: L, width: W, cutoutLength: cl, cutoutWidth: cw, cutoutCorner } = shape;
      const l = Math.min(Math.max(cl, 0), L);
      const w = Math.min(Math.max(cw, 0), W);
      let pts: Polygon;
      switch (cutoutCorner) {
        case 'top-left':
          pts = [
            { x: l, y: 0 },
            { x: L, y: 0 },
            { x: L, y: W },
            { x: 0, y: W },
            { x: 0, y: w },
            { x: l, y: w },
          ];
          break;
        case 'top-right':
          pts = [
            { x: 0, y: 0 },
            { x: L - l, y: 0 },
            { x: L - l, y: w },
            { x: L, y: w },
            { x: L, y: W },
            { x: 0, y: W },
          ];
          break;
        case 'bottom-right':
          pts = [
            { x: 0, y: 0 },
            { x: L, y: 0 },
            { x: L, y: W - w },
            { x: L - l, y: W - w },
            { x: L - l, y: W },
            { x: 0, y: W },
          ];
          break;
        case 'bottom-left':
          pts = [
            { x: 0, y: 0 },
            { x: L, y: 0 },
            { x: L, y: W },
            { x: l, y: W },
            { x: l, y: W - w },
            { x: 0, y: W - w },
          ];
          break;
      }
      return normalizePolygon(pts);
    }
    case 'rectangle_with_features':
      return normalizePolygon(applyWallFeatures(shape.length, shape.width, shape.features));
  }
}

/**
 * Build a rectilinear polygon from a base rectangle and a list of wall features.
 * Features on the same wall are applied in order of offset; overlapping features are clamped.
 * Positive depth projects OUT of the room (bay window, alcove); negative projects IN (chimney breast).
 */
export function applyWallFeatures(length: Mm, width: Mm, features: WallFeature[]): Polygon {
  // Walk clockwise from top-left: top wall (left->right), right wall (top->bottom), bottom (right->left), left (bottom->top).
  const walls: { wall: WallFeature['wall']; start: Point; end: Point; outward: Point; len: Mm }[] = [
    { wall: 'top', start: { x: 0, y: 0 }, end: { x: length, y: 0 }, outward: { x: 0, y: -1 }, len: length },
    { wall: 'right', start: { x: length, y: 0 }, end: { x: length, y: width }, outward: { x: 1, y: 0 }, len: width },
    { wall: 'bottom', start: { x: length, y: width }, end: { x: 0, y: width }, outward: { x: 0, y: 1 }, len: length },
    { wall: 'left', start: { x: 0, y: width }, end: { x: 0, y: 0 }, outward: { x: -1, y: 0 }, len: width },
  ];
  const pts: Polygon = [];
  for (const w of walls) {
    const dir = { x: Math.sign(w.end.x - w.start.x), y: Math.sign(w.end.y - w.start.y) };
    const along = (d: Mm): Point => ({ x: w.start.x + dir.x * d, y: w.start.y + dir.y * d });
    const feats = features
      .filter((f) => f.wall === w.wall && f.width > 0 && f.depth !== 0)
      .map((f) => ({ ...f, offset: Math.max(0, Math.min(f.offset, w.len)), width: f.width }))
      .sort((a, b) => a.offset - b.offset);
    pts.push(w.start);
    let cursor = 0;
    for (const f of feats) {
      const s = Math.max(f.offset, cursor);
      const e = Math.min(f.offset + f.width, w.len);
      if (e - s <= EPS) continue;
      const d = f.depth;
      pts.push(along(s));
      pts.push({ x: along(s).x + w.outward.x * d, y: along(s).y + w.outward.y * d });
      pts.push({ x: along(e).x + w.outward.x * d, y: along(e).y + w.outward.y * d });
      pts.push(along(e));
      cursor = e;
    }
  }
  return pts;
}

/**
 * Build a rectilinear polygon by "walking the walls": start at the origin heading +x, and for each
 * segment turn left/right/straight then advance. Useful for typing odd-shaped rooms wall by wall.
 * The last segment need not close the polygon; the closing edge is implied.
 */
export function walkToPolygon(segments: { turn: 'left' | 'right' | 'straight'; length: Mm }[]): Polygon {
  const pts: Polygon = [{ x: 0, y: 0 }];
  let heading = 0; // 0: +x, 1: +y, 2: -x, 3: -y
  let x = 0;
  let y = 0;
  for (const s of segments) {
    if (s.turn === 'right') heading = (heading + 1) % 4;
    else if (s.turn === 'left') heading = (heading + 3) % 4;
    if (heading === 0) x += s.length;
    else if (heading === 1) y += s.length;
    else if (heading === 2) x -= s.length;
    else y -= s.length;
    pts.push({ x, y });
  }
  return normalizePolygon(pts);
}

// ---------------------------------------------------------------------------
// Basic measures
// ---------------------------------------------------------------------------

/** Remove consecutive duplicates, the closing duplicate, and collinear intermediate points; translate so min x/y = 0. */
export function normalizePolygon(poly: Polygon): Polygon {
  if (poly.length === 0) return [];
  let pts = poly.map((p) => ({ x: p.x, y: p.y }));
  // drop consecutive duplicates (including wrap-around)
  pts = pts.filter((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length]!;
    return !(Math.abs(p.x - prev.x) < EPS && Math.abs(p.y - prev.y) < EPS) || pts.length === 1;
  });
  // drop collinear points
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) < EPS) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  return pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

export function signedArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Area in mm². */
export function polygonAreaMm2(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

/** Area in m². */
export function polygonAreaM2(poly: Polygon): M2 {
  return mm2ToM2(polygonAreaMm2(poly));
}

export function distance(a: Point, b: Point): Mm {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function edgeLength(poly: Polygon, edgeIndex: number): Mm {
  const a = poly[edgeIndex % poly.length]!;
  const b = poly[(edgeIndex + 1) % poly.length]!;
  return distance(a, b);
}

export function polygonPerimeter(poly: Polygon): Mm {
  let p = 0;
  for (let i = 0; i < poly.length; i++) p += edgeLength(poly, i);
  return p;
}

export interface BBox {
  minX: Mm;
  minY: Mm;
  maxX: Mm;
  maxY: Mm;
  /** extent along x */
  length: Mm;
  /** extent along y */
  width: Mm;
}

export function boundingBox(poly: Polygon): BBox {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, length: maxX - minX, width: maxY - minY };
}

/** True if every edge is axis-aligned. */
export function isRectilinear(poly: Polygon): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) return false;
  }
  return true;
}

/** Swap x and y (mirror across the diagonal) — used to plan with the roll running along the other axis. */
export function transpose(poly: Polygon): Polygon {
  return poly.map((p) => ({ x: p.y, y: p.x }));
}

export function translate(poly: Polygon, dx: Mm, dy: Mm): Polygon {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Point at `offset` along edge `edgeIndex` from its start vertex. */
export function pointAlongEdge(poly: Polygon, edgeIndex: number, offset: Mm): Point {
  const a = poly[edgeIndex % poly.length]!;
  const b = poly[(edgeIndex + 1) % poly.length]!;
  const len = distance(a, b);
  if (len < EPS) return { ...a };
  const t = Math.max(0, Math.min(1, offset / len));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The doorway as a segment on the polygon boundary (clamped to the edge). */
export function doorwaySegment(poly: Polygon, d: Doorway): { from: Point; to: Point; width: Mm } {
  const len = edgeLength(poly, d.edgeIndex);
  const start = Math.max(0, Math.min(d.offset, len));
  const end = Math.max(start, Math.min(d.offset + d.width, len));
  return { from: pointAlongEdge(poly, d.edgeIndex, start), to: pointAlongEdge(poly, d.edgeIndex, end), width: end - start };
}

/** Perimeter that needs gripper / beading: total perimeter minus the doorway openings. */
export function fixingPerimeter(poly: Polygon, doorways: Doorway[]): Mm {
  const total = polygonPerimeter(poly);
  const openings = doorways.reduce((s, d) => s + doorwaySegment(poly, d).width, 0);
  return Math.max(0, total - openings);
}

/** Ray-casting point-in-polygon (boundary counts as inside). */
export function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    // on-edge check
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < EPS) {
      if (
        p.x >= Math.min(a.x, b.x) - EPS &&
        p.x <= Math.max(a.x, b.x) + EPS &&
        p.y >= Math.min(a.y, b.y) - EPS &&
        p.y <= Math.max(a.y, b.y) + EPS
      )
        return true;
    }
    const intersects = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Centroid (area-weighted) — used to position labels. */
export function centroid(poly: Polygon): Point {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const bb = boundingBox(poly);
    return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

// ---------------------------------------------------------------------------
// Slab decomposition (the basis of the roll planner)
// ---------------------------------------------------------------------------

export interface Slab {
  /** x-range of the slab (across the pile direction when y is the pile axis). */
  x0: Mm;
  x1: Mm;
  /** y-extent of the polygon within this x-range (bounding, so voids are covered by the piece). */
  y0: Mm;
  y1: Mm;
}

/**
 * Split the polygon into vertical slabs at every distinct vertex x-coordinate, and for each slab
 * record the y-extent of the polygon inside it. Adjacent slabs with identical extents are merged.
 *
 * For a rectilinear polygon this is exact. For diagonal walls the slab's extent is the bounding
 * extent of the clipped edges, which is exactly what has to be cut from the roll (the carpet is cut
 * to shape on site). Voids (a slab whose polygon coverage is two disjoint y-intervals) are bridged,
 * which mirrors how a fitter would cut one piece and trim it around an obstruction.
 */
export function verticalSlabs(poly: Polygon): Slab[] {
  if (poly.length < 3) return [];
  const xs = Array.from(new Set(poly.map((p) => round6(p.x)))).sort((a, b) => a - b);
  const slabs: Slab[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i]!;
    const xb = xs[i + 1]!;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e]!;
      const b = poly[(e + 1) % poly.length]!;
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      if (hi <= xa + EPS || lo >= xb - EPS) continue; // edge does not enter the open slab
      // clip the edge to [xa, xb]
      const ya = yAt(a, b, Math.max(xa, lo));
      const yb = yAt(a, b, Math.min(xb, hi));
      y0 = Math.min(y0, ya, yb);
      y1 = Math.max(y1, ya, yb);
    }
    if (!isFinite(y0) || !isFinite(y1)) continue;
    slabs.push({ x0: xa, x1: xb, y0, y1 });
  }
  // merge adjacent slabs with the same extent
  const merged: Slab[] = [];
  for (const s of slabs) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.y0 - s.y0) < EPS && Math.abs(last.y1 - s.y1) < EPS && Math.abs(last.x1 - s.x0) < EPS) {
      last.x1 = s.x1;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function yAt(a: Point, b: Point, x: Mm): Mm {
  if (Math.abs(b.x - a.x) < EPS) {
    // vertical edge: whole y-range applies; return the extreme toward whichever end is asked.
    // Both endpoints will be considered by the caller's min/max because we are called for both clipped ends.
    return x === a.x ? a.y : b.y;
  }
  const t = (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * t;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * The y-extent of the polygon over an arbitrary x-range, from the slab list.
 * Returns null if the range does not overlap the polygon.
 */
export function extentOverRange(slabs: Slab[], x0: Mm, x1: Mm): { y0: Mm; y1: Mm } | null {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of slabs) {
    if (s.x1 <= x0 + EPS || s.x0 >= x1 - EPS) continue;
    y0 = Math.min(y0, s.y0);
    y1 = Math.max(y1, s.y1);
  }
  if (!isFinite(y0)) return null;
  return { y0, y1 };
}

/** Area (mm²) of the polygon that falls within the x-range, computed exactly by clipping. */
export function areaInRange(poly: Polygon, x0: Mm, x1: Mm): number {
  const clipped = clipToXRange(poly, x0, x1);
  return polygonAreaMm2(clipped);
}

/** Sutherland–Hodgman clip of the polygon to the vertical band x0 <= x <= x1. */
export function clipToXRange(poly: Polygon, x0: Mm, x1: Mm): Polygon {
  const clipHalf = (pts: Polygon, inside: (p: Point) => boolean, intersect: (a: Point, b: Point) => Point): Polygon => {
    const out: Polygon = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!;
      const prev = pts[(i - 1 + pts.length) % pts.length]!;
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    return out;
  };
  const atX = (a: Point, b: Point, x: Mm): Point => ({ x, y: yAt(a, b, x) });
  let pts = clipHalf(poly, (p) => p.x >= x0 - EPS, (a, b) => atX(a, b, x0));
  pts = clipHalf(pts, (p) => p.x <= x1 + EPS, (a, b) => atX(a, b, x1));
  return dedupeConsecutive(pts);
}

/** Remove consecutive duplicate points (including the wrap-around pair) without translating. */
export function dedupeConsecutive(pts: Polygon): Polygon {
  const out: Polygon = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS) out.pop();
    else break;
  }
  // drop collinear points (clip lines often leave a vertex on a straight run)
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) < EPS) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}
