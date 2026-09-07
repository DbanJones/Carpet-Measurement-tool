import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import type { FloorPlanDocument } from '@engine/types';
import type { SuggestedScale } from './automaticScale';
import type { SuggestedScaleReply } from './suggestedScale.worker';
import { SUGGESTED_SCALE_DEBOUNCE_MS, SUGGESTED_SCALE_TIMEOUT_MS, suggestedScaleSourceKey, useSuggestedScale } from './useSuggestedScale';

const plan: FloorPlanDocument = { id: 'scale-one', name: 'Estate PDF', imageDataUrl: 'data:image/png;base64,test', widthPx: 2400, heightPx: 1800,
  reading: { source: 'pdf', text: 'LOUNGE\n4m x 3m', lines: [{ text: 'LOUNGE', x: 200, y: 160, width: 120, height: 20, confidence: 100 }, { text: '4m x 3m', x: 220, y: 210, width: 100, height: 20, confidence: 100 }] } };
const suggestion: SuggestedScale = { a: { x: 40, y: 40 }, b: { x: 240, y: 40 }, distance: 4000, mmPerPx: 20,
  polygon: [{ x: 40, y: 40 }, { x: 240, y: 40 }, { x: 240, y: 190 }, { x: 40, y: 190 }], roomName: 'Lounge', printedLabel: '4m × 3m', checkLabel: 'Other side matches 3m.', matchedRooms: 1 };
class ImageStub {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
}
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: { data: SuggestedScaleReply }) => void) | null = null;
  onerror: ((event: { preventDefault: () => void }) => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { WorkerStub.instances.push(this); }
}
beforeEach(() => {
  WorkerStub.instances = []; localStorage.clear();
  vi.stubGlobal('Image', ImageStub); vi.stubGlobal('Worker', WorkerStub);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ fillRect: vi.fn(), drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255) }),
  }) as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const started = async (count = 1) => waitFor(() => expect(WorkerStub.instances).toHaveLength(count));
const complete = (index = 0) => act(() => WorkerStub.instances[index]!.onmessage?.({ data: { type: 'complete', result: { suggestion } } }));

it('analyses on a worker, maps evidence to original pixels and never persists a calibration', async () => {
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const { result } = renderHook(() => useSuggestedScale(plan, { enabled: true }));
  await started();
  expect(result.current.busy).toBe(true);
  const request = WorkerStub.instances[0]!.postMessage.mock.calls[0]![0];
  expect(request.image).toMatchObject({ width: 1000, height: 750 });
  expect(request.reading.lines[0].x).toBeCloseTo(200 / 2.4);
  complete();
  expect(result.current.suggestion).toMatchObject({ a: { x: 96, y: 96 }, b: { x: 576, y: 96 }, distance: 4000, sourceKey: suggestedScaleSourceKey(plan) });
  expect(result.current.suggestion!.mmPerPx).toBeCloseTo(4000 / 480);
  expect(result.current.busy).toBe(false);
  expect(WorkerStub.instances[0]!.terminate).toHaveBeenCalledOnce();
  expect(plan.mmPerPx).toBeUndefined(); expect(writes).not.toHaveBeenCalled();
});

it('hides and cancels evidence immediately when the user chooses manual scale', async () => {
  const { result, rerender } = renderHook(({ enabled }) => useSuggestedScale(plan, { enabled }), { initialProps: { enabled: true } });
  await started(); const late = WorkerStub.instances[0]!.onmessage;
  complete(); expect(result.current.suggestion).toBeDefined();
  rerender({ enabled: false });
  expect(result.current.suggestion).toBeUndefined(); expect(result.current.busy).toBe(false);
  act(() => late?.({ data: { type: 'complete', result: { suggestion } } }));
  expect(result.current.suggestion).toBeUndefined();
});

