import { useMemo, useRef, useState } from 'react';
import type { Staircase, StairLayout } from '@engine/types';
import { makeSteps } from '@store/projectStore';
import { Field, LengthInput, NumberInput, formatLength } from '@ui/components/inputs';
import { defaultStairLayout, stairPlanGeometry } from '@ui/stairs/stairLayout';
import { measuredStairPreset, stairFlightDimensions } from '@ui/stairs/stepEditing';
import { MAX_RISERS } from '@ui/stairs/stairLimits';
import './setup.css';
import './stair-setup-wizard.css';

const SHAPES: { kind: StairLayout['kind']; title: string; subtitle: string }[] = [
  { kind: 'straight', title: 'Straight', subtitle: 'No turn · 0°' },
  { kind: 'quarter_turn', title: 'L-shaped', subtitle: 'Quarter turn · 90°' },
  { kind: 'half_turn', title: 'U-shaped', subtitle: 'Half turn · 180°' },
  { kind: 'curved', title: 'Custom turn', subtitle: 'Set your own angle' },
];

/** A measured, disposable preview: no live staircase changes until the final confirmation. */
export function StairSetupWizard({ staircase, unit, onApply, onCancel }: {
  staircase: Staircase; unit: 'metric' | 'imperial'; onApply: (staircase: Staircase) => void; onCancel: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const initial = defaultStairLayout(staircase);
  const dimensions = stairFlightDimensions(staircase, 0);
  const [stage, setStage] = useState(0);
  const [kind, setKind] = useState(initial.kind);
  const [direction, setDirection] = useState(initial.direction);
  const [turn, setTurn] = useState<'landing' | 'winders'>(staircase.landings.some(landing => landing.kind !== 'top') ? 'landing' : 'winders');
  const [corner, setCorner] = useState<'round' | 'square'>(staircase.steps.some(step => step.kind === 'winder' && !step.outline) ? 'round' : 'square');
  const [count, setCount] = useState(Math.max(2, Math.min(MAX_RISERS, staircase.steps.length)));
  const [width, setWidth] = useState(dimensions.width);
  const [rise, setRise] = useState(staircase.steps[0]?.rise ?? 200);
  const [going, setGoing] = useState(dimensions.going);
  const [turnAfter, setTurnAfter] = useState<number | undefined>(initial.kind === 'straight' ? undefined : initial.turnStartIndex);
  const [turnSteps, setTurnSteps] = useState<number | undefined>(staircase.steps.some(step => step.kind === 'winder') ? initial.turnSteps : undefined);
  const [curveAngle, setCurveAngle] = useState(initial.curveAngle ?? 180);
  const rotation = kind === 'straight' ? 0 : kind === 'half_turn' ? 180 : kind === 'quarter_turn' ? 90 : curveAngle;
  const turning = kind !== 'straight';
  const useWinders = turn === 'winders' || kind === 'curved';
  const winders = Math.max(2, Math.min(count, turnSteps ?? Math.max(2, Math.round(rotation / 22.5))));
  const beforeTurn = Math.max(useWinders ? 0 : 1, Math.min(useWinders ? count - winders : count - 1, turnAfter ?? Math.floor((count - (useWinders ? winders : 0)) / 2)));
  const preview = useMemo(() => {
    const steps = Array.from({ length: count }, (_, index) => ({ ...staircase.steps[index] ?? makeSteps(1)[0]!, kind: 'straight' as const, width, rise, going, plan: undefined, outline: undefined }));
    return measuredStairPreset({ ...staircase, steps, landings: staircase.landings.map(landing => landing.kind === 'top' ? { ...landing, afterStepIndex: count - 1 } : landing) }, {
      kind, direction, turn: useWinders ? 'winders' : 'landing', corner, turnStartIndex: beforeTurn, turnSteps: winders, curveAngle,
    });
  }, [staircase, count, width, rise, going, kind, direction, useWinders, corner, beforeTurn, winders, curveAngle]);
  const pages = turning ? [0, 1, 2, 3] : [0, 2, 3];
  const next = () => {
    const invalid = section.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    setStage(pages[pages.indexOf(stage) + 1] ?? 3);
  };
  const back = () => setStage(pages[Math.max(0, pages.indexOf(stage) - 1)] ?? 0);
  const turnSummary = turning ? useWinders ? `${winders} turning steps · ${rotation}° · no turning landing` : `${rotation}° turn on a flat landing` : 'One straight flight';
  return <section ref={section} className="stair-setup stair-guide-simple" data-stage={stage} aria-label="Guided staircase setup">
    <div className="setup-header"><div><div className="eyebrow">GUIDED STAIRS</div><h3>Build your staircase</h3></div><button type="button" className="link" onClick={onCancel}>Cancel stair guide</button></div>
    <ol className="setup-steps" aria-label="Stair guide progress">{pages.map((page, index) => <li key={page} aria-current={stage === page ? 'step' : undefined} className={stage > page ? 'complete' : ''}><span>{stage > page ? '✓' : index + 1}</span>{['Steps & rotation', 'The turn', 'Measurements', 'Check & apply'][page]}</li>)}</ol>
    <div className="setup-content">
      {stage === 0 ? <>
        <h3>How many steps, and how far does it turn?</h3>
        <p>Count upwards from the bottom. The plan updates as you choose.</p>
        <Field label="Total number of steps up" hint="Count every rise, including the last rise to the upstairs floor."><NumberInput ariaLabel="Guide riser count" value={count} min={2} max={MAX_RISERS} integer onChange={setCount}/></Field>
        <div className="setup-shapes" role="group" aria-label="Guided stair rotation">{SHAPES.map(shape => <button type="button" key={shape.kind} aria-pressed={kind === shape.kind} onClick={() => { setKind(shape.kind); setTurnAfter(undefined); setTurnSteps(undefined); if (shape.kind === 'curved') setTurn('winders'); }}><StairShapeIcon kind={shape.kind}/><strong>{shape.title}</strong><span>{shape.subtitle}</span></button>)}</div>
        {kind === 'curved' ? <Field label="Total rotation" hint="180° returns in the opposite direction."><NumberInput ariaLabel="Guide curve angle" value={curveAngle} min={15} max={330} suffix="°" onChange={setCurveAngle}/></Field> : null}
        <StairSetupPreview staircase={preview}/>
      </> : stage === 1 ? <>
        <h3>How do the steps go around the turn?</h3>
        <p>A U-shaped staircase can turn entirely on steps. It does not need a landing.</p>
        <div className="setup-turn-choices" role="group" aria-label="Guided turn surface">
          <button type="button" aria-pressed={useWinders} onClick={() => { setTurn('winders'); setTurnAfter(undefined); }}><strong>Turning steps · no landing</strong><span>The steps keep rising around the corner. Also called winders.</span></button>
          {kind !== 'curved' ? <button type="button" aria-pressed={!useWinders} onClick={() => { setTurn('landing'); setTurnAfter(undefined); }}><strong>A flat landing</strong><span>A level platform between two flights.</span></button> : null}
        </div>
        {useWinders ? <div className="stair-guide-turn-count"><Field label="How many steps make the turn?" hint={`Included in your ${count} total steps, not added on top.`}><NumberInput ariaLabel="Guide turning steps" value={winders} min={2} max={count} integer onChange={setTurnSteps}/></Field><div className="stair-guide-live-summary" role="status">{turnSummary}</div></div> : null}
        <div className="setup-turn-choices" role="group" aria-label="Guided turn direction"><button type="button" aria-pressed={direction === 'left'} onClick={() => setDirection('left')}><strong>Turn left ↶</strong><span>Walking upstairs</span></button><button type="button" aria-pressed={direction === 'right'} onClick={() => setDirection('right')}><strong>Turn right ↷</strong><span>Walking upstairs</span></button></div>
        {useWinders ? <><h4>What does the outside edge follow?</h4><div className="setup-turn-choices" role="group" aria-label="Guided corner shape"><button type="button" aria-pressed={corner === 'square'} onClick={() => setCorner('square')}><strong>Straight walls / square corners</strong><span>Turning steps fit against a square outer edge.</span></button><button type="button" aria-pressed={corner === 'round'} onClick={() => setCorner('round')}><strong>A curved outer edge</strong><span>The edges follow a smooth arc.</span></button></div></> : null}
        <details className="stair-guide-extra"><summary>Adjust where the turn starts</summary><Field label="Straight steps before the turn"><NumberInput ariaLabel="Guide steps before turn" value={beforeTurn} min={useWinders ? 0 : 1} max={useWinders ? count - winders : count - 1} integer onChange={setTurnAfter}/></Field><p>{beforeTurn} before the turn · {useWinders ? winders : 'a landing'} in the turn · {count - beforeTurn - (useWinders ? winders : 0)} after it.</p></details>
        <StairSetupPreview staircase={preview}/>
      </> : stage === 2 ? <>
        <h3>Check three starting measurements</h3>
        <p>{count} steps · {turnSummary}. You can refine individual measurements on the plan afterwards.</p>
        <div className="setup-measure-help"><svg viewBox="0 0 180 100" aria-hidden="true"><path d="M15 86H60V58H103V29H150" fill="none" stroke="#32705e" strokeWidth="3"/><path d="M43 59V84M39 64L43 59L47 64M39 79L43 84L47 79M63 45H100M68 41L63 45L68 49M95 41L100 45L95 49" fill="none" stroke="#738780"/><text x="5" y="69" fontSize="10">rise</text><text x="64" y="36" fontSize="10">tread depth</text></svg><p><strong>Rise</strong> is the height of one step. <strong>Tread depth</strong> is the flat part you stand on, measured from front edge to front edge.</p></div>
        <div className="stair-guide-measurements"><Field label="Width across the stairs"><LengthInput ariaLabel="Guide stair width" value={width} unit={unit} min={100} onChange={setWidth}/></Field><Field label="Height of one step"><LengthInput ariaLabel="Guide step rise" value={rise} unit={unit} min={1} onChange={setRise}/></Field><Field label="Depth of a straight tread"><LengthInput ariaLabel="Guide tread depth" value={going} unit={unit} min={1} onChange={setGoing}/></Field></div>
        {turning && useWinders ? <p className="setup-note">Turning tread sizes come from the shape you chose. Check their actual widest and narrowest depths on site before ordering.</p> : null}
      </> : <>
        <h3>Does this look like your staircase?</h3>
        <p><strong>{count} steps · {formatLength(width, unit)} wide · {formatLength(count * rise, unit)} total height</strong></p><div className="stair-guide-live-summary">{turnSummary}</div><StairSetupPreview staircase={preview}/>
        <p className="setup-note">Apply replaces the step arrangement with this preview. Next, select a step or landing in the top-down plan to add, remove or reshape it.</p>
      </>}
      <div className="setup-actions">{stage > 0 ? <button type="button" onClick={back}>Back</button> : null}{stage < 3 ? <button type="button" className="primary" onClick={next}>Continue</button> : <button type="button" className="primary" onClick={() => onApply(preview)}>Apply this staircase</button>}</div>
    </div>
  </section>;
}
function StairSetupPreview({ staircase }: { staircase: Staircase }) {
  const geometry = stairPlanGeometry(staircase);
  const scale = Math.min(370 / geometry.width, 230 / geometry.height);
  const x = (420 - geometry.width * scale) / 2, y = (260 - geometry.height * scale) / 2;
  return <figure className="setup-stair-preview"><svg viewBox="0 0 420 260" role="img" aria-label="Stair guide top-down preview">{geometry.pieces.map(piece => { const points = piece.points.map(point => ({ x: x + point.x * scale, y: y + (geometry.height - point.y) * scale })); const middle = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 }); return <g key={piece.id}><polygon className={piece.kind === 'landing' ? 'preview-landing' : 'preview-tread'} points={points.map(p => `${p.x},${p.y}`).join(' ')}/>{piece.stepIndex !== undefined ? <text x={middle.x} y={middle.y + 4} textAnchor="middle">{piece.stepIndex + 1}</text> : null}</g>; })}</svg><figcaption>View from above · walk upstairs from step 1 · beige areas are flat landings</figcaption></figure>;
}

function StairShapeIcon({ kind }: { kind: StairLayout['kind'] }) {
  return <svg viewBox="0 0 100 86" aria-hidden="true">{kind === 'straight' ? <><rect x="34" y="7" width="32" height="72" rx="1"/>{[19, 31, 43, 55, 67].map(y => <path key={y} d={`M34 ${y}H66`}/>)}</> : kind === 'quarter_turn' ? <><path d="M14 77V13H84V41H42V77Z" fill="var(--accent-soft)"/><path d="M14 41H42V13M14 53H42M14 65H42M56 13V41M70 13V41"/></> : kind === 'half_turn' ? <><path d="M12 77V10H88V77H59V39H41V77Z" fill="var(--accent-soft)"/><path d="M12 39H88M12 51H41M12 64H41M59 51H88M59 64H88"/></> : <><path d="M14 74V42A36 36 0 0 1 86 42V74H59V42A9 9 0 0 0 41 42V74Z" fill="var(--accent-soft)"/><path d="M14 60H41M14 45H41M19 24L42 36M32 10L47 33M50 6V33M68 10L53 33M81 24L58 36M59 45H86M59 60H86"/></>}</svg>;
}
