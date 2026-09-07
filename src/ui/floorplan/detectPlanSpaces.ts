import { detectAllRooms, type AllRoomsDetectionOptions, type AllRoomsDetectionResult, type DetectionControl, type DetectionImage } from './detection';
import { detectStaircases } from './staircaseDetection';
import { outlinesOverlap } from './outlineEditing';

/** One cancellable review batch; tread evidence supplements enclosed-room detection. */
export function detectPlanSpaces(image: DetectionImage, options: AllRoomsDetectionOptions, control: DetectionControl = {}): AllRoomsDetectionResult {
  const rooms = detectAllRooms(image, options, { ...control, onProgress: value => control.onProgress?.(value * .8) });
  if (!options.includeStaircases || !options.mmPerPx || control.cancelled?.()) return rooms;
  const detected = detectStaircases(image, { mmPerPx: options.mmPerPx, reading: options.reading }, control);
  if (control.cancelled?.()) return { ok: false, reason: 'Detection cancelled.' };
  const staircases = detected.candidates.filter(stair => !(options.excludePolygons ?? []).some(polygon => outlinesOverlap(stair.polygon, polygon)));
  control.onProgress?.(1);
  if (!rooms.ok && !staircases.length) return rooms;
  const result = rooms.ok ? rooms : { ok: true as const, candidates: [], omitted: 0, truncated: false, message: rooms.reason };
  return { ...result, staircases, message: `${result.message}${staircases.length ? ` ${staircases.length} possible staircases found. Check their estimated dimensions and step counts.` : ''}` };
}
