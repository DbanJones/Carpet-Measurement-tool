import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PdfPagePicker } from './PdfPagePicker';
import type { PdfHandle, PlanRaster } from './pdf';

afterEach(cleanup);

const raster = (page: number): PlanRaster => ({ imageDataUrl: `data:image/png;base64,page${page}`, widthPx: 1200, heightPx: 900 });
const useButton = () => screen.getByRole('button', { name: 'Use this page' }) as HTMLButtonElement;
const selectPage = (page: number) => fireEvent.change(screen.getByRole('combobox', { name: 'PDF page' }), { target: { value: String(page) } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

describe('PdfPagePicker', () => {
  it('previews the chosen page automatically and imports only after Use this page', async () => {
    const onChoose = vi.fn();
    const renderPage = vi.fn(async (page: number) => raster(page));
    render(<PdfPagePicker name="brochure.pdf" handle={{ pageCount: 4, renderPage, destroy: vi.fn() }} onChoose={onChoose} onCancel={vi.fn()} />);
    expect(useButton().disabled).toBe(true);
    expect(screen.getByRole('region', { name: 'Choose the floor plan page' })).toBeTruthy();
    await screen.findByAltText('Page 1 of brochure.pdf');
    expect(onChoose).not.toHaveBeenCalled();
    selectPage(3);
    expect(useButton().disabled).toBe(true);
    expect(screen.queryByAltText('Page 1 of brochure.pdf')).toBeNull();
    const preview = await screen.findByAltText('Page 3 of brochure.pdf') as HTMLImageElement;
    expect(preview.src).toBe(raster(3).imageDataUrl);
    expect(renderPage.mock.calls).toEqual([[1], [3]]);
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.click(useButton());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(raster(3), 3);
  });

  it('ignores stale asynchronous results and cannot import a previous page while loading', async () => {
    const first = deferred<PlanRaster>();
    const second = deferred<PlanRaster>();
    const third = deferred<PlanRaster>();
    const requests = [first, second, third];
    const handle: PdfHandle = { pageCount: 3, renderPage: vi.fn((page: number) => requests[page - 1]!.promise), destroy: vi.fn() };
    const onChoose = vi.fn();
    render(<PdfPagePicker name="brochure.pdf" handle={handle} onChoose={onChoose} onCancel={vi.fn()} />);
    await act(async () => { first.resolve(raster(1)); });
    selectPage(2);
    fireEvent.click(useButton());
    expect(onChoose).not.toHaveBeenCalled();
    await act(async () => {});
    selectPage(3);
    await act(async () => { third.resolve(raster(3)); });
    await act(async () => { second.resolve(raster(2)); });
    expect(screen.getByAltText('Page 3 of brochure.pdf')).toBeTruthy();
    expect(screen.queryByAltText('Page 2 of brochure.pdf')).toBeNull();
    fireEvent.click(useButton());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(raster(3), 3);
  });

  it('shows render errors and retries the same selected page', async () => {
    const renderPage = vi.fn().mockRejectedValueOnce(new Error('Unreadable page')).mockResolvedValueOnce(raster(1));
    render(<PdfPagePicker name="brochure.pdf" handle={{ pageCount: 3, renderPage, destroy: vi.fn() }} onChoose={vi.fn()} onCancel={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Unreadable page');
    expect(useButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(useButton().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    await screen.findByAltText('Page 1 of brochure.pdf');
    expect(useButton().disabled).toBe(false);
    expect(renderPage.mock.calls).toEqual([[1], [1]]);
  });

  it('waits for the current render when returning to a previously previewed page', async () => {
    const pendingSecond = deferred<PlanRaster>();
    const pendingFirst = deferred<PlanRaster>();
    const renderPage = vi.fn().mockResolvedValueOnce(raster(1)).mockReturnValueOnce(pendingSecond.promise).mockReturnValueOnce(pendingFirst.promise);
    render(<PdfPagePicker name="brochure.pdf" handle={{ pageCount: 2, renderPage, destroy: vi.fn() }} onChoose={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByAltText('Page 1 of brochure.pdf');
    selectPage(2);
    await act(async () => {});
    selectPage(1);
    expect(useButton().disabled).toBe(true);
    await act(async () => { pendingSecond.resolve(raster(2)); });
    expect(useButton().disabled).toBe(true);
    await act(async () => { pendingFirst.resolve(raster(1)); });
    expect(useButton().disabled).toBe(false);
  });

  it('ignores a stale rejection after a newer page succeeds', async () => {
    const first = deferred<PlanRaster>();
    const renderPage = vi.fn((page: number) => page === 1 ? first.promise : Promise.resolve(raster(page)));
    render(<PdfPagePicker name="brochure.pdf" handle={{ pageCount: 2, renderPage, destroy: vi.fn() }} onChoose={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => {});
    selectPage(2);
    await screen.findByAltText('Page 2 of brochure.pdf');
    await act(async () => { first.reject(new Error('Old page failed')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useButton().disabled).toBe(false);
  });

  it('allows cancellation during rendering and leaves document cleanup to its parent', async () => {
    const pending = deferred<PlanRaster>();
    const onCancel = vi.fn();
    const onChoose = vi.fn();
    const destroy = vi.fn();
    const view = render(<PdfPagePicker name="brochure.pdf" handle={{ pageCount: 2, renderPage: () => pending.promise, destroy }} onChoose={onChoose} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => { pending.resolve(raster(1)); });
    expect(onChoose).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('starts at page one when replaced with another document and ignores the old render', async () => {
    const oldPage = deferred<PlanRaster>();
    const oldHandle = { pageCount: 3, renderPage: vi.fn((page: number) => page === 2 ? oldPage.promise : Promise.resolve(raster(page))), destroy: vi.fn() };
    const newHandle = { pageCount: 2, renderPage: vi.fn(async () => raster(4)), destroy: vi.fn() };
    const onChoose = vi.fn();
    const view = render(<PdfPagePicker name="old.pdf" handle={oldHandle} onChoose={onChoose} onCancel={vi.fn()} />);
    await screen.findByAltText('Page 1 of old.pdf');
    selectPage(2);
    await act(async () => {});
    view.rerender(<PdfPagePicker name="new.pdf" handle={newHandle} onChoose={onChoose} onCancel={vi.fn()} />);
    expect(useButton().disabled).toBe(true);
    await screen.findByAltText('Page 1 of new.pdf');
    await act(async () => { oldPage.resolve(raster(2)); });
    expect(newHandle.renderPage).toHaveBeenCalledExactlyOnceWith(1);
    fireEvent.click(useButton());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(raster(4), 1);
    expect(oldHandle.destroy).not.toHaveBeenCalled();
  });
});
