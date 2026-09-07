import type { FloorPlanDocument } from '@engine/types';
import { formatLength } from '@ui/components/inputs';
import type { Px } from './tracing';
import './scale-overlay.css';

export interface CanvasScaleState {
  active: boolean;
  pointCount: number;
  /** The distance entered for the new reference, in millimetres. It is not saved yet. */
  distance?: number;
  /** A text-matched reference still needs explicit confirmation. */
  suggested?: boolean;
  searching?: boolean;
}

/** A round real-world distance that stays readable at the current display zoom. */
export function physicalScaleRuler(mmPerPx: number, zoom: number, unit: 'metric' | 'imperial') {
  if (!(mmPerPx > 0) || !(zoom > 0) || !Number.isFinite(mmPerPx / zoom)) return null;
  const base = unit === 'imperial' ? 304.8 : 1;
  const target = 96 * mmPerPx / zoom / base;
  const order = 10 ** Math.floor(Math.log10(target));
  const amount = [5, 2, 1].find((n) => n * order <= target) ?? 1;
  const distance = amount * order * base;
  return { distance, width: distance / mmPerPx * zoom };
}

export function CanvasCalibrationNotice({ unit, state }: { unit: 'metric' | 'imperial'; state?: CanvasScaleState }) {
  if (!state?.active) return null;
  const instructions = state.suggested
    ? `Check the ${formatLength(state.distance ?? 0, unit)} A–B reference, then confirm the suggested scale.`
    : state.searching ? 'Looking for a printed room size and matching wall length. You can also tap a known wall to set the scale yourself.'
    : state?.pointCount === 0
    ? 'Tap the first end of a wall with a known length.'
    : state?.pointCount === 1
      ? 'Tap the other end of the same wall.'
      : state?.distance && state.distance > 0
        ? `${formatLength(state.distance, unit)} entered. Confirm the scale to start measuring.`
        : 'Enter the real distance between A and B, then confirm the scale.';
  return <div className="fp-calibrating-banner" role="status" aria-live="polite" data-testid="scale-canvas-instruction">
      <span className="fp-calibrating-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m4 16 12-12 4 4L8 20ZM8 12l2 2m2-6 2 2m2-6 2 2"/></svg></span>
      <span><strong>{state.suggested ? 'Suggested scale · awaiting confirmation' : 'Setting the scale'}{!state.suggested && !state.searching ? <span> · {Math.min((state.pointCount || 0) + 1, 3)} of 3</span> : null}</strong><span>{instructions}</span></span>
    </div>;
}

export function CanvasScaleOverlay({ plan, zoom, unit, state }: {
  plan: FloorPlanDocument; zoom: number; unit: 'metric' | 'imperial'; state?: CanvasScaleState;
}) {
  const ruler = plan.mmPerPx ? physicalScaleRuler(plan.mmPerPx, zoom, unit) : null;
  return <div className="fp-canvas-scale-overlay" style={{ pointerEvents: 'none' }}>
    <div className={`fp-physical-scale${ruler ? ' is-calibrated' : ' is-unscaled'}`} data-testid="physical-scale-ruler">
      {ruler ? <>
        <div className="fp-ruler-line" style={{ width: ruler.width }}><span/><span/><span/></div>
        <strong>{formatLength(ruler.distance, unit)}</strong>
        <span>{plan.sketch ? `${formatLength(plan.sketch.gridMm, unit)} grid` : state?.active ? 'Saved scale' : 'Scale set'}</span>
      </> : <><span className="fp-scale-unset-dot"/><strong>Scale not set</strong><span>Measurements unavailable</span></>}
    </div>
  </div>;
}

/** The reference lives in image coordinates; strokes, points and labels stay readable at every zoom. */
export function ScaleReference({ plan, a, b, distance, zoom, unit, draft = false, endpointPlaced = true }: {
  plan: FloorPlanDocument; a: Px; b?: Px | null; distance?: number; zoom: number;
  unit: 'metric' | 'imperial'; draft?: boolean; endpointPlaced?: boolean;
}) {
  const z = Math.max(.01, zoom);
  const label = distance && distance > 0
    ? `${formatLength(distance, unit)} · ${draft ? 'Not saved' : 'Scale set'}`
    : 'A → B · Enter the distance';
  const width = Math.min(label.length * 6.1 + 22, plan.widthPx * z - 8) / z;
  const height = 26 / z;
  const middle = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a;
  const x = Math.max(width / 2 + 4 / z, Math.min(plan.widthPx - width / 2 - 4 / z, middle.x));
  // Keep the caption inside the image when the reference touches a page edge.
  const y = middle.y * z < 24
    ? Math.min(plan.heightPx - height / 2, middle.y + 25 / z)
    : Math.max(height / 2 + 3 / z, middle.y - 21 / z);
  const marker = (point: Px, name: string, ghost = false) => <g className={`fp-reference-point${ghost ? ' is-preview' : ''}`}>
    <circle cx={point.x} cy={point.y} r={9 / z} strokeWidth={2 / z} strokeDasharray={ghost ? `${2 / z} ${2 / z}` : undefined}/>
    <text x={point.x} y={point.y + .5 / z} fontSize={10 / z} textAnchor="middle" dominantBaseline="central">{name}</text>
  </g>;
  return <g className={`fp-reference ${draft ? 'is-draft' : 'is-confirmed'}`} pointerEvents="none" data-testid={draft ? 'draft-scale-reference' : 'confirmed-scale-reference'}>
    <title>{draft ? 'Scale reference not saved' : 'Confirmed scale reference'}{distance ? `: ${formatLength(distance, unit)}` : ''}</title>
    {b ? <>
      <line className="fp-reference-halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={6 / z}/>
      <line className="fp-reference-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={2 / z} strokeDasharray={draft ? `${6 / z} ${4 / z}` : undefined}/>
    </> : null}
    {marker(a, 'A')}{b ? marker(b, 'B', !endpointPlaced) : null}
    {b ? <g className="fp-reference-caption">
      <rect x={x - width / 2} y={y - height / 2} width={width} height={height} rx={7 / z} strokeWidth={1 / z}/>
      <text x={x} y={y + .5 / z} textAnchor="middle" dominantBaseline="central" fontSize={11 / z}>{label}</text>
    </g> : null}
  </g>;
}
