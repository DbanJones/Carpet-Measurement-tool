import type { UnderlayOptions } from './types';

/** Per-product underlay inherits missing details, but an explicit m² price replaces a default roll price. */
export function resolveProductUnderlay(defaults: UnderlayOptions, overrides?: Partial<UnderlayOptions>): UnderlayOptions {
  const result = { ...defaults, ...Object.fromEntries(Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)) };
  if (overrides?.pricePerM2 !== undefined && overrides.pricePerRoll === undefined) delete result.pricePerRoll;
  return result;
}
