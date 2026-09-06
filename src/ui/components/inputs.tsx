import { useEffect, useState, type ReactNode } from 'react';
import { parseLength, fromMm, formatFtIn, roundTo, MM_PER_M } from '@engine/units';
import type { Mm } from '@engine/types';

export function Field({ label, hint, children, inline }: { label: ReactNode; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <label className={inline ? 'field field-inline' : 'field'}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/**
 * Length input. Stores millimetres; displays metres (2 dp) or feet/inches. Accepts free text such as
 * "4.2", "420cm", "4200mm", "13'9"", "13 ft 9 in" whatever the display unit.
 */
export function LengthInput({
  value,
  onChange,
  unit,
  min = 0,
  placeholder,
  disabled,
  ariaLabel,
  className,
}: {
  value: Mm | undefined;
  onChange: (mm: Mm) => void;
  unit: 'metric' | 'imperial';
  min?: Mm;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const display = (mm: Mm | undefined) =>
    mm === undefined || Number.isNaN(mm) ? '' : unit === 'metric' ? String(roundTo(fromMm(mm, 'm'), 3)) : formatFtIn(mm);
  const [text, setText] = useState(display(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(display(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unit]);
  const commit = () => {
    const mm = parseLength(text, unit === 'metric' ? 'm' : 'ft');
    if (mm === null || mm < min) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(Math.round(mm));
    setText(display(Math.round(mm)));
  };
  return (
    <span className={`length-input ${className ?? ''}`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={invalid ? 'invalid' : ''}
        value={text}
        placeholder={placeholder ?? (unit === 'metric' ? '0.00' : `0' 0"`)}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="unit">{unit === 'metric' ? 'm' : 'ft in'}</span>
    </span>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  disabled,
  ariaLabel,
  integer,
}: {
  value: number | undefined;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  ariaLabel?: string;
  integer?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    const n = integer ? parseInt(text, 10) : parseFloat(text.replace(',', '.'));
    if (Number.isNaN(n)) {
      setText(value === undefined ? '' : String(value));
      return;
    }
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
    setText(String(v));
  };
  return (
    <span className="number-input">
      <input
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        min={min}
        max={max}
        step={step ?? (integer ? 1 : 'any')}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix ? <span className="unit">{suffix}</span> : null}
    </span>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select value={value} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children, actions, collapsible, defaultOpen = true }: { title: ReactNode; children: ReactNode; actions?: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <header className="section-header">
        {collapsible ? (
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'} {title}
          </button>
        ) : (
          <h3>{title}</h3>
        )}
        {actions ? <span className="section-actions">{actions}</span> : null}
      </header>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}

export function formatLength(mm: Mm, unit: 'metric' | 'imperial', decimals = 2): string {
  return unit === 'metric' ? `${(mm / MM_PER_M).toFixed(decimals)} m` : formatFtIn(mm);
}

export function formatArea(m2: number, unit: 'metric' | 'imperial'): string {
  return unit === 'metric' ? `${m2.toFixed(2)} m²` : `${(m2 * 10.7639).toFixed(1)} sq ft (${m2.toFixed(2)} m²)`;
}

export function formatMoney(v: number | undefined, currency = 'GBP'): string {
  if (v === undefined || Number.isNaN(v)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(v);
  } catch {
    return v.toFixed(2);
  }
}
