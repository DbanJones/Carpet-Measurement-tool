import type { Doorway, Point, Polygon, RoomShape } from '@engine/types';
import { boundingBox, doorwaySegment, edgeLength, isSimplePolygon, normalizePolygon, polygonAreaM2, shapeToPolygon, signedArea } from '@engine/geometry';

export type RoomHandle = { kind: 'corner' | 'wall'; index: number };
export type DiagramEdit = { shape: RoomShape; polygon: Polygon };

export function outlineProblem(points: Polygon): string | null {
  if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'A room needs at least three measured corners.';
  if (points.some((_, i) => edgeLength(points, i) < 10)) return 'Keep at least 10 mm between corners.';
  if (!isSimplePolygon(points) || polygonAreaM2(points) < .0001) return 'Walls cannot cross or fold back on themselves.';
  const onWall = (p: Point, a: Point, b: Point) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) < .01 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  if (points.some((p, i) => points.some((a, j) => j !== i && (j + 1) % points.length !== i && onWall(p, a, points[(j + 1) % points.length]!)))) return 'A corner cannot touch or overlap another wall.';
  if (normalizePolygon(points).length !== points.length) return 'This would remove a corner. Use Delete corner to remove it deliberately.';
  return null;
}

function fromPolygon(points: Polygon, original: RoomShape): DiagramEdit {
  const normal = normalizePolygon(points);
  const box = boundingBox(normal);
  if (original.kind === 'rectangle') return { shape: { kind: 'rectangle', length: Math.round(box.length), width: Math.round(box.width) }, polygon: points };
  if (original.kind === 'l_shape') {
    const innerX = normal.find(p => p.x > 0 && p.x < box.length)?.x;
    const innerY = normal.find(p => p.y > 0 && p.y < box.width)?.y;
    if (innerX !== undefined && innerY !== undefined) {
      return { shape: { ...original, length: box.length, width: box.width, cutoutLength: original.cutoutCorner.endsWith('left') ? innerX : box.length - innerX, cutoutWidth: original.cutoutCorner.startsWith('top') ? innerY : box.width - innerY }, polygon: points };
    }
  }
  return { shape: { kind: 'polygon', points: normal }, polygon: points };
}

/** Rectangles and L shapes keep their square walls and measured parameters. Free outlines move one corner or wall. */
export function moveRoomHandle(shape: RoomShape, handle: RoomHandle, delta: Point): DiagramEdit {
  const original = shapeToPolygon(shape);
  const index = Math.max(0, Math.min(handle.index, original.length - 1));
  const a = original[index]!;
  const b = original[(index + 1) % original.length]!;
  const square = shape.kind === 'rectangle' || shape.kind === 'l_shape';
  let dx = Math.round(delta.x), dy = Math.round(delta.y);
  if (handle.kind === 'wall') {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    const along = dx * nx + dy * ny;
    dx = Math.round(nx * along); dy = Math.round(ny * along);
  }
  if (square) {
    const clampBand = (axis: 'x' | 'y', shift: number) => {
      const levels = [...new Set(original.map(p => p[axis]))].sort((x, y) => x - y);
      const at = levels.indexOf(a[axis]);
      return Math.max(at > 0 ? levels[at - 1]! + 10 - a[axis] : -Infinity, Math.min(at < levels.length - 1 ? levels[at + 1]! - 10 - a[axis] : Infinity, shift));
    };
    dx = clampBand('x', dx); dy = clampBand('y', dy);
  }
  if (dx === 0 && dy === 0) return { shape, polygon: original };
  const points = original.map((p, i) => {
    if (square) {
      const changeX = p.x === a.x && (handle.kind === 'corner' || a.x === b.x);
      const changeY = p.y === a.y && (handle.kind === 'corner' || a.y === b.y);
      return { x: p.x + (changeX ? dx : 0), y: p.y + (changeY ? dy : 0) };
    }
    return i === index || (handle.kind === 'wall' && i === (index + 1) % original.length) ? { x: p.x + dx, y: p.y + dy } : { ...p };
  });
  return fromPolygon(points, shape);
}

/** A new corner starts as a small outward bend so normalization never silently discards it. */
export function insertRoomCorner(points: Polygon, edge: number): Polygon {
  const a = points[edge]!, b = points[(edge + 1) % points.length]!;
  const length = edgeLength(points, edge);
  const offset = Math.min(150, length / 8) * (signedArea(points) >= 0 ? 1 : -1);
  const point = { x: Math.round((a.x + b.x) / 2 + (b.y - a.y) / length * offset), y: Math.round((a.y + b.y) / 2 - (b.x - a.x) / length * offset) };
  return [...points.slice(0, edge + 1), point, ...points.slice(edge + 1)];
}

