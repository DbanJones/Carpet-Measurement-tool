/**
 * Integration tests for the estimator.
 *
 * `estimate.ts` is the only module that sees a whole `Project`, so these tests are deliberately
 * end-to-end: they quote the sample house, check the invariants a quote must satisfy (nothing is
 * ordered twice, nothing is priced without a unit price, the totals add up), and then poke the
 * estimator with the broken projects a UI will hand it — no rooms, a deleted product, a room with
 * no area, a staircase with no steps, a price book of zeros. None of those may throw.
 *
 * Every expected figure is derived in a comment: the point of the test is the trade arithmetic,
 * not the current output.
 */
import { estimateProject, compareRollWidths, dedupeWarnings, buildUpChange, fittingLabour } from './estimate';
import { emptyProject, sampleProject, SAMPLE_IDS } from './fixtures';
import { OVER_RUN_TOLERANCE, wholeUnitsWithTolerance } from './accessories';
import { MINIMUM_JOB_DE_MINIMIS } from './estimate';
import { CARPET_MAX_ROLL_LENGTH, VINYL_MAX_ROLL_LENGTH, CUT_INCREMENT, DEFAULT_PRICES, DEFAULT_UNDERLAY } from './defaults';
import type { BomCategory, BomLine, BroadloomProduct, Mm, PackProduct, Project, Room, Staircase, Step, Subfloor, Warning } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const R = SAMPLE_IDS.rooms;
const P = SAMPLE_IDS.products;
const STAIRS = SAMPLE_IDS.staircase;

/** The `Bom.add` wording for a recommended (`optional`) line: priced, but left out of the totals. */
const RECOMMENDED = 'Recommended — not included in the totals';
const isRecommended = (line: BomLine): boolean => (line.notes ?? '').startsWith(RECOMMENDED);

const money = (v: number): number => Math.round(v * 100) / 100;

const goodBoards: Subfloor = { type: 'floorboards', condition: 'good' };

function carpet4(over: Partial<BroadloomProduct> = {}): BroadloomProduct {
  return {
    id: 'carpet-4m',
    name: 'Test twist 4 m',
    kind: 'carpet',
    rollWidth: 4000,
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 10,
    pricePerM2: 20,
    ...over,
  };
}

function vinyl3(over: Partial<BroadloomProduct> = {}): BroadloomProduct {
  return {
    id: 'vinyl-3m',
    name: 'Test cushioned vinyl 3 m',
    kind: 'sheet_vinyl',
    rollWidth: 3000,
    maxRollLength: VINYL_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 2.5,
    pricePerM2: 12,
    ...over,
  };
}

/** A plain rectangular room with no doorways, on sound floorboards. */
function rect(id: string, productId: string, length: Mm, width: Mm, over: Partial<Room> = {}): Room {
  return { id, name: id, shape: { kind: 'rectangle', length, width }, doorways: [], productId, subfloor: goodBoards, ...over };
}

function straightSteps(count: number, width: Mm = 860): Step[] {
  return Array.from({ length: count }, (_, i) => ({ id: `step-${i + 1}`, kind: 'straight' as const, rise: 200, going: 223, width }));
}

function staircase(productId: string, steps: Step[], over: Partial<Staircase> = {}): Staircase {
  return { id: 'stairs', name: 'Stairs', productId, steps, landings: [], method: 'cap_and_band', openSides: 'none', ...over };
}

/** An empty project with the given contents; options and prices stay at their defaults. */
function project(id: string, patch: Partial<Project>): Project {
  return { ...emptyProject(id), ...patch };
}

const levels = (warnings: Warning[]): Warning['level'][] => warnings.map((w) => w.level);

// ---------------------------------------------------------------------------
// The sample house, end to end
// ---------------------------------------------------------------------------

