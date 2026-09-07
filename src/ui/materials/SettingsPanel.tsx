import type { CoveringKind, LabourActivity, LabourModel } from '@engine/types';
import { resolveLabourModel } from '@engine/labour';
import { useProjectStore } from '@store/projectStore';
import { useEstimate } from '@store/useEstimate';
import { Field, NumberInput, Section, Select, formatMoney } from '@ui/components/inputs';
import { MoneyInput, PercentInput } from './fields';
import { KIND_LABELS } from './presets';
import { PricesEditor } from './PricesEditor';
import { OptionsEditor } from './OptionsEditor';
import { BusinessSettings } from './BusinessSettings';
import './settings.css';

const ACTIVITIES: { key: LabourActivity; label: string; unit: string }[] = [
  { key: 'uplift', label: 'Uplift old covering', unit: 'm²' }, { key: 'disposal', label: 'Handle and remove waste', unit: 'm²' },
  { key: 'latex', label: 'Prime and apply smoothing compound', unit: 'm²' }, { key: 'ply', label: 'Fit ply / hardboard', unit: 'm²' },
  { key: 'gripper_removal', label: 'Remove old gripper', unit: 'm' }, { key: 'moisture_test', label: 'Set up moisture test', unit: 'test' },
  { key: 'secure_boards', label: 'Secure floorboards', unit: 'm²' }, { key: 'sand_boards', label: 'Sand floorboards', unit: 'm²' },
  { key: 'skirting_refit', label: 'Remove and refit skirting', unit: 'm' }, { key: 'door_easing', label: 'Ease a door', unit: 'door' },
  { key: 'binding', label: 'Bind carpet edges', unit: 'm' },
];

