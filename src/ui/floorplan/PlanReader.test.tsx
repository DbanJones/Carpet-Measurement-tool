import { cleanup, render } from '@testing-library/react';
import type { FloorPlanDocument } from '@engine/types';
import { PlanReader } from './PlanReader';
import { usePlanReading } from './usePlanReading';

vi.mock('./usePlanReading', () => ({ usePlanReading: vi.fn() }));
const plan: FloorPlanDocument = { id: 'reading-status', name: 'Estate plan', imageDataUrl: 'data:image/png;base64,test', widthPx: 960, heightPx: 700 };
const status = { read: vi.fn(async () => {}), cancel: vi.fn(), busy: false, progress: 0, error: null as string | null, cancelled: false };
beforeEach(() => { vi.mocked(usePlanReading).mockReturnValue({ ...status }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('reports reading status changes without repeating on progress-only or unrelated renders', () => {
  const onStatusChange = vi.fn();
  const { rerender } = render(<PlanReader plan={plan} onStatusChange={onStatusChange}/>);
  expect(onStatusChange).toHaveBeenCalledExactlyOnceWith({ busy: false, error: null, cancelled: false });
  vi.mocked(usePlanReading).mockReturnValue({ ...status, busy: true, progress: 15 });
  rerender(<PlanReader plan={plan} onStatusChange={onStatusChange}/>);
  expect(onStatusChange).toHaveBeenLastCalledWith({ busy: true, error: null, cancelled: false });
  vi.mocked(usePlanReading).mockReturnValue({ ...status, busy: true, progress: 75 });
  rerender(<PlanReader plan={{ ...plan, name: 'Renamed plan' }} onStatusChange={onStatusChange}/>);
  expect(onStatusChange).toHaveBeenCalledTimes(2);
  vi.mocked(usePlanReading).mockReturnValue({ ...status, cancelled: true });
  rerender(<PlanReader plan={plan} onStatusChange={onStatusChange}/>);
  expect(onStatusChange).toHaveBeenLastCalledWith({ busy: false, error: null, cancelled: true });
  vi.mocked(usePlanReading).mockReturnValue({ ...status, error: 'Unreadable image' });
  rerender(<PlanReader plan={plan} onStatusChange={onStatusChange}/>);
  expect(onStatusChange).toHaveBeenLastCalledWith({ busy: false, error: 'Unreadable image', cancelled: false });
});

it('uses the latest listener for the next status change', () => {
  const first = vi.fn(), latest = vi.fn();
  const { rerender } = render(<PlanReader plan={plan} onStatusChange={first}/>);
  rerender(<PlanReader plan={plan} onStatusChange={latest}/>);
  expect(latest).not.toHaveBeenCalled();
  vi.mocked(usePlanReading).mockReturnValue({ ...status, busy: true });
  rerender(<PlanReader plan={plan} onStatusChange={latest}/>);
  expect(first).toHaveBeenCalledTimes(1);
  expect(latest).toHaveBeenCalledExactlyOnceWith({ busy: true, error: null, cancelled: false });
});
