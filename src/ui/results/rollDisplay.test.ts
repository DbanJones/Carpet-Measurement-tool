import type { RollCut, RollPlan } from '@engine/types';
import { splitIntoRolls } from '@engine/packer';
import { estimateProject } from '@engine/estimate';
import { sampleProject } from '@engine/fixtures';
import { destinationColour, physicalRolls, pieceReference } from './rollDisplay';

const product = { name: 'Carpet', kind: 'carpet' as const, maxRollLength: 10000, cutIncrement: 100 };
function planFor(lengths: number[], overrides: Partial<RollPlan> = {}, max = 10000, increment = 100): RollPlan {
  const cuts: RollCut[] = lengths.map((length, index) => ({ index, length, pieces: [] }));
  const { rolls } = splitIntoRolls(cuts, max, increment);
  return { productId: 'carpet', rollWidth: 4000, pileDirection: 'along_length', pieces: [], cuts,
    orderLength: rolls.reduce((sum, value) => sum + value, 0), rollsRequired: rolls.length,
    orderedAreaM2: 0, netAreaM2: 0, wasteFraction: 0, offcuts: [], seamsByRoom: {}, warnings: [], ...overrides };
}

describe('physical roll display', () => {
  it('displays every paid whole roll including a reserve-only roll', () => {
    const plan = planFor([4500, 4000], { orderLength: 30000, rollsRequired: 3, warnings: [{ level: 'info', code: 'WHOLE_ROLL_PURCHASE', message: 'Whole rolls' }] });
    const display = physicalRolls(plan, { ...product, priceBasis: 'per_roll', pricedRollLength: 10000, maxRollLength: 30000 });
    expect(display.assigned).toBe(true);
    expect(display.rolls.map(r => r.orderLength)).toEqual([10000, 10000, 10000]);
    expect(display.rolls.map(r => r.cutLength)).toEqual([8500, 0, 0]);
    expect(display.unallocatedLength).toBe(0);
  });

  it('allocates an explicit uncut wastage reserve without repacking the cuts', () => {
    const plan = planFor([6500, 5500], { orderLength: 25000, rollsRequired: 3, warnings: [{ level: 'info', code: 'WASTAGE_RESERVE', message: 'Reserve' }] });
    const display = physicalRolls(plan, product);
    expect(display.assigned).toBe(true);
    expect(display.rolls.map(r => r.orderLength)).toEqual([10000, 10000, 5000]);
    expect(display.rolls.map(r => r.cuts.map(c => c.index))).toEqual([[0], [1], []]);
    expect(display.unallocatedLength).toBe(0);
  });
  it('places later cuts into spare length on earlier rolls without changing cut IDs or order', () => {
    const plan = planFor([6200, 5100, 3800]);
    const result = physicalRolls(plan, product);
    expect(result.assigned).toBe(true);
    expect(result.rolls.map((roll) => roll.cuts.map((cut) => cut.index))).toEqual([[0, 2], [1]]);
    expect(result.rolls.map((roll) => roll.orderLength)).toEqual([10000, 5100]);
    expect(result.rolls[0]!.cuts[1]).toBe(plan.cuts[2]);
  });

  it.each([
    { lengths: [6123, 5001, 3456, 765, 435], max: 10000, increment: 100 },
    { lengths: [10111, 5123, 110, 9000, 485], max: 10000, increment: 250 },
    { lengths: [3501, 3001, 2001, 1001], max: 4000, increment: 500 },
    { lengths: [201, 301, 51, 100], max: 500, increment: 0 },
    { lengths: [4200, 3000, 2400], max: 0, increment: 100 },
  ])('matches engine roll counts and ordered lengths: $lengths', ({ lengths, max, increment }) => {
    const plan = planFor(lengths, {}, max, increment);
    const expected = splitIntoRolls(plan.cuts, max, increment);
    const result = physicalRolls(plan, { ...product, maxRollLength: max, cutIncrement: increment });
    expect(result.assigned).toBe(true);
    expect(result.rolls.map((roll) => roll.orderLength)).toEqual(expected.rolls);
    expect(result.rolls.flatMap((roll) => roll.cuts).map((cut) => cut.index).sort()).toEqual(plan.cuts.map((cut) => cut.index).sort());
    expect(result.rolls.reduce((sum, roll) => sum + roll.orderLength, 0)).toBe(plan.orderLength);
  });

  it('matches physical allocation and order totals for every sample product', () => {
    const project = sampleProject();
    const estimate = estimateProject(project);
    for (const plan of estimate.rollPlans) {
      const covering = project.products.find((item) => item.id === plan.productId)!;
      if (covering.kind !== 'carpet' && covering.kind !== 'sheet_vinyl') throw new Error('Expected roll goods');
      const display = physicalRolls(plan, covering);
      expect(display.assigned).toBe(true);
      expect(display.rolls.length).toBe(plan.rollsRequired);
      expect(display.rolls.reduce((sum, roll) => sum + roll.orderLength, 0)).toBe(plan.orderLength);
      expect(display.rolls.flatMap((roll) => roll.cuts).length).toBe(plan.cuts.length);
    }
  });

  it('shows supplier minimum length as part of a single roll order', () => {
    const result = physicalRolls(planFor([2400], { orderLength: 3500 }), { ...product, minCutLength: 3500 });
    expect(result.rolls[0]).toMatchObject({ cutLength: 2400, orderLength: 3500 });
    expect(result.unallocatedLength).toBe(0);
  });

  it('does not invent an allocation for extra supplier minimum length across several rolls', () => {
    const result = physicalRolls(planFor([8000, 7000], { orderLength: 20000 }), { ...product, minCutLength: 20000 });
    expect(result.rolls.map((roll) => roll.orderLength)).toEqual([8000, 7000]);
    expect(result.unallocatedLength).toBe(5000);
  });

  it('marks overlong and supplier-rounded orders that exceed a roll maximum', () => {
    expect(physicalRolls(planFor([10500]), product).rolls[0]!.exceedsMaximum).toBe(true);
    const plan = planFor([3950], {}, 3950, 100);
    expect(physicalRolls(plan, { ...product, maxRollLength: 3950 }).rolls[0]!.exceedsMaximum).toBe(true);
  });

  it('shows combined cuts honestly when multi-roll supplier information is absent', () => {
    const result = physicalRolls(planFor([6200, 5100, 3800]));
    expect(result.assigned).toBe(false);
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls[0]!.orderLength).toBe(15100);
  });

  it('assigns a stable colour by destination and unambiguous piece references', () => {
    expect(destinationColour('stairs')).toEqual(destinationColour('stairs'));
    expect(pieceReference(0, 0)).toBe('1A');
    expect(pieceReference(3, 25)).toBe('4Z');
    expect(pieceReference(3, 26)).toBe('4AA');
    expect(pieceReference(3, 51)).toBe('4AZ');
  });
});