export function SettingsPanel() {
  const project = useProjectStore(s => s.project);
  const updatePrices = useProjectStore(s => s.updatePrices);
  const estimate = useEstimate();
  const model = resolveLabourModel(project.prices.labourModel);
  const hours = estimate.details.labourHours;
  const set = (patch: Partial<LabourModel>) => updatePrices({ labourModel: { ...resolveLabourModel(useProjectStore.getState().project.prices.labourModel), ...patch } });
  const currency = project.prices.currency;
  return <div className="panel settings-panel">
    <div className="eyebrow">YOUR ESTIMATING DEFAULTS</div><h2>Settings</h2>
    <p className="muted">Set your labour method and business details. These settings are saved with this project.</p>
    <Section title="Labour & time">
      <div className="grid-2">
        <Field label="Labour pricing method" hint="Time estimates are available with either method."><Select ariaLabel="Labour pricing method" value={model.mode} options={[{ value: 'unit_rates', label: 'Rates per m² / step / item' }, { value: 'hourly', label: 'Estimated hours × hourly rate' }]} onChange={mode => set({ mode })} /></Field>
        <Field label="Hourly labour rate" hint="Price per person-hour before VAT. Used for labour charges when hourly pricing is selected."><MoneyInput ariaLabel="Hourly labour rate" value={model.hourlyRate} per="per hour" onChange={hourlyRate => set({ hourlyRate })} /></Field>
        <Field label="Site setup & clean-up" hint="Added once to a measured job, not once per room."><NumberInput value={model.setupHours} min={0} step={0.25} suffix="hours" ariaLabel="Job setup hours" onChange={setupHours => set({ setupHours })} /></Field>
        <Field label="Site time allowance" hint="Extra time for access, furniture and site uncertainty. Applied to required work and setup."><PercentInput value={model.allowance} ariaLabel="Labour time allowance" onChange={allowance => set({ allowance })} /></Field>
        <Field label="Minimum job labour" hint="A top-up applies if priced labour falls below this amount; set 0 to disable."><MoneyInput value={project.prices.labour.minimumJobLabour} ariaLabel="Settings minimum job labour" onChange={minimumJobLabour => updatePrices({ labour: { ...project.prices.labour, minimumJobLabour } })} /></Field>
      </div>
      <div className="settings-metrics" aria-label="Job time estimate">
        <div><span>Required work</span><strong>{hours.baseHours.toFixed(1)} h</strong></div>
        <div><span>Time allowance</span><strong>{hours.allowanceHours.toFixed(1)} h</strong></div>
        <div><span>Total person-hours</span><strong>{hours.totalHours.toFixed(1)} h</strong></div>
        <div><span>Labour on estimate</span><strong>{formatMoney(estimate.totals.labourCost, currency)}</strong></div>
      </div>
      <p className="field-hint">{model.mode === 'hourly' ? 'The estimate charges each activity in hours at your hourly rate, plus any minimum-job top-up.' : 'Your estimate currently charges unit rates. The hours below describe the workload and do not add another labour charge.'} Person-hours measure labour effort; two fitters may share the work. Drying, acclimatisation and test waiting periods are excluded.</p>
      <Section title="How the hours are calculated" collapsible defaultOpen={false} description="Room area ÷ fitting speed + stair minutes + preparation + setup + site allowance.">
        <p className="field-hint">Starting values are editable estimating assumptions. Adjust them to your team's experience and site conditions. Preparation follows the subfloor and uplift choices entered for each space. Disposal time covers handling; include external disposal fees separately.</p>
        <div className="table-scroll"><table className="data"><thead><tr><th>Activity</th><th>Calculation</th><th>Hours</th></tr></thead><tbody>
          {hours.lines.map(line => <tr key={line.id}><td>{line.description}{line.optional ? ' (optional)' : ''}</td><td>{line.calculation}</td><td>{line.hours.toFixed(2)}</td></tr>)}
        </tbody></table></div>
        {hours.optionalHours > 0 ? <p className="field-hint">Optional preparation: {hours.optionalHours.toFixed(1)} further hours, excluded from the total.</p> : null}
      </Section>
      <Section title="Fitting speeds & stair time" collapsible defaultOpen={false} description="Adjust the assumptions for carpet, laminate, LVT, patterns, straight and shaped stairs.">
        <div className="grid-2">
          {(Object.keys(model.fittingM2PerHour) as CoveringKind[]).map(kind => <Field key={kind} label={KIND_LABELS[kind]} hint="Net floor area fitted per person-hour, including normal underlay and trim fitting."><NumberInput value={model.fittingM2PerHour[kind]} min={0.1} step={0.5} suffix="m²/hour" ariaLabel={`${KIND_LABELS[kind]} fitting speed`} onChange={value => set({ fittingM2PerHour: { ...model.fittingM2PerHour, [kind]: value } })} /></Field>)}
          <Field label="Pattern fitting time multiplier" hint="Applied to herringbone, chevron and diagonal rooms. 1.75 means 75% more fitting time."><NumberInput value={model.patternMultiplier} min={0.1} step={0.05} suffix="×" ariaLabel="Pattern time multiplier" onChange={patternMultiplier => set({ patternMultiplier })} /></Field>
          <Field label="Straight step"><NumberInput value={model.straightStepMinutes} min={0} step={1} suffix="min/step" ariaLabel="Straight step minutes" onChange={straightStepMinutes => set({ straightStepMinutes })} /></Field>
          <Field label="Shaped step" hint="Winders, bullnoses and curtail steps."><NumberInput value={model.shapedStepMinutes} min={0} step={1} suffix="min/step" ariaLabel="Shaped step minutes" onChange={shapedStepMinutes => set({ shapedStepMinutes })} /></Field>
          <Field label="Stair landings"><NumberInput value={model.landingM2PerHour} min={0.1} step={0.5} suffix="m²/hour" ariaLabel="Landing fitting speed" onChange={landingM2PerHour => set({ landingM2PerHour })} /></Field>
        </div>
      </Section>
      <Section title="Preparation & finishing time" collapsible defaultOpen={false}>
        <div className="grid-2">{ACTIVITIES.map(a => <Field key={a.key} label={a.label}><NumberInput value={model.activityMinutes[a.key]} min={0} step={0.5} suffix={`min/${a.unit}`} ariaLabel={`${a.label} minutes`} onChange={v => set({ activityMinutes: { ...model.activityMinutes, [a.key]: v } })} /></Field>)}</div>
      </Section>
    </Section>
    <BusinessSettings />
    <Section title="Unit rates, material prices & VAT" collapsible defaultOpen={false}><PricesEditor /></Section>
    <Section title="Planning & material assumptions" collapsible defaultOpen={false}><OptionsEditor /></Section>
  </div>;
}
