import type { Doorway, Point, Room } from '@engine/types';
import { doorwaySegment, isSimplePolygon, normalizePolygon, shapeToPolygon } from '@engine/geometry';
import { doorwayFromPoints, mmToPx, nearestEdge, pixelDistance, pixelPolygonArea, pxToMm, roomPlanTransform, type DoorwayPlacement, type EdgeHit } from './tracing';

export interface ManualDoorwayPreview {
  placement: DoorwayPlacement;
  a: Point; b: Point;
  polygon: Point[];
  pixelPolygon: Point[];
  retainedDoorways: Doorway[];
  adjusted: boolean;
}

const pathLength = (path: Point[]) => path.slice(1).reduce((length, point, index) => length + pixelDistance(path[index]!, point), 0);
function boundaryPath(polygon: Point[], from: EdgeHit, to: EdgeHit) {
  const result = [from.point];
  if (from.edgeIndex === to.edgeIndex && from.t <= to.t) return [...result, to.point];
  for (let count = 1; count <= polygon.length; count++) {
    const index = (from.edgeIndex + count) % polygon.length;
    result.push(polygon[index]!);
    if (index === to.edgeIndex) break;
  }
  result.push(to.point);
  return result;
}

/** Resolve a straight wall or replace a short door-swing detour between two explicitly marked jambs. */
export function previewManualDoorway(room: Pick<Room, 'shape' | 'source' | 'doorways'>, aPx: Point, bPx: Point, zoom: number): ManualDoorwayPreview | null {
  const transform = roomPlanTransform(room);
  if (!transform || !(zoom > 0)) return null;
  const original = shapeToPolygon(room.shape);
  const a = pxToMm(transform, aPx), b = pxToMm(transform, bPx);
  if ([...original, a, b].some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)) || !isSimplePolygon(original)) return null;
  const tolerance = Math.min(300, 36 / (transform.pxPerMm * zoom));
  const requestedWidth = pixelDistance(a, b);
  if (requestedWidth < 100 || requestedWidth > 3000) return null;
  const direct = doorwayFromPoints(original, a, b);
  if (direct && direct.maxDistance <= tolerance && direct.width >= requestedWidth * .96) {
    const segment = doorwaySegment(original, { ...direct, id: 'preview', transition: 'carpet' });
    return { placement: direct, a: mmToPx(transform, segment.from), b: mmToPx(transform, segment.to), polygon: original, pixelPolygon: room.source!.pixelPolygon, retainedDoorways: room.doorways, adjusted: false };
  }
  const start = nearestEdge(original, a), end = nearestEdge(original, b);
  if (!start || !end || start.distance > tolerance || end.distance > tolerance || start.edgeIndex === end.edgeIndex) return null;
  const thresholdWidth = pixelDistance(start.point, end.point);
  if (thresholdWidth < 300 || thresholdWidth > 2400 || thresholdWidth < requestedWidth * .85) return null;
  const forward = boundaryPath(original, start, end), reverse = boundaryPath(original, end, start);
  const removed = pathLength(forward) <= pathLength(reverse) ? forward : reverse;
  const retained = removed === forward ? reverse : forward;
  if (pathLength(removed) > thresholdWidth * 3.5 || pathLength(retained) < thresholdWidth * 2) return null;
  const rounded = retained.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }));
  const minX = Math.min(...rounded.map(point => point.x)), minY = Math.min(...rounded.map(point => point.y));
  const relative = (point: Point) => ({ x: point.x - minX, y: point.y - minY });
  const polygon = normalizePolygon(rounded);
  if (!isSimplePolygon(polygon)) return null;
  const gained = pixelPolygonArea(polygon) - pixelPolygonArea(original);
  // This only fills a local door-swing recess; it must never cut off a room or bridge a hallway.
  if (gained < -1 || gained > thresholdWidth ** 2 * .9 + tolerance * thresholdWidth) return null;
  const placement = doorwayFromPoints(polygon, relative(start.point), relative(end.point));
  if (!placement || placement.maxDistance > 2 || placement.width < thresholdWidth * .99) return null;
  const retainedDoorways: Doorway[] = [];
  for (const door of room.doorways) {
    const segment = doorwaySegment(original, door);
    const next = doorwayFromPoints(polygon, relative(segment.from), relative(segment.to));
    if (!next || next.maxDistance > 2 || Math.abs(next.width - door.width) > 2) return null;
    retainedDoorways.push({ ...door, edgeIndex: next.edgeIndex, offset: next.offset, width: next.width });
  }
  const pixelPolygon = polygon.map(point => mmToPx(transform, { x: point.x + minX, y: point.y + minY }));
  const segment = doorwaySegment(polygon, { ...placement, id: 'preview', transition: 'carpet' });
  return { placement, a: mmToPx(transform, { x: segment.from.x + minX, y: segment.from.y + minY }), b: mmToPx(transform, { x: segment.to.x + minX, y: segment.to.y + minY }), polygon, pixelPolygon, retainedDoorways, adjusted: true };
}
