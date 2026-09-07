import { emptyProject, sampleProject } from './fixtures';
import { estimateProject } from './estimate';
import { DEFAULT_LABOUR_MODEL, resolveLabourModel } from './labour';
import { parseProject, serializeProject } from './serialize';
import type { BroadloomProduct, PackProduct, Project, Room } from './types';

const carpet = (id = 'carpet', patch: Partial<BroadloomProduct> = {}): BroadloomProduct => ({ id, name: id, kind: 'carpet', rollWidth: 4000, maxRollLength: 30000, pricePerM2: 20, ...patch });
const room = (id: string, productId = 'carpet', length = 5000, width = 3000): Room => ({ id, name: id, productId, shape: { kind: 'rectangle', length, width }, doorways: [], subfloor: { type: 'floorboards', condition: 'good' } });
function project(products: Project['products'] = [carpet()], rooms: Room[] = [room('Lounge')]): Project {
  const p = { ...emptyProject('commercial'), products, rooms };
  p.prices.labour.minimumJobLabour = 0;
  return p;
}
const covering = (p: Project) => estimateProject(p).bom.find(l => l.id === `bom:covering:${p.products[0]!.id}`)!;

describe('product purchase choices', () => {
  it('preserves existing square-metre pricing and all legacy sample totals', () => {
    const p = project();
    expect(covering(p)).toMatchObject({ unit: 'lm', unitPrice: 80 });
    const sample = sampleProject();
    const before = estimateProject(sample);
    sample.prices.labourModel = resolveLabourModel(undefined);
    expect(estimateProject(sample).totals).toEqual(before.totals);
  });
  it('charges and orders complete rolls, with ordered area and waste based on the purchase', () => {
    const p = project([carpet('carpet', { priceBasis: 'per_roll', pricePerRoll: 800, pricedRollLength: 10000 })]);
    const e = estimateProject(p);
    expect(covering(p)).toMatchObject({ quantity: 1, unit: 'roll', unitPrice: 800, total: 800 });
    expect(e.rollPlans[0]).toMatchObject({ orderLength: 10000, orderedAreaM2: 40, netAreaM2: 15, wasteFraction: 0.625 });
  });
  it('splits physical rolls at the priced length even if the old delivery maximum was longer', () => {
    const p = project([carpet('carpet', { priceBasis: 'per_roll', pricePerRoll: 800, pricedRollLength: 10000 })], [room('A', 'carpet', 6000, 3500), room('B', 'carpet', 6000, 3500)]);
    const e = estimateProject(p);
    expect(e.rollPlans[0]).toMatchObject({ rollsRequired: 2, orderLength: 20000, orderedAreaM2: 80 });
    expect(covering(p).total).toBe(1600);
  });
  it('prorates a roll price only when cut-length charging is selected', () => {
    const p = project([carpet('carpet', { priceBasis: 'per_roll', pricePerRoll: 777, pricedRollLength: 12000, rollPricing: 'cut_length' })]);
    const plan = estimateProject(p).rollPlans[0]!;
    expect(covering(p).unit).toBe('lm');
    expect(covering(p).total).toBe(Math.round(777 * plan.orderLength / 12000 * 100) / 100);
    expect(plan.orderLength).toBeLessThan(12000);
  });
  it('leaves pricing incomplete if the length covered by a roll price is missing', () => {
    const p = project([carpet('carpet', { priceBasis: 'per_roll', pricePerRoll: 800 })]);
    expect(covering(p).total).toBeUndefined();
    expect(estimateProject(p).warnings.some(w => w.code === 'ROLL_PRICE_LENGTH_MISSING')).toBe(true);
  });
  it('honours explicit m² pack pricing despite an old pack price and still buys whole packs', () => {
    const product: PackProduct = { id: 'laminate', name: 'Laminate', kind: 'laminate', packCoverageM2: 2, pricePerPack: 99, pricePerM2: 10, priceBasis: 'per_m2' };
    const p = project([product], [room('A', 'laminate', 3000, 3000)]);
    expect(covering(p)).toMatchObject({ quantity: 5, unit: 'pack', unitPrice: 20, total: 100 });
  });
});

