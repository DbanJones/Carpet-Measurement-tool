import { isSimplePolygon } from '@engine/geometry';
import { nearestEdge, pixelPolygonArea, pointInPixelPolygon, type Px } from './tracing';
import type { DetectedDoorway } from './doorwaySymbols';

const EPS = 1e-6;
const distance = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
};

/** Use every pixel row through the wall, not the inner face visible from either room. */
export function resolveDoorThreshold(door: DetectedDoorway, gaps: Array<{ a: Px; b: Px }>, maxWallDepth = 24) {
  const horizontal = Math.abs(door.b.x - door.a.x) >= Math.abs(door.b.y - door.a.y);
  const along = (p: Px) => horizontal ? p.x : p.y;
  const across = (p: Px) => horizontal ? p.y : p.x;
  const start = Math.min(along(door.a), along(door.b)), end = Math.max(along(door.a), along(door.b));
  const at = (across(door.a) + across(door.b)) / 2;
  const tolerance = Math.max(4, (end - start) * 0.1);
  const rows = gaps.filter(gap => Math.abs(across(gap.a) - across(gap.b)) < EPS
    && Math.abs(Math.min(along(gap.a), along(gap.b)) - start) <= tolerance
    && Math.abs(Math.max(along(gap.a), along(gap.b)) - end) <= tolerance
    && Math.abs(across(gap.a) - at) <= maxWallDepth).sort((a, b) => across(a.a) - across(b.a));
  const bands: typeof rows[] = [];
  for (const row of rows) {
    const previous = bands[bands.length - 1];
    if (!previous || across(row.a) - across(previous[previous.length - 1]!.a) > 2) bands.push([row]);
    else previous.push(row);
  }
  const band = bands.filter(group => across(group[group.length - 1]!.a) - across(group[0]!.a) <= maxWallDepth)
    .sort((a, b) => Math.abs(median(a.map(g => across(g.a))) - at) - Math.abs(median(b.map(g => across(g.a))) - at))[0];
  if (!band?.length) return { door, wallDepth: 1 };
  const centre = (across(band[0]!.a) + across(band[band.length - 1]!.a)) / 2;
  // A printed leaf can narrow some raster rows. Keep the full supported jamb opening,
  // rather than trimming half the leaf stroke off the carpet width by averaging rows.
  const from = Math.min(...band.map(g => Math.min(along(g.a), along(g.b))));
  const to = Math.max(...band.map(g => Math.max(along(g.a), along(g.b))));
  const point = (value: number) => horizontal ? { x: value, y: centre } : { x: centre, y: value };
  return { door: { ...door, a: point(from), b: point(to) }, wallDepth: across(band[band.length - 1]!.a) - across(band[0]!.a) + 1 };
}

/**
 * Union a small doorway rectangle with a simple outline. Boundary segments are split at
 * intersections and kept only where one side is inside the union; no convex-hull shortcut
 * can fill an unrelated concavity. Disconnected/touching-only results are refused.
 */
export function unionDoorRectangle(polygon: Px[], rectangle: Px[]): Px[] | null {
  if (polygon.length < 3 || polygon.length > 128 || rectangle.length !== 4) return null;
  const shapes = [polygon, rectangle];
  const inside = (point: Px) => shapes.some(shape => pointInPixelPolygon(point, shape));
  const edges: Array<{ a: Px; b: Px }> = [];
  for (let shapeIndex = 0; shapeIndex < 2; shapeIndex++) {
    const shape = shapes[shapeIndex]!, other = shapes[1 - shapeIndex]!;
    for (let index = 0; index < shape.length; index++) {
      const a = shape[index]!, b = shape[(index + 1) % shape.length]!;
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      if (length2 < EPS * EPS) continue;
      const cuts = [0, 1];
      for (let j = 0; j < other.length; j++) {
        const c = other[j]!, d = other[(j + 1) % other.length]!;
        const ex = d.x - c.x, ey = d.y - c.y, cross = dx * ey - dy * ex;
        if (Math.abs(cross) > EPS) {
          const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / cross;
          const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / cross;
          if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) cuts.push(t);
        } else if (Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx) < EPS) {
          for (const point of [c, d]) {
            const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2;
            if (t > EPS && t < 1 - EPS) cuts.push(t);
          }
        }
      }
      cuts.sort((x, y) => x - y);
      const normal = { x: -dy / Math.sqrt(length2) * 0.0001, y: dx / Math.sqrt(length2) * 0.0001 };
      for (let j = 1; j < cuts.length; j++) {
        if (cuts[j]! - cuts[j - 1]! < EPS) continue;
        const p = { x: a.x + dx * cuts[j - 1]!, y: a.y + dy * cuts[j - 1]! };
        const q = { x: a.x + dx * cuts[j]!, y: a.y + dy * cuts[j]! };
        const middle = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const left = inside({ x: middle.x + normal.x, y: middle.y + normal.y });
        const right = inside({ x: middle.x - normal.x, y: middle.y - normal.y });
        if (left !== right) edges.push(left ? { a: p, b: q } : { a: q, b: p });
      }
    }
  }
  const key = (p: Px) => `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`;
  const unique = new Map(edges.map(edge => [`${key(edge.a)}:${key(edge.b)}`, edge]));
  const byStart = new Map<string, typeof edges>();
  for (const edge of unique.values()) byStart.set(key(edge.a), [...(byStart.get(key(edge.a)) ?? []), edge]);
  const first = unique.values().next().value as { a: Px; b: Px } | undefined;
  if (!first) return null;
  const outline = [{ ...first.a }];
  let cursor = first;
  const visited = new Set<string>();
  for (let step = 0; step <= unique.size; step++) {
    const edgeKey = `${key(cursor.a)}:${key(cursor.b)}`;
    if (visited.has(edgeKey)) return null;
    visited.add(edgeKey);
    if (distance(cursor.b, first.a) < EPS) break;
    outline.push({ ...cursor.b });
    const next = byStart.get(key(cursor.b));
    if (next?.length !== 1) return null;
    cursor = next[0]!;
  }
  if (visited.size !== unique.size) return null;
  const simplified = outline.filter((point, index) => {
    const previous = outline[(index + outline.length - 1) % outline.length]!, next = outline[(index + 1) % outline.length]!;
    return Math.abs((point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x)) > EPS;
  });
  return simplified.length >= 3 && simplified.length <= 128 && isSimplePolygon(simplified)
    && pixelPolygonArea(simplified) >= pixelPolygonArea(polygon) - EPS ? simplified : null;
}

