import type { Point, Room, Staircase } from '@engine/types';
import { isSimplePolygon } from '@engine/geometry';
import type { DetectedDoorway, InferredGap } from './detection';
import { outlinesOverlap } from './outlineEditing';
import { pixelPolygonArea } from './tracing';
import type { DetectedStaircase } from './staircaseDetection';

export interface RoomSuggestion {
  id: string;
  polygon: Point[];
  inferredGaps: InferredGap[];
  detectedDoorways?: DetectedDoorway[];
  excludedDoorways?: number[];
  name: string;
  nameEdited?: boolean;
  included: boolean;
  message?: string;
}
export interface StaircaseSuggestion extends DetectedStaircase { id: string; name: string; included: boolean; riseMm: number }
export interface RoomSuggestionBatch { rooms: RoomSuggestion[]; staircases?: StaircaseSuggestion[]; mmPerPx: number; message: string; productId: string; imageDataUrl: string; widthPx: number; heightPx: number }

export function isSmallRoomSuggestion(polygon: Point[], mmPerPx: number): boolean {
  return pixelPolygonArea(polygon) * mmPerPx ** 2 < 1e6 - .01;
}

/** Validate again at acceptance time: another editor may have changed the saved rooms. */
export function roomSuggestionIssue(candidate: RoomSuggestion, accepted: Pick<RoomSuggestion, 'id' | 'polygon'>[], existing: (Room | Staircase)[], sheet: { widthPx: number; heightPx: number }): string | undefined {
  const points = candidate.polygon;
  if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !isSimplePolygon(points) || pixelPolygonArea(points) <= 0) return 'Adjust the outline: its corners cross or have no area.';
  if (points.some(p => p.x < 0 || p.y < 0 || p.x > sheet.widthPx || p.y > sheet.heightPx)) return 'The outline goes outside this plan.';
  const overlap = existing.find(room => room.source && outlinesOverlap(points, room.source.pixelPolygon));
  if (overlap) return `Overlaps ${overlap.name}, which is already on the plan.`;
  if (accepted.some(room => room.id !== candidate.id && outlinesOverlap(points, room.polygon))) return 'Overlaps another selected suggestion. Adjust or deselect one.';
}
