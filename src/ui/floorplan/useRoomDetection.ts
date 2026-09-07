import { useCallback, useEffect, useRef, useState } from 'react';
import type { FloorPlanDocument } from '@engine/types';
import { DETECTION_MAX_SIDE, detectRoom, detectAllRooms, mapDetectionResult, mapAllRoomsDetectionResult, type AllRoomsDetectionOptions, type AllRoomsDetectionResult, type DetectionImage, type DetectionResult } from './detection';
import type { Px } from './tracing';
import { detectPlanSpaces } from './detectPlanSpaces';

const cancelled = (): { ok: false; reason: string } => ({ ok: false, reason: 'Detection cancelled.' });

async function readRaster(plan: FloorPlanDocument): Promise<DetectionImage> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const source = new Image();
    const timer = setTimeout(() => reject(new Error('The plan image took too long to load. Try opening it again.')), 12000);
    source.onload = () => { clearTimeout(timer); resolve(source); };
    source.onerror = () => { clearTimeout(timer); reject(new Error('The plan image could not be read. Try drawing the room outline.')); };
    source.src = plan.imageDataUrl;
  });
  const factor = Math.min(1, DETECTION_MAX_SIDE / Math.max(plan.widthPx, plan.heightPx));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(3, Math.round(plan.widthPx * factor));
  canvas.height = Math.max(3, Math.round(plan.heightPx * factor));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image analysis is unavailable in this browser. Use Draw outline or Rectangle.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

