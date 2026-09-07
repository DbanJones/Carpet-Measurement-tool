import type { UnderlayOptions } from '@engine/types';
import { roundTo } from '@engine/units';
import { useProjectStore } from '@store/projectStore';
import { Field, Select, formatMoney } from '@ui/components/inputs';
import { MoneyInput } from './fields';
import './underlay-pricing.css';

/** Explicitly clear the other price so an inherited roll price cannot override a typed m² rate. */
export function underlayPricePatch(value: UnderlayOptions, basis: 'per_roll' | 'per_m2'): Partial<UnderlayOptions> {
  const area = value.rollWidth * value.rollLength / 1e6;
  return basis === 'per_m2'
    ? { pricePerRoll: undefined, pricePerM2: value.pricePerM2 ?? (value.pricePerRoll !== undefined && area > 0 ? roundTo(value.pricePerRoll / area, 2) : 0) }
    : { pricePerM2: undefined, pricePerRoll: value.pricePerRoll ?? (value.pricePerM2 !== undefined ? roundTo(value.pricePerM2 * area, 2) : 0) };
}

export function UnderlayPricing({ value, onChange, prefix = 'Product' }: {
  value: UnderlayOptions; onChange: (patch: Partial<UnderlayOptions>) => void; prefix?: string;
}) {
  const currency = useProjectStore(s => s.project.prices.currency);
  const basis = value.pricePerRoll !== undefined ? 'per_roll' : 'per_m2';
  const area = value.rollWidth * value.rollLength / 1e6;
  const rate = basis === 'per_roll' && area > 0 ? value.pricePerRoll! / area : value.pricePerM2;
  return <div className="underlay-pricing" aria-label="Separate underlay price">
    <div className="grid-2">
      <Field label="Underlay price basis"><Select ariaLabel={`${prefix} underlay price basis`} value={basis}
        options={[{ value: 'per_roll', label: 'Per underlay roll' }, { value: 'per_m2', label: 'Per square metre' }]}
        onChange={next => onChange(underlayPricePatch(value, next))}/></Field>
      {basis === 'per_roll'
        ? <Field label="Underlay price per roll"><MoneyInput ariaLabel={`${prefix} underlay price per roll`} value={value.pricePerRoll} per="per roll" onChange={pricePerRoll => onChange({ pricePerRoll, pricePerM2: undefined })}/></Field>
        : <Field label="Underlay price per m²"><MoneyInput ariaLabel={`${prefix} underlay price per m²`} value={value.pricePerM2} per="per m²" onChange={pricePerM2 => onChange({ pricePerM2, pricePerRoll: undefined })}/></Field>}
    </div>
    <p className="field-hint">{area.toFixed(2)} m² per underlay roll{rate !== undefined ? ` · ${formatMoney(rate, currency)} per m²` : ''}. Priced separately from the carpet; the estimate orders whole underlay rolls.</p>
  </div>;
}