describe('sampleProject(): a whole house end to end', () => {
  const est = estimateProject(sampleProject());
  const roomIds = Object.values(R);

  it('estimates the sample house without a single error-level warning', () => {
    // Everything in the fixture resolves: eight rooms with products and areas, one staircase.
    expect(est.warnings.filter((w) => w.level === 'error')).toEqual([]);
    // ... and it does say something useful: reusable gripper, duplicated doorways, the bonded vinyl.
    expect(est.warnings.length).toBeGreaterThan(0);
    expect(est.warnings.map((w) => w.code)).toContain('VINYL_FULLY_BONDED');
  });

  it('summarises every room and every staircase', () => {
    expect(Object.keys(est.rooms).sort()).toEqual([...roomIds].sort());
    expect(Object.keys(est.staircases)).toEqual([STAIRS]);
    for (const id of roomIds) {
      const summary = est.rooms[id];
      expect(summary).toBeDefined();
      expect(summary!.roomId).toBe(id);
      expect(summary!.netAreaM2).toBeGreaterThan(0);
      // the fixing perimeter (gripper) stops at the doorways, so it never exceeds the wall perimeter
      expect(summary!.gripperPerimeter).toBeLessThanOrEqual(summary!.perimeter);
      expect(summary!.boundingBox.length).toBeGreaterThan(0);
      expect(summary!.boundingBox.width).toBeGreaterThan(0);
    }
  });

  it('resolves a product for every room and every staircase', () => {
    const owners = est.details.productByOwner;
    for (const id of roomIds) expect(owners[id]).toBeDefined();
    expect(owners[STAIRS]).toBe(P.hallCarpet);
    // hall, landing and the stairs share one carpet; the two bedrooms share another
    expect(owners[R.hall]).toBe(P.hallCarpet);
    expect(owners[R.landing]).toBe(P.hallCarpet);
    expect(owners[R.bedroom1]).toBe(P.bedroomCarpet);
    expect(owners[R.bedroom2]).toBe(P.bedroomCarpet);
    expect(owners[R.bedroom3]).toBe(P.laminate);
    expect(owners[R.bathroom]).toBe(P.lvt);
    // every product referenced is a real product
    const productIds = new Set(sampleProject().products.map((p) => p.id));
    for (const productId of Object.values(owners)) expect(productIds.has(productId)).toBe(true);
  });

  it('measures each room to the dimensions entered', () => {
    // lounge 4.6 x 3.7 = 17.02 + bay 2.0 x 0.7 = 1.4 - chimney 1.4 x 0.35 = 0.49 -> 17.93 m²
    // kitchen 5.2 x 3.6 = 18.72 - cutout 2.0 x 1.4 = 2.8 -> 15.92 m²
    // landing 3.0 x 2.0 = 6.0 - cutout 1.8 x 1.1 = 1.98 -> 4.02 m²
    // bedroom 2 3.6 x 3.0 = 10.8 + wardrobe recess 1.8 x 0.6 = 1.08 -> 11.88 m²
    const expected: Record<string, number> = {
      [R.lounge]: 17.93,
      [R.kitchen]: 15.92,
      [R.hall]: 4.0,
      [R.landing]: 4.02,
      [R.bedroom1]: 14.7,
      [R.bedroom2]: 11.88,
      [R.bedroom3]: 6.24,
      [R.bathroom]: 4.18,
    };
    for (const [id, area] of Object.entries(expected)) expect(est.rooms[id]!.netAreaM2).toBeCloseTo(area, 6);
  });

  it('totals the net area as the rooms plus the stair carpet', () => {
    // 17.93 + 15.92 + 4.0 + 4.02 + 14.7 + 11.88 + 6.24 + 4.18 = 78.87 m² of floor
    const rooms = Object.values(est.rooms).reduce((s, r) => s + r.netAreaM2, 0);
    expect(rooms).toBeCloseTo(78.87, 6);
    // + the stair carpet (13 steps of rise + going + nosing, no allowances) ≈ 5.17 m²
    const stairs = est.staircases[STAIRS]!.carpetAreaM2;
    expect(stairs).toBeCloseTo(5.166, 3);
    expect(est.totals.netAreaM2).toBeCloseTo(rooms + stairs, 6);
  });

  it('summarises the staircase: 13 steps, its own pieces, gripper and underlay', () => {
    const stairs = est.staircases[STAIRS]!;
    expect(stairs.stepCount).toBe(13);
    expect(stairs.pieces).toHaveLength(13); // one piece per step: cap and band
    expect(stairs.pieces.every((p) => p.ownerId === STAIRS)).toBe(true);
    expect(stairs.gripperLength).toBeGreaterThan(0); // two lengths per step (tread + riser)
    expect(stairs.underlayAreaM2).toBeGreaterThan(0);
    expect(stairs.bindingLength).toBe(0); // closed strings both sides: nothing to bind
    // the flight's own subfloor now reaches the floor-prep rules, so it carries their notes
    expect(stairs.warnings.map((w) => w.level)).not.toContain('error');
  });

  it('keeps every specialist plan in details for the UI', () => {
    const d = est.details;
    expect(Object.keys(d.stairPlans)).toEqual([STAIRS]);
    // only the two pack-floor rooms get a hard floor plan
    expect(Object.keys(d.hardFloorPlans).sort()).toEqual([R.bathroom, R.bedroom3].sort());
    expect(d.underlay).toBeDefined();
    expect(d.gripper).toBeDefined();
    expect(d.doorBars.bars.length).toBeGreaterThan(0);
    expect(d.tapes.seamTapeLength).toBeGreaterThan(0);
    expect(Object.keys(d.vinylSundries)).toEqual([R.kitchen]);
    expect(d.floorPrep.items.length).toBeGreaterThan(0);
  });

  it('publishes one de-duplicated warning list, errors first', () => {
    const keys = est.warnings.map((w) => `${w.code}|${w.subjectId ?? ''}|${w.message}`);
    expect(new Set(keys).size).toBe(keys.length);
    const rank = { error: 0, warning: 1, info: 2 };
    const ranks = est.warnings.map((w) => rank[w.level]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    // a room's summary repeats only the warnings about that room
    for (const w of est.rooms[R.kitchen]!.warnings) expect(w.subjectId).toBe(R.kitchen);
  });
});

// ---------------------------------------------------------------------------
// Roll plans
// ---------------------------------------------------------------------------

describe('roll plans', () => {
  const est = estimateProject(sampleProject());

  it('builds one plan per broadloom product actually used, and none for pack floors', () => {
    expect(est.rollPlans.map((p) => p.productId).sort()).toEqual([P.bedroomCarpet, P.hallCarpet, P.kitchenVinyl, P.loungeCarpet].sort());
    expect(new Set(est.rollPlans.map((p) => p.productId)).size).toBe(est.rollPlans.length);
    expect(est.rollPlans.map((p) => p.productId)).not.toContain(P.laminate);
    expect(est.rollPlans.map((p) => p.productId)).not.toContain(P.lvt);
  });

  it('every plan is orderable: a positive length, at least one roll, at least one cut', () => {
    expect(est.rollPlans.length).toBe(4);
    for (const plan of est.rollPlans) {
      expect(plan.orderLength).toBeGreaterThan(0);
      expect(plan.orderLength % CUT_INCREMENT).toBe(0); // sold to the nearest 10 cm
      expect(plan.rollsRequired).toBeGreaterThanOrEqual(1);
      expect(plan.cuts.length).toBeGreaterThan(0);
      expect(plan.pieces.length).toBeGreaterThan(0);
      // you always buy at least the floor you are covering
      expect(plan.orderedAreaM2).toBeGreaterThanOrEqual(plan.netAreaM2);
      expect(plan.orderedAreaM2).toBeCloseTo((plan.orderLength * plan.rollWidth) / 1e6, 6);
      expect(plan.wasteFraction).toBeGreaterThanOrEqual(0);
      expect(plan.wasteFraction).toBeLessThan(1);
    }
  });

  it('never plans a piece wider than the roll', () => {
    for (const plan of est.rollPlans) {
      for (const piece of plan.pieces) {
        expect(piece.width).toBeGreaterThan(0);
        expect(piece.length).toBeGreaterThan(0);
        expect(piece.width).toBeLessThanOrEqual(plan.rollWidth);
      }
    }
  });

  it('never claims more carpet in pieces than the order length buys', () => {
    for (const plan of est.rollPlans) {
      const piecesM2 = plan.pieces.reduce((s, p) => s + (p.length * p.width) / 1e6, 0);
      expect(piecesM2).toBeLessThanOrEqual(plan.orderedAreaM2 + 1e-9);
      // and the pieces cover at least the net floor area (allowances make them larger)
      expect(piecesM2).toBeGreaterThanOrEqual(plan.netAreaM2 - 1e-9);
    }
  });

  it('every piece belongs to a room or staircase that uses that product', () => {
    const owners = est.details.productByOwner;
    for (const plan of est.rollPlans) {
      for (const piece of plan.pieces) {
        expect(owners[piece.ownerId]).toBe(plan.productId);
        expect(piece.ownerName.length).toBeGreaterThan(0);
      }
      for (const roomId of Object.keys(plan.seamsByRoom)) expect(owners[roomId]).toBe(plan.productId);
    }
  });

  it('cuts the stairs out of the hall & landing roll, so the offcuts serve the stairs', () => {
    const hall = est.rollPlans.find((p) => p.productId === P.hallCarpet)!;
    const stairPieces = hall.pieces.filter((p) => p.ownerId === STAIRS);
    // 13 steps: 9 straight + 3 winders + the top riser
    expect(stairPieces).toHaveLength(13);
    expect(stairPieces.filter((p) => p.role === 'stair_step')).toHaveLength(10);
    expect(stairPieces.filter((p) => p.role === 'winder')).toHaveLength(3);
    // the same plan carries the hall and the landing: one order, not three
    expect(hall.pieces.some((p) => p.ownerId === R.hall)).toBe(true);
    expect(hall.pieces.some((p) => p.ownerId === R.landing)).toBe(true);
    // and no other plan mentions the stairs
    for (const plan of est.rollPlans) {
      if (plan === hall) continue;
      expect(plan.pieces.some((p) => p.ownerId === STAIRS)).toBe(false);
    }
    // the stair pieces are 860 + 100 mm of tuck wide, so four fit across a 4 m roll
    expect(stairPieces.every((p) => p.width === 960)).toBe(true);
  });

  it('quotes hall, landing and stairs as a single order line', () => {
    const line = est.bom.find((l) => l.id === `bom:covering:${P.hallCarpet}`)!;
    expect(line.subjectIds.sort()).toEqual([R.hall, R.landing, STAIRS].sort());
  });

  it('places every piece in exactly one cut and orders the cut total, rounded up', () => {
    for (const plan of est.rollPlans) {
      const placed = plan.cuts.flatMap((c) => c.pieces.map((p) => p.pieceId));
      expect(placed.slice().sort()).toEqual(plan.pieces.map((p) => p.id).sort());
      for (const cut of plan.cuts) {
        expect(cut.length).toBeGreaterThan(0);
        const across = cut.pieces.reduce((s, p) => s + p.width, 0) + (cut.offcut?.width ?? 0);
        expect(across).toBeLessThanOrEqual(plan.rollWidth);
        for (const p of cut.pieces) expect(p.length).toBeLessThanOrEqual(cut.length);
      }
      const cutTotal = plan.cuts.reduce((s, c) => s + c.length, 0);
      expect(plan.orderLength).toBeGreaterThanOrEqual(cutTotal);
      expect(plan.orderLength - cutTotal).toBeLessThan(CUT_INCREMENT * plan.rollsRequired);
    }
  });

  it('orders the hall carpet at 6.3 lm: 6.226 m of cuts rounded to the 10 cm increment', () => {
    // cut 0: hall main 1.10 m + landing fill 1.80 m + landing main 0.40 m across a 4 m roll, 4.10 m long
    // cuts 1-3: four stair pieces of 0.96 m across, 0.705 / 0.548 / 0.548 m long
    // cut 4: the top riser, 0.325 m -> 4.100 + 0.705 + 0.548 + 0.548 + 0.325 = 6.226 m -> 6.3 lm
    const hall = est.rollPlans.find((p) => p.productId === P.hallCarpet)!;
    expect(hall.cuts.reduce((s, c) => s + c.length, 0)).toBe(6226);
    expect(hall.orderLength).toBe(6300);
    expect(hall.rollsRequired).toBe(1);
    expect(hall.orderedAreaM2).toBeCloseTo(25.2, 6); // 6.3 x 4 m
  });
});

// ---------------------------------------------------------------------------
// Bill of materials
// ---------------------------------------------------------------------------

describe('bill of materials', () => {
  const est = estimateProject(sampleProject());
  const byCategory = (c: BomCategory): BomLine[] => est.bom.filter((l) => l.category === c);

  it('has at least one line in every category this house needs', () => {
    const expected: BomCategory[] = ['floor_covering', 'underlay', 'gripper', 'door_bars', 'trims', 'floor_preparation', 'adhesives_tapes', 'labour'];
    for (const category of expected) expect(byCategory(category).length).toBeGreaterThan(0);
    // one covering line per product in use (four carpets/vinyls + laminate + LVT), plus the
    // recommended spare pack the two pack products each carry
    expect(byCategory('floor_covering').filter((l) => !l.id.endsWith(':spare'))).toHaveLength(6);
    expect(byCategory('floor_covering').filter((l) => l.id.endsWith(':spare'))).toHaveLength(2);
  });

  it('never lists a zero, negative or non-finite quantity', () => {
    expect(est.bom.length).toBeGreaterThan(0);
    for (const line of est.bom) {
      expect(Number.isFinite(line.quantity)).toBe(true);
      expect(line.quantity).toBeGreaterThan(0);
      expect(line.unit.length).toBeGreaterThan(0);
      expect(line.description.length).toBeGreaterThan(0);
      if (line.exactQuantity !== undefined) {
        expect(Number.isFinite(line.exactQuantity)).toBe(true);
        // Whole units round UP from the exact requirement. Continuous goods (gripper packs, beading,
        // foam underlay) may round down within OVER_RUN_TOLERANCE, where the last few per cent
        // really does come out of the offcuts and the note says so.
        expect(line.quantity).toBeGreaterThanOrEqual(line.exactQuantity * (1 - OVER_RUN_TOLERANCE) - 1e-6);
      }
    }
  });

  it('prices every line it totals, at quantity x unit price', () => {
    for (const line of est.bom) {
      if (line.total === undefined) continue;
      expect(line.unitPrice).toBeDefined();
      expect(line.unitPrice).toBeGreaterThanOrEqual(0);
      expect(line.total).toBeCloseTo(money(line.quantity * line.unitPrice!), 6);
    }
    // a line can be unpriced (site work with no material price) — it then has no total either
    for (const line of est.bom) if (line.unitPrice === undefined) expect(line.total).toBeUndefined();
  });

  it('leaves recommended work out of the totals but quotes it in the notes', () => {
    const recommended = est.bom.filter(isRecommended);
    expect(recommended.length).toBeGreaterThan(0);
    for (const line of recommended) {
      expect(line.optional).toBe(true);
      expect(line.total).toBeUndefined();
      if (line.unitPrice === undefined) continue;
      // e.g. 2 bags of latex at £20 -> "(about GBP 40.00 if needed)"
      expect(line.notes).toContain(`about GBP ${money(line.quantity * line.unitPrice).toFixed(2)} if needed`);
    }
    // the skim over the new ply in the bathroom is a recommendation, not a required prep item
    const skim = est.bom.find((l) => l.id.startsWith('bom:prep:latex:recommended'))!;
    expect(skim.subjectIds).toEqual([R.bathroom]);
    expect(skim.total).toBeUndefined();
    expect(skim.notes).toContain('about GBP 40.00 if needed'); // 2 bags x £20
  });

  it('identifies preparation activities whose cost is included in labour or needs no separate charge', () => {
    const activities = est.bom.filter((line) => line.category === 'floor_preparation' && line.unitPrice === undefined);
    expect(activities.length).toBeGreaterThan(0);
    for (const line of activities) expect(line.informational).toBe(true);
    const covering = est.bom.find((line) => line.category === 'floor_covering');
    expect(covering?.informational).toBeUndefined();
  });

  it('points every line at real rooms and staircases', () => {
    const known = new Set<string>([...Object.values(R), STAIRS]);
    for (const line of est.bom) {
      expect(line.subjectIds.length).toBeGreaterThan(0);
      expect(new Set(line.subjectIds).size).toBe(line.subjectIds.length); // de-duplicated
      for (const id of line.subjectIds) expect(known.has(id)).toBe(true);
    }
  });

  it('gives every line a unique id', () => {
    const ids = est.bom.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('bom:')).toBe(true);
  });

  it('charges broadloom by the linear metre at the roll width', () => {
    // hall carpet £22/m² on a 4 m roll = £88 per linear metre; 6.3 lm -> £554.40
    const hall = est.bom.find((l) => l.id === `bom:covering:${P.hallCarpet}`)!;
    expect(hall.unit).toBe('lm');
    expect(hall.quantity).toBe(6.3);
    expect(hall.unitPrice).toBe(88);
    expect(hall.total).toBe(554.4);
    expect(hall.exactQuantity).toBeCloseTo(6.226, 6); // the cut total before rounding
    expect(hall.notes).toContain('1 roll');
    // lounge: 5.4 lm of £18/m² 4 m carpet = £72/lm -> £388.80
    const lounge = est.bom.find((l) => l.id === `bom:covering:${P.loungeCarpet}`)!;
    expect(lounge.quantity).toBe(5.4);
    expect(lounge.total).toBe(388.8);
    // kitchen vinyl: 7.4 lm of £16/m² 3 m vinyl = £48/lm -> £355.20 (no cross joins in vinyl)
    const vinyl = est.bom.find((l) => l.id === `bom:covering:${P.kitchenVinyl}`)!;
    expect(vinyl.unitPrice).toBe(48);
    expect(vinyl.quantity).toBe(7.4);
    expect(vinyl.total).toBe(355.2);
  });

  it('charges pack floors by the pack, rounding UP', () => {
    // box room 6.24 m² + 7% straight-lay wastage = 6.677 m²; 6.677 / 2.22 = 3.008 packs -> FOUR
    // packs. Three packs is 6.66 m² against a 6.677 m² plan, and "the last 0.02 m² comes out of the
    // offcuts" is not a thing you can do with click planks: 27 boards of 1.285 m do not make 13 rows
    // of 2.6 m. Rigid pack goods carry no over-run tolerance.
    const laminate = est.bom.find((l) => l.id === `bom:covering:${P.laminate}`)!;
    expect(laminate.unit).toBe('pack');
    expect(laminate.quantity).toBe(4);
    expect(laminate.exactQuantity).toBeCloseTo(3.0075, 3);
    expect(laminate.total).toBe(96);
    // the note says what is BOUGHT, not only the intermediate gross area
    expect(laminate.notes).toContain('8.88 m² bought for 6.24 m² of floor');
    expect(laminate.notes).not.toContain('offcuts');
    // and a spare pack is offered separately rather than hidden in the rounding
    const spare = est.bom.find((l) => l.id === `bom:covering:${P.laminate}:spare`)!;
    expect(spare.quantity).toBe(1);
    expect(spare.total).toBeUndefined();
    // bathroom 4.18 m² + 7% = 4.473 m²; 4.473 / 3.29 = 1.36 -> 2 packs x £65
    const lvt = est.bom.find((l) => l.id === `bom:covering:${P.lvt}`)!;
    expect(lvt.quantity).toBe(2);
    expect(lvt.total).toBe(130);
  });

  it('counts the accessories the fitter needs', () => {
    const underlay = est.bom.find((l) => l.id === 'bom:underlay:carpet')!;
    expect(underlay.unit).toBe('roll');
    expect(underlay.subjectIds).toContain(STAIRS); // the stair pads come off the same rolls
    expect(underlay.total).toBe(money(underlay.quantity * DEFAULT_UNDERLAY.pricePerRoll!));

    // gripper is sold in packs of ten, so the quantity, the unit and the price are all per pack:
    // the line used to quote 63 lengths at the per-length price and then say "7 packs of 10".
    const gripper = est.bom.find((l) => l.id === 'bom:gripper:timber')!;
    expect(gripper.unit).toBe('pack');
    expect(gripper.unitPrice).toBe(DEFAULT_PRICES.materials.gripperPerPack);
    expect(gripper.total).toBe(money(gripper.quantity * DEFAULT_PRICES.materials.gripperPerPack));
    expect(gripper.notes).toContain('10% wastage');
    expect(gripper.subjectIds).toContain(STAIRS);
    // no concrete-pin gripper: every carpeted room in the sample is on timber
    expect(est.bom.find((l) => l.id === 'bom:gripper:concrete')).toBeUndefined();

    // three carpet-to-carpet doorways (lounge, bedroom 1, bedroom 2) share one bar each
    const doubleBar = est.bom.find((l) => l.id === 'bom:doorbar:double_carpet')!;
    expect(doubleBar.quantity).toBe(3);
    expect(doubleBar.category).toBe('door_bars');
    // the two hard-floor doorways upstairs get ramps, priced as trims
    const ramps = est.bom.find((l) => l.id === 'bom:doorbar:ramp')!;
    expect(ramps.category).toBe('trims');
    expect(ramps.quantity).toBe(2);
    expect(ramps.unitPrice).toBe(DEFAULT_PRICES.materials.thresholdPerItem);
    // seam tape only where there are seams: with the planner no longer seaming a room for nothing,
    // the lounge, landing and bedroom 2 come out in one piece and only bedroom 1 carries a seam
    const seamTape = est.bom.find((l) => l.id === 'bom:tape:seam')!;
    expect(seamTape.subjectIds).toEqual([R.bedroom1]);
  });

  it('charges fitting per m² by covering kind, and the stairs per step', () => {
    // carpet rooms: 17.93 + 4.0 + 4.02 + 14.7 + 11.88 = 52.53 m² at £5 -> £262.65
    const carpet = est.bom.find((l) => l.id === 'bom:labour:fitting:carpet')!;
    expect(carpet.quantity).toBeCloseTo(52.53, 6);
    expect(carpet.unitPrice).toBe(DEFAULT_PRICES.labour.carpetFittingPerM2);
    expect(carpet.total).toBe(262.65);
    // LVT is the dearest rate: 4.18 m² at £18 -> £75.24
    expect(est.bom.find((l) => l.id === 'bom:labour:fitting:lvt')!.total).toBe(75.24);
    // 13 steps at £12 -> £156
    const stairs = est.bom.find((l) => l.id === 'bom:labour:stairs')!;
    expect(stairs.quantity).toBe(13);
    expect(stairs.unit).toBe('step');
    expect(stairs.total).toBe(156);
  });
});

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

