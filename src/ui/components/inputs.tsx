import { useEffect, useId, useState, type ReactNode } from 'react';
import { parseLength, fromMm, formatFtIn, roundTo, MM_PER_M } from '@engine/units';
import type { Mm } from '@engine/types';

/**
 * A labelled field for ONE control. The wrapper is a `<label>`, so clicking the caption focuses the
 * control inside it — which is only correct when there is exactly one. For a row of checkboxes,
 * radio buttons or action buttons use `FieldGroup`: a `<label>` wrapping several labelable elements
 * activates the FIRST one, so clicking the caption would silently tick a box or press a button.
 */
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
 * A captioned GROUP of controls (checkboxes, preset buttons, radio buttons). Renders a plain
 * container with a `role="group"` named by the caption, so the caption is announced with each
 * control but clicking it does nothing.
 */
export function FieldGroup({ label, hint, children, inline }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  const id = useId();
  return (
    <div className={inline ? 'field field-inline' : 'field'} role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>
        {label}
      </span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
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
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  useEffect(() => {
    setText(display(value));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, unit]);
  const commit = () => {
    // Reading a field must never change the measurement. Feet-and-inches display rounds to the whole
    // inch, so re-parsing an untouched field would write 3988 mm back over a stored 4000 mm every
    // time the user tabbed through it. Nothing typed, nothing committed.
    if (text === display(value)) {
      setError(null);
      return;
    }
    const mm = parseLength(text, unit === 'metric' ? 'm' : 'ft');
    if (mm === null) {
      setError(unit === 'metric' ? `Enter a length like 4.2, 420cm or 13' 9"` : `Enter a length like 13' 9", 13ft 9in or 4.2m`);
      return;
    }
    if (mm < min) {
      setError(`Must be at least ${unit === 'metric' ? `${roundTo(fromMm(min, 'm'), 3)} m` : formatFtIn(min)}.`);
      return;
    }
    setError(null);
    onChange(Math.round(mm));
    setText(display(Math.round(mm)));
  };
  return (
    <span className={`length-input ${className ?? ''}`}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        className={error ? 'invalid' : ''}
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
      {error ? (
        <span className="field-hint invalid" role="alert" id={errorId}>
          {error}
        </span>
      ) : null}
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