it('discards an old result after image replacement, plan switch or OCR correction', async () => {
  const { result, rerender } = renderHook(({ current }) => useSuggestedScale(current, { enabled: true }), { initialProps: { current: plan } });
  await started(); const late = WorkerStub.instances[0]!.onmessage;
  const replacement = { ...plan, id: 'scale-two', imageDataUrl: 'data:image/png;base64,replacement' };
  rerender({ current: replacement });
  expect(result.current.suggestion).toBeUndefined();
  act(() => late?.({ data: { type: 'complete', result: { suggestion } } }));
  expect(result.current.suggestion).toBeUndefined();
  await started(2); complete(1);
  const corrected = { ...replacement, reading: { ...replacement.reading!, lines: replacement.reading!.lines.map(line => ({ ...line, reviewed: true })) } };
  rerender({ current: corrected });
  expect(result.current.suggestion).toBeUndefined();
  await started(3); complete(2);
  expect(result.current.suggestion?.sourceKey).toBe(suggestedScaleSourceKey(corrected));
});

it('starts once in StrictMode and does not repeatedly scan an unsuccessful reading', async () => {
  const { result, rerender } = renderHook(() => useSuggestedScale(plan, { enabled: true }), { wrapper: StrictMode });
  await started();
  act(() => WorkerStub.instances[0]!.onmessage?.({ data: { type: 'complete', result: { reason: 'No matching room.' } } }));
  expect(result.current.error).toBe('No matching room.');
  rerender(); await new Promise(resolve => setTimeout(resolve, SUGGESTED_SCALE_DEBOUNCE_MS + 20));
  expect(WorkerStub.instances).toHaveLength(1);
  act(() => result.current.retry()); await started(2);
  expect(result.current.error).toBeNull();
});

it('reset suppresses this evidence until retry, and a confirmed scale is never changed by the hook', async () => {
  const calibrated = { ...plan, mmPerPx: 12.5 };
  const { result } = renderHook(() => useSuggestedScale(calibrated, { enabled: true }));
  await started(); complete();
  expect(calibrated.mmPerPx).toBe(12.5);
  act(() => result.current.reset());
  expect(result.current.suggestion).toBeUndefined();
  await new Promise(resolve => setTimeout(resolve, SUGGESTED_SCALE_DEBOUNCE_MS + 20));
  expect(WorkerStub.instances).toHaveLength(1);
  act(() => result.current.retry()); await started(2);
});

it('does not read a sketch, a disabled plan, or a plan whose OCR has not arrived', async () => {
  renderHook(() => useSuggestedScale({ ...plan, sketch: { gridMm: 1000 } }, { enabled: true }));
  renderHook(() => useSuggestedScale(plan, { enabled: false }));
  renderHook(() => useSuggestedScale({ ...plan, reading: undefined }, { enabled: true }));
  await new Promise(resolve => setTimeout(resolve, SUGGESTED_SCALE_DEBOUNCE_MS + 20));
  expect(WorkerStub.instances).toHaveLength(0);
});

it('cancels while loading the image and ignores a late worker reply after unmount', async () => {
  vi.stubGlobal('Image', class { onload = null; onerror = null; set src(_value: string) {} });
  const first = renderHook(() => useSuggestedScale(plan, { enabled: true }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, SUGGESTED_SCALE_DEBOUNCE_MS + 20)); });
  first.unmount(); expect(WorkerStub.instances).toHaveLength(0);
  vi.stubGlobal('Image', ImageStub);
  const second = renderHook(() => useSuggestedScale(plan, { enabled: true })); await started();
  const late = WorkerStub.instances[0]!.onmessage; second.unmount();
  act(() => late?.({ data: { type: 'complete', result: { suggestion } } }));
  expect(WorkerStub.instances[0]!.terminate).toHaveBeenCalledOnce();
});

it('surfaces a bounded timeout and offers a manual fallback', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useSuggestedScale(plan, { enabled: true }));
  await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTED_SCALE_DEBOUNCE_MS + 1); });
  expect(WorkerStub.instances).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTED_SCALE_TIMEOUT_MS); });
  expect(result.current.error).toContain('took too long'); expect(result.current.busy).toBe(false);
  expect(WorkerStub.instances[0]!.terminate).toHaveBeenCalledOnce();
});

it('uses the same bounded core when a browser blocks workers, without inventing a scale on a blank page', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker blocked'); } });
  const { result } = renderHook(() => useSuggestedScale(plan, { enabled: true }));
  await waitFor(() => expect(result.current.error).toMatch(/could not be matched/));
  expect(result.current.suggestion).toBeUndefined(); expect(result.current.busy).toBe(false);
});
