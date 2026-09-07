import { useState } from 'react';
import type { Staircase, StairLayout } from '@engine/types';
import { useProjectStore } from '@store/projectStore';
import { newId } from '@store/ids';
import { Field, LengthInput, NumberInput, Select } from '@ui/components/inputs';
import { applyWinderLayout, defaultStairLayout, STAIR_SHAPES } from './stairLayout';

export function StairLayoutEditor({ staircase, unit }: { staircase: Staircase; unit: 'metric' | 'imperial' }) {
  const update = useProjectStore((s) => s.updateStaircase);
  const initial = defaultStairLayout(staircase);
  const [layout, setLayout] = useState<StairLayout>(initial);
  const [editing, setEditing] = useState(false);
  const [transition, setTransition] = useState<'winders' | 'landing'>(initial.turnSteps === 0 ? 'landing' : 'winders');
  const [replaceDepths, setReplaceDepths] = useState(!staircase.steps.some((s) => s.kind === 'winder'));
  const [wide, setWide] = useState(staircase.steps.find((s) => s.kind === 'winder')?.going ?? 600);
  const [narrow, setNarrow] = useState(staircase.steps.find((s) => s.kind === 'winder')?.goingNarrow ?? 100);
  const stairWidth = Math.max(...staircase.steps.map((s) => s.width), 1);
  const currentLanding = staircase.landings.find((l) => l.kind !== 'top' && l.afterStepIndex === initial.turnStartIndex - 1);
  const [landingLength, setLandingLength] = useState(currentLanding?.length ?? stairWidth);
  const [landingWidth, setLandingWidth] = useState(currentLanding?.width ?? (initial.kind === 'half_turn' ? stairWidth * 2 : stairWidth));
  const [notice, setNotice] = useState('');
  const change = (patch: Partial<StairLayout>) => { setLayout((s) => ({ ...s, ...patch })); setEditing(true); setNotice(''); };
  const chooseShape = (kind: StairLayout['kind']) => {
    const current = defaultStairLayout(staircase);
    const curved = kind === 'curved';
    setLayout({ ...current, kind, turnStartIndex: curved ? 0 : Math.min(current.turnStartIndex || Math.floor(staircase.steps.length / 2), staircase.steps.length - 1), turnSteps: curved ? staircase.steps.length : Math.min(current.kind === kind ? current.turnSteps || 3 : kind === 'half_turn' ? 6 : 3, staircase.steps.length), curveAngle: current.curveAngle ?? 180, innerRadius: current.innerRadius ?? 300 });
    if (curved) setTransition('winders');
    setLandingWidth(current.kind === kind && currentLanding ? currentLanding.width : kind === 'half_turn' ? stairWidth * 2 : stairWidth);
    setLandingLength(current.kind === kind && currentLanding ? currentLanding.length : stairWidth);
    setEditing(true); setNotice('');
  };
  const maxTurnSteps = Math.max(1, staircase.steps.length - layout.turnStartIndex);
  const useWinders = transition === 'winders' || layout.kind === 'curved';
  const apply = () => {
    const start = Math.max(0, Math.min(staircase.steps.length - 1, layout.turnStartIndex));
    const next = { ...layout, turnStartIndex: start, turnSteps: layout.kind === 'straight' || !useWinders ? 0 : Math.max(1, Math.min(staircase.steps.length - start, layout.turnSteps)) };
    update(staircase.id, (current) => {
      let result = applyWinderLayout(current, next, replaceDepths ? wide : undefined, replaceDepths ? narrow : undefined);
      if (next.kind !== 'straight' && !useWinders) {
        const afterStepIndex = start - 1;
        const existing = current.landings.find((l) => l.afterStepIndex === afterStepIndex && l.kind !== 'top');
        const landing = { id: existing?.id ?? newId('landing'), kind: next.kind === 'half_turn' ? 'half' as const : 'quarter' as const, afterStepIndex, length: landingLength, width: landingWidth };
        result = { ...result, landings: existing ? current.landings.map((l) => l.id === existing.id ? landing : l) : [...current.landings, landing] };
      }
      return { ...result, steps: result.steps.map(({ plan: _plan, outline: _outline, ...step }) => step), drawing: undefined };
    });
    setLayout(next); setEditing(false);
    setNotice(next.kind === 'straight' ? 'Straight plan applied. Existing step measurements and landings are retained.' : useWinders ? `Layout applied to steps ${start + 1}–${start + next.turnSteps}. Check each turning tread’s widest and narrowest depths in Individual steps and turns.` : 'Turning landing added. Check its measured size in Landings.');
  };
  return <div className="stairs-layout-picker">
    <div className="stairs-layout-heading"><strong>Staircase shape</strong><span className="field-hint">Choose the view from above</span></div>
    <div className="stairs-shape-options" role="group" aria-label="Staircase shape">
      {STAIR_SHAPES.map((shape) => <button key={shape.value} type="button" className={layout.kind === shape.value ? 'active' : ''} aria-pressed={layout.kind === shape.value} onClick={() => chooseShape(shape.value)}>
        <svg aria-hidden="true" viewBox="0 0 60 46"><path d={shape.value === 'straight' ? 'M30 40V7' : shape.value === 'quarter_turn' ? 'M15 40V15H48' : shape.value === 'half_turn' ? 'M15 40V14Q15 7 22 7H38Q45 7 45 14V36' : 'M12 38C3 12 25 1 42 10C57 18 48 36 36 38'} /><path d={shape.value === 'straight' ? 'M24 14L30 7L36 14' : shape.value === 'quarter_turn' ? 'M41 9L48 15L41 21' : shape.value === 'half_turn' ? 'M39 29L45 36L51 29' : 'M41 30L36 38L45 41'} /></svg>
        <strong>{shape.label}</strong><span>{shape.detail}</span>
      </button>)}
    </div>
    {!editing && layout.kind !== 'straight' ? <button type="button" className="small" onClick={() => setEditing(true)}>Edit turn and curve</button> : null}
    {editing ? <div className="stairs-layout-fields">
      {layout.kind !== 'straight' ? <>
        <div className="grid-2">
          <Field label="Turn direction"><Select ariaLabel="Turn direction" value={layout.direction} options={[{ value: 'right', label: 'Right, walking upstairs' }, { value: 'left', label: 'Left, walking upstairs' }]} onChange={(direction) => change({ direction })} /></Field>
          {layout.kind !== 'curved' ? <Field label="At the turn"><Select ariaLabel="At the turn" value={transition} options={[{ value: 'winders', label: 'Winder steps' }, { value: 'landing', label: 'Flat landing' }]} onChange={(value) => { setTransition(value); setEditing(true); }} /></Field> : <Field label="Curve sweep" hint="180° is a half circle."><NumberInput ariaLabel="Curve sweep" value={layout.curveAngle ?? 180} min={15} max={330} onChange={(curveAngle) => change({ curveAngle })} suffix="°" /></Field>}
          <Field label="Turn after step" hint="0 starts the turn at the bottom."><NumberInput ariaLabel="Turn after step" value={layout.turnStartIndex} min={0} max={Math.max(0, staircase.steps.length - 1)} integer onChange={(turnStartIndex) => change({ turnStartIndex })} /></Field>
          {useWinders ? <Field label="Steps in the turn"><NumberInput ariaLabel="Steps in the turn" value={Math.min(layout.turnSteps || 1, maxTurnSteps)} min={1} max={maxTurnSteps} integer onChange={(turnSteps) => change({ turnSteps })} /></Field> : null}
          {layout.kind === 'curved' ? <Field label="Inside radius" hint="For the plan view; measure the tread depths separately."><LengthInput ariaLabel="Inside radius" value={layout.innerRadius ?? 300} unit={unit} onChange={(innerRadius) => change({ innerRadius })} /></Field> : null}
        </div>
        {useWinders ? <>
          <label className="checkbox"><input type="checkbox" checked={replaceDepths} onChange={(e) => setReplaceDepths(e.target.checked)} /> Set measured depths for these turning treads</label>
          {replaceDepths ? <div className="grid-2"><Field label="Widest tread depth"><LengthInput ariaLabel="Widest turning tread depth" value={wide} unit={unit} onChange={setWide} /></Field><Field label="Narrowest tread depth"><LengthInput ariaLabel="Narrowest turning tread depth" value={narrow} unit={unit} onChange={setNarrow} /></Field></div> : <p className="field-hint">Existing tread depths are kept. Open Individual steps and turns to check each widest and narrowest measurement.</p>}
        </> : <div className="grid-2"><Field label="Landing depth"><LengthInput ariaLabel="Turning landing depth" value={landingLength} unit={unit} onChange={setLandingLength} /></Field><Field label="Landing width" hint={layout.kind === 'half_turn' ? 'Measure across both flights.' : undefined}><LengthInput ariaLabel="Turning landing width" value={landingWidth} unit={unit} onChange={setLandingWidth} /></Field></div>}
        <p className="field-hint">Applying a layout keeps riser count, heights and widths. Existing turns and landings outside this selection stay in the estimate; edit them individually when changing an existing flight.</p>
      </> : <p className="field-hint">This changes the plan view. Existing winder measurements and landings are kept; edit individual steps if the physical staircase has changed.</p>}
      <div className="stairs-layout-actions"><button type="button" className="primary" disabled={useWinders && replaceDepths && (!(wide > 0) || narrow < 0 || narrow > wide)} onClick={apply}>Apply staircase layout</button><button type="button" onClick={() => { setLayout(defaultStairLayout(staircase)); setEditing(false); }}>Cancel</button></div>
    </div> : null}
    {notice ? <p className="stairs-complex-note" role="status">{notice}</p> : null}
  </div>;
}
