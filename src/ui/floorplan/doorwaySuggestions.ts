import type { Doorway, Point, Product, Room } from '@engine/types';
import { doorwaySegment, isSimplePolygon, shapeToPolygon } from '@engine/geometry';
import { newId } from '@store/ids';
import type { DetectedDoorway, InferredGap } from './detection';
import type { RoomSuggestion } from './roomSuggestions';
import { doorwayFromPoints, mmToPx, nearestEdge, pixelDistance, pixelPolygonArea, pointInPixelPolygon, projectOntoEdge, roomPlanTransform, traceToPolygon } from './tracing';

/**
 * Read-only coverage of the original straight threshold after outline edits. Split at every
 * polygon crossing so even a narrow notch between the endpoints/midpoint is checked. The
 * 0.02px boundary tolerance only accommodates the editor's 0.01px coordinate rounding.
 */
export function doorwayThresholdCovered(door: InferredGap, polygon: Point[]): boolean {
  if (polygon.length < 3 || polygon.length > 512 || [...polygon, door.a, door.b].some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    || pixelPolygonArea(polygon) < 1e-8 || !isSimplePolygon(polygon)) return false;
  const dx = door.b.x - door.a.x, dy = door.b.y - door.a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 < 1e-8) return false;
  const pointAt = (t: number) => ({ x: door.a.x + dx * t, y: door.a.y + dy * t });
  const covered = (point: Point) => pointInPixelPolygon(point, polygon) || (nearestEdge(polygon, point)?.distance ?? Infinity) <= 0.02 + 1e-9;
  if (!covered(door.a) || !covered(door.b)) return false;
  const cuts = [0, 1];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!;
    const ex = b.x - a.x, ey = b.y - a.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) > 1e-10) {
      const t = ((a.x - door.a.x) * ey - (a.y - door.a.y) * ex) / denominator;
      const u = ((a.x - door.a.x) * dy - (a.y - door.a.y) * dx) / denominator;
      if (t > 0 && t < 1 && u >= -1e-10 && u <= 1 + 1e-10) cuts.push(t);
    } else {
      // Project collinear edge ends too: their straight run may contain several vertices.
      for (const point of [a, b]) {
        const t = ((point.x - door.a.x) * dx + (point.y - door.a.y) * dy) / length2;
        if (t > 0 && t < 1 && pixelDistance(pointAt(t), point) < 1e-7) cuts.push(t);
      }
    }
  }
  cuts.sort((a, b) => a - b);
  for (let index = 1; index < cuts.length; index++) {
    if (cuts[index]! - cuts[index - 1]! > 1e-10 && !covered(pointAt((cuts[index]! + cuts[index - 1]!) / 2))) return false;
  }
  return true;
}

