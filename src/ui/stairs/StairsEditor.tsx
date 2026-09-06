/**
 * StairsEditor: everything a fitter measures on a staircase — the product, the flight (number of
 * risers, quick-set dimensions, method, open strings, runner, subfloor), a per-step table with live
 * Approved Document K checks, landings, a live elevation/plan preview and the flight's totals.
 *
 * All state lives in the project store (millimetres); inputs display in the project's unit through
 * the shared LengthInput. Nothing here duplicates the engine — stairs.ts does the quantities.
 */
import type { ReactNode } from 'react';
import { useProjectStore, makeSteps } from '@store/projectStore';
import { newId } from '@store/ids';
import type { CoveringKind, Landing, Mm, Product, Staircase, Step, StepKind, Subfloor, SubfloorCondition, SubfloorType } from '@engine/types';
import { isBroadloom } from '@engine/types';
import { DEFAULT_NOSING_OVERHANG, DEFAULT_STEP, RUNNER_DEFAULT_WIDTH, STAIR_REGS } from '@engine/defaults';
import { MM_PER_INCH } from '@engine/units';
import { Checkbox, Field, LengthInput, NumberInput, Section, Select, formatLength, FieldGroup } from '@ui/components/inputs';
import { StairsPreview } from './StairsPreview';

type Unit = 'metric' | 'imperial';

export const MAX_RISERS = 30;
/** Narrow-end going given to a newly inserted winder (a typical kite winder at the newel post). */
export const DEFAULT_WINDER_NARROW_GOING: Mm = 100;
/** Default landing when the user adds one: a metre-long top landing as wide as the flight. */
const DEFAULT_LANDING_LENGTH: Mm = 1000;

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

