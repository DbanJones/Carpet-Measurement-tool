import { act, cleanup, renderHook } from '@testing-library/react';
import * as engine from '@engine/estimate';
import { makeEmptyProject, useProjectStore } from './projectStore';
import { useEstimate, useRollWidthComparison } from './useEstimate';

beforeEach(() => {
  useProjectStore.getState().setProject(makeEmptyProject('Cache test'));
  useProjectStore.getState().addRoom();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('shares one estimate between mounted consumers and recalculates once when a room changes', () => {
  const calculate = vi.spyOn(engine, 'estimateProject');
  const first = renderHook(() => useEstimate());
  const second = renderHook(() => useEstimate());
  expect(calculate).toHaveBeenCalledTimes(1);
  expect(first.result.current).toBe(second.result.current);
  const previousArea = first.result.current.totals.netAreaM2;

  act(() => {
    const store = useProjectStore.getState();
    store.updateRoom(store.project.rooms[0]!.id, { shape: { kind: 'rectangle', length: 6000, width: 3000 } });
  });
  expect(calculate).toHaveBeenCalledTimes(2);
  expect(first.result.current).toBe(second.result.current);
  expect(first.result.current.totals.netAreaM2).toBeGreaterThan(previousArea);
});

it('shares width comparisons, and drops them when the project changes', () => {
  const compare = vi.spyOn(engine, 'compareRollWidths');
  const id = useProjectStore.getState().project.products[0]!.id;
  const first = renderHook(() => useRollWidthComparison(id));
  const second = renderHook(() => useRollWidthComparison(id));
  expect(compare).toHaveBeenCalledTimes(1);
  expect(first.result.current).toBe(second.result.current);
  act(() => useProjectStore.getState().updateProduct(id, { rollWidth: 5000 }));
  expect(compare).toHaveBeenCalledTimes(2);
  expect(first.result.current).toBe(second.result.current);
});