export interface ThresholdRaster { width: number; height: number; walls: Uint8Array }

/** Include the door swing's floor and its half-wall recess, stopping at the shared centreline. */
export function includeDoorThresholdFloor(polygon: Px[], door: DetectedDoorway, wallDepth: number, raster?: ThresholdRaster):
  { ok: true; polygon: Px[] } | { ok: false; reason: string } {
  const length = distance(door.a, door.b);
  if (!(length >= 8 && length <= 160)) return { ok: false, reason: 'Check the doorway width before including its floor.' };
  const u = { x: (door.b.x - door.a.x) / length, y: (door.b.y - door.a.y) / length };
  const n = { x: -u.y, y: u.x };
  const middle = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
  const leafDepth = door.hinge && door.leafEnd ? Math.abs((door.leafEnd.x - door.hinge.x) * n.x + (door.leafEnd.y - door.hinge.y) * n.y) : length;
  const depth = Math.max(length * 0.6, leafDepth, wallDepth) + 3;
  if ((nearestEdge(polygon, middle)?.distance ?? Infinity) > depth * 1.1) return { ok: false, reason: 'The doorway is too far from this room outline.' };
  const hits = (side: number) => [0.25, 0.5, 1].reduce((total, fraction) => total
    + (pointInPixelPolygon({ x: middle.x + n.x * side * depth * fraction, y: middle.y + n.y * side * depth * fraction }, polygon) ? 1 : 0), 0);
  const positive = hits(1), negative = hits(-1);
  if ((!positive && !negative) || (positive && negative)) return { ok: false, reason: 'Check which side of this doorway belongs to the room.' };
  const side = positive ? 1 : -1;
  const far = (p: Px) => ({ x: p.x + n.x * side * depth, y: p.y + n.y * side * depth });
  const rectangle = [door.a, door.b, far(door.b), far(door.a)];
  const next = unionDoorRectangle(polygon, rectangle);
  if (!next) return { ok: false, reason: 'The doorway floor could not be joined to the outline safely.' };
  if (raster) {
    const radius = Math.max(1, Math.min(4, Math.floor(wallDepth / 3)));
    const minX = Math.max(0, Math.floor(Math.min(...rectangle.map(p => p.x))));
    const maxX = Math.min(raster.width - 1, Math.ceil(Math.max(...rectangle.map(p => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...rectangle.map(p => p.y))));
    const maxY = Math.min(raster.height - 1, Math.ceil(Math.max(...rectangle.map(p => p.y))));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const point = { x: x + 0.5, y: y + 0.5 };
      if (!pointInPixelPolygon(point, rectangle) || pointInPixelPolygon(point, polygon) || !raster.walls[y * raster.width + x]) continue;
      // A fully open leaf may be printed flush against a corner wall. Only its narrow,
      // evidenced stroke can be cleared; the rest of a structural return stays protected.
      if (door.evidence === 'swing-arc' && door.hinge && door.leafEnd) {
        const dx = door.leafEnd.x - door.hinge.x, dy = door.leafEnd.y - door.hinge.y;
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((point.x - door.hinge.x) * dx + (point.y - door.hinge.y) * dy) / length2)) : 0;
        const leafDistance = distance(point, { x: door.hinge.x + dx * t, y: door.hinge.y + dy * t });
        if (leafDistance <= Math.min(3, Math.max(2, wallDepth / 4))) continue;
      }
      let thick = true;
      for (let dy = -radius; dy <= radius && thick; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const col = x + dx, row = y + dy;
        if (col < 0 || row < 0 || col >= raster.width || row >= raster.height || !raster.walls[row * raster.width + col]) { thick = false; break; }
      }
      if (thick) return { ok: false, reason: 'A wall crosses this doorway recess. Check its outline before including the floor beneath it.' };
    }
  }
  return { ok: true, polygon: next };
}
