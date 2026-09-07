import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorPlanDocument, PlanReading } from '@engine/types';
import type { ReadingReply } from './planReading.worker';
import { OCR_TIMEOUT_MS, usePlanReading } from './usePlanReading';
import { StrictMode } from 'react';

const plan: FloorPlanDocument = { id: 'one', name: 'Plan', widthPx: 960, heightPx: 700, imageDataUrl: 'data:image/png;base64,test' };
const reading: PlanReading = { source: 'ocr', text: 'Bedroom 4.2m', lines: [{ text: 'Bedroom', x: 10, y: 20, width: 80, height: 20, confidence: 95 }] };
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: { data: ReadingReply }) => void) | null = null;
  onerror: ((event: { preventDefault: () => void }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { WorkerStub.instances.push(this); }
}
beforeEach(() => { WorkerStub.instances = []; vi.stubGlobal('Worker', WorkerStub); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('usePlanReading lifecycle', () => {
  it('runs in a same-origin coordinator, reports progress, saves one result and terminates', async () => {
    const onRead = vi.fn();
    const { result } = renderHook(() => usePlanReading(plan, onRead));
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(); });
    const worker = WorkerStub.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({ imageDataUrl: plan.imageDataUrl, assetBase: new URL('./ocr/', document.baseURI).href });
    expect(result.current.busy).toBe(true);
    act(() => worker.onmessage?.({ data: { type: 'progress', progress: 64 } }));
    expect(result.current.progress).toBe(64);
    await act(async () => { worker.onmessage?.({ data: { type: 'complete', reading } }); await pending; });
    expect(onRead).toHaveBeenCalledExactlyOnceWith(reading);
    expect(result.current.busy).toBe(false);
    expect(result.current.progress).toBe(100);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('immediately surfaces an OCR language-loading failure and settles the request', async () => {
    const onRead = vi.fn();
    const { result } = renderHook(() => usePlanReading(plan, onRead));
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(); });
    const worker = WorkerStub.instances[0]!;
    await act(async () => { worker.onmessage?.({ data: { type: 'error', message: 'Language data unavailable' } }); await pending; });
    expect(result.current.error).toContain('Language data unavailable');
    expect(result.current.busy).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onRead).not.toHaveBeenCalled();
  });

  it('cancels during startup before any worker reply and ignores late messages', async () => {
    const onRead = vi.fn();
    const { result } = renderHook(() => usePlanReading(plan, onRead));
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(); });
    const worker = WorkerStub.instances[0]!;
    const late = worker.onmessage;
    await act(async () => { result.current.cancel(); await pending; late?.({ data: { type: 'complete', reading } }); });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onRead).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates an old request on plan changes without writing its text into the new plan', async () => {
    const first = vi.fn(); const second = vi.fn();
    const { result, rerender } = renderHook(({ current, onRead }) => usePlanReading(current, onRead), { initialProps: { current: plan, onRead: first } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(); });
    const worker = WorkerStub.instances[0]!; const late = worker.onmessage;
    rerender({ current: { ...plan, id: 'two' }, onRead: second });
    await act(async () => { late?.({ data: { type: 'complete', reading } }); await pending; });
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(result.current.busy).toBe(false);
  });

  it('times out and terminates a stuck initialization, then permits a fresh request', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePlanReading(plan, vi.fn()));
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(); });
    await act(async () => { vi.advanceTimersByTime(OCR_TIMEOUT_MS); await pending; });
    expect(result.current.error).toContain('took too long');
    expect(WorkerStub.instances[0]!.terminate).toHaveBeenCalledOnce();
    act(() => { void result.current.read(); });
    expect(result.current.error).toBeNull();
    expect(WorkerStub.instances).toHaveLength(2);
  });

  it('settles and terminates pending work on unmount', async () => {
    const onRead = vi.fn();
    const { result, unmount } = renderHook(() => usePlanReading(plan, onRead));
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(); });
    const worker = WorkerStub.instances[0]!; const late = worker.onmessage;
    unmount();
    await pending;
    late?.({ data: { type: 'complete', reading } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onRead).not.toHaveBeenCalled();
  });

  it('reports browser worker startup errors and blocked worker construction', async () => {
    const { result } = renderHook(() => usePlanReading(plan, vi.fn()));
    let pending!: Promise<void>;
    act(() => { pending = result.current.read(); });
    const preventDefault = vi.fn();
    await act(async () => { WorkerStub.instances[0]!.onerror?.({ preventDefault }); await pending; });
    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.error).toContain('could not start');
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Blocked by browser'); } });
    await act(async () => { await result.current.read(); });
    expect(result.current.error).toContain('Blocked by browser');
    expect(result.current.busy).toBe(false);
  });
});

