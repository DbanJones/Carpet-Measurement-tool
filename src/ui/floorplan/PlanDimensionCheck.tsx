import type { PlanReading, Point } from '@engine/types';
import { formatM } from '@engine/units';
import { comparePlanDimensions, suggestRoomText } from './planText';
import './plan-reader.css';

const reasons = {
  irregular: 'This outline is irregular. Printed lengths may describe its widest parts; compare them with the original plan.',
  rotated: 'This room is rotated. The comparison follows its longest wall and remains approximate.',
  uncertain_text: 'The text is unclear. Check decimal points and units against the original plan.',
  multiple_dimensions: 'Several different dimension pairs sit inside this outline. Check which pair belongs to this room.',
};

export function PlanDimensionCheck({ reading, polygon, mmPerPx }: {
  reading: PlanReading | undefined; polygon: readonly Point[]; mmPerPx?: number;
}) {
  const check = comparePlanDimensions(reading, polygon, mmPerPx);
  if (!check) {
    const unclear = suggestRoomText(reading, polygon).dimensionWarning;
    if (!unclear) return null;
    return <aside className="plan-dimension-check is-approximate" data-testid="plan-dimension-check" aria-label="Printed dimension check">
      <strong>Printed measurement needs checking</strong><dl><div><dt>Text read from plan</dt><dd>{unclear}</dd></div></dl>
      <p>Check decimal points and units against the original plan. This reading has not been used to check or change the room dimensions.</p>
    </aside>;
  }
  const title = check.status === 'match' ? 'Dimensions look consistent' : check.status === 'difference' ? 'Check these dimensions'
    : check.status === 'approximate' ? 'Approximate dimension check' : 'Printed dimensions found';
  return <aside className={`plan-dimension-check is-${check.status}`} data-testid="plan-dimension-check" aria-label="Printed dimension check">
    <div className="plan-dimension-heading"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 14 14 3l3 3L6 17zM7 10l3 3m0-6 3 3"/></svg><strong>{title}</strong></div>
    <dl><div><dt>Printed on plan</dt><dd>{check.printed.label}</dd></div>{check.measured ? <div><dt>From your outline</dt><dd>{formatM(check.measured.widthMm)} × {formatM(check.measured.heightMm)}</dd></div> : null}</dl>
    <p>{check.status === 'unscaled' ? 'Set the scale to compare these with your outline.'
      : check.reason ? reasons[check.reason]
      : check.status === 'difference' ? `The largest difference is about ${Math.round(check.differencePercent!)}%. Check the outline, scale and printed text.`
      : 'Within 5% or 100 mm of the printed lengths. Confirm measurements on site.'}</p>
  </aside>;
}