/** A cancellable worker-backed preview. An unavailable worker falls back to the same capped core. */
export function useRoomDetection(plan: FloorPlanDocument | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<'room' | 'all' | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const currentPlan = useRef(plan);
  currentPlan.current = plan;
  const workerRef = useRef<Worker | null>(null);
  const cancelWork = useRef<(() => void) | null>(null);
  const raster = useRef<{ imageDataUrl: string; promise: Promise<DetectionImage> } | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    cancelWork.current?.();
    cancelWork.current = null;
  }, []);
  const reset = useCallback(() => { stop(); setBusy(false); setError(null); setProgress(0); setMode(null); }, [stop]);
  useEffect(() => { reset(); }, [plan?.id, plan?.imageDataUrl, plan?.mmPerPx, reset]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  const run = useCallback(async (kind: 'room' | 'all', seed?: Px, allOptions: Omit<AllRoomsDetectionOptions, 'mmPerPx'> = {}): Promise<DetectionResult | AllRoomsDetectionResult> => {
    if (!plan) return { ok: false, reason: 'Upload a floor plan first.' };
    stop();
    const request = generation.current;
    const isCurrent = () => mounted.current && request === generation.current
      && currentPlan.current?.id === plan.id && currentPlan.current.imageDataUrl === plan.imageDataUrl
      && currentPlan.current.mmPerPx === plan.mmPerPx;
    setBusy(true);
    setError(null);
    setProgress(0);
    setMode(kind);
    try {
      if (raster.current?.imageDataUrl !== plan.imageDataUrl) {
        const promise = readRaster(plan);
        raster.current = { imageDataUrl: plan.imageDataUrl, promise };
        void promise.catch(() => { if (raster.current?.promise === promise) raster.current = null; });
      }
      // Cancellation also settles while the image is loading, before a worker exists.
      const image = await new Promise<DetectionImage | null>((resolve, reject) => {
        const cancel = () => resolve(null);
        cancelWork.current = cancel;
        void raster.current!.promise.then(value => {
          if (cancelWork.current === cancel) cancelWork.current = null;
          resolve(value);
        }, reject);
      });
      if (!image || !isCurrent()) return cancelled();
      const sx = plan.widthPx / image.width, sy = plan.heightPx / image.height;
      const smallSeed = seed ? { x: seed.x / sx, y: seed.y / sy } : undefined;
      const options: AllRoomsDetectionOptions = {
        ...allOptions,
        ...(kind === 'all' ? { includeStaircases: true, ...(plan.reading ? { reading: { ...plan.reading, lines: plan.reading.lines.map(line => ({ ...line, x: line.x / sx, y: line.y / sy, width: line.width / sx, height: line.height / sy })) } } : {}) } : {}),
        mmPerPx: plan.mmPerPx ? plan.mmPerPx * Math.max(sx, sy) : undefined,
        ...(allOptions.excludePolygons ? { excludePolygons: allOptions.excludePolygons.map(polygon => polygon.map(point => ({ x: point.x / sx, y: point.y / sy }))) } : {}),
      };
      const reportProgress = (value: number) => { if (isCurrent()) setProgress(Math.max(0, Math.min(1, value))); };
      const fallback = async () => {
        // Paint the busy indicator first. Both paths cap pixel count before computation.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!isCurrent()) return cancelled();
        return kind === 'all'
          ? detectPlanSpaces(image, options, { cancelled: () => !isCurrent(), onProgress: reportProgress })
          : detectRoom(image, smallSeed!, options);
      };
      let result: DetectionResult | AllRoomsDetectionResult;
      if (typeof Worker === 'undefined') result = await fallback();
      else {
        result = await new Promise<DetectionResult | AllRoomsDetectionResult>((resolve) => {
          let settled = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let worker: Worker | null = null;
          const finish = (value: DetectionResult | AllRoomsDetectionResult) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            worker?.terminate();
            if (workerRef.current === worker) workerRef.current = null;
            if (cancelWork.current === cancel) cancelWork.current = null;
            resolve(value);
          };
          const useFallback = () => {
            worker?.terminate();
            void fallback().then(finish).catch(() => finish({ ok: false, reason: 'Image analysis failed. Use Draw outline or Rectangle.' }));
          };
          const cancel = () => finish(cancelled());
          cancelWork.current = cancel;
          try {
            worker = new Worker(new URL('./detection.worker.ts', import.meta.url), { type: 'module' });
            workerRef.current = worker;
            worker.onmessage = (event: MessageEvent<DetectionResult | AllRoomsDetectionResult | { kind: 'progress'; progress: number }>) => {
              if ('kind' in event.data && event.data.kind === 'progress') reportProgress(event.data.progress);
              else finish(event.data as DetectionResult | AllRoomsDetectionResult);
            };
            worker.onerror = (event) => { event.preventDefault(); useFallback(); };
            timer = setTimeout(() => finish({ ok: false, reason: 'Detection took too long. Try detecting one room at a time or draw the outlines.' }), kind === 'all' ? 15000 : 8000);
            // Transfer a copy; keep the cached raster available for subsequent clicks and fallback.
            const data = image.data.slice();
            worker.postMessage({ kind, image: { ...image, data }, ...(smallSeed ? { seed: smallSeed } : {}), options }, [data.buffer]);
          } catch { useFallback(); }
        });
      }
      if (!isCurrent()) return cancelled();
      if (!result.ok) setError(result.reason);
      setProgress(1);
      return kind === 'all' ? mapAllRoomsDetectionResult(result as AllRoomsDetectionResult, sx, sy) : mapDetectionResult(result as DetectionResult, sx, sy);
    } catch (err) {
      if (!isCurrent()) return cancelled();
      const reason = err instanceof Error ? err.message : 'Image analysis failed. Draw the room outline instead.';
      setError(reason);
      return { ok: false, reason };
    } finally { if (isCurrent()) { setBusy(false); setMode(null); } }
  }, [plan, stop]);

  const detect = useCallback((seed: Px) => run('room', seed) as Promise<DetectionResult>, [run]);
  const detectAll = useCallback((options?: Omit<AllRoomsDetectionOptions, 'mmPerPx'>) => run('all', undefined, options) as Promise<AllRoomsDetectionResult>, [run]);
  return { detect, detectAll, busy, error, progress, mode, reset };
}
