import { Field, LengthInput, NumberInput, formatLength } from '@ui/components/inputs';
import type { StaircaseSuggestion } from './roomSuggestions';
import { MAX_RISERS } from '@ui/stairs/stairLimits';

export function DetectedStairsReview({ stairs, activeId, issues, unit, onSelect, onChange, onEdit }: {
  stairs: StaircaseSuggestion[]; activeId?: string; issues: Map<string, string>; unit:'metric'|'imperial';
  onSelect:(id:string)=>void; onChange:(id:string, patch:Partial<StaircaseSuggestion>)=>void; onEdit:(stair:StaircaseSuggestion)=>void;
}) {
  if (!stairs.length) return null;
  const active=stairs.find(stair=>stair.id===activeId)??(!activeId?stairs[0]:undefined);
  return <section className="fp-stair-suggestions" aria-label="Detected staircases">
    <div className="eyebrow">STAIRCASES FOUND · CHECK ESTIMATES</div>
    <h3>{stairs.length} possible {stairs.length===1?'staircase':'staircases'}</h3>
    <p>Repeated tread lines suggest these stair footprints. Check the complete flight before including it.</p>
    <ol className="fp-suggestion-list">{stairs.map((stair,index)=><li key={stair.id} className={stair.id===active?.id?'active':''}>
      <input type="checkbox" aria-label={`Include detected staircase ${index+1}: ${stair.name}`} checked={stair.included} onChange={event=>{onChange(stair.id,{included:event.target.checked});onSelect(stair.id);}}/>
      <button type="button" onClick={()=>onSelect(stair.id)} aria-current={stair.id===active?.id?'true':undefined}><span className="fp-suggestion-index">S{index+1}</span><span><strong>{stair.name}</strong><small>{formatLength(stair.widthMm,unit)} wide · {stair.visibleTreads} tread lines</small></span></button>
    </li>)}</ol>
    {active ? <div className="fp-stair-estimate">
      <Field label="Staircase name"><input aria-label="Detected staircase name" value={active.name} onChange={event=>onChange(active.id,{name:event.target.value})}/></Field>
      <p className="fp-help">Estimated footprint: <strong>{formatLength(active.widthMm,unit)} × {formatLength(active.lengthMm,unit)}</strong>. {active.message}</p>
      <div className="grid-2">
        <Field label="Total risers to include" hint="Check the whole flight"><NumberInput ariaLabel="Detected staircase risers" min={2} max={MAX_RISERS} integer value={active.estimatedRisers} onChange={value=>onChange(active.id,{estimatedRisers:Math.round(value)})}/></Field>
        <Field label="Flight width"><LengthInput ariaLabel="Detected staircase width" min={300} value={active.widthMm} unit={unit} onChange={value=>onChange(active.id,{widthMm:value})}/></Field>
      </div>
      <details><summary>Step measurements and assumptions</summary><div className="grid-2">
        <Field label="Tread depth"><LengthInput ariaLabel="Detected staircase going" min={100} value={active.goingMm} unit={unit} onChange={value=>onChange(active.id,{goingMm:value})}/></Field>
        <Field label="Riser height" hint="Cannot be read from a top-down plan"><LengthInput ariaLabel="Detected staircase rise" min={80} value={active.riseMm} unit={unit} onChange={value=>onChange(active.id,{riseMm:value})}/></Field>
      </div><p className="fp-help">Hidden steps, turns and floor height need checking. After adding, use the staircase guide to set the rotation and winders.</p></details>
      {issues.get(active.id)?<p role="alert" className="warning">{issues.get(active.id)}</p>:null}
      <button type="button" className="link" onClick={()=>onEdit(active)}>Edit staircase footprint</button>
    </div> : <p className="fp-help">Select an S marker or staircase above to check its measurements.</p>}
  </section>;
}