describe('totals', () => {
  const est = estimateProject(sampleProject());

  it('adds materials and labour to the subtotal', () => {
    const { materialsCost, labourCost, subtotal } = est.totals;
    expect(materialsCost).toBeGreaterThan(0);
    expect(labourCost).toBeGreaterThan(0);
    expect(money(materialsCost! + labourCost!)).toBeCloseTo(subtotal!, 2);
  });

  it('takes the subtotal from the priced lines only', () => {
    const sum = (pred: (l: BomLine) => boolean): number => money(est.bom.filter(pred).reduce((s, l) => s + (l.total ?? 0), 0));
    expect(est.totals.materialsCost).toBeCloseTo(sum((l) => l.category !== 'labour'), 2);
    expect(est.totals.labourCost).toBeCloseTo(sum((l) => l.category === 'labour'), 2);
    // recommended lines carry a price in their notes but never a total, so they cannot leak in
    expect(est.bom.filter(isRecommended).every((l) => l.total === undefined)).toBe(true);
  });

  it('adds VAT at the price book rate', () => {
    const { subtotal, vat, total } = est.totals;
    expect(vat).toBeCloseTo(money(subtotal! * DEFAULT_PRICES.vatRate), 2);
    expect(total).toBeCloseTo(money(subtotal! + vat!), 2);
    expect(total).toBeGreaterThan(subtotal!);
  });

  it('leaves VAT off when the price book says so', () => {
    const p = sampleProject();
    p.prices.applyVat = false;
    const noVat = estimateProject(p);
    expect(noVat.totals.vat ?? 0).toBe(0);
    expect(noVat.totals.total).toBe(noVat.totals.subtotal);
    // the work itself is unchanged
    expect(noVat.totals.subtotal).toBeCloseTo(est.totals.subtotal!, 6);
  });

  it('a different VAT rate only moves the VAT line', () => {
    const p = sampleProject();
    p.prices.vatRate = 0;
    const zeroRate = estimateProject(p);
    expect(zeroRate.totals.vat).toBe(0);
    expect(zeroRate.totals.total).toBe(zeroRate.totals.subtotal);
    expect(zeroRate.totals.subtotal).toBeCloseTo(est.totals.subtotal!, 6);
  });
});