/** Keep symbol evidence at its original position; never transfer a door to a different wall. */
export function detectedDoorwayPlacement(door: InferredGap, points: Point[], mmPerPx: number) {
  if (!(mmPerPx > 0) || !Number.isFinite(mmPerPx) || points.length < 3
    || [...points, door.a, door.b].some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
  const mm = (p: Point) => ({ x: (p.x - minX) * mmPerPx, y: (p.y - minY) * mmPerPx });
  const placement = doorwayFromPoints(traceToPolygon(points, mmPerPx), mm(door.a), mm(door.b));
  const originalWidth = pixelDistance(door.a, door.b) * mmPerPx;
  if (!placement || placement.width < 300 || placement.width > 2400
    || placement.maxDistance > Math.min(220, Math.max(120, mmPerPx * 3))
    || placement.width < originalWidth * .97) return null;
  return placement;
}

/** A changed corner can invalidate one opening without discarding doors on untouched walls. */
export function reconcileDetectedDoorways(doors: DetectedDoorway[] = [], excluded: number[] = [], points: Point[], mmPerPx: number) {
  const detectedDoorways: DetectedDoorway[] = [], excludedDoorways: number[] = [];
  doors.forEach((door, index) => {
    if (!detectedDoorwayPlacement(door, points, mmPerPx)) return;
    if (excluded.includes(index)) excludedDoorways.push(detectedDoorways.length);
    detectedDoorways.push(door);
  });
  return { detectedDoorways, excludedDoorways };
}

/** Opposite faces of one wall may be separated by the wall thickness in the raster. */
function sameOpening(a: InferredGap, b: InferredGap, scale: number, polygonA: Point[], polygonB: Point[]) {
  const lengthA = pixelDistance(a.a, a.b), lengthB = pixelDistance(b.a, b.b);
  if (!lengthA || !lengthB) return false;
  const ux = (a.b.x - a.a.x) / lengthA, uy = (a.b.y - a.a.y) / lengthA;
  const vx = (b.b.x - b.a.x) / lengthB, vy = (b.b.y - b.a.y) / lengthB;
  if (Math.abs(ux * vx + uy * vy) < .985 || Math.abs(lengthA - lengthB) * scale > Math.max(80, lengthA * scale * .12)) return false;
  const midA = { x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 };
  const midB = { x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 };
  const along = (midB.x - midA.x) * ux + (midB.y - midA.y) * uy;
  const across = (midB.x - midA.x) * -uy + (midB.y - midA.y) * ux;
  // The local interior matters: a wrapping hall's centroid may lie beyond the opposite wall.
  const interiorSide = (gap: InferredGap, polygon: Point[]) => {
    const placement = doorwayFromPoints(polygon, gap.a, gap.b);
    if (!placement) return 0;
    const middle = projectOntoEdge(polygon, placement.edgeIndex, { x: (gap.a.x + gap.b.x) / 2, y: (gap.a.y + gap.b.y) / 2 }).point;
    for (const distance of [.5, 1, 2]) {
      const forward = pointInPixelPolygon({ x: middle.x - uy * distance, y: middle.y + ux * distance }, polygon);
      const reverse = pointInPixelPolygon({ x: middle.x + uy * distance, y: middle.y - ux * distance }, polygon);
      if (forward !== reverse) return forward ? 1 : -1;
    }
    return 0;
  };
  const sideA = interiorSide(a, polygonA), sideB = interiorSide(b, polygonB);
  return Math.abs(along) * scale <= Math.max(60, lengthA * scale * .1)
    && Math.abs(across) * scale <= 250 && sideA * sideB < 0;
}

/** Prepare both sides together so one physical door contributes only one transition bar. */
export function prepareDetectedDoorways(candidates: RoomSuggestion[], scale: number, productId: string, existing: Pick<Room, 'id' | 'productId' | 'shape' | 'source' | 'doorways'>[], products: Product[]) {
  const byCandidate = new Map<string, Doorway[]>();
  const links: Array<{ roomId: string; doorwayId: string; sharedOpeningId: string }> = [];
  const entries: Array<{ roomId: string; productId: string; door: Doorway; gap: InferredGap; polygon: Point[]; existing: boolean; paired: boolean }> = [];
  const transitionTo = (id: string) => ['carpet', 'carpet_tiles'].includes(products.find(p => p.id === id)?.kind ?? '') ? 'carpet' as const : 'hard_floor' as const;
  for (const room of existing) {
    const transform = roomPlanTransform(room);
    if (!transform || !room.source) continue;
    for (const door of room.doorways) {
      const segment = doorwaySegment(shapeToPolygon(room.shape), door);
      entries.push({ roomId: room.id, productId: room.productId, door: { ...door },
        gap: { a: mmToPx(transform, segment.from), b: mmToPx(transform, segment.to) },
        polygon: room.source.pixelPolygon, existing: true, paired: false });
    }
  }
  for (const candidate of candidates) {
    const doors: Doorway[] = [];
    for (const [index, gap] of (candidate.detectedDoorways ?? []).entries()) {
      if (candidate.excludedDoorways?.includes(index)) continue;
      const placement = detectedDoorwayPlacement(gap, candidate.polygon, scale);
      if (!placement) continue;
      const { edgeIndex, offset, width } = placement;
      if (doors.some(d => d.edgeIndex === edgeIndex && Math.min(d.offset + d.width, offset + width) - Math.max(d.offset, offset) > Math.min(d.width, width) * .7)) continue;
      const peer = entries.find(entry => entry.roomId !== candidate.id && !entry.paired && sameOpening(entry.gap, gap, scale, entry.polygon, candidate.polygon));
      const sharedOpeningId = peer?.door.sharedOpeningId || newId('opening');
      const door: Doorway = { id: newId('door'), edgeIndex, offset, width, sharedOpeningId,
        transition: transitionTo(peer?.productId ?? productId), label: `Doorway ${doors.length + 1}` };
      if (peer) {
        peer.paired = true;
        if (peer.existing) {
          if (!peer.door.sharedOpeningId) links.push({ roomId: peer.roomId, doorwayId: peer.door.id, sharedOpeningId });
        } else { peer.door.sharedOpeningId = sharedOpeningId; peer.door.transition = transitionTo(productId); }
      }
      doors.push(door);
      entries.push({ roomId: candidate.id, productId, door, gap, polygon: candidate.polygon, existing: false, paired: !!peer });
    }
    byCandidate.set(candidate.id, doors);
  }
  return { byCandidate, links };
}
