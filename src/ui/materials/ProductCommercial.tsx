import type { BroadloomProduct, HardFloorOptions, LayPattern, PackProduct, UnderlayOptions } from '@engine/types';
import { LAY_PATTERN_WASTAGE } from '@engine/defaults';
import { resolveProductUnderlay } from '@engine/productOptions';
import { useProjectStore } from '@store/projectStore';
import { Field, LengthInput, NumberInput, Section, Select, formatMoney } from '@ui/components/inputs';
import { MoneyInput, MmInput, PercentInput } from './fields';
import { UNDERLAY_PRESETS } from './presets';
import { UnderlayPricing } from './UnderlayPricing';

export function BroadloomPrice({ product, onChange }: { product: BroadloomProduct; onChange: (p: Partial<BroadloomProduct>) => void }) {
  const unit = useProjectStore(s => s.project.displayUnit);
  const basis = product.priceBasis ?? 'per_m2';
  return <>
    <Field label="Price basis"><Select ariaLabel="Product price basis" value={basis} options={[{ value: 'per_m2', label: 'Per square metre' }, { value: 'per_roll', label: 'Per roll' }]} onChange={priceBasis => onChange({ priceBasis })} /></Field>
    {basis === 'per_m2' ? <Field label="Price per m²" hint="Before VAT; the full roll width of each cut is charged."><MoneyInput value={product.pricePerM2} ariaLabel="Price per square metre" per="per m²" onChange={pricePerM2 => onChange({ pricePerM2 })} /></Field> : <>
      <Field label="Price per roll" hint="Supply price before VAT."><MoneyInput value={product.pricePerRoll} ariaLabel="Price per roll" per="per roll" onChange={pricePerRoll => onChange({ pricePerRoll })} /></Field>
      <Field label="Length covered by this price" hint="Required: the length of one priced roll."><LengthInput value={product.pricedRollLength} min={100} unit={unit} ariaLabel="Priced roll length" onChange={pricedRollLength => onChange({ pricedRollLength })} /></Field>
      <Field label="How it is sold" hint="Whole rolls include all uncut material in the order and cost."><Select ariaLabel="Roll charging method" value={product.rollPricing ?? 'whole_rolls'} options={[{ value: 'whole_rolls', label: 'Buy whole rolls' }, { value: 'cut_length', label: 'Pay only for cut length' }]} onChange={rollPricing => onChange({ rollPricing })} /></Field>
      {!product.pricedRollLength ? <p className="field-error" role="status">Enter the priced roll length to calculate the price.</p> : null}
    </>}
  </>;
}

export function ProductWaste({ product, onChange }: { product: BroadloomProduct; onChange: (p: Partial<BroadloomProduct>) => void }) {
  const defaults = useProjectStore(s => s.project.options.broadloom);
  return <Section title="Cutting & wastage" description="The roll layout already allows for trimming, seams, pattern matching and unusable offcuts.">
    <Field label="Minimum surplus over floor area" hint="0% uses the calculated cut plan. A higher value only adds material when the existing cutting surplus is smaller, then rounds to supplier increments.">
      <PercentInput value={product.wastageAllowance ?? defaults.wastageAllowance ?? 0} ariaLabel="Product wastage allowance" onChange={wastageAllowance => onChange({ wastageAllowance })} />
    </Field>
    <p className="field-hint">Current trim allowances: {defaults.lengthAllowance} mm in length and {defaults.widthAllowance} mm in width. Final waste is shown with the roll plan.</p>
  </Section>;
}