// ---------------------------------------------------------------------------
// Pack rounding across rooms
// ---------------------------------------------------------------------------

describe('pack floors are ordered for the whole project, not room by room', () => {
  /**
   * Two rooms 2.0 m wide in a laminate sold in 2 m² packs, wastage overridden to 0 so the pack
   * arithmetic is exact: 3.4 x 2.0 = 6.8 m² = 3.4 packs, 2.3 x 2.0 = 4.6 m² = 2.3 packs.
   */
  const laminate: PackProduct = { id: 'lam', name: 'Test laminate', kind: 'laminate', packCoverageM2: 2, pricePerPack: 30 };
  const room = (id: string, length: Mm): Room => rect(id, laminate.id, length, 2000, { hardFloor: { wastage: 0 } });

  it('sums the exact pack requirements before rounding up: 3.4 + 2.3 orders 6', () => {
    const est = estimateProject(project('packs', { products: [laminate], rooms: [room('a', 3400), room('b', 2300)] }));
    const line = est.bom.find((l) => l.id === 'bom:covering:lam')!;
    expect(line.exactQuantity).toBeCloseTo(5.7, 6);
    expect(line.quantity).toBe(6); // ceil(5.7), not ceil(3.4) + ceil(2.3) = 7
    expect(line.unit).toBe('pack');
    expect(line.total).toBe(180); // 6 x £30
    expect(line.subjectIds.sort()).toEqual(['a', 'b']);
  });

  it('the same rooms quoted separately would order 4 + 3 = 7 packs', () => {
    const alone = (id: string, length: Mm): number =>
      estimateProject(project(`one-${id}`, { products: [laminate], rooms: [room(id, length)] })).bom.find((l) => l.id === 'bom:covering:lam')!.quantity;
    expect(alone('a', 3400)).toBe(4);
    expect(alone('b', 2300)).toBe(3);
  });

  it('merges the stair cladding into the same pack count', () => {
    // 3 straight steps 0.9 m wide: (0.2 rise + 0.25 going) x 0.9 = 0.405 m² of laminate, + cutting waste
    const est = estimateProject(
      project('packs-stairs', {
        products: [laminate],
        staircases: [staircase('lam', [{ id: 's1', kind: 'straight', rise: 200, going: 250, width: 900 }], { id: 'stairs' })],
      }),
    );
    const line = est.bom.find((l) => l.id === 'bom:covering:lam')!;
    expect(line.subjectIds).toContain('stairs');
    expect(line.quantity).toBeGreaterThanOrEqual(1);
    expect(line.notes).toContain('incl. stairs');
  });
});

// ---------------------------------------------------------------------------
// Roll width comparison
// ---------------------------------------------------------------------------