describe('visible wastage and pattern assumptions', () => {
  it('uses explicit product wastage for stair cladding and retains the stair default when unset', () => {
    const product: PackProduct = { id: 'lvt', name: 'LVT', kind: 'lvt_click', packCoverageM2: 2, hardFloor: { wastage: 0.25 } };
    const p = project([product], []);
    p.staircases = [{ id: 'stairs', name: 'Stairs', productId: 'lvt', steps: [{ id: 's1', kind: 'straight', rise: 200, going: 250, width: 900 }, { id: 's2', kind: 'straight', rise: 200, going: 250, width: 900 }], landings: [], method: 'cap_and_band', openSides: 'none' }];
    const plan = estimateProject(p).details.stairPlans.stairs!;
    expect(plan.hardFloorGrossAreaM2).toBeCloseTo(plan.hardFloorAreaM2! * 1.25);
    product.hardFloor = undefined;
    expect(estimateProject(p).details.stairPlans.stairs!.hardFloorGrossAreaM2).toBeCloseTo(plan.hardFloorAreaM2! * 1.15);
  });
  it('credits existing carpet cutting surplus before adding any extra allowance', () => {
    const p = project();
    const before = estimateProject(p).rollPlans[0]!;
    (p.products[0] as BroadloomProduct).wastageAllowance = 0.1;
    expect(estimateProject(p).rollPlans[0]!.orderLength).toBe(before.orderLength);
    (p.products[0] as BroadloomProduct).wastageAllowance = 0.5;
    const after = estimateProject(p).rollPlans[0]!;
    expect(after.orderedAreaM2).toBeGreaterThanOrEqual(15 * 1.5);
    expect(after.orderedAreaM2).toBeLessThan(15 * 1.5 + 0.4 + 1e-9);
    expect(after.warnings.some(w => w.code === 'WASTAGE_RESERVE')).toBe(true);
  });
  it('uses product herringbone allowance, and lets a room override the pattern', () => {
    const product: PackProduct = { id: 'lvt', name: 'Herringbone LVT', kind: 'lvt_click', packCoverageM2: 2, hardFloor: { layPattern: 'herringbone' } };
    const p = project([product], [room('A', 'lvt', 4000, 5000)]);
    expect(estimateProject(p).details.hardFloorPlans.A!.grossAreaM2).toBe(24);
    p.rooms[0]!.hardFloor = { layPattern: 'straight' };
    expect(estimateProject(p).details.hardFloorPlans.A!.grossAreaM2).toBeCloseTo(21.4);
    p.rooms[0]!.hardFloor = { wastage: 0.12 };
    expect(estimateProject(p).details.hardFloorPlans.A!.grossAreaM2).toBeCloseTo(22.4);
  });
});

describe('underlay selected with each carpet', () => {
  it('honours a custom underlay square-metre price ahead of an inherited project roll price', () => {
    const p = project([carpet('carpet', { underlay: { pricePerM2: 3 } })]);
    const line = estimateProject(p).bom.find(l => l.category === 'underlay')!;
    expect(line.unitPrice).toBe(45.21); // 1.37 × 11m roll, charged at £3/m².
    expect(line.unitPrice).not.toBe(75);
  });
  it('excludes no-underlay rooms and separates genuinely different underlay rolls', () => {
    const p = project([carpet('A'), carpet('B', { underlay: { fit: false } }), carpet('C', { underlay: { thickness: 8, pricePerRoll: 60 } })], [room('A', 'A'), room('B', 'B'), room('C', 'C')]);
    const lines = estimateProject(p).bom.filter(l => l.category === 'underlay');
    expect(lines).toHaveLength(2);
    expect(lines.flatMap(l => l.subjectIds).sort()).toEqual(['A', 'C']);
    expect(lines.map(l => l.unitPrice).sort()).toEqual([60, 75]);
  });
  it('shares identical default underlay across different carpets instead of rounding per product', () => {
    const p = project([carpet('A'), carpet('B', { underlay: { fit: true } })], [room('A', 'A', 2000, 2000), room('B', 'B', 2000, 2000)]);
    const lines = estimateProject(p).bom.filter(l => l.category === 'underlay');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.subjectIds).toEqual(['A', 'B']);
    expect(lines[0]!.quantity).toBe(1);
  });
  it('applies the product underlay choice to staircase pads', () => {
    const p = project([carpet('carpet', { underlay: { fit: false } })], []);
    p.staircases = [{ id: 'stairs', name: 'Stairs', productId: 'carpet', steps: [{ id: 's1', kind: 'straight', rise: 200, going: 250, width: 900 }], landings: [], method: 'cap_and_band', openSides: 'none' }];
    const e = estimateProject(p);
    expect(e.staircases.stairs!.underlayAreaM2).toBe(0);
    expect(e.bom.some(l => l.category === 'underlay')).toBe(false);
  });
});