describe('automatic plan reading', () => {
  const autoPlan = (id: string): FloorPlanDocument => ({ ...plan, id: `auto-${id}` });
  beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });

  it('starts an image automatically once, including with React StrictMode, and uses the latest save callback', async () => {
    const onRead = vi.fn(); const latest = vi.fn(); const current = autoPlan('strict');
    const { rerender, result } = renderHook(({ save }) => usePlanReading(current, save, { automatic: true }), { initialProps: { save: onRead }, wrapper: StrictMode });
    act(() => { vi.advanceTimersByTime(0); });
    expect(WorkerStub.instances).toHaveLength(1);
    rerender({ save: latest });
    await act(async () => { WorkerStub.instances[0]!.onmessage?.({ data: { type: 'complete', reading } }); });
    expect(latest).toHaveBeenCalledExactlyOnceWith(reading);
    expect(onRead).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    act(() => { vi.advanceTimersByTime(100); });
    expect(WorkerStub.instances).toHaveLength(1);
  });

  it('uses useful embedded PDF text and never reads a blank house drawing', () => {
    renderHook(() => usePlanReading({ ...autoPlan('pdf'), reading: { ...reading, source: 'pdf' } }, vi.fn(), { automatic: true }));
    const sketch = { ...autoPlan('sketch'), sketch: { gridMm: 1000 } };
    const { result } = renderHook(() => usePlanReading(sketch, vi.fn(), { automatic: true }));
    act(() => { vi.advanceTimersByTime(0); void result.current.read(); });
    expect(WorkerStub.instances).toHaveLength(0);
  });

  it('automatically reads a scanned PDF when its only embedded text is the agent footer', () => {
    renderHook(() => usePlanReading({ ...autoPlan('footer'), reading: { source: 'pdf', text: 'Estate agents Ltd. Not to scale.', lines: [] } }, vi.fn(), { automatic: true }));
    act(() => { vi.advanceTimersByTime(0); });
    expect(WorkerStub.instances).toHaveLength(1);
  });

  it('does not retry cancelled or failed reading on remount but permits an explicit retry', async () => {
    const current = autoPlan('cancel');
    const first = renderHook(() => usePlanReading(current, vi.fn(), { automatic: true }));
    act(() => { vi.advanceTimersByTime(0); first.result.current.cancel(); });
    first.unmount();
    const second = renderHook(() => usePlanReading(current, vi.fn(), { automatic: true }));
    act(() => { vi.advanceTimersByTime(0); });
    expect(WorkerStub.instances).toHaveLength(1);
    expect(second.result.current.cancelled).toBe(true);
    act(() => { void second.result.current.read(); });
    await act(async () => { WorkerStub.instances[1]!.onmessage?.({ data: { type: 'error', message: 'Unclear image' } }); });
    second.unmount();
    const third = renderHook(() => usePlanReading(current, vi.fn(), { automatic: true }));
    act(() => { vi.advanceTimersByTime(0); });
    expect(WorkerStub.instances).toHaveLength(2);
    expect(third.result.current.error).toContain('Unclear image');
  });

  it('ignores a late automatic result when switching plans and reads the new plan independently', () => {
    const save = vi.fn(); const firstPlan = autoPlan('switch-a'), secondPlan = autoPlan('switch-b');
    const { rerender } = renderHook(({ current }) => usePlanReading(current, save, { automatic: true }), { initialProps: { current: firstPlan } });
    act(() => { vi.advanceTimersByTime(0); });
    const late = WorkerStub.instances[0]!.onmessage;
    rerender({ current: secondPlan });
    act(() => { vi.advanceTimersByTime(0); late?.({ data: { type: 'complete', reading } }); });
    expect(WorkerStub.instances[0]!.terminate).toHaveBeenCalledOnce();
    expect(WorkerStub.instances).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
  });
});
