import type { SuggestedScale } from './automaticScale';
import { formatLength } from '@ui/components/inputs';
import './scale-suggestion.css';

export function ScaleSuggestionCard({ suggestion, unit, onConfirm, onManual }: {
  suggestion: SuggestedScale; unit: 'metric' | 'imperial'; onConfirm: () => void; onManual: () => void;
}) {
  return <section className="fp-auto-scale" data-testid="automatic-scale-suggestion">
    <div className="eyebrow">SCALE FOUND · PLEASE CONFIRM</div>
    <h3>Check the highlighted length</h3>
    <p>We matched a printed room size to its walls. Check the A–B line on the plan before continuing.</p>
    <div className="fp-auto-scale-reading"><span>{suggestion.roomName || 'Reference room'}</span><strong>{suggestion.printedLabel}</strong><small>Read from the plan</small></div>
    <div className="fp-auto-scale-reference"><span>A–B reference</span><strong>{formatLength(suggestion.distance, unit)}</strong></div>
    <details className="fp-auto-scale-evidence"><summary>How this was checked</summary><p>{suggestion.checkLabel}</p>{suggestion.matchedRooms > 1 ? <p>{suggestion.matchedRooms} rooms support this scale.</p> : null}</details>
    <button type="button" className="primary fp-primary" onClick={onConfirm}>Confirm scale & find rooms</button>
    <button type="button" className="link fp-auto-scale-manual" onClick={onManual}>Set scale manually</button>
    <p className="fp-help">Room outlines are shown for review before they are added to your estimate.</p>
  </section>;
}
