/**
 * Small field helpers shared by the materials editors: money (currency prefix), percentages stored as
 * fractions, millimetre figures that are too small to show as metres, and a checkbox with a hint.
 */
import type { ReactNode } from 'react';
import { roundTo } from '@engine/units';
import { useProjectStore } from '@store/projectStore';
import { Checkbox, NumberInput } from '@ui/components/inputs';

export function currencySymbol(code: string): string {
  try {
    const part = new Intl.NumberFormat('en-GB', { style: 'currency', currency: code }).formatToParts(0).find((p) => p.type === 'currency');
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** Number input with the project currency as a prefix; `per` is shown as a suffix ("per m²"). */
export function MoneyInput({
  value,
  onChange,
  ariaLabel,
  per,
  disabled,
}: {
  value: number | undefined;
  onChange: (n: number) => void;
  ariaLabel: string;
  per?: string;
  disabled?: boolean;
}) {
  const currency = useProjectStore((s) => s.project.prices.currency);
  return (
    <span className="money-input">
      <span className="unit" aria-hidden="true">
        {currencySymbol(currency)}
      </span>
      <NumberInput value={value} onChange={onChange} min={0} step={0.01} suffix={per} ariaLabel={ariaLabel} disabled={disabled} />
    </span>
  );
}

/** Percentage input over a value stored as a fraction (0.1 <-> "10 %"). */
export function PercentInput({
  value,
  onChange,
  ariaLabel,
  max = 100,
  disabled,
}: {
  value: number | undefined;
  onChange: (fraction: number) => void;
  ariaLabel: string;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <NumberInput
      value={value === undefined ? undefined : roundTo(value * 100, 2)}
      onChange={(n) => onChange(roundTo(n / 100, 4))}
      min={0}
      max={max}
      step={0.5}
      suffix="%"
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  );
}

/** Millimetre input for small figures (thickness, expansion gap) that read badly as metres or feet. */
export function MmInput({
  value,
  onChange,
  ariaLabel,
  min = 0,
  step,
  disabled,
}: {
  value: number | undefined;
  onChange: (mm: number) => void;
  ariaLabel: string;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  return <NumberInput value={value} onChange={onChange} min={min} step={step ?? 0.5} suffix="mm" ariaLabel={ariaLabel} disabled={disabled} />;
}

/** A checkbox with a hint line beneath, laid out like a Field (without nesting labels). */
export function CheckField({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className="field">
      <Checkbox checked={checked} onChange={onChange} label={label} disabled={disabled} />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