/** Interior angle follows the polygon winding, so an inward corner reads 270°, not 90°. */
export function roomCornerAngle(points: Polygon, index: number): number {
  const a = points[(index - 1 + points.length) % points.length]!, b = points[index]!, c = points[(index + 1) % points.length]!;
  const incoming = { x: b.x - a.x, y: b.y - a.y }, outgoing = { x: c.x - b.x, y: c.y - b.y };
  const turn = Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x, incoming.x * outgoing.x + incoming.y * outgoing.y);
  return 180 - turn * (signedArea(points) >= 0 ? 1 : -1) * 180 / Math.PI;
}

/** Move only the selected corner to the nearest valid point on its constant-angle circle.
 * Its two neighbours and every other wall stay fixed; the two adjoining wall lengths change.
 */
export function setRoomCornerAngle(shape: RoomShape, index: number, degrees: number): { edit?: DiagramEdit; error?: string } {
  const points = shapeToPolygon(shape);
  if (!Number.isFinite(degrees) || degrees < 1 || degrees > 359 || Math.abs(degrees - 180) < .001) {
    return { error: 'Enter an interior angle from 1° to 359°. Use Delete corner for a straight 180° wall.' };
  }
  if (index < 0 || index >= points.length) return { error: 'Select a room corner first.' };
  if (Math.abs(roomCornerAngle(points, index) - degrees) < .000001) return { edit: { shape, polygon: points } };
  const a = points[(index - 1 + points.length) % points.length]!, b = points[index]!, c = points[(index + 1) % points.length]!;
  const dx = c.x - a.x, dy = c.y - a.y, distance = Math.hypot(dx, dy);
  if (distance < 10) return { error: 'Move the neighbouring corners apart before setting this angle.' };
  const winding = signedArea(points) >= 0 ? 1 : -1;
  const theta = degrees * Math.PI / 180;
  const offset = -winding * distance / (2 * Math.tan(theta));
  const centre = { x: (a.x + c.x) / 2 - dy / distance * offset, y: (a.y + c.y) / 2 + dx / distance * offset };
  const radius = Math.abs(distance / (2 * Math.sin(theta)));
  const toward = { x: b.x - centre.x, y: b.y - centre.y };
  const magnitude = Math.hypot(toward.x, toward.y);
  const direction = magnitude > .000001 ? { x: toward.x / magnitude, y: toward.y / magnitude } : { x: dy / distance * winding, y: -dx / distance * winding };
  const candidates = [1, -1].map(sign => ({ x: centre.x + direction.x * radius * sign, y: centre.y + direction.y * radius * sign }))
    .sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
  for (const corner of candidates) {
    const polygon = points.map((point, i) => i === index ? corner : { ...point });
    if (Math.sign(signedArea(polygon)) !== winding || Math.abs(roomCornerAngle(polygon, index) - degrees) > .0001 || outlineProblem(polygon)) continue;
    return { edit: { shape: { kind: 'polygon', points: normalizePolygon(polygon) }, polygon } };
  }
  return { error: 'That angle would cross or collapse another wall. Move a neighbouring corner first, or try a closer angle.' };
}

/** Keep stable wall indices on ordinary edits; re-anchor openings by position only when a wall is added or removed. */
export function diagramDoorways(doors: Doorway[], before: Polygon, after: Polygon, topologyChanged = false): Doorway[] {
  return doors.map(door => {
    let edgeIndex = Math.max(0, Math.min(door.edgeIndex, after.length - 1));
    let offset = door.offset;
    if (topologyChanged && door.edgeIndex >= 0 && door.edgeIndex < before.length) {
      const segment = doorwaySegment(before, door);
      const centre = { x: (segment.from.x + segment.to.x) / 2, y: (segment.from.y + segment.to.y) / 2 };
      let nearest = Infinity;
      after.forEach((a, i) => {
        const b = after[(i + 1) % after.length]!, length = edgeLength(after, i);
        if (length < door.width) return;
        const along = Math.max(door.width / 2, Math.min(length - door.width / 2, ((centre.x - a.x) * (b.x - a.x) + (centre.y - a.y) * (b.y - a.y)) / length));
        const distance = Math.hypot(centre.x - a.x - (b.x - a.x) * along / length, centre.y - a.y - (b.y - a.y) * along / length);
        if (distance < nearest) { nearest = distance; edgeIndex = i; offset = along - door.width / 2; }
      });
    }
    return { ...door, edgeIndex, offset: Math.round(Math.max(0, Math.min(offset, edgeLength(after, edgeIndex) - door.width))) };
  });
}
