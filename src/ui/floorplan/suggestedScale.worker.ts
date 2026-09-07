import type { PlanReading } from '@engine/types';
import type { DetectionImage } from './detection';
import { inferSuggestedScale, type ScaleInference } from './automaticScale';

export interface SuggestedScaleRequest { image: DetectionImage; reading: PlanReading }
export type SuggestedScaleReply = { type: 'complete'; result: ScaleInference } | { type: 'error'; message: string };
const scope = self as unknown as { onmessage: ((event: MessageEvent<SuggestedScaleRequest>) => void) | null; postMessage: (message: SuggestedScaleReply) => void };
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ type: 'complete', result: inferSuggestedScale(data.image, data.reading) }); }
  catch { scope.postMessage({ type: 'error', message: 'The printed dimensions could not be checked against this image. Set the scale manually.' }); }
};