describe('hourly labour methodology', () => {
  it('replaces unit-rate labour with measured activity hours without double charging', () => {
    const p = project([carpet()], [room('A', 'carpet', 6000, 4000)]);
    p.prices.labourModel = { ...resolveLabourModel(undefined), mode: 'hourly', hourlyRate: 50, setupHours: 1, allowance: 0.1 };
    const e = estimateProject(p);
    // 24m² /12m²/h =2h, +1h setup, +10%=3.3h at £50 =£165.
    expect(e.details.labourHours.totalHours).toBeCloseTo(3.3);
    expect(e.totals.labourCost).toBe(165);
    expect(e.bom.filter(l => l.category === 'labour').every(l => l.unit === 'hour')).toBe(true);
    expect(e.bom.some(l => l.id === 'bom:labour:fitting:carpet')).toBe(false);
  });
  it('charges shaped steps more time and includes landing area once', () => {
    const p = project([carpet()], []);
    p.prices.labourModel = { ...resolveLabourModel(undefined), mode: 'hourly', setupHours: 0, allowance: 0 };
    p.staircases = [{ id: 'stairs', name: 'Stairs', productId: 'carpet', steps: [{ id: 's1', kind: 'straight', rise: 200, going: 250, width: 900 }, { id: 's2', kind: 'winder', rise: 200, going: 500, goingNarrow: 100, width: 900 }], landings: [{ id: 'l', kind: 'top', length: 2000, width: 1000, afterStepIndex: 1 }], method: 'cap_and_band', openSides: 'none' }];
    expect(estimateProject(p).details.labourHours.totalHours).toBeCloseTo((15 + 25) / 60 + 2 / 5, 3);
  });
  it('applies pattern time and excludes optional preparation from required hours', () => {
    const p = project([{ id: 'lvt', name: 'LVT', kind: 'lvt_glue', packCoverageM2: 2, hardFloor: { layPattern: 'herringbone' } }], [room('A', 'lvt', 3000, 3000)]);
    p.prices.labourModel = { ...resolveLabourModel(undefined), mode: 'hourly', setupHours: 0, allowance: 0 };
    const hours = estimateProject(p).details.labourHours;
    expect(hours.lines.find(l => l.id === 'fitting:A')!.hours).toBeCloseTo(9 / 3 * 1.75);
    expect(hours.totalHours).toBeCloseTo(hours.lines.filter(l => !l.optional).reduce((s, l) => s + l.hours, 0));
    expect(estimateProject(p).bom.filter(l => l.optional && l.category === 'labour').every(l => l.total === undefined)).toBe(true);
  });
  it('does not create setup labour for an empty or unmeasurable job', () => {
    const p = project([], []);
    p.prices.labourModel = { ...resolveLabourModel(undefined), mode: 'hourly' };
    expect(estimateProject(p).details.labourHours.totalHours).toBe(0);
    expect(estimateProject(p).totals.labourCost).toBe(0);
  });
});

describe('commercial settings project files', () => {
  it('round-trips all new product, waste and labour fields without changing the estimate', () => {
    const p = project([carpet('carpet', { priceBasis: 'per_roll', pricePerRoll: 600, pricedRollLength: 15000, rollPricing: 'cut_length', wastageAllowance: 0.3, underlay: { fit: true, thickness: 8, pricePerRoll: 60 } }), { id: 'lvt', name: 'LVT', kind: 'lvt_click', packCoverageM2: 2, priceBasis: 'per_m2', pricePerM2: 19, hardFloor: { layPattern: 'herringbone', wastage: 0.16 } }]);
    p.prices.labourModel = { ...resolveLabourModel(undefined), mode: 'hourly' };
    p.options.broadloom.wastageAllowance = 0.2;
    const parsed = parseProject(serializeProject(p));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.project.products).toEqual(p.products);
    expect(parsed.project.prices.labourModel).toEqual(p.prices.labourModel);
    expect(estimateProject(parsed.project).totals).toEqual(estimateProject(p).totals);
  });
  it('repairs invalid divisors, enums and allowances while preserving old file defaults', () => {
    const p = project();
    const json = JSON.parse(serializeProject(p));
    json.project.prices.labourModel = { mode: 'wrong', fittingM2PerHour: { carpet: 0 }, hourlyRate: -5, allowance: -1 };
    json.project.products[0].priceBasis = 'invalid';
    json.project.products[0].pricedRollLength = -3;
    const parsed = parseProject(JSON.stringify(json));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.project.prices.labourModel).toEqual(DEFAULT_LABOUR_MODEL);
    expect(parsed.project.products[0]).not.toHaveProperty('priceBasis');
    expect(parsed.warnings.length).toBeGreaterThan(0);
    const old = parseProject(serializeProject(p));
    if ('error' in old) throw new Error(old.error);
    expect(old.project.prices.labourModel).toBeUndefined();
  });
});
