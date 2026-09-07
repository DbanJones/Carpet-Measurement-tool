import { projectOntoEdge, type Px } from './tracing';

const EPS = 1e-6;

/** Interior overlap, including containment and identical outlines. Shared walls are allowed. */
export function outlinesOverlap(a: Px[], b: Px[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const ys = [...a, ...b].map((p) => p.y);
  // Edge intersections split the sweep into bands with a constant ordering of boundaries.
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i]!; const q = a[(i + 1) % a.length]!;
    const r = b[j]!; const s = b[(j + 1) % b.length]!;
    const dx = q.x - p.x; const dy = q.y - p.y;
    const ex = s.x - r.x; const ey = s.y - r.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < EPS) continue;
    const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / denominator;
    const u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / denominator;
    if (t > 0 && t < 1 && u > 0 && u < 1) ys.push(p.y + t * dy);
  }
  ys.sort((x, y) => x - y);
  const intersections = (polygon: Px[], y: number) => polygon.flatMap((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    return (p.y > y) !== (q.y > y) ? [p.x + (y - p.y) * (q.x - p.x) / (q.y - p.y)] : [];
  }).sort((x, y) => x - y);
  for (let i = 1; i < ys.length; i++) {
    if (ys[i]! - ys[i - 1]! < EPS) continue;
    const y = (ys[i]! + ys[i - 1]!) / 2;
    const ax = intersections(a, y); const bx = intersections(b, y);
    for (let ai = 0; ai + 1 < ax.length; ai += 2) for (let bi = 0; bi + 1 < bx.length; bi += 2) {
      if (Math.min(ax[ai + 1]!, bx[bi + 1]!) - Math.max(ax[ai]!, bx[bi]!) > EPS) return true;
    }
  }
  return false;
}

/** Snap to a nearby existing wall, preferring its corner when the pointer is close to both. */
export function snapToOutline(point: Px, polygons: Px[][], tolerance: number): Px {
  let nearest = point; let best = tolerance;
  for (const polygon of polygons) for (const vertex of polygon) {
    const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (distance <= best) { nearest = vertex; best = distance; }
  }
  if (nearest !== point) return { ...nearest };
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const hit = projectOntoEdge(polygon, i, point);
    if (hit.distance < best) { nearest = hit.point; best = hit.distance; }
  }
  return { ...nearest };
}
