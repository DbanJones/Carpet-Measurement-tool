import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FloorPlanDocument, PlanReading } from '@engine/types';
import type { DetectionImage } from './detection';
import { inferSuggestedScale, type ScaleInference, type SuggestedScale } from './automaticScale';
import type { SuggestedScaleReply, SuggestedScaleRequest } from './suggestedScale.worker';

export const SUGGESTED_SCALE_TIMEOUT_MS = 15000;
export const SUGGESTED_SCALE_MAX_SIDE = 1000;
export const SUGGESTED_SCALE_DEBOUNCE_MS = 150;

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${value >>> 0}`;
}
/** All evidence that can invalidate a proposal, including per-line corrections and an existing scale. */
export function suggestedScaleSourceKey(plan: FloorPlanDocument): string {
  return `${plan.id}:${plan.widthPx}:${plan.heightPx}:${plan.mmPerPx ?? ''}:${hash(plan.imageDataUrl)}:${hash(JSON.stringify(plan.reading ?? null))}`;
}

async function readRaster(plan: FloorPlanDocument, signal: AbortSignal): Promise<DetectionImage> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = image.onerror = null;
      if (error) reject(error); else resolve(image);
    };
    const abort = () => { finish(new DOMException('Cancelled', 'AbortError')); image.src = ''; };
    const timer = setTimeout(() => finish(new Error('The plan image took too long to load. Set the scale manually or try again.')), 10000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error('The plan image could not be read for scale. Set a known length manually.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else image.src = plan.imageDataUrl;
  });
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const factor = Math.min(1, SUGGESTED_SCALE_MAX_SIDE / Math.max(plan.widthPx, plan.heightPx));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(20, Math.round(plan.widthPx * factor)); canvas.height = Math.max(20, Math.round(plan.heightPx * factor));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image analysis is unavailable in this browser. Set the scale manually.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

interface State { key: string; suggestion?: SuggestedScale; busy: boolean; error: string | null }
/** Cancellable preview only: the caller must explicitly confirm before persisting any calibration. */
export function useSuggestedScale(plan: FloorPlanDocument | null, { enabled }: { enabled: boolean }) {
  const key = useMemo(() => plan ? suggestedScaleSourceKey(plan) : '', [plan?.id, plan?.imageDataUrl, plan?.widthPx, plan?.heightPx, plan?.reading, plan?.mmPerPx]);
  const [state, setState] = useState<State>({ key: '', busy: false, error: null });
  const [retryCount, setRetryCount] = useState(0);
  const generation = useRef(0);
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const suppressed = useRef('');
  const latest = useRef({ key, enabled }); latest.current = { key, enabled };
  const stop = useCallback(() => {
    generation.current++; clearTimeout(timer.current); abort.current?.abort(); abort.current = null;
    if (worker.current) { worker.current.onmessage = null; worker.current.onerror = null; worker.current.terminate(); }
    worker.current = null;
  }, []);
  const reset = useCallback(() => { suppressed.current = latest.current.key; stop(); setState({ key: latest.current.key, busy: false, error: null }); }, [stop]);
  const retry = useCallback(() => { suppressed.current = ''; stop(); setState({ key: '', busy: false, error: null }); setRetryCount(value => value + 1); }, [stop]);

  useEffect(() => {
    stop();
    if (!enabled || !plan || plan.sketch || !plan.reading || suppressed.current === key) {
      setState({ key, busy: false, error: null }); return;
    }
    const request = generation.current;
    const current = () => generation.current === request && latest.current.key === key && latest.current.enabled;
    setState({ key, busy: true, error: null });
    const finish = (result: ScaleInference, image?: DetectionImage) => {
      if (!current()) return;
      let suggestion = result.suggestion;
      if (suggestion && image) {
        const sx = plan.widthPx / image.width, sy = plan.heightPx / image.height;
        const map = (point: { x: number; y: number }) => ({ x: point.x * sx, y: point.y * sy });
        const a = map(suggestion.a), b = map(suggestion.b);
        suggestion = { ...suggestion, a, b, polygon: suggestion.polygon.map(map), mmPerPx: suggestion.distance / Math.hypot(b.x - a.x, b.y - a.y), sourceKey: key };
      }
      setState({ key, suggestion, busy: false, error: result.reason ?? null }); stop();
    };
    const start = setTimeout(() => {
      const controller = new AbortController(); abort.current = controller;
      void readRaster(plan, controller.signal).then(image => {
        if (!current()) return;
        const sx = plan.widthPx / image.width, sy = plan.heightPx / image.height;
        const reading: PlanReading = { ...plan.reading!, lines: plan.reading!.lines.map(line => ({ ...line, x: line.x / sx, y: line.y / sy, width: line.width / sx, height: line.height / sy })) };
        let fallbackStarted = false;
        const fallback = () => {
          if (fallbackStarted || !current()) return;
          fallbackStarted = true;
          if (worker.current) { worker.current.onmessage = null; worker.current.onerror = null; worker.current.terminate(); worker.current = null; }
          // Paint first. The fallback caps both image size and the number of detector calls.
          setTimeout(() => {
            if (!current()) return;
            try { finish(inferSuggestedScale(image, reading, { cancelled: () => !current(), maxVerifications: 4 }), image); }
            catch { finish({ reason: 'Automatic scale is unavailable. Set a known wall length manually.' }); }
          }, 0);
        };
        timer.current = setTimeout(() => finish({ reason: 'The scale check took too long. Set a known wall length manually or try again.' }), SUGGESTED_SCALE_TIMEOUT_MS);
        try {
          if (typeof Worker === 'undefined') { fallback(); return; }
          const active = new Worker(new URL('./suggestedScale.worker.ts', import.meta.url), { type: 'module' }); worker.current = active;
          active.onmessage = ({ data }: MessageEvent<SuggestedScaleReply>) => {
            if (!current()) return;
            if (data.type === 'complete') finish(data.result, image);
            else if (data.type === 'error') finish({ reason: data.message });
          };
          active.onerror = event => { event.preventDefault(); fallback(); };
          const data = image.data.slice();
          const payload: SuggestedScaleRequest = { image: { ...image, data }, reading };
          active.postMessage(payload, [data.buffer]);
        } catch { fallback(); }
      }).catch(error => { if (current()) finish({ reason: error instanceof Error ? error.message : 'The image could not be checked for scale.' }); });
    }, SUGGESTED_SCALE_DEBOUNCE_MS);
    return () => { clearTimeout(start); stop(); };
  }, [enabled, key, retryCount, stop]);

  // Mode and evidence changes hide stale proposals during render, before effect cleanup runs.
  const visible = enabled && !!plan && !plan.sketch && state.key === key;
  return { suggestion: visible ? state.suggestion : undefined, busy: visible && state.busy, error: visible ? state.error : null, retry, reset };
}