describe('compareRollWidths', () => {
  it('offers every candidate width, ascending, including the standard 4 m and 5 m carpet rolls', () => {
    // a 3.66 m (12 ft) carpet also listed in 4.57 m (15 ft): candidates are its own width, its
    // alternatives and the UK standards, de-duplicated
    const odd = carpet4({ id: 'odd', rollWidth: 3660, alternativeRollWidths: [4570, 4000] });
    const p = project('widths', { products: [odd], rooms: [rect('lounge', 'odd', 5000, 3000)] });
    const rows = compareRollWidths(p, 'odd');
    expect(rows.map((r) => r.rollWidth)).toEqual([3660, 4000, 4570, 5000]);
    for (const row of rows) {
      expect(row.orderLength).toBeGreaterThan(0);
      expect(row.rollsRequired).toBeGreaterThanOrEqual(1);
      expect(row.orderedAreaM2).toBeCloseTo((row.orderLength * row.rollWidth) / 1e6, 6);
      expect(row.seams).toBeGreaterThanOrEqual(0);
      expect(levels(row.warnings)).not.toContain('error');
    }
  });

  it('a 5.0 x 6.0 m lounge: the 5 m roll has no seam, the 4 m roll has one', () => {
    // 4 m roll: the 5 m width needs two 5.1 m drops across the room = 10.2 lm, 40.8 m², 1 side seam
    // 5 m roll: one 6.1 m piece, 30.5 m², no seam — 10.3 m² less carpet
    const p = project('lounge', { products: [carpet4()], rooms: [rect('lounge', 'carpet-4m', 6000, 5000)] });
    p.options.broadloom.seamPolicy = 'min_seams';
    const rows = compareRollWidths(p, 'carpet-4m');
    expect(rows.map((r) => r.rollWidth)).toEqual([4000, 5000]);
    const four = rows[0]!;
    const five = rows[1]!;
    expect(four.seams).toBe(1);
    expect(four.orderLength).toBe(10200);
    expect(four.orderedAreaM2).toBeCloseTo(40.8, 6);
    expect(five.seams).toBe(0);
    expect(five.orderLength).toBe(6100);
    expect(five.orderedAreaM2).toBeCloseTo(30.5, 6);
    expect(five.wasteFraction).toBeLessThan(four.wasteFraction);
  });

  it('compares the standard vinyl widths for a sheet vinyl product', () => {
    const p = project('vinyl', { products: [vinyl3()], rooms: [rect('kitchen', 'vinyl-3m', 3400, 2400)] });
    p.options.broadloom.seamPolicy = 'min_seams';
    const rows = compareRollWidths(p, 'vinyl-3m');
    expect(rows.map((r) => r.rollWidth)).toEqual([2000, 3000, 4000]);
    // 2.4 m + 100 mm trim across a 2 m roll cannot be done in one piece; a 3 m or 4 m roll can
    expect(rows[0]!.seams).toBeGreaterThan(0);
    expect(rows[1]!.seams).toBe(0);
    expect(rows[2]!.seams).toBe(0);
    // 3 m roll: the 2.4 m width fits across, 3.5 lm x 3 m = 10.5 m²
    // 4 m roll: the room turns, the 3.4 m length fits across, 2.5 lm x 4 m = 10.0 m² — less waste
    expect(rows[1]!.orderLength).toBe(3500);
    expect(rows[2]!.orderLength).toBe(2500);
    expect(rows[2]!.wasteFraction).toBeLessThan(rows[1]!.wasteFraction);
  });

  it('compares the sample house hall carpet against a 5 m roll', () => {
    const rows = compareRollWidths(sampleProject(), P.hallCarpet);
    expect(rows.map((r) => r.rollWidth)).toEqual([4000, 5000]);
    // the 4 m roll is the cheaper order here: the same 6-ish metres on a wider roll is more carpet
    expect(rows[0]!.orderedAreaM2).toBeLessThan(rows[1]!.orderedAreaM2);
  });

  it('returns nothing for a pack floor, an unknown product or a product with nothing to plan', () => {
    const laminate: PackProduct = { id: 'lam', name: 'Laminate', kind: 'laminate', packCoverageM2: 2 };
    const unused = carpet4({ id: 'unused' });
    const p = project('nothing', { products: [carpet4(), laminate, unused], rooms: [rect('a', 'carpet-4m', 3000, 3000)] });
    expect(compareRollWidths(p, 'lam')).toEqual([]);
    expect(compareRollWidths(p, 'does-not-exist')).toEqual([]);
    expect(compareRollWidths(p, 'unused')).toEqual([]); // no room uses it
    expect(compareRollWidths(emptyProject('e'), 'anything')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Robustness: none of these may throw
// ---------------------------------------------------------------------------

describe('robustness', () => {
  it('an empty project estimates to nothing at all', () => {
    const est = estimateProject(emptyProject('empty'));
    expect(est.rollPlans).toEqual([]);
    expect(est.bom).toEqual([]);
    expect(est.warnings).toEqual([]);
    expect(est.rooms).toEqual({});
    expect(est.staircases).toEqual({});
    expect(est.details.productByOwner).toEqual({});
    expect(est.totals).toEqual({ netAreaM2: 0, materialsCost: 0, labourCost: 0, subtotal: 0, vat: 0, total: 0 });
  });

  it('a room whose product has been deleted is reported and left out of the quantities', () => {
    const est = estimateProject(project('missing', { rooms: [rect('ghost', 'deleted-product', 3000, 3000)] }));
    const errors = est.warnings.filter((w) => w.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('MISSING_PRODUCT');
    expect(errors[0]!.subjectId).toBe('ghost');
    // the room is still measured and summarised (the UI shows it with its error)...
    const summary = est.rooms['ghost'];
    expect(summary).toBeDefined();
    expect(summary!.netAreaM2).toBe(9);
    expect(summary!.pieces).toEqual([]);
    expect(summary!.warnings.map((w) => w.code)).toEqual(['MISSING_PRODUCT']);
    // ... but nothing is ordered, priced or counted for it
    expect(est.details.productByOwner['ghost']).toBeUndefined();
    expect(est.rollPlans).toEqual([]);
    expect(est.bom).toEqual([]);
    expect(est.totals.netAreaM2).toBe(0);
    expect(est.totals.total).toBe(0);
  });

  it('a room with no area is reported and left out of the quantities', () => {
    const est = estimateProject(project('degenerate', { products: [carpet4()], rooms: [rect('flat', 'carpet-4m', 0, 0)] }));
    const errors = est.warnings.filter((w) => w.level === 'error');
    expect(errors.map((w) => w.code)).toEqual(['EMPTY_ROOM']);
    expect(est.rooms['flat']!.netAreaM2).toBe(0);
    expect(est.rooms['flat']!.boundingBox).toEqual({ length: 0, width: 0 });
    expect(est.rollPlans).toEqual([]);
    expect(est.bom).toEqual([]);
    expect(est.totals.subtotal).toBe(0);
  });

  it('one unusable room does not stop the rest of the house being quoted', () => {
    const est = estimateProject(
      project('mixed', {
        products: [carpet4()],
        rooms: [rect('flat', 'carpet-4m', 0, 0), rect('bed', 'carpet-4m', 4200, 3500), rect('ghost', 'deleted', 3000, 3000)],
      }),
    );
    expect(est.warnings.filter((w) => w.level === 'error').map((w) => w.code).sort()).toEqual(['EMPTY_ROOM', 'MISSING_PRODUCT']);
    expect(est.rollPlans).toHaveLength(1);
    expect(est.rollPlans[0]!.pieces.every((p) => p.ownerId === 'bed')).toBe(true);
    // 4.2 x 3.5 m bedroom: one 4.3 x 3.6 m piece off a 4 m roll = 4.3 lm at £80/lm
    const covering = est.bom.find((l) => l.id === 'bom:covering:carpet-4m')!;
    expect(covering.quantity).toBe(4.3);
    expect(covering.total).toBe(344);
    expect(est.totals.netAreaM2).toBeCloseTo(14.7, 6);
  });

  it('nonsense dimensions are treated as no area, not as NaN', () => {
    const est = estimateProject(project('nan', { products: [carpet4()], rooms: [rect('odd', 'carpet-4m', Number.NaN, 3000)] }));
    expect(est.warnings.map((w) => w.code)).toEqual(['EMPTY_ROOM']);
    expect(est.bom).toEqual([]);
    expect(Number.isFinite(est.totals.netAreaM2)).toBe(true);
    expect(est.totals.netAreaM2).toBe(0);
    expect(est.totals.total).toBe(0);
  });

  it('a staircase with no steps is reported, summarised and skipped', () => {
    const est = estimateProject(project('nosteps', { products: [carpet4()], staircases: [staircase('carpet-4m', [])] }));
    const errors = est.warnings.filter((w) => w.level === 'error');
    expect(errors.map((w) => w.code)).toEqual(['NO_STEPS']);
    expect(errors[0]!.subjectId).toBe('stairs');
    const summary = est.staircases['stairs'];
    expect(summary).toBeDefined();
    expect(summary!.stepCount).toBe(0);
    expect(summary!.carpetAreaM2).toBe(0);
    expect(summary!.pieces).toEqual([]);
    expect(est.rollPlans).toEqual([]); // nothing to cut, so nothing to order
    expect(est.bom).toEqual([]);
    expect(est.totals.total).toBe(0);
  });

  it('a staircase whose product has been deleted is reported and skipped', () => {
    const est = estimateProject(project('stairs-missing', { staircases: [staircase('deleted', straightSteps(13))] }));
    expect(est.warnings.map((w) => w.code)).toEqual(['MISSING_PRODUCT']);
    expect(est.staircases['stairs']!.stepCount).toBe(13); // still counted for the UI
    expect(est.details.stairPlans['stairs']).toBeUndefined();
    expect(est.bom).toEqual([]);
  });

  it('a price book of zeros gives a zero quote with the same lines', () => {
    const p = sampleProject();
    for (const key of Object.keys(p.prices.labour) as (keyof typeof p.prices.labour)[]) p.prices.labour[key] = 0;
    for (const key of Object.keys(p.prices.materials) as (keyof typeof p.prices.materials)[]) p.prices.materials[key] = 0;
    for (const product of p.products) {
      if ('pricePerM2' in product) product.pricePerM2 = 0;
      if ('pricePerPack' in product) product.pricePerPack = 0;
    }
    p.options.underlay.pricePerRoll = 0;
    const est = estimateProject(p);
    expect(est.bom.length).toBe(estimateProject(sampleProject()).bom.length);
    expect(est.totals).toMatchObject({ materialsCost: 0, labourCost: 0, subtotal: 0, vat: 0, total: 0 });
    expect(est.totals.netAreaM2).toBeCloseTo(84.036, 3); // the measurements are unaffected
    // every priced line totals zero; recommended lines still carry no total at all
    for (const line of est.bom) {
      if (line.unitPrice === undefined || isRecommended(line)) continue;
      expect(line.total).toBe(0);
    }
  });

  it('an unpriced product still counts the quantities', () => {
    const est = estimateProject(project('unpriced', { products: [carpet4({ pricePerM2: undefined })], rooms: [rect('bed', 'carpet-4m', 4200, 3500)] }));
    const covering = est.bom.find((l) => l.id === 'bom:covering:carpet-4m')!;
    expect(covering.quantity).toBe(4.3);
    expect(covering.unitPrice).toBeUndefined();
    expect(covering.total).toBeUndefined();
    expect(est.totals.materialsCost).toBeGreaterThan(0); // the gripper and underlay are still priced
  });

  it('a duplicated product entry is planned and quoted once', () => {
    const p = project('dup', { products: [carpet4(), carpet4()], rooms: [rect('bed', 'carpet-4m', 4200, 3500)] });
    const est = estimateProject(p);
    expect(est.rollPlans).toHaveLength(1);
    expect(est.bom.filter((l) => l.category === 'floor_covering')).toHaveLength(1);
    const single = estimateProject(project('single', { products: [carpet4()], rooms: [rect('bed', 'carpet-4m', 4200, 3500)] }));
    expect(est.totals).toEqual(single.totals);
  });

  it('a project with rooms but no staircases, and staircases but no rooms, both estimate', () => {
    const roomsOnly = estimateProject(project('rooms-only', { products: [carpet4()], rooms: [rect('bed', 'carpet-4m', 4200, 3500)] }));
    expect(roomsOnly.staircases).toEqual({});
    expect(roomsOnly.totals.total).toBeGreaterThan(0);
    const stairsOnly = estimateProject(project('stairs-only', { products: [carpet4()], staircases: [staircase('carpet-4m', straightSteps(13))] }));
    expect(stairsOnly.rooms).toEqual({});
    expect(stairsOnly.rollPlans).toHaveLength(1);
    expect(stairsOnly.rollPlans[0]!.pieces).toHaveLength(13);
    expect(stairsOnly.totals.total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('estimating the same project twice gives identical JSON', () => {
    const p = sampleProject();
    expect(JSON.stringify(estimateProject(p))).toBe(JSON.stringify(estimateProject(p)));
  });

  it('a fresh sampleProject() estimates identically: no clock, no randomness, no shared state', () => {
    expect(JSON.stringify(estimateProject(sampleProject()))).toBe(JSON.stringify(estimateProject(sampleProject())));
  });

  it('estimating does not mutate the project it is given', () => {
    const p = sampleProject();
    const before = JSON.stringify(p);
    estimateProject(p);
    compareRollWidths(p, P.hallCarpet);
    expect(JSON.stringify(p)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

describe('dedupeWarnings', () => {
  it('drops repeats of the same code, subject and message', () => {
    const w = (code: string, subjectId?: string): Warning => ({ level: 'info', code, message: `${code} happened`, ...(subjectId ? { subjectId } : {}) });
    expect(dedupeWarnings([w('A'), w('A'), w('B'), w('A', 'r1')])).toEqual([w('A'), w('B'), w('A', 'r1')]);
  });

  it('puts errors first, then warnings, keeping the original order within a level', () => {
    const list: Warning[] = [
      { level: 'info', code: 'I1', message: 'i1' },
      { level: 'error', code: 'E1', message: 'e1' },
      { level: 'warning', code: 'W1', message: 'w1' },
      { level: 'error', code: 'E2', message: 'e2' },
    ];
    expect(dedupeWarnings(list).map((x) => x.code)).toEqual(['E1', 'E2', 'W1', 'I1']);
  });
});

describe('buildUpChange', () => {
  const underlay = { ...DEFAULT_UNDERLAY };

  it('compares the new build-up with the old covering', () => {
    // 11 mm carpet + 10 mm underlay = 21 mm over an assumed 10 + 10 mm of old carpet -> +1 mm
    const carpet: BroadloomProduct = { id: 'c', name: 'c', kind: 'carpet', rollWidth: 4000, thickness: 11 };
    expect(buildUpChange(carpet, { type: 'floorboards', condition: 'good', existingCovering: 'carpet' }, underlay)).toBe(1);
    // over bare boards the whole 21 mm is new
    expect(buildUpChange(carpet, { type: 'floorboards', condition: 'good', existingCovering: 'none' }, underlay)).toBe(21);
    // with no underlay fitted, only the carpet counts
    expect(buildUpChange(carpet, { type: 'floorboards', condition: 'good', existingCovering: 'carpet' }, { ...underlay, fit: false })).toBe(-9);
  });

  it('gives up when the old floor cannot be guessed', () => {
    const laminate: PackProduct = { id: 'l', name: 'l', kind: 'laminate', packCoverageM2: 2, thickness: 8 };
    expect(buildUpChange(laminate, { type: 'floorboards', condition: 'good', existingCovering: 'tiles' }, underlay)).toBeUndefined();
    // ... and when the new product has no thickness
    const unknown: PackProduct = { id: 'u', name: 'u', kind: 'laminate', packCoverageM2: 2 };
    expect(buildUpChange(unknown, { type: 'floorboards', condition: 'good', existingCovering: 'none' }, underlay)).toBeUndefined();
  });
});

describe('fittingLabour', () => {
  it('prices each covering at its own rate', () => {
    const labour = DEFAULT_PRICES.labour;
    expect(fittingLabour('carpet', labour).rate).toBe(labour.carpetFittingPerM2);
    expect(fittingLabour('sheet_vinyl', labour).rate).toBe(labour.vinylFittingPerM2);
    expect(fittingLabour('engineered_wood', labour).key).toBe('laminate'); // one rate for boards
    expect(fittingLabour('lvt_click', labour).key).toBe('lvt');
    expect(fittingLabour('lvt_glue', labour).rate).toBe(labour.lvtFittingPerM2);
    // carpet tiles borrow the carpet rate, and say so
    const tiles = fittingLabour('carpet_tiles', labour);
    expect(tiles.rate).toBe(labour.carpetFittingPerM2);
    expect(tiles.note).toBeDefined();
  });
});


// ---------------------------------------------------------------------------
// Regressions: things the quote used to get wrong
// ---------------------------------------------------------------------------

describe('regressions', () => {
  const carpet: BroadloomProduct = { id: 'c', name: 'Carpet 4 m', kind: 'carpet', rollWidth: 4000, cutIncrement: CUT_INCREMENT, maxRollLength: CARPET_MAX_ROLL_LENGTH, thickness: 10, pricePerM2: 18 };

  function house(rooms: Room[], staircases: Staircase[] = [], products: Project['products'] = [carpet]): Project {
    const p = emptyProject('reg');
    p.products = products;
    p.rooms = rooms;
    p.staircases = staircases;
    return p;
  }

  const plainRoom = (id: string, name: string, doorways: Room['doorways'] = []): Room => ({
    id,
    name,
    shape: { kind: 'rectangle', length: 3000, width: 3000 },
    doorways,
    productId: 'c',
    subfloor: { type: 'floorboards', condition: 'good' },
  });

  it('buys one bar per opening however the doorways are labelled', () => {
    // Four rooms built the way the app builds them, all with a doorway the user called "Door".
    // Matching on the label used to collapse them into a single bar and drop three doorways.
    const rooms = ['1', '2', '3', '4'].map((n) =>
      plainRoom(`r${n}`, `Room ${n}`, [{ id: `d${n}`, edgeIndex: 0, offset: 200, width: 900, transition: 'carpet', label: 'Door' }]),
    );
    const est = estimateProject(house(rooms));
    expect(est.details.doorBars.standardBars).toBe(4);
    expect(est.warnings.filter((w) => w.code === 'DOORWAY_SHARED')).toHaveLength(0);
  });

  it('counts an opening entered from both rooms once, for the bar AND the door easing', () => {
    const hall = plainRoom('hall', 'Hall', [{ id: 'd1', edgeIndex: 0, offset: 200, width: 838, transition: 'carpet', sharedOpeningId: 'op', label: 'Lounge door' }]);
    const lounge = plainRoom('lng', 'Lounge', [{ id: 'd2', edgeIndex: 0, offset: 200, width: 838, transition: 'carpet', sharedOpeningId: 'op', label: 'Hall door' }]);
    const est = estimateProject(house([hall, lounge]));
    expect(est.details.doorBars.standardBars).toBe(1);
    expect(est.details.doorBars.bars).toHaveLength(1);
  });

  it('reports a doorway whose wall no longer exists and leaves it out of the quantities', () => {
    // an 8-wall room converted to a rectangle leaves stale edge indices behind
    const room = plainRoom('r', 'Room', [{ id: 'd', edgeIndex: 6, offset: 100, width: 900, transition: 'carpet', label: 'Ghost door' }]);
    const est = estimateProject(house([room]));
    expect(est.warnings.map((w) => w.code)).toContain('DOORWAY_OFF_EDGE');
    // no bar is bought for it, and the gripper runs the whole perimeter
    expect(est.details.doorBars.bars).toHaveLength(0);
    expect(est.rooms.r!.gripperPerimeter).toBe(12000);
  });

  it('flags two openings that overlap on one wall and counts the hole once', () => {
    const room = plainRoom('r', 'Room', [
      { id: 'a', edgeIndex: 0, offset: 100, width: 900, transition: 'carpet' },
      { id: 'b', edgeIndex: 0, offset: 200, width: 900, transition: 'carpet' },
    ]);
    const est = estimateProject(house([room]));
    expect(est.warnings.map((w) => w.code)).toContain('DOORWAY_OVERLAP');
    expect(est.rooms.r!.gripperPerimeter).toBe(12000 - 1000);
  });

  it('reports an outline that crosses itself instead of quoting it', () => {
    const room: Room = {
      id: 'r',
      name: 'Bowtie',
      shape: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 4000, y: 0 },
          { x: 1000, y: 3000 },
          { x: 3000, y: 3000 },
        ],
      },
      doorways: [],
      productId: 'c',
      subfloor: { type: 'floorboards', condition: 'good' },
    };
    const est = estimateProject(house([room]));
    expect(est.warnings.map((w) => w.code)).toContain('SELF_INTERSECTING');
    expect(est.rollPlans).toHaveLength(0);
  });

  it('warns when a recess is deeper than the room rather than over-ordering from a broken outline', () => {
    const room: Room = {
      id: 'r',
      name: 'Lounge',
      shape: { kind: 'rectangle_with_features', length: 4000, width: 3000, features: [{ id: 'f', wall: 'bottom', offset: 1000, width: 1400, depth: -3500, label: 'Chimney breast' }] },
      doorways: [],
      productId: 'c',
      subfloor: { type: 'floorboards', condition: 'good' },
    };
    const est = estimateProject(house([room]));
    expect(est.warnings.map((w) => w.code)).toContain('FEATURE_TOO_DEEP');
    // the outline is clamped to the room, so the bounding box is not 500 mm too deep
    expect(est.rooms.r!.boundingBox.width).toBe(3000);
  });

  it('does not hang, and reports an error, when a product has no roll width', () => {
    const est = estimateProject(house([plainRoom('r', 'Room')], [], [{ ...carpet, rollWidth: 0 }]));
    expect(est.warnings.map((w) => w.code)).toContain('INVALID_ROLL_WIDTH');
    expect(est.totals.total).toBeGreaterThanOrEqual(0);
  });

  it('surfaces a line it cannot quantify instead of dropping it silently', () => {
    // a non-finite allowance used to make every piece NaN: the carpet line vanished, the quote still
    // totalled up underlay, gripper and fitting labour, and not one warning was raised.
    const p = house([plainRoom('r', 'Room')]);
    p.options.broadloom = { ...p.options.broadloom, lengthAllowance: Number.NaN };
    const est = estimateProject(p);
    expect(est.warnings.some((w) => w.level === 'error')).toBe(true);
    expect(est.bom.every((l) => Number.isFinite(l.quantity) && l.quantity > 0)).toBe(true);
  });

  it('strips, skips and pulls the gripper on the stairs as well as the rooms', () => {
    const stairs: Staircase = {
      id: 'st',
      name: 'Stairs',
      productId: 'c',
      steps: Array.from({ length: 13 }, (_, i) => ({ id: `s${i + 1}`, kind: 'straight', rise: 200, going: 223, width: 860 }) as Step),
      landings: [],
      method: 'cap_and_band',
      openSides: 'none',
      subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true },
    };
    const est = estimateProject(house([], [stairs]));
    const uplift = est.bom.find((l) => l.id === 'bom:labour:uplift')!;
    expect(uplift.subjectIds).toContain('st');
    expect(uplift.quantity).toBeGreaterThan(0);
    expect(est.bom.find((l) => l.id === 'bom:labour:disposal')!.subjectIds).toContain('st');
    // and the old stair gripper is a line of its own rather than a £0 entry
    const removal = est.bom.find((l) => l.id.startsWith('bom:labour:gripper_removal'))!;
    expect(removal.unitPrice).toBe(DEFAULT_PRICES.labour.gripperRemovalPerM);
  });

  it('a staircase gets stair preparation, not room preparation: no latex, primer or ply on a flight', () => {
    // The whole room rule table used to run over a staircase pushed into planFloorPrep: £125 of
    // self-levelling compound poured down a flight of stairs, and two sheets of ply laid on it.
    const stairs: Staircase = {
      id: 'st',
      name: 'Stairs',
      productId: 'c',
      steps: Array.from({ length: 13 }, (_, i) => ({ id: `s${i + 1}`, kind: 'straight', rise: 200, going: 223, width: 860 }) as Step),
      landings: [],
      method: 'cap_and_band',
      openSides: 'none',
      subfloor: { type: 'concrete', condition: 'poor', existingCovering: 'carpet', existingGripper: true, dpmKnown: true },
    };
    const est = estimateProject(house([], [stairs]));
    const stairLines = est.bom.filter((l) => (l.subjectIds ?? []).includes('st')).map((l) => l.description);
    for (const banned of ['Latex', 'Primer', 'Plywood', 'Ply fixing', 'Hardboard', 'smoothing compound', 'skirting', 'DPM']) {
      expect([banned, stairLines.some((d) => d.includes(banned))]).toEqual([banned, false]);
    }
    // what a flight DOES need is still there
    expect(stairLines.some((d) => /Uplift/.test(d))).toBe(true);
    expect(stairLines.some((d) => /Remove existing gripper/.test(d))).toBe(true);
  });

  it('buys new gripper and charges for taking the old gripper up: the two lines have to agree', () => {
    // The quote used to buy a full set of new gripper for every carpet room while showing the old
    // gripper's removal as "recommended, excluded" — you cannot fit new gripper over the old.
    const room = plainRoom('r', 'Room');
    room.subfloor = { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true };
    const est = estimateProject(house([room]));
    const newGripper = est.bom.find((l) => l.id.startsWith('bom:gripper:'))!;
    expect(newGripper.quantity).toBeGreaterThan(0);
    const removal = est.bom.find((l) => l.id.startsWith('bom:labour:gripper_removal'))!;
    expect(removal.notes ?? '').not.toContain(RECOMMENDED);
    expect(removal.total).toBeGreaterThan(0);
    expect(est.bom.find((l) => l.id.startsWith('bom:prep:gripper_removal'))!.id).toContain(':required:');
  });

  it('eases the door leaf when EITHER side of a shared opening needs it', () => {
    // Pairing two rooms with sharedOpeningId used to credit the leaf to whichever room won the door
    // BAR: where that side needed no easing and the other did, the door vanished from the quote.
    const tiles: PackProduct = { id: 'ct', name: 'Carpet tiles', kind: 'carpet_tiles', packCoverageM2: 5, thickness: 6, pricePerPack: 60 };
    const study = plainRoom('study', 'Study', [{ id: 'ds', edgeIndex: 0, offset: 500, width: 838, transition: 'carpet', sharedOpeningId: 'op' }]);
    study.productId = 'ct';
    // carpet tiles over old carpet: 6 mm replacing 20 mm of carpet + underlay, so nothing to ease
    study.subfloor = { type: 'concrete', condition: 'good', existingCovering: 'carpet', dpmKnown: true };
    const lounge = plainRoom('lounge', 'Lounge', [{ id: 'dl', edgeIndex: 0, offset: 500, width: 838, transition: 'carpet', sharedOpeningId: 'op' }]);
    lounge.subfloor = { type: 'concrete', condition: 'good', existingCovering: 'vinyl', dpmKnown: true };

    const paired = estimateProject(house([study, lounge], [], [carpet, tiles]));
    const easing = paired.bom.filter((l) => /Ease \/ trim doors/.test(l.description));
    expect(easing.length).toBeGreaterThan(0);
    // one leaf, not two: the opening is still counted once
    expect(easing.every((l) => l.quantity === 1)).toBe(true);

    // and the same two rooms with the opening left unpaired agree
    const loneLounge = { ...lounge, doorways: [{ id: 'dl', edgeIndex: 0, offset: 500, width: 838, transition: 'carpet' as const }] };
    const unpaired = estimateProject(house([study, loneLounge], [], [carpet, tiles]));
    expect(unpaired.bom.filter((l) => /Ease \/ trim doors/.test(l.description)).length).toBe(easing.length);
  });

  it('eases an external door too: a front door swings inward over the new floor', () => {
    const hall = plainRoom('hall', 'Hall', [{ id: 'd', edgeIndex: 0, offset: 500, width: 900, transition: 'external', label: 'Front door' }]);
    hall.subfloor = { type: 'concrete', condition: 'good', existingCovering: 'vinyl', dpmKnown: true };
    const est = estimateProject(house([hall]));
    const easing = est.bom.find((l) => l.id.startsWith('bom:labour:door_easing'))!;
    expect(easing.quantity).toBe(1);
    // an opening with nothing on the other side still has no leaf to ease
    const wardrobe = plainRoom('w', 'Wardrobe recess', [{ id: 'd2', edgeIndex: 0, offset: 500, width: 900, transition: 'none' }]);
    wardrobe.subfloor = hall.subfloor;
    expect(estimateProject(house([wardrobe])).bom.find((l) => l.id.startsWith('bom:labour:door_easing'))).toBeUndefined();
  });

  it('absorbs a de-minimis minimum-charge shortfall instead of printing a 20p line', () => {
    const stairs: Staircase = {
      id: 'st',
      name: 'Stairs',
      productId: 'c',
      steps: Array.from({ length: 13 }, (_, i) => ({ id: `s${i + 1}`, kind: 'straight', rise: 200, going: 223, width: 860 }) as Step),
      landings: [],
      method: 'cap_and_band',
      openSides: 'none',
    };
    // 13 steps at £12 = £156 of labour; against a £158 minimum the shortfall is £2, which is not a
    // line item — "Minimum job charge, 1 each @ 0.20" with a paragraph of explanation is not
    // something anyone sends a customer.
    const p = house([], [stairs]);
    p.prices = { ...p.prices, labour: { ...p.prices.labour, minimumJobLabour: 158 } };
    const est = estimateProject(p);
    expect(est.totals.labourCost).toBe(156);
    expect(est.bom.find((l) => l.id === 'bom:labour:minimum')).toBeUndefined();

    // a shortfall worth charging for is still charged, and lifts the total to the minimum
    const real = house([], [stairs]);
    const realEst = estimateProject(real);
    const minimum = realEst.bom.find((l) => l.id === 'bom:labour:minimum')!;
    expect(minimum.total).toBeGreaterThan(MINIMUM_JOB_DE_MINIMIS);
    expect(realEst.totals.labourCost).toBe(real.prices.labour.minimumJobLabour);
  });

  it('names the two features when a pair of recesses meet in a corner', () => {
    const room: Room = {
      id: 'r',
      name: 'Odd room',
      shape: {
        kind: 'rectangle_with_features',
        length: 2493,
        width: 2672,
        features: [
          { id: 'f1', wall: 'left', offset: 536, width: 481, depth: -971, label: 'Meter cupboard' },
          { id: 'f2', wall: 'bottom', offset: 2285, width: 1149, depth: -1839, label: 'Chimney breast' },
        ],
      },
      doorways: [],
      productId: 'c',
      subfloor: { type: 'floorboards', condition: 'good' },
    };
    const est = estimateProject(house([room]));
    const why = est.warnings.find((w) => w.code === 'SELF_INTERSECTING')!;
    expect(why.message).toContain('Meter cupboard');
    expect(why.message).toContain('Chimney breast');
    expect(why.message).not.toContain('points in the wrong order');
  });

  it('never lists a required item with no price and no labour counterpart', () => {
    const est = estimateProject(sampleProject());
    for (const line of est.bom) {
      if (line.notes?.startsWith('Recommended')) continue;
      const priced = line.total !== undefined;
      const explained = line.notes?.includes('Priced under labour below.') || line.notes?.includes('No charge') || line.notes?.includes('Included in the fitting rate.');
      expect([line.description, priced || explained]).toEqual([line.description, true]);
    }
  });

  it('reports the sample lounge and kitchen as seam-free at the width that suits them', () => {
    const project = sampleProject();
    const lounge = compareRollWidths(project, P.loungeCarpet);
    expect(lounge.find((r) => r.rollWidth === 4000)!.seams).toBe(0);
    const kitchen = compareRollWidths(project, P.kitchenVinyl);
    expect(kitchen.find((r) => r.rollWidth === 4000)!.seams).toBe(0);
    // and every row's seam count matches what that width's plan actually cuts
    for (const row of lounge) expect(row.seams).toBeGreaterThanOrEqual(0);
  });

  it('makes up a small over-run from the offcuts instead of buying another whole unit', () => {
    // Continuous goods only (gripper packs, beading lengths, foam underlay rolls): 4.02 units used
    // to buy FIVE — a whole unit to supply 219 mm. Carpet underlay and rigid packs round up instead.
    const over = wholeUnitsWithTolerance(44_219, 11_000);
    expect(over.units).toBe(4);
    expect(over.shortfall).toBeCloseTo(219, 6);
    // a real shortfall still rounds up
    expect(wholeUnitsWithTolerance(48_000, 11_000)).toEqual({ units: 5, shortfall: 0 });
    // and the first unit is never rounded away
    expect(wholeUnitsWithTolerance(100, 11_000)).toEqual({ units: 1, shortfall: 0 });
    expect(wholeUnitsWithTolerance(0, 11_000)).toEqual({ units: 0, shortfall: 0 });
  });
});
