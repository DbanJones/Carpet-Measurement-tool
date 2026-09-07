import type { FloorPlanDocument } from '@engine/types';
import { useEffect, useRef } from 'react';
import { useProjectStore } from '@store/projectStore';
import { correctPlanTextLine, hasUsefulPlanText, readDimensions, readRoomNames } from './planText';
import { usePlanReading } from './usePlanReading';
import './plan-reader.css';

export interface PlanReadingStatus { busy: boolean; error: string | null; cancelled: boolean }

export function PlanReader({ plan, onUseName, onUseDistance, onStatusChange }: {
  plan: FloorPlanDocument; onUseName?: (name: string) => void; onUseDistance?: (mm: number) => void;
  onStatusChange?: (status: PlanReadingStatus) => void;
}) {
  const updateFloorPlan = useProjectStore(s => s.updateFloorPlan);
  const { read, cancel, busy, progress, error, cancelled } = usePlanReading(plan, reading => updateFloorPlan(plan.id, { reading }), { automatic: true });
  const statusCallback = useRef(onStatusChange); statusCallback.current = onStatusChange;
  useEffect(() => { statusCallback.current?.({ busy, error, cancelled }); }, [busy, error, cancelled]);
  const names = plan.reading ? readRoomNames(plan.reading) : [];
  const dimensions = plan.reading ? readDimensions(plan.reading.text) : [];
  const useful = hasUsefulPlanText(plan.reading);
  const status = busy ? 'Reading room names and dimensions' : error ? 'Text reading needs another try' : cancelled ? 'Text reading paused'
    : useful ? 'Plan text ready' : plan.reading?.source === 'ocr' ? 'No clear room text found' : 'Preparing automatic text reading';
  if (plan.sketch) return null;
  return <section className="plan-reader" data-testid="plan-reader" aria-label="Automatic plan reading">
    <div className={`plan-reading-status ${busy ? 'is-reading' : ''} ${error ? 'has-error' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      <span className="plan-reading-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4M8 8h8M8 12h8M8 16h5"/></svg></span>
      <div><strong>{status}</strong><span>{busy ? `Automatic · ${progress}% · you can keep working` : useful ? `${names.length} room ${names.length === 1 ? 'label' : 'labels'} · ${dimensions.length} printed ${dimensions.length === 1 ? 'length' : 'lengths'}${plan.reading?.source === 'pdf' ? ' · PDF text' : ''}` : cancelled ? 'Resume when you are ready.' : error ? 'You can keep drawing and enter measurements yourself.' : plan.reading?.source === 'ocr' ? 'Add names and measurements as you draw.' : 'Names and dimension checks will appear as you draw.'}</span></div>
    </div>
    {busy ? <progress aria-label="Automatic text reading progress" value={progress} max={100}/> : null}
    <details className="plan-reading-review">
    <summary>Read plan text · review and options</summary>
    <p className="small muted">Room names and printed measurements are read automatically on this device. Check suggestions against the original plan.</p>
    {busy ? <button type="button" onClick={cancel}>Cancel text reading</button>
      : <button type="button" onClick={() => void read()}>{plan.reading ? 'Read image again' : 'Read text from plan'}</button>}
    {error ? <p role="alert" className="warning">{error}</p> : null}
    {plan.reading ? <div className="plan-reading-results">
      <p className="small muted">{plan.reading.source === 'pdf' ? 'Text extracted from the PDF.' : 'Text recognised from the image.'} Select a suggestion to use it in the current task.</p>
      {names.length ? <div><strong className="small">Room labels</strong><div className="reading-suggestions">{names.map(name => onUseName
        ? <button type="button" key={name} onClick={() => onUseName(name)} title="Use as draft name">{name}</button> : <span className="badge" key={name}>{name}</span>)}</div></div> : null}
      {dimensions.length ? <div><strong className="small">Printed lengths</strong><div className="reading-suggestions">{dimensions.map(dimension => onUseDistance
        ? <button type="button" key={dimension.mm} onClick={() => onUseDistance(dimension.mm)} title="Use as known distance">{dimension.label}</button> : <span className="badge" key={dimension.mm}>{dimension.label}</span>)}</div></div> : null}
      {!names.length && !dimensions.length ? <p className="small">No clear room labels or unit-labelled lengths found. You can still name rooms and enter a known measurement manually.</p> : null}
      <details><summary>Review or correct recognised text</summary>
        <p className="small muted">Small text can lose decimal points. Correct an individual line to update its room name or dimension check at the same position on the plan.</p>
        <div className="plan-text-corrections">{plan.reading.lines.map((line, index) => <label className="plan-text-correction" key={index}>
          <span>Plan line {index + 1}<small>{line.reviewed ? 'Checked by you' : `Recognition ${Math.round(line.confidence)}%`}</small></span>
          <input type="text" aria-label={`Correct plan line ${index + 1}`} value={line.text} maxLength={500} onChange={event => updateFloorPlan(plan.id, { reading: correctPlanTextLine(plan.reading!, index, event.target.value) })}/>
        </label>)}</div>
        <details><summary>Full text transcript</summary><p className="small muted">Transcript edits update the general suggestions only. Use the individual lines above for room-specific checks. Editing an individual line rebuilds this transcript.</p>
          <label className="field"><span className="field-label">Recognised text</span><textarea rows={6} aria-label="Recognised text" value={plan.reading.text} onChange={event => updateFloorPlan(plan.id, { reading: { ...plan.reading!, text: event.target.value.slice(0, 50000) } })} /></label>
        </details>
      </details>
    </div> : null}
    </details>
  </section>;
}
