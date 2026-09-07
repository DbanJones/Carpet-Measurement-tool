import { detectAllRooms, detectRoom, type AllRoomsDetectionOptions, type AllRoomsDetectionResult, type DetectionImage, type DetectionResult } from './detection';
import type { Px } from './tracing';
import { detectPlanSpaces } from './detectPlanSpaces';

type DetectionRequest = { kind?: 'room'; image: DetectionImage; seed: Px; options: { mmPerPx?: number } }
  | { kind: 'all'; image: DetectionImage; options: AllRoomsDetectionOptions };

// Keep this worker's type surface independent of the application's DOM TypeScript library.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DetectionRequest>) => void) | null;
  postMessage: (result: DetectionResult | AllRoomsDetectionResult | { kind: 'progress'; progress: number }) => void;
};
scope.onmessage = ({ data }) => {
  try {
    scope.postMessage(data.kind === 'all'
      ? detectPlanSpaces(data.image, data.options, { onProgress: progress => scope.postMessage({ kind: 'progress', progress }) })
      : detectRoom(data.image, data.seed, data.options));
  }
  catch { scope.postMessage({ ok: false, reason: 'The outline could not be detected. Use Draw outline or Rectangle for this room.' }); }
};