const STEP_KIND_OPTIONS: { value: StepKind; label: string }[] = [
  { value: 'straight', label: 'Straight' },
  { value: 'winder', label: 'Winder' },
  { value: 'bullnose', label: 'Bullnose' },
  { value: 'curtail', label: 'Curtail' },
];
const METHOD_OPTIONS: { value: Staircase['method']; label: string }[] = [
  { value: 'cap_and_band', label: 'Cap & band — a piece per step' },
  { value: 'waterfall', label: 'Waterfall — one continuous piece' },
];
const METHOD_NOTE: Record<Staircase['method'], string> = {
  cap_and_band: 'Each step is its own piece tucked under the nosing: least waste (cut from offcuts or one cut across the roll), with a join under every nosing.',
  waterfall: 'One piece flows down the flight over every nosing: the cleanest look, but it needs a straight run and uses the most carpet — winders, bullnose steps and landings split it into runs.',
};
const OPEN_SIDE_OPTIONS: { value: Staircase['openSides']; label: string }[] = [
  { value: 'none', label: 'Closed both sides' },
  { value: 'left', label: 'Left string open' },
  { value: 'right', label: 'Right string open' },
  { value: 'both', label: 'Both strings open' },
];
const BULLNOSE_SIDE_OPTIONS: { value: NonNullable<Step['bullnoseSides']>; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
];
const SUBFLOOR_TYPE_OPTIONS: { value: SubfloorType | 'unset'; label: string }[] = [
  { value: 'unset', label: 'Not recorded' },
  { value: 'floorboards', label: 'Timber treads / floorboards' },
  { value: 'plywood', label: 'Plywood' },
  { value: 'chipboard', label: 'Chipboard' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'anhydrite', label: 'Anhydrite screed' },
  { value: 'existing_tiles', label: 'Existing tiles' },
  { value: 'existing_vinyl', label: 'Existing vinyl' },
  { value: 'asphalt', label: 'Asphalt' },
];
const SUBFLOOR_CONDITION_OPTIONS: { value: SubfloorCondition; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'uneven', label: 'Uneven' },
  { value: 'poor', label: 'Poor' },
];
const LANDING_KIND_OPTIONS: { value: Landing['kind']; label: string }[] = [
  { value: 'quarter', label: 'Quarter landing' },
  { value: 'half', label: 'Half landing' },
  { value: 'top', label: 'Top landing' },
];
const KIND_LABEL: Record<CoveringKind, string> = {
  carpet: 'carpet',
  sheet_vinyl: 'sheet vinyl',
  laminate: 'laminate',
  engineered_wood: 'engineered wood',
  lvt_click: 'LVT click',
  lvt_glue: 'LVT glue-down',
  carpet_tiles: 'carpet tiles',
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Pitch of a step in degrees, or null when it cannot be computed (winders, missing dims). */
export function pitchDeg(rise: Mm, going: Mm): number | null {
  if (!(rise > 0) || !(going > 0)) return null;
  return (Math.atan2(rise, going) * 180) / Math.PI;
}

/** Effective pitch of the flight: total rise over total going of the non-winder steps. */
export function flightPitchDeg(steps: Step[]): number | null {
  let rise = 0;
  let going = 0;
  for (const s of steps) {
    if (s.kind === 'winder') continue;
    rise += s.rise > 0 ? s.rise : 0;
    going += s.going > 0 ? s.going : 0;
  }
  return pitchDeg(rise, going);
}

export interface RegsIssue {
  code: 'rise' | 'going' | 'pitch';
  text: string;
}

/** Approved Document K (private stair) checks for one step. Old houses are often outside — this is a prompt to re-measure, not an error. */
export function stepRegsIssues(step: Step): RegsIssue[] {
  const issues: RegsIssue[] = [];
  if (step.rise > 0 && (step.rise < STAIR_REGS.minRise || step.rise > STAIR_REGS.maxRise)) {
    issues.push({ code: 'rise', text: `rise ${Math.round(step.rise)} mm is outside ${STAIR_REGS.minRise}–${STAIR_REGS.maxRise} mm` });
  }
  if (step.kind !== 'winder' && step.going > 0) {
    if (step.going < STAIR_REGS.minGoing || step.going > STAIR_REGS.maxGoing) {
      issues.push({ code: 'going', text: `going ${Math.round(step.going)} mm is outside ${STAIR_REGS.minGoing}–${STAIR_REGS.maxGoing} mm` });
    }
    const pitch = pitchDeg(step.rise, step.going);
    if (pitch !== null && pitch > STAIR_REGS.maxPitchDeg + 1e-9) {
      issues.push({ code: 'pitch', text: `pitch ${pitch.toFixed(1)}° is steeper than ${STAIR_REGS.maxPitchDeg}°` });
    }
  }
  return issues;
}

/** Stair dimensions read best in mm (metric) or inches (imperial) below a metre / a foot. */
export function formatStairDim(mm: Mm, unit: Unit): string {
  if (unit === 'metric') return mm < 1000 ? `${Math.round(mm)} mm` : formatLength(mm, unit);
  const inches = mm / MM_PER_INCH;
  return inches < 12 ? `${Math.round(inches * 10) / 10}"` : formatLength(mm, unit);
}

/** Change a step's kind, carrying its dimensions and giving kind-specific fields sensible starts. */
export function withKind(step: Step, kind: StepKind): Step {
  const next: Step = { id: step.id, kind, rise: step.rise, going: step.going, width: step.width };
  if (kind === 'winder') next.goingNarrow = step.goingNarrow ?? DEFAULT_WINDER_NARROW_GOING;
  if (kind === 'bullnose' || kind === 'curtail') {
    if (step.bullnoseProjection !== undefined) next.bullnoseProjection = step.bullnoseProjection;
    next.bullnoseSides = kind === 'curtail' ? 'both' : (step.bullnoseSides ?? 'right');
  }
  return next;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}


// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function StairsEditor({ staircaseId }: { staircaseId: string }) {
  const staircase = useProjectStore((s) => s.project.staircases.find((x) => x.id === staircaseId));
  if (!staircase) {
    return (
      <div className="panel stairs-editor">
        <div className="empty">This staircase no longer exists. Pick another from the sidebar.</div>
      </div>
    );
  }
  return <StairsForm staircase={staircase} />;
}

