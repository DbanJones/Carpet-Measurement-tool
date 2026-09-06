/**
 * Units.
 *
 * The engine works internally in MILLIMETRES (integers where possible) so that
 * geometry never suffers from floating-point drift, and areas in square metres
 * are derived at the edges. Every public input that is a length is a `Mm`.
 */
export type Mm = number;
export type M2 = number;

export const MM_PER_M = 1000;
export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export function toMm(value: number, unit: LengthUnit): Mm {
  switch (unit) {
    case 'mm':
      return value;
    case 'cm':
      return value * 10;
    case 'm':
      return value * MM_PER_M;
    case 'in':
      return value * MM_PER_INCH;
    case 'ft':
      return value * MM_PER_FOOT;
  }
}

export function fromMm(mm: Mm, unit: LengthUnit): number {
  switch (unit) {
    case 'mm':
      return mm;
    case 'cm':
      return mm / 10;
    case 'm':
      return mm / MM_PER_M;
    case 'in':
      return mm / MM_PER_INCH;
    case 'ft':
      return mm / MM_PER_FOOT;
  }
}

/** Parse "12'6"", "12 ft 6 in", "3.5m", "350cm", "3500" (default unit) into mm. Returns null if unparseable. */
export function parseLength(input: string, defaultUnit: LengthUnit = 'm'): Mm | null {
  const s = input.trim().toLowerCase().replace(/,/g, '.');
  if (!s) return null;
  // feet and inches: 12'6", 12' 6", 12ft 6in, 12 ft, 6 in
  const ftIn = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (ftIn) {
    const ft = parseFloat(ftIn[1]!);
    const inches = ftIn[2] ? parseFloat(ftIn[2]) : 0;
    return Math.round(ft * MM_PER_FOOT + inches * MM_PER_INCH);
  }
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inOnly) return Math.round(parseFloat(inOnly[1]!) * MM_PER_INCH);
  const metric = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/);
  if (metric) {
    const v = parseFloat(metric[1]!);
    const unit = (metric[2] as LengthUnit | undefined) ?? defaultUnit;
    return Math.round(toMm(v, unit));
  }
  return null;
}

export function mm2ToM2(mm2: number): M2 {
  return mm2 / 1_000_000;
}

export function m2ToMm2(m2: M2): number {
  return m2 * 1_000_000;
}

/** Round UP to the next multiple of `step` (e.g. cut lengths sold in 100 mm increments). */
export function ceilToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.ceil(value / step - 1e-9) * step;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Format millimetres as metres with 2 decimals, e.g. 4250 -> "4.25 m". */
export function formatM(mm: Mm, decimals = 2): string {
  return `${roundTo(mm / MM_PER_M, decimals).toFixed(decimals)} m`;
}

export function formatM2(m2: M2, decimals = 2): string {
  return `${roundTo(m2, decimals).toFixed(decimals)} m²`;
}

/** Format millimetres as feet and inches, e.g. 3810 -> 12' 6". */
export function formatFtIn(mm: Mm): string {
  const totalInches = mm / MM_PER_INCH;
  const ft = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - ft * 12);
  if (inches === 12) return `${ft + 1}' 0"`;
  return `${ft}' ${inches}"`;
}
