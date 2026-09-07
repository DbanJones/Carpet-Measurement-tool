import { useEffect, useId, useState } from 'react';
import type { PdfHandle, PlanRaster } from './pdf';
import './pdf-page-picker.css';

interface PdfPagePickerProps {
  name: string;
  handle: PdfHandle;
  onChoose: (raster: PlanRaster, page: number) => void;
  onCancel: () => void;
}

interface PreviewResult {
  handle: PdfHandle;
  page: number;
  attempt: number;
  raster?: PlanRaster;
  error?: string;
}

/** Preview before import: opening a brochure never adds its cover as a floor plan. */
export function PdfPagePicker({ name, handle, onChoose, onCancel }: PdfPagePickerProps) {
  const headingId = useId();
  const selectId = useId();
  const [selection, setSelection] = useState({ handle, page: 1 });
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const page = selection.handle === handle ? selection.page : 1;
  const current = result?.handle === handle && result.page === page && result.attempt === attempt ? result : null;
  const loading = current === null;

  useEffect(() => {
    let cancelled = false;
    // The parent owns the PDF handle. Ignore outdated renders without destroying that document.
    void Promise.resolve().then(() => handle.renderPage(page)).then(
      (raster) => { if (!cancelled) setResult({ handle, page, attempt, raster }); },
      (error: unknown) => {
        if (!cancelled) setResult({ handle, page, attempt, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => { cancelled = true; };
  }, [handle, page, attempt]);

  return (
    <section className="fp-pdf-picker" aria-labelledby={headingId}>
      <div className="fp-pdf-picker-heading">
        <div>
          <h3 id={headingId}>Choose the floor plan page</h3>
          <p className="fp-pdf-picker-name">{name}</p>
        </div>
        <div className="fp-pdf-picker-select">
          <label htmlFor={selectId}>PDF page</label>
          <select id={selectId} value={page} onChange={(event) => {
            setSelection({ handle, page: Number(event.target.value) });
            setAttempt((value) => value + 1);
          }}>
            {Array.from({ length: handle.pageCount }, (_, index) => (
              <option key={index + 1} value={index + 1}>Page {index + 1} of {handle.pageCount}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="fp-pdf-picker-help">Find the page containing the floor plan, then use it to start measuring.</p>
      <div className="fp-pdf-picker-preview" aria-busy={loading}>
        {loading ? <p role="status">Loading page {page}…</p> : null}
        {current?.error !== undefined ? (
          <div className="fp-pdf-picker-error">
            <p role="alert">Page {page} could not be shown. {current.error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry preview</button>
          </div>
        ) : null}
        {current?.raster ? (
          <img
            src={current.raster.imageDataUrl}
            width={current.raster.widthPx}
            height={current.raster.heightPx}
            alt={`Page ${page} of ${name}`}
          />
        ) : null}
      </div>
      <div className="fp-pdf-picker-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!current?.raster} onClick={() => {
          if (current?.raster) onChoose(current.raster, page);
        }}>Use this page</button>
      </div>
    </section>
  );
}
