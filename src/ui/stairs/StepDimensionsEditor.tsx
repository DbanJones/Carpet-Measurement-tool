import { useEffect, useId, useState } from 'react';
import type { Staircase } from '@engine/types';
import { Field, LengthInput, NumberInput, Select, formatLength } from '@ui/components/inputs';
import { setStairCornerAngle, setStairPointPosition, setStairSideLength, stairDimensions, type StairDimensionEdit } from './stairDimensions';
import './step-dimensions-editor.css';

export interface StepDimensionsEditorProps {
  staircase: Staircase; stepId: string; unit: 'metric' | 'imperial';
  onChange: (staircase: Staircase) => void; defaultOpen?: boolean;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}

/** Exact outline measurements stay one click below the ordinary width/depth controls. */
export function StepDimensionsEditor({ staircase, stepId, unit, onChange, defaultOpen = false, open, onOpenChange }: StepDimensionsEditorProps) {
  const [sideIndex, setSideIndex] = useState(0), [pointIndex, setPointIndex] = useState(0);
  const [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(defaultOpen);
  const captionId = useId();
  useEffect(() => { setSideIndex(0); setPointIndex(0); setError(null); }, [stepId]);
  const dimensions = stairDimensions(staircase, stepId);
  if (!dimensions) return null;
  const side = dimensions.sides[Math.min(sideIndex, dimensions.sides.length - 1)]!;
  const corner = dimensions.corners[side.startCorner]!;
  const selectedPointIndex = Math.min(pointIndex, dimensions.points.length - 1);
  const point = dimensions.points[selectedPointIndex]!;
  const xs = dimensions.points.map(point => point.x), ys = dimensions.points.map(point => point.y);
  const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top;
  const scale = 172 / Math.max(width, height, 1);
  const at = (point: { x: number; y: number }) => ({ x: 24 + (172 - width * scale) / 2 + (point.x - left) * scale, y: 196 - (172 - height * scale) / 2 - (point.y - top) * scale });
  const apply = (edit: StairDimensionEdit) => {
    setError(edit.error ?? null);
    // Reset a rejected field to the real measurement; the inline message explains the unchanged shape.
    if (edit.error) setRevision(value => value + 1);
    else if (edit.staircase !== staircase) onChange(edit.staircase);
  };
  const choose = (index: number) => { setSideIndex(index); setPointIndex(dimensions.corners[index]!.pointIndex); setError(null); };
  return <details className="step-dimensions-editor" open={open ?? expanded} onToggle={event => { const next = event.currentTarget.open; setExpanded(next); onOpenChange?.(next); }}>
    <summary><span>Exact sides &amp; angles</span><span className="step-dimensions-count">{dimensions.corners.length} corners</span></summary>
    <div className="step-dimensions-body">
      <p className="step-dimensions-intro" id={captionId}>Select a side or corner to measure its actual outline. Shared corners stay joined to neighbouring steps.</p>
      <div className="step-dimensions-layout">
        <svg className="step-dimensions-diagram" viewBox="0 0 220 220" role="group" aria-label="Selected tread sides and corners" aria-describedby={captionId}>
          <polygon points={dimensions.points.map(point => { const p = at(point); return `${p.x},${p.y}`; }).join(' ')} className="step-dimensions-fill" />
          {dimensions.sides.map((item, index) => <g key={item.label}>
            <polyline points={item.pointIndices.map(i => { const p = at(dimensions.points[i]!); return `${p.x},${p.y}`; }).join(' ')} className={item === side ? 'step-dimensions-edge is-selected' : 'step-dimensions-edge'} />
            <polyline points={item.pointIndices.map(i => { const p = at(dimensions.points[i]!); return `${p.x},${p.y}`; }).join(' ')} className="step-dimensions-hit" role="button" tabIndex={0} aria-label={`Select side ${item.label}`} aria-pressed={item === side} onClick={() => choose(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(index); } }} />
          </g>)}
          {dimensions.corners.map((item, index) => { const p = at(item.point); return <g key={item.label} role="button" tabIndex={0} aria-label={`Select corner ${item.label}`} aria-pressed={item === corner} className="step-dimensions-corner" onClick={() => choose(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(index); } }}>
            <circle cx={p.x} cy={p.y} r={11} className={item === corner ? 'is-selected' : ''} /><text x={p.x} y={p.y + 3.5}>{item.label}</text>
          </g>; })}
        </svg>
        <div className="step-dimensions-controls" key={`${stepId}:${revision}`}>
          <Field label="Side"><Select ariaLabel="Tread side" value={String(side.startCorner)} options={dimensions.sides.map((item, index) => ({ value: String(index), label: `${item.label}${item.curved ? ' · curved' : ''} · ${formatLength(item.length, unit, 3)}` }))} onChange={value => choose(Number(value))} /></Field>
          <Field label={side.curved ? 'Length along curved edge' : `Side ${side.label} length`} hint={`Corner ${corner.label} stays fixed; corner ${dimensions.corners[side.endCorner]!.label} moves.`}><LengthInput ariaLabel="Exact tread side length" unit={unit} min={1} value={side.length} onChange={length => apply(setStairSideLength(staircase, stepId, side.startCorner, length))} /></Field>
          <div className="step-dimensions-angle"><Field label={`Inside angle at ${corner.label}`}><NumberInput ariaLabel="Exact tread corner angle" value={Math.round(corner.angle * 1000) / 1000} min={1} max={359} suffix="°" onChange={angle => apply(setStairCornerAngle(staircase, stepId, side.startCorner, angle))} /></Field><button type="button" onClick={() => apply(setStairCornerAngle(staircase, stepId, side.startCorner, 90))}>Set to 90°</button></div>
          <p className="step-dimensions-note">Angle edits keep {corner.label} and the incoming side fixed, then turn side {side.label}. Other side lengths update with the shape.</p>
        </div>
      </div>
      {error ? <p className="step-dimensions-error" role="alert">{error}</p> : null}
      <details className="step-dimensions-coordinates"><summary>Point coordinates</summary>
        <p className="step-dimensions-note">Positions use the staircase’s plan axes. Curves include intermediate points; their lengths follow the drawn path.</p>
        <div className="step-dimensions-coordinate-fields" key={`coordinates:${stepId}:${revision}`}>
          <Field label="Outline point"><Select ariaLabel="Tread outline point" value={String(selectedPointIndex)} options={dimensions.points.map((_, index) => ({ value: String(index), label: dimensions.corners.find(corner => corner.pointIndex === index)?.label ?? `Curve point ${index + 1}` }))} onChange={value => { setPointIndex(Number(value)); setError(null); }} /></Field>
          {(['x', 'y'] as const).map(axis => <Field key={axis} label={`${axis.toUpperCase()} position`}><LengthInput ariaLabel={`Exact tread point ${axis}`} unit={unit} min={-999999} value={point[axis]} onChange={value => apply(setStairPointPosition(staircase, stepId, selectedPointIndex, { ...point, [axis]: value }))} /></Field>)}
        </div>
      </details>
    </div>
  </details>;
}