function StairsForm({ staircase }: { staircase: Staircase }) {
  const products = useProjectStore((s) => s.project.products);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const updateStaircase = useProjectStore((s) => s.updateStaircase);
  const removeStaircase = useProjectStore((s) => s.removeStaircase);

  const { id, steps, landings } = staircase;
  const patch = (p: Partial<Staircase>) => updateStaircase(id, p);
  const patchSteps = (fn: (steps: Step[]) => Step[]) => updateStaircase(id, (s) => ({ ...s, steps: fn(s.steps) }));
  const patchStep = (stepId: string, p: Partial<Step>) => patchSteps((all) => all.map((st) => (st.id === stepId ? { ...st, ...p } : st)));
  const patchLanding = (landingId: string, p: Partial<Landing>) =>
    updateStaircase(id, (s) => ({ ...s, landings: s.landings.map((l) => (l.id === landingId ? { ...l, ...p } : l)) }));

  // ---- product ----------------------------------------------------------------------------------
  const rank = (p: Product) => (p.kind === 'carpet' ? 0 : p.kind === 'sheet_vinyl' ? 1 : 2);
  const productOptions = [...products]
    .sort((a, b) => rank(a) - rank(b))
    .map((p) => ({ value: p.id, label: `${p.name} · ${KIND_LABEL[p.kind]}` }));
  const product = products.find((p) => p.id === staircase.productId);
  if (!product) productOptions.unshift({ value: staircase.productId, label: '— choose a product —' });
  const productNote = !product
    ? null
    : product.kind === 'sheet_vinyl'
      ? 'Sheet vinyl on stairs is fully bonded with a stair nosing on every step — no gripper or underlay.'
      : !isBroadloom(product.kind)
        ? `${KIND_LABEL[product.kind]} on stairs needs a stair nosing profile on every step; each tread and riser is cut individually (specialist work, 15% waste).`
        : null;
  const isCarpet = product?.kind === 'carpet';

  // ---- flight -----------------------------------------------------------------------------------
  const setRiserCount = (n: number) =>
    patchSteps((all) => {
      const count = Math.max(1, Math.min(MAX_RISERS, Math.round(n)));
      if (count === all.length) return all;
      if (count < all.length) return all.slice(0, count);
      const last = all[all.length - 1];
      const base: Omit<Step, 'id'> = last ? { kind: 'straight', rise: last.rise, going: last.going, width: last.width } : DEFAULT_STEP;
      return [...all, ...makeSteps(count - all.length, base)];
    });

  type DimKey = 'rise' | 'going' | 'width';
  const commonValue = (key: DimKey): Mm | undefined => {
    const first = steps[0];
    if (!first) return undefined;
    return steps.every((s) => s[key] === first[key]) ? first[key] : undefined;
  };
  const applyToAll = (key: DimKey, value: Mm) => patchSteps((all) => all.map((s) => ({ ...s, [key]: value })));

  const setRunner = (on: boolean) =>
    updateStaircase(id, (s) => {
      const { runner: _runner, ...rest } = s;
      return on ? { ...rest, runner: { width: RUNNER_DEFAULT_WIDTH, stairRods: false } } : rest;
    });
  const setSubfloorType = (type: SubfloorType | 'unset') =>
    updateStaircase(id, (s) => {
      const { subfloor: _subfloor, ...rest } = s;
      if (type === 'unset') return rest;
      const next: Subfloor = { ...(s.subfloor ?? { condition: 'good' }), type };
      return { ...rest, subfloor: next };
    });

  // ---- steps ------------------------------------------------------------------------------------
  const insertWinderAbove = (index: number) =>
    updateStaircase(id, (s) => {
      const src = s.steps[index];
      if (!src) return s;
      const winder: Step = { id: newId('step'), kind: 'winder', rise: src.rise, going: src.going, width: src.width, goingNarrow: DEFAULT_WINDER_NARROW_GOING };
      const nextSteps = [...s.steps.slice(0, index + 1), winder, ...s.steps.slice(index + 1)];
      // a landing recorded after step i (or higher) now follows the winder too
      const nextLandings = s.landings.map((l) => (l.afterStepIndex >= index ? { ...l, afterStepIndex: l.afterStepIndex + 1 } : l));
      return { ...s, steps: nextSteps, landings: nextLandings };
    });
  const deleteStep = (index: number) =>
    updateStaircase(id, (s) => {
      if (s.steps.length <= 1) return s;
      // there is no undo in the app and the row holds a measured rise, going and width
      const nextSteps = s.steps.filter((_, i) => i !== index);
      const nextLandings = s.landings.map((l) => {
        const shifted = l.afterStepIndex > index ? l.afterStepIndex - 1 : l.afterStepIndex;
        return { ...l, afterStepIndex: Math.min(shifted, nextSteps.length - 1) };
      });
      return { ...s, steps: nextSteps, landings: nextLandings };
    });

  const hasWinders = steps.some((s) => s.kind === 'winder');
  const hasCurved = steps.some((s) => s.kind === 'bullnose' || s.kind === 'curtail');

  // ---- landings ---------------------------------------------------------------------------------
  const addLanding = () =>
    updateStaircase(id, (s) => {
      const last = s.steps[s.steps.length - 1];
      const first = s.landings.length === 0;
      // The FIRST landing is the one at the head of the flight. A second one defaults to the middle:
      // only one landing can carry the top riser, so stacking them all at the head would either be
      // rejected or, worse, pay for the same riser twice. Move it with the Position column.
      const afterStepIndex = first ? Math.max(0, s.steps.length - 1) : Math.max(0, Math.floor((s.steps.length - 1) / 2));
      const landing: Landing = {
        id: newId('landing'),
        kind: first ? 'top' : 'quarter',
        length: DEFAULT_LANDING_LENGTH,
        width: last?.width ?? DEFAULT_STEP.width,
        afterStepIndex,
      };
      return { ...s, landings: [...s.landings, landing] };
    });
  const removeLanding = (landingId: string) => updateStaircase(id, (s) => ({ ...s, landings: s.landings.filter((l) => l.id !== landingId) }));
  const positionOptions = [{ value: '-1', label: 'At the foot of the flight' }, ...steps.map((_, i) => ({ value: String(i), label: `After step ${i + 1}${i === steps.length - 1 ? ' (top)' : ''}` }))];

  // ---- totals -----------------------------------------------------------------------------------
  const n = steps.length;
  const totalRise = steps.reduce((acc, s) => acc + (s.rise > 0 ? s.rise : 0), 0);
  const totalGoing = steps.reduce((acc, s) => acc + (s.going > 0 ? s.going : 0), 0);
  const landingRun = landings.reduce((acc, l) => acc + (l.length > 0 ? l.length : 0), 0);
  const winders = steps.filter((s) => s.kind === 'winder').length;
  const bullnoses = steps.filter((s) => s.kind === 'bullnose').length;
  const curtails = steps.filter((s) => s.kind === 'curtail').length;
  const widths = steps.map((s) => s.width);
  const minWidth = widths.length ? Math.min(...widths) : 0;
  const maxWidth = widths.length ? Math.max(...widths) : 0;
  const widthText = minWidth === maxWidth ? formatStairDim(maxWidth, unit) : `${formatStairDim(minWidth, unit)}–${formatStairDim(maxWidth, unit)}`;
  const flightPitch = flightPitchDeg(steps);
  const pitchTooSteep = flightPitch !== null && flightPitch > STAIR_REGS.maxPitchDeg + 1e-9;
  const summaryParts = [plural(n, 'riser'), `${widthText} wide`];
  if (winders) summaryParts.push(plural(winders, 'winder'));
  if (bullnoses) summaryParts.push(`${bullnoses} bullnose`);
  if (curtails) summaryParts.push(`${curtails} curtail`);
  if (landings.length) summaryParts.push(plural(landings.length, 'landing'));
  summaryParts.push(staircase.method === 'waterfall' ? 'waterfall' : 'cap & band');
  if (staircase.runner) summaryParts.push(`${formatStairDim(staircase.runner.width, unit)} runner${staircase.runner.stairRods ? ' with stair rods' : ''}`);
  if (staircase.openSides !== 'none') summaryParts.push(staircase.openSides === 'both' ? 'both strings open' : `${staircase.openSides} string open`);
  const summary = summaryParts.join(', ');

  return (
    <div className="panel stairs-editor">
      <Section
        title={<h2 className="stairs-title">{staircase.name || 'Stairs'}</h2>}
        actions={
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (window.confirm(`Delete "${staircase.name}"? This cannot be undone.`)) removeStaircase(id);
            }}
          >
            Delete staircase
          </button>
        }
      >
        <div className="grid-2">
          <Field label="Name">
            <input type="text" aria-label="Staircase name" value={staircase.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Product" hint={productNote ?? 'Carpet products are listed first.'}>
            <Select ariaLabel="Product" value={staircase.productId} options={productOptions} onChange={(productId) => patch({ productId })} />
          </Field>
        </div>
        <Field label="Notes" hint="Shown on the quote.">
          <textarea aria-label="Staircase notes" rows={2} value={staircase.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} />
        </Field>
      </Section>

      <Section title="Flight">
        <div className="grid-2">
          <Field label="Number of risers" hint="Count the risers from the bottom floor to the landing. Adding risers copies the last step; removing takes them off the top.">
            <NumberInput ariaLabel="Number of risers" value={n} min={1} max={MAX_RISERS} integer onChange={setRiserCount} />
          </Field>
          <Field label="Nosing overhang" hint="How far each tread projects beyond its riser; the carpet wraps under it.">
            <LengthInput ariaLabel="Nosing overhang" value={staircase.nosingOverhang ?? DEFAULT_NOSING_OVERHANG} unit={unit} onChange={(nosingOverhang) => patch({ nosingOverhang })} />
          </Field>
        </div>
        <FieldGroup label="Apply to all steps" hint="Sets the value on every step; fine-tune individual steps in the table below. Blank means the steps differ.">
          <div className="row">
            <Field inline label="Rise">
              <LengthInput ariaLabel="Rise for all steps" value={commonValue('rise')} unit={unit} placeholder="varies" onChange={(v) => applyToAll('rise', v)} />
            </Field>
            <Field inline label="Going">
              <LengthInput ariaLabel="Going for all steps" value={commonValue('going')} unit={unit} placeholder="varies" onChange={(v) => applyToAll('going', v)} />
            </Field>
            <Field inline label="Width">
              <LengthInput ariaLabel="Width for all steps" value={commonValue('width')} unit={unit} placeholder="varies" onChange={(v) => applyToAll('width', v)} />
            </Field>
          </div>
        </FieldGroup>
        <div className="grid-2">
          <Field label="Method" hint={METHOD_NOTE[staircase.method]}>
            <Select ariaLabel="Fitting method" value={staircase.method} options={METHOD_OPTIONS} onChange={(method) => patch({ method })} />
          </Field>
          <Field label="Open sides" hint="On an open string the carpet wraps the open edge and is bound.">
            <Select ariaLabel="Open sides" value={staircase.openSides} options={OPEN_SIDE_OPTIONS} onChange={(openSides) => patch({ openSides })} />
          </Field>
        </div>
        <div className="stack stairs-runner">
          <Checkbox
            label={<span>Fit as a runner (bound both edges){isCarpet ? '' : ' — carpet only'}</span>}
            checked={Boolean(staircase.runner)}
            onChange={setRunner}
          />
          {staircase.runner ? (
            <div className="row">
              <Field inline label="Runner width">
                <LengthInput ariaLabel="Runner width" value={staircase.runner.width} unit={unit} onChange={(width) => patch({ runner: { ...staircase.runner!, width } })} />
              </Field>
              <Checkbox label="Stair rods (one per step)" checked={staircase.runner.stairRods} onChange={(stairRods) => patch({ runner: { ...staircase.runner!, stairRods } })} />
            </div>
          ) : null}
          <Checkbox
            label="Landing carpet covers the top riser (the stair carpet stops one riser short)"
            checked={Boolean(staircase.topRiserByLanding)}
            onChange={(topRiserByLanding) => patch({ topRiserByLanding })}
          />
        </div>
        <FieldGroup label="Subfloor (optional)" hint="Drives floor preparation: uneven or poor treads want ply or hardboard first.">
          <div className="row">
            <Select ariaLabel="Subfloor type" value={staircase.subfloor?.type ?? 'unset'} options={SUBFLOOR_TYPE_OPTIONS} onChange={setSubfloorType} />
            <Select
              ariaLabel="Subfloor condition"
              value={staircase.subfloor?.condition ?? 'good'}
              options={SUBFLOOR_CONDITION_OPTIONS}
              disabled={!staircase.subfloor}
              onChange={(condition) => {
                if (staircase.subfloor) patch({ subfloor: { ...staircase.subfloor, condition } });
              }}
            />
          </div>
        </FieldGroup>
      </Section>

      <Section
        title="Steps (from the bottom up)"
        actions={
          <span className={pitchTooSteep ? 'badge warn' : 'badge'}>
            {pitchTooSteep ? '⚠ ' : ''}Pitch {flightPitch === null ? '—' : `${flightPitch.toFixed(1)}°`}
            {pitchTooSteep ? ` — steeper than ${STAIR_REGS.maxPitchDeg}°` : ''}
            <span className="sr-only"> (total rise over total going of the straight steps)</span>
          </span>
        }
      >
        <div className="stairs-table-wrap">
          <table className="data stairs-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Kind</th>
                <th>Rise</th>
                <th>
                  Going
                  {hasWinders ? <span className="stairs-th-note"> (max for winders)</span> : null}
                </th>
                <th>Width</th>
                {hasWinders ? <th>Narrow going</th> : null}
                {hasCurved ? <th>Bullnose projection / sides</th> : null}
                <th className="num">Pitch</th>
                <th>Regs</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={index}
                  count={n}
                  unit={unit}
                  hasWinders={hasWinders}
                  hasCurved={hasCurved}
                  onPatch={(p) => patchStep(step.id, p)}
                  onKind={(kind) => patchSteps((all) => all.map((st) => (st.id === step.id ? withKind(st, kind) : st)))}
                  onInsertWinder={() => insertWinderAbove(index)}
                  onDelete={() => {
                    if (window.confirm(`Delete step ${index + 1}? Its measured rise, going and width are lost.`)) deleteStep(index);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-hint">
          Regs: Approved Document K for a private stair — rise {STAIR_REGS.minRise}–{STAIR_REGS.maxRise} mm, going {STAIR_REGS.minGoing}–{STAIR_REGS.maxGoing} mm, pitch at most {STAIR_REGS.maxPitchDeg}°. Older
          houses are often outside; a flag is a prompt to re-check the tape, not an error.
        </p>
      </Section>

      <Section
        title="Landings"
        actions={
          <button type="button" onClick={addLanding}>
            + Add landing
          </button>
        }
      >
        {landings.length === 0 ? (
          <div className="empty small">No landings. Add a quarter or half landing where the flight turns, or the top landing if it is carpeted with the stairs.</div>
        ) : (
          <div className="stairs-table-wrap">
            <table className="data stairs-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Length (along the walk)</th>
                  <th>Width</th>
                  <th>Position</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {landings.map((l, k) => (
                  <tr key={l.id}>
                    <td>
                      <Select ariaLabel={`Landing ${k + 1} type`} value={l.kind} options={LANDING_KIND_OPTIONS} onChange={(kind) => patchLanding(l.id, { kind })} />
                    </td>
                    <td>
                      <LengthInput ariaLabel={`Landing ${k + 1} length`} value={l.length} unit={unit} onChange={(length) => patchLanding(l.id, { length })} />
                    </td>
                    <td>
                      <LengthInput ariaLabel={`Landing ${k + 1} width`} value={l.width} unit={unit} onChange={(width) => patchLanding(l.id, { width })} />
                    </td>
                    <td>
                      <Select
                        ariaLabel={`Landing ${k + 1} position`}
                        value={String(l.afterStepIndex < 0 ? -1 : Math.min(l.afterStepIndex, n - 1))}
                        options={positionOptions}
                        onChange={(v) => patchLanding(l.id, { afterStepIndex: parseInt(v, 10) })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="danger"
                        aria-label={`Remove landing ${k + 1}`}
                        onClick={() => {
                          if (window.confirm(`Remove landing ${k + 1}? Its measured length and width are lost.`)) removeLanding(l.id);
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Preview">
        <StairsPreview staircase={staircase} unit={unit} />
      </Section>

      <Section title="Totals">
        <div className="kpis">
          <div className="kpi">
            <div className="value">{formatLength(totalRise, unit)}</div>
            <div className="label">Total rise</div>
          </div>
          <div className="kpi">
            <div className="value">{formatLength(totalGoing, unit)}</div>
            <div className="label">Total going{landingRun > 0 ? ` (+ ${formatLength(landingRun, unit)} of landings)` : ''}</div>
          </div>
          <div className="kpi">
            <div className="value">{n}</div>
            <div className="label">Risers</div>
          </div>
          <div className="kpi">
            <div className="value">{Math.max(0, n - 1)}</div>
            <div className="label">Treads (the top tread is the landing)</div>
          </div>
        </div>
        <p className="stairs-summary" data-testid="stairs-summary">
          {summary}
        </p>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step row
// ---------------------------------------------------------------------------

function StepRow({
  step,
  index,
  count,
  unit,
  hasWinders,
  hasCurved,
  onPatch,
  onKind,
  onInsertWinder,
  onDelete,
}: {
  step: Step;
  index: number;
  count: number;
  unit: Unit;
  hasWinders: boolean;
  hasCurved: boolean;
  onPatch: (p: Partial<Step>) => void;
  onKind: (kind: StepKind) => void;
  onInsertWinder: () => void;
  onDelete: () => void;
}) {
  const no = index + 1;
  const isWinder = step.kind === 'winder';
  const isCurved = step.kind === 'bullnose' || step.kind === 'curtail';
  const issues = stepRegsIssues(step);
  const pitch = isWinder ? null : pitchDeg(step.rise, step.going);
  const pitchTooSteep = pitch !== null && pitch > STAIR_REGS.maxPitchDeg + 1e-9;
  return (
    <tr className={`stairs-step stairs-step-${step.kind}`}>
      <td className="num">{no}</td>
      <td>
        <Select ariaLabel={`Step ${no} kind`} value={step.kind} options={STEP_KIND_OPTIONS} onChange={onKind} />
      </td>
      <td>
        <LengthInput ariaLabel={`Step ${no} rise`} value={step.rise} unit={unit} onChange={(rise) => onPatch({ rise })} />
      </td>
      <td>
        <LengthInput ariaLabel={`Step ${no} going${isWinder ? ' (max)' : ''}`} value={step.going} unit={unit} onChange={(going) => onPatch({ going })} />
      </td>
      <td>
        <LengthInput ariaLabel={`Step ${no} width`} value={step.width} unit={unit} onChange={(width) => onPatch({ width })} />
      </td>
      {hasWinders ? (
        <td>
          {isWinder ? (
            <LengthInput ariaLabel={`Step ${no} narrow going`} value={step.goingNarrow} unit={unit} placeholder="narrow end" onChange={(goingNarrow) => onPatch({ goingNarrow })} />
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      ) : null}
      {hasCurved ? (
        <td>
          {isCurved ? (
            <span className="row">
              <LengthInput ariaLabel={`Step ${no} bullnose projection`} value={step.bullnoseProjection} unit={unit} placeholder="not measured" onChange={(bullnoseProjection) => onPatch({ bullnoseProjection })} />
              <Select
                ariaLabel={`Step ${no} bullnose sides`}
                value={step.bullnoseSides ?? (step.kind === 'curtail' ? 'both' : 'right')}
                options={BULLNOSE_SIDE_OPTIONS}
                disabled={step.kind === 'curtail'}
                onChange={(bullnoseSides) => onPatch({ bullnoseSides })}
              />
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      ) : null}
      {/* WCAG 1.4.1: the failing pitch must not be signalled by hue alone — orange bold text is
          invisible to a colour-blind fitter and hard to read in sunlight, so add a marker. */}
      <td className="num">
        {pitch === null ? (
          <span className="muted">—</span>
        ) : pitchTooSteep ? (
          <span className="stairs-pitch-warn">
            {pitch.toFixed(1)}° ⚠<span className="sr-only"> steeper than {STAIR_REGS.maxPitchDeg}°</span>
          </span>
        ) : (
          <span>{pitch.toFixed(1)}°</span>
        )}
      </td>
      {/* `title` alone never appears on a touch screen and is not reliably announced, so the actual
          numbers go in the cell; the codes stay as the at-a-glance summary. */}
      <td>
        {issues.length > 0 ? (
          <>
            <span className="badge warn">⚠ {issues.map((i) => i.code).join(', ')}</span>
            <span className="stairs-issue">{issues.map((i) => i.text).join('; ')}</span>
          </>
        ) : (
          <span className="badge ok">OK</span>
        )}
      </td>
      <td className="stairs-step-actions">
        <button type="button" aria-label={`Insert winder above step ${no}`} title="Insert a winder above this step" onClick={onInsertWinder}>
          + Winder
        </button>
        <button type="button" className="danger" aria-label={`Delete step ${no}`} disabled={count <= 1} onClick={onDelete}>
          Delete
        </button>
      </td>
    </tr>
  );
}
