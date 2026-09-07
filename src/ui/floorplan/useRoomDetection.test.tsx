import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorPlanDocument } from '@engine/types';
import type { AllRoomsDetectionResult, DetectionResult } from './detection';
import { useRoomDetection } from './useRoomDetection';

const plan: FloorPlanDocument = { id: 'one', name: 'Plan', widthPx: 2400, heightPx: 1200, imageDataUrl: 'data:image/png;base64,test', mmPerPx: 10 };
const suggestion: DetectionResult = { ok: true, polygon: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 60 }, { x: 10, y: 60 }], inferredGaps: [] };
class ImageStub {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}
class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage: ((event: { data: DetectionResult | AllRoomsDetectionResult | { kind: 'progress'; progress: number } }) => void) | null = null;
  onerror: ((event: { preventDefault: () => void }) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { WorkerStub.instances.push(this); }
}

beforeEach(() => {
  WorkerStub.instances = [];
  vi.stubGlobal('Image', ImageStub);
  vi.stubGlobal('Worker', WorkerStub);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    fillRect: vi.fn(), drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(1200 * 600 * 4).fill(255) }),
  }) as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useRoomDetection', () => {
  it('runs outside the UI thread and maps a worker preview to the full plan coordinates', async () => {
    const { result } = renderHook(() => useRoomDetection(plan));
    let pending!: Promise<DetectionResult>;
    act(() => { pending = result.current.detect({ x: 200, y: 100 }); });
    await waitFor(() => expect(WorkerStub.instances).toHaveLength(1));
    expect(result.current.busy).toBe(true);
    const worker = WorkerStub.instances[0]!;
    expect(worker.postMessage.mock.calls[0]![0]).toMatchObject({ seed: { x: 100, y: 50 }, options: { mmPerPx: 20 } });
    let output!: DetectionResult;
    await act(async () => { worker.onmessage?.({ data: suggestion }); output = await pending; });
    expect(output).toMatchObject({ ok: true, polygon: [{ x: 20, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 120 }, { x: 20, y: 120 }] });
    expect(result.current.busy).toBe(false);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('settles cancellation and ignores a stale result after changing the plan', async () => {
    const { result, rerender } = renderHook(({ current }) => useRoomDetection(current), { initialProps: { current: plan } });
    let pending!: Promise<DetectionResult>;
    act(() => { pending = result.current.detect({ x: 200, y: 100 }); });
    await waitFor(() => expect(WorkerStub.instances).toHaveLength(1));
    const staleReply = WorkerStub.instances[0]!.onmessage;
    rerender({ current: { ...plan, id: 'two' } });
    let output!: DetectionResult;
    await act(async () => { staleReply?.({ data: suggestion }); output = await pending; });
    expect(output).toEqual({ ok: false, reason: 'Detection cancelled.' });
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('falls back without a Worker instead of crashing the workspace', async () => {
    vi.stubGlobal('Worker', undefined);
    const { result } = renderHook(() => useRoomDetection(plan));
    let output!: DetectionResult;
    await act(async () => { output = await result.current.detect({ x: 200, y: 100 }); });
    // The mocked canvas is a blank page: a correct fallback reports a leaking region.
    expect(output).toMatchObject({ ok: false, reason: expect.stringMatching(/escapes/) });
    expect(result.current.busy).toBe(false);
  });

  it('falls back when the browser blocks worker construction', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Blocked worker'); } });
    const { result } = renderHook(() => useRoomDetection(plan));
    let output!: DetectionResult;
    await act(async () => { output = await result.current.detect({ x: 200, y: 100 }); });
    expect(output).toMatchObject({ ok: false, reason: expect.stringMatching(/escapes/) });
    expect(result.current.busy).toBe(false);
  });

  it('maps all room candidates, doorway gaps and existing exclusions across raster scale', async () => {
    const { result } = renderHook(() => useRoomDetection(plan));
    const excluded = [{ x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 100 }];
    let pending!: Promise<AllRoomsDetectionResult>;
    act(() => { pending = result.current.detectAll({ excludePolygons: [excluded] }); });
    await waitFor(() => expect(WorkerStub.instances).toHaveLength(1));
    const worker = WorkerStub.instances[0]!;
    expect(worker.postMessage.mock.calls[0]![0]).toMatchObject({ kind: 'all', options: { mmPerPx: 20,
      excludePolygons: [[{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 50 }]] } });
    expect(result.current.mode).toBe('all');
    act(() => { worker.onmessage?.({ data: { kind: 'progress', progress: 0.5 } }); });
    expect(result.current.progress).toBe(0.5);
    expect(result.current.busy).toBe(true);
    let output!: AllRoomsDetectionResult;
    await act(async () => {
      worker.onmessage?.({ data: { ok: true, candidates: [{ ok: true, polygon: [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 60 }],
        inferredGaps: [{ a: { x: 30, y: 10 }, b: { x: 50, y: 10 } }] }], message: 'Review rooms', omitted: 0, truncated: false } });
      output = await pending;
    });
    expect(output).toMatchObject({ ok: true, candidates: [{ polygon: [{ x: 20, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 120 }],
      inferredGaps: [{ a: { x: 60, y: 20 }, b: { x: 100, y: 20 } }] }] });
    expect(result.current.progress).toBe(1);
    expect(result.current.mode).toBeNull();
  });

  it('maps staircase footprints and tread lines while retaining physical dimensions', async()=>{
    const {result}=renderHook(()=>useRoomDetection({...plan,reading:{source:'ocr',text:'Stairs',lines:[{text:'Stairs',x:400,y:200,width:100,height:30,confidence:90}]}}));
    let pending!:Promise<AllRoomsDetectionResult>;
    act(()=>{pending=result.current.detectAll();});
    await waitFor(()=>expect(WorkerStub.instances).toHaveLength(1));
    const worker=WorkerStub.instances[0]!;
    expect(worker.postMessage.mock.calls[0]![0].options).toMatchObject({includeStaircases:true,reading:{lines:[{x:200,y:100,width:50,height:15}]}});
    let output!:AllRoomsDetectionResult;
    await act(async()=>{worker.onmessage?.({data:{ok:true,candidates:[],staircases:[{polygon:[{x:10,y:20},{x:50,y:20},{x:50,y:100},{x:10,y:100}],treads:[{a:{x:10,y:30},b:{x:50,y:30}}],widthMm:800,lengthMm:1600,goingMm:240,estimatedRisers:8,visibleTreads:7,headingDegrees:90,layout:'straight',confidence:'medium',message:'Review'}],message:'',omitted:0,truncated:false}});output=await pending;});
    expect(output).toMatchObject({staircases:[{polygon:[{x:20,y:40},{x:100,y:40},{x:100,y:200},{x:20,y:200}],treads:[{a:{x:20,y:60},b:{x:100,y:60}}],widthMm:800,lengthMm:1600,goingMm:240}]});
  });

  it('cancels an all-room scan immediately and prevents its stale result replacing the next single room', async () => {
    const { result } = renderHook(() => useRoomDetection(plan));
    let all!: Promise<AllRoomsDetectionResult>, single!: Promise<DetectionResult>;
    act(() => { all = result.current.detectAll(); });
    await waitFor(() => expect(WorkerStub.instances).toHaveLength(1));
    const old = WorkerStub.instances[0]!;
    act(() => { single = result.current.detect({ x: 200, y: 100 }); });
    await waitFor(() => expect(WorkerStub.instances).toHaveLength(2));
    let oldOutput!: AllRoomsDetectionResult;
    await act(async () => {
      old.onmessage?.({ data: { ok: true, candidates: [], message: 'Stale', omitted: 0, truncated: false } });
      oldOutput = await all;
    });
    expect(oldOutput).toEqual({ ok: false, reason: 'Detection cancelled.' });
    expect(old.terminate).toHaveBeenCalled();
    expect(result.current.busy).toBe(true);
    expect(result.current.mode).toBe('room');
    await act(async () => { WorkerStub.instances[1]!.onmessage?.({ data: suggestion }); await single; });
    expect(result.current.busy).toBe(false);
  });

  it('settles reset even when an image has not finished loading', async () => {
    let loaded: (() => void) | null = null;
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      set src(_value: string) { loaded = () => this.onload?.(); }
    });
    const { result } = renderHook(() => useRoomDetection(plan));
    let pending!: Promise<AllRoomsDetectionResult>;
    act(() => { pending = result.current.detectAll(); });
    act(() => result.current.reset());
    let output!: AllRoomsDetectionResult;
    await act(async () => { output = await pending; });
    expect(output).toEqual({ ok: false, reason: 'Detection cancelled.' });
    expect(result.current.busy).toBe(false);
    expect(WorkerStub.instances).toEqual([]);
    // Complete the cached load so its timeout does not outlive the test.
    await act(async () => { (loaded as (() => void) | null)?.(); });
    expect(WorkerStub.instances).toEqual([]);
  });

  it('falls back to an empty review batch when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const { result } = renderHook(() => useRoomDetection(plan));
    let output!: AllRoomsDetectionResult;
    await act(async () => { output = await result.current.detectAll(); });
    expect(output).toMatchObject({ ok: true, candidates: [] });
    expect(result.current.busy).toBe(false);
  });
});
