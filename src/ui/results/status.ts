import type { BomLine, Estimate } from '@engine/types';

/** Optional recommendations do not belong in the amount being quoted. */
export function unpricedLines(lines: BomLine[]): BomLine[] {
  return lines.filter((line) => line.quantity > 0 && line.unitPrice === undefined && !line.optional && !line.informational);
}

export function estimateStatus(estimate: Estimate) {
  const failed = estimate.warnings.some((warning) => warning.code === 'ENGINE_ERROR');
  const errors = estimate.warnings.filter((warning) => warning.level === 'error');
  const missingPrices = unpricedLines(estimate.bom);
  return { failed, errors, missingPrices, incomplete: failed || errors.length > 0 || missingPrices.length > 0 };
}
