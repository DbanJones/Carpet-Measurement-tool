import { useCallback, useEffect, useRef, useState } from 'react';
import type { FloorPlanDocument, PlanReading } from '@engine/types';
import type { ReadingReply, ReadingRequest } from './planReading.worker';
import { hasUsefulPlanText } from './planText';

export const OCR_TIMEOUT_MS = 60000;

type ReadingAttempt = { status: 'reading' | 'ready' | 'cancelled' | 'error'; error?: string };
const attempts = new Map<string, ReadingAttempt>();
function attemptKey(plan: FloorPlanDocument): string {
  // A small content signature distinguishes replacement images without retaining a second image copy.
  const image = plan.imageDataUrl;
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(image.length / 512));
  for (let i = 0; i < image.length; i += stride) hash = Math.imul(hash ^ image.charCodeAt(i), 16777619);
  return `floor-plan-reading:${plan.id}:${image.length}:${hash >>> 0}`;
}
function previousAttempt(key: string): ReadingAttempt | undefined {
  const cached = attempts.get(key);
  if (cached) return cached;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as ReadingAttempt;
      // A coordinator cannot survive a reload. Expose a retry instead of silently starting over.
      if (parsed.status === 'reading') parsed.status = 'cancelled';
      if (['ready', 'cancelled', 'error'].includes(parsed.status)) { attempts.set(key, parsed); return parsed; }
    }
  } catch { /* Private storage restrictions must not prevent local recognition. */ }
}
function remember(key: string, attempt: ReadingAttempt) {
  attempts.set(key, attempt);
  if (attempts.size > 100) attempts.delete(attempts.keys().next().value!);
  try { sessionStorage.setItem(key, JSON.stringify(attempt)); } catch { /* Session cache is best effort. */ }
}

/** Same-origin OCR; terminating the coordinator stops its child even during initialization. */
export function usePlanReading(plan: FloorPlanDocument, onRead: (reading: PlanReading) => void, { automatic = false }: { automatic?: boolean } = {}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const generation = useRef(0);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const settle = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const activeKey = useRef<string | null>(null);
  const currentPlan = useRef(plan);
  currentPlan.current = plan;
  const callback = useRef(onRead);
  callback.current = onRead;
  const stop = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    if (worker.current) {
      worker.current.onmessage = null;
      worker.current.onerror = null;
      worker.current.terminate();
    }
    worker.current = null;
    if (activeKey.current && attempts.get(activeKey.current)?.status === 'reading') remember(activeKey.current, { status: 'cancelled' });
    activeKey.current = null;
    settle.current?.();
    settle.current = null;
  }, []);
  const cancel = useCallback(() => { stop(); setBusy(false); setCancelled(true); }, [stop]);
  useEffect(() => {
    stop(); setBusy(false); setProgress(0);
    const previous = previousAttempt(attemptKey(plan));
    setError(previous?.status === 'error' ? previous.error ?? 'Text could not be read. Try again with a clearer plan.' : null);
    setCancelled(previous?.status === 'cancelled');
  }, [plan.id, plan.imageDataUrl, stop]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  const read = useCallback((): Promise<void> => {
    stop();
    if (plan.sketch) return Promise.resolve();
    const key = attemptKey(plan);
    activeKey.current = key;
    remember(key, { status: 'reading' });
    const request = generation.current;
    const current = () => mounted.current && generation.current === request
      && currentPlan.current.id === plan.id && currentPlan.current.imageDataUrl === plan.imageDataUrl;
    setBusy(true); setProgress(0); setError(null); setCancelled(false);
    return new Promise<void>((resolve) => {
      settle.current = resolve;
      const fail = (message: string) => {
        if (!current()) return;
        remember(key, { status: 'error', error: message });
        setError(message); setBusy(false); stop();
      };
      try {
        if (typeof Worker === 'undefined') throw new Error('This browser does not support local text recognition.');
        const active = new Worker(new URL('./planReading.worker.ts', import.meta.url), { type: 'module' });
        worker.current = active;
        active.onmessage = ({ data }: MessageEvent<ReadingReply>) => {
          if (!current()) return;
          if (data.type === 'progress') setProgress(Math.max(0, Math.min(100, data.progress)));
          else if (data.type === 'error') fail(`Text could not be read. ${data.message}`);
          else if (data.type === 'complete') {
            try {
              callback.current(data.reading);
              remember(key, { status: 'ready' });
              setProgress(100); setBusy(false); stop();
            } catch (problem) { fail(`The recognised text could not be saved. ${problem instanceof Error ? problem.message : 'Try again.'}`); }
          }
        };
        active.onerror = (event) => {
          event.preventDefault();
          fail('Text reading could not start. Reload the app and try again.');
        };
        timer.current = setTimeout(() => fail('Text reading took too long. Try a clearer or smaller plan image.'), OCR_TIMEOUT_MS);
        const payload: ReadingRequest = { imageDataUrl: plan.imageDataUrl, assetBase: new URL(`${import.meta.env.BASE_URL}ocr/`, document.baseURI).href };
        active.postMessage(payload);
      } catch (problem) {
        fail(`Text could not be read. ${problem instanceof Error ? problem.message : 'Try again.'}`);
      }
    });
  }, [plan.id, plan.imageDataUrl, plan.sketch, stop]);
  useEffect(() => {
    if (!automatic || plan.sketch || plan.reading?.source === 'ocr' || hasUsefulPlanText(plan.reading) || previousAttempt(attemptKey(plan))) return;
    // Deferring one tick avoids React StrictMode starting and immediately cancelling the first attempt.
    const start = setTimeout(() => { if (!previousAttempt(attemptKey(plan))) void read(); }, 0);
    return () => clearTimeout(start);
  }, [automatic, plan.id, plan.imageDataUrl, plan.reading, plan.sketch, read]);
  return { read, cancel, busy, progress, error, cancelled };
}