export function ProductUnderlay({ product, onChange }: { product: BroadloomProduct; onChange: (p: Partial<BroadloomProduct>) => void }) {
  const defaults = useProjectStore(s => s.project.options.underlay);
  const unit = useProjectStore(s => s.project.displayUnit);
  const currency = useProjectStore(s => s.project.prices.currency);
  const u = resolveProductUnderlay(defaults, product.underlay);
  const set = (patch: Partial<UnderlayOptions>) => onChange({ underlay: { ...u, ...patch } });
  const presets = UNDERLAY_PRESETS.filter(p => p.id !== 'laminate_pack');
  const matchingPreset = presets.find(p => Object.entries(p.values).every(([key, value]) => u[key as keyof UnderlayOptions] === value));
  const mode = product.underlay === undefined ? 'inherit' : u.fit ? matchingPreset?.id ?? 'custom' : 'none';
  return <Section title="Underlay for this carpet">
    <Field label="Underlay option" hint="Applies to every room and staircase using this carpet."><Select ariaLabel="Carpet underlay option" value={mode}
      options={[{ value: 'inherit', label: 'Use project default' }, { value: 'none', label: 'No underlay / reuse existing' }, ...presets.map(p => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom underlay' }]}
      onChange={v => { if (v === 'inherit') onChange({ underlay: undefined }); else if (v === 'none') set({ fit: false }); else { const preset = presets.find(p => p.id === v); set({ fit: true, ...preset?.values }); } }} />
    </Field>
    <p className="product-supply-summary">{u.fit ? `${u.thickness} mm underlay · ${(u.rollWidth * u.rollLength / 1e6).toFixed(2)} m² per roll · ${u.pricePerRoll !== undefined ? formatMoney(u.pricePerRoll, currency) + ' per roll' : u.pricePerM2 !== undefined ? formatMoney(u.pricePerM2, currency) + ' per m²' : 'price not set'}` : 'No new underlay will be ordered for this carpet.'}</p>
    {u.fit ? <UnderlayPricing value={u} onChange={set}/> : null}
    {u.fit ? <Section title="Underlay details" collapsible defaultOpen={false}>
      <div className="grid-2">
        <Field label="Underlay thickness"><MmInput value={u.thickness} ariaLabel="Product underlay thickness" onChange={thickness => set({ thickness })} /></Field>
        <Field label="Underlay tog"><NumberInput value={u.tog} min={0} step={0.1} ariaLabel="Product underlay tog" onChange={tog => set({ tog })} /></Field>
        <Field label="Underlay roll width"><LengthInput value={u.rollWidth} unit={unit} min={100} ariaLabel="Product underlay roll width" onChange={rollWidth => set({ rollWidth })} /></Field>
        <Field label="Underlay roll length"><LengthInput value={u.rollLength} unit={unit} min={100} ariaLabel="Product underlay roll length" onChange={rollLength => set({ rollLength })} /></Field>
      </div>
    </Section> : null}
  </Section>;
}

export function ProductPattern({ product, onChange }: { product: PackProduct; onChange: (p: Partial<PackProduct>) => void }) {
  const defaults = useProjectStore(s => s.project.options.hardFloor);
  const o = { ...defaults, ...Object.fromEntries(Object.entries(product.hardFloor ?? {}).filter(([, value]) => value !== undefined)) };
  const set = (patch: Partial<HardFloorOptions>) => onChange({ hardFloor: { ...product.hardFloor, ...patch } });
  const patternNames: Record<LayPattern, string> = { straight: 'Straight', herringbone: 'Herringbone', chevron: 'Chevron', diagonal: 'Diagonal', random_stagger: 'Random stagger', brick: 'Brick bond' };
  return <Section title="Laying pattern & wastage">
    <div className="grid-2">
      <Field label="Laying pattern" hint="Default for rooms using this product. A room can use its own pattern."><Select ariaLabel="Product laying pattern" value={o.layPattern}
        options={Object.entries(patternNames).map(([value, label]) => ({ value: value as LayPattern, label }))} onChange={layPattern => set({ layPattern })} /></Field>
      <Field label="Cutting wastage" hint={`Pattern starting allowance: ${Math.round(LAY_PATTERN_WASTAGE[o.layPattern] * 100)}%. Added before rounding up to whole packs. Room shape and size may add further allowance.`}>
        <PercentInput value={o.wastage ?? LAY_PATTERN_WASTAGE[o.layPattern]} ariaLabel="Product cutting wastage" onChange={wastage => set({ wastage })} />
      </Field>
    </div>
    {o.wastage !== undefined ? <button type="button" className="small" onClick={() => set({ wastage: LAY_PATTERN_WASTAGE[o.layPattern] })}>Use pattern wastage</button> : null}
    {['herringbone', 'chevron'].includes(o.layPattern) ? <p className="field-hint">Choose boards designed for {o.layPattern}, including the supplier's left/right board mix where required. The estimate calculates quantities and cutting allowance; it does not draw a board-by-board fitting layout.</p> : null}
  </Section>;
}
