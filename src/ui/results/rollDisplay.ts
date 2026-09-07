import type { BroadloomProduct, RollCut, RollPlan } from '@engine/types';
import { splitIntoRolls } from '@engine/packer';
import { ceilToStep } from '@engine/units';

export type RollDisplayProduct = Pick<BroadloomProduct, 'name' | 'maxRollLength' | 'cutIncrement' | 'minCutLength' | 'kind' | 'priceBasis' | 'rollPricing' | 'pricedRollLength' | 'wastageAllowance'>;

export interface DisplayRoll {
  number: number;
  cuts: RollCut[];
  cutLength: number;
  orderLength: number;
  exceedsMaximum: boolean;
}

/** A display projection of the packer's first-fit allocation; no pieces are repacked here. */
export function physicalRolls(plan: RollPlan, product?: RollDisplayProduct): { rolls: DisplayRoll[]; assigned: boolean; unallocatedLength: number } {
  const wholeRolls = product?.priceBasis === 'per_roll' && product.rollPricing !== 'cut_length' && !!product.pricedRollLength;
  const max = wholeRolls ? product!.pricedRollLength : product?.maxRollLength;
  const increment = product?.cutIncrement ?? 100;
  const inc = increment > 0 ? increment : 1;
  const groups: RollCut[][] = [];
  const used: number[] = [];
  const knownAssignment = plan.rollsRequired <= 1 || !!(max && max > 0);

  if (!knownAssignment || !(max && max > 0)) {
    if (plan.cuts.length) groups.push(plan.cuts);
  } else {
    // Match splitIntoRolls, including its rounding of overlong cuts before placing later cuts.
    // The engine does not retain the cut-to-roll assignment; parity tests guard this projection.
    for (const cut of plan.cuts) {
      if (cut.length > max + 1e-6) {
        groups.push([cut]);
        used.push(ceilToStep(cut.length, inc));
        continue;
      }
      const index = used.findIndex((length) => length + cut.length <= max + 1e-6);
      if (index < 0) {
        groups.push([cut]);
        used.push(cut.length);
      } else {
        groups[index]!.push(cut);
        used[index] = used[index]! + cut.length;
      }
    }
  }

  const engineRolls = splitIntoRolls(plan.cuts, max, increment).rolls;
  const reserve = wholeRolls || plan.warnings.some(w => w.code === 'WASTAGE_RESERVE');
  if (reserve && knownAssignment) while (groups.length < plan.rollsRequired) groups.push([]);
  const assigned = knownAssignment && groups.length === plan.rollsRequired;
  const rolls = groups.map((cuts, index): DisplayRoll => {
    const cutLength = cuts.reduce((sum, cut) => sum + cut.length, 0);
    const orderLength = wholeRolls ? max! : groups.length === 1 ? plan.orderLength : engineRolls[index] ?? cutLength;
    return { number: index + 1, cuts, cutLength, orderLength, exceedsMaximum: !!(max && Math.max(orderLength, cutLength) > max + 1e-6) };
  });
  if (reserve && !wholeRolls && assigned) {
    let extra = Math.max(0, plan.orderLength - rolls.reduce((sum, roll) => sum + roll.orderLength, 0));
    for (const roll of rolls) {
      const space = max && max > 0 ? Math.max(0, max - roll.orderLength) : extra;
      const allocation = Math.min(extra, space);
      roll.orderLength += allocation;
      extra -= allocation;
    }
  }
  return { rolls, assigned, unallocatedLength: Math.max(0, plan.orderLength - rolls.reduce((sum, roll) => sum + roll.orderLength, 0)) };
}

/** Stable by destination ID, so a room keeps its colour across rolls and recalculations. */
export function destinationColour(ownerId: string): { fill: string; stroke: string } {
  const colours = [
    { fill: '#bce5dc', stroke: '#186759' }, { fill: '#cbdcfa', stroke: '#34558a' },
    { fill: '#f6dea7', stroke: '#795719' }, { fill: '#e3d0f2', stroke: '#704e8a' },
    { fill: '#f4cad5', stroke: '#90405b' }, { fill: '#bde6ee', stroke: '#276776' },
    { fill: '#d9e8b6', stroke: '#526c27' }, { fill: '#f5d0b7', stroke: '#8e5030' },
  ];
  let hash = 0;
  for (const char of ownerId) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return colours[hash % colours.length]!;
}

/** Cut number plus a piece letter, including AA... for unusually busy cuts. */
export function pieceReference(cutIndex: number, pieceIndex: number): string {
  let letters = '';
  for (let index = pieceIndex + 1; index > 0; index = Math.floor((index - 1) / 26)) {
    letters = String.fromCharCode(65 + (index - 1) % 26) + letters;
  }
  return `${cutIndex + 1}${letters}`;
}
