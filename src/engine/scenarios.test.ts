/**
 * End-to-end scenarios: ten jobs a UK flooring estimator actually quotes, priced through
 * `estimateProject` from top to bottom.
 *
 * These are deliberately NOT unit tests. Each scenario builds a whole `Project` inline from
 * `emptyProject()` — explicit products, rooms, staircases, the engine's own `DEFAULT_*` options and
 * price book — so every figure below is fully determined by the input, and asserts CONCRETE
 * numbers. The arithmetic that produces each number is written out in a comment above the
 * assertion: if the engine and the comment ever disagree, one of them is wrong and the test says
 * so. Nothing here is a "> 0" smoke check.
 *
 * Conventions used throughout (from `defaults.ts`, all user-editable in the real tool):
 * - lengthAllowance 100 mm and widthAllowance 100 mm on every broadloom piece;
 * - cut lengths sold in 100 mm increments (`CUT_INCREMENT`); seamPolicy 'balanced' with a 1 m²
 *   threshold, so a narrow fill is cut as cross-joined segments when that saves over 1 m²;
 * - underlay 1.37 m x 11 m rolls; gripper 1.52 m lengths with 10 % cutting wastage;
 * - a stair step is rise + going + nosing (+ 30 mm tuck, + 75 mm more for cap and band) long and
 *   tread width + 100 mm wide.
 */
import { estimateProject, compareRollWidths, type ProjectEstimate } from './estimate';
import { emptyProject } from './fixtures';
import { serializeProject, parseProject } from './serialize';
import {
  CARPET_MAX_ROLL_LENGTH,
  VINYL_MAX_ROLL_LENGTH,
  CUT_INCREMENT,
  DEFAULT_PRICES,
  DEFAULT_UNDERLAY,
} from './defaults';
import type { BomLine, BroadloomProduct, Mm, PackProduct, Project, Room, Staircase, Step, Warning } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An empty project (default options and prices) with the given contents dropped in. */
function project(id: string, patch: Partial<Project>): Project {
  return { ...emptyProject(id), ...patch };
}

/** The BOM line with this id (the `bom:` prefix is added), or a failure naming what was there. */
function bomLine(est: ProjectEstimate, id: string): BomLine {
  const line = est.bom.find((l) => l.id === `bom:${id}`);
  if (!line) throw new Error(`no BOM line "${id}"; the quote has: ${est.bom.map((l) => l.id).join(', ')}`);
  return line;
}

const hasLine = (est: ProjectEstimate, id: string): boolean => est.bom.some((l) => l.id === `bom:${id}`);
const codes = (warnings: Warning[]): string[] => warnings.map((w) => w.code);
const linesIn = (est: ProjectEstimate, category: BomLine['category']): BomLine[] => est.bom.filter((l) => l.category === category);

/** 13 identical straight steps: 200 mm rise, 223 mm going, 860 mm wide (the UK domestic norm). */
function straightSteps(count: number, width: Mm = 860): Step[] {
  return Array.from({ length: count }, (_, i) => ({ id: `step-${i + 1}`, kind: 'straight' as const, rise: 200, going: 223, width }));
}

// ---------------------------------------------------------------------------
// 1. A single carpeted bedroom, end to end
// ---------------------------------------------------------------------------

describe('scenario 1: one 4.2 x 3.5 m bedroom, 4 m carpet, timber floor, old carpet up', () => {
  const carpet: BroadloomProduct = {
    id: 'carpet-4m',
    name: 'Bedroom saxony 4 m',
    kind: 'carpet',
    rollWidth: 4000,
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 10,
    pricePerM2: 18,
  };
  const bedroom: Room = {
    id: 'bedroom',
    name: 'Bedroom',
    shape: { kind: 'rectangle', length: 4200, width: 3500 },
    // one 2'6" (762 mm) door onto the carpeted landing, on the top wall
    doorways: [{ id: 'door-bed', edgeIndex: 0, offset: 1000, width: 762, transition: 'carpet', label: 'Bedroom door' }],
    productId: carpet.id,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: false, dpmKnown: true },
  };
  const est = estimateProject(project('scenario-1', { products: [carpet], rooms: [bedroom] }));

  it('cuts one 4.3 x 3.6 m piece and orders 4.3 lm off a 4 m roll', () => {
    const plan = est.rollPlans[0]!;
    expect(est.rollPlans).toHaveLength(1);
    // The room is 3.5 m across, so it fits the 4 m roll in one piece: no seam.
    // piece length  = 4200 (room) + 100 (trim allowance)          = 4300
    // piece width   = 3500 (room) + 100 (trim allowance)          = 3600 (under the 4000 roll width)
    expect(plan.pieces).toHaveLength(1);
    expect(plan.pieces[0]).toMatchObject({ label: 'Main piece', length: 4300, width: 3600, role: 'main' });
    expect(plan.seamsByRoom['bedroom']).toEqual([]);
    // one cut of 4300 mm, already a multiple of the 100 mm increment
    expect(plan.orderLength).toBe(4300);
    expect(plan.rollsRequired).toBe(1);
    // ordered 4.3 lm x 4.0 m = 17.2 m² against 4.2 x 3.5 = 14.7 m² net
    expect(plan.orderedAreaM2).toBeCloseTo(17.2, 6);
    expect(plan.netAreaM2).toBeCloseTo(14.7, 6);
    // waste = (17.2 - 14.7) / 17.2 = 14.53 %
    expect(plan.wasteFraction).toBeCloseTo(2.5 / 17.2, 6);
  });

  it('prices the carpet by the linear metre at the roll width', () => {
    // £18/m² x 4 m roll width = £72 per linear metre; 4.3 lm x £72 = £309.60
    const covering = bomLine(est, 'covering:carpet-4m');
    expect(covering).toMatchObject({ quantity: 4.3, unit: 'lm', unitPrice: 72, total: 309.6 });
  });

  it('takes 12.6 m of underlay off the roll — 2 rolls — and 1 roll of joining tape', () => {
    // 1.37 m wide underlay across the 3.5 m width: ceil(3500 / 1370) = 3 strips, each 4.2 m long
    //   -> 3 x 4200 = 12 600 mm (the other way round, 4 strips x 3.5 m = 14.0 m, is worse)
    // rolls = ceil(12 600 / 11 000) = 2;  joins = 2 x 4.2 m = 8.4 m -> 1 roll of 50 m tape
    const underlay = est.details.underlay!;
    expect(underlay.perOwner[0]!.strips).toBe(3);
    expect(underlay.stripLengthMm).toBe(12600);
    expect(underlay.rolls).toBe(2);
    expect(underlay.tapeLength).toBe(8400);
    expect(bomLine(est, 'underlay:carpet')).toMatchObject({ quantity: 2, unit: 'roll', unitPrice: DEFAULT_UNDERLAY.pricePerRoll, total: 150 });
    expect(bomLine(est, 'tape:underlay')).toMatchObject({ quantity: 1, unit: 'roll' });
  });

  it('grips the perimeter less the doorway, plus 10 % wastage: 11 lengths', () => {
    // perimeter 2 x (4.2 + 3.5) = 15.4 m, less the 762 mm opening = 14 638 mm
    // x 1.10 wastage = 16 101.8 -> 16 102 mm;  16 102 / 1520 = 10.59 -> 11 lengths (2 packs of 10)
    const gripper = est.details.gripper!;
    expect(gripper.byPin.timber).toBe(16102);
    expect(gripper.byPin.concrete).toBe(0); // timber pins on floorboards
    const line = bomLine(est, 'gripper:timber');
    expect(line).toMatchObject({ quantity: 11, unit: 'length', unitPrice: 1.2, total: 13.2 });
    expect(line.notes).toContain('2 packs of 10');
  });

  it('fits one double-sided carpet door bar at the 762 mm opening', () => {
    // carpet to carpet -> a double-sided bar; 762 mm fits one standard 900 mm bar
    expect(est.details.doorBars.bars).toHaveLength(1);
    expect(est.details.doorBars.bars[0]).toMatchObject({ type: 'double_carpet', width: 762, bars: 1, longBars: 0 });
    expect(bomLine(est, 'doorbar:double_carpet')).toMatchObject({ quantity: 1, unit: 'each', unitPrice: 8, total: 8 });
  });

  it('lifts and tips 14.7 m² of old carpet and charges fitting on the same area', () => {
    // uplift and disposal are the room's net area, priced at £2 and £3 per m²
    expect(bomLine(est, 'prep:uplift:required:uplift-existing-floor-covering')).toMatchObject({ quantity: 14.7, unit: 'm²' });
    expect(bomLine(est, 'prep:disposal:required:dispose-of-old-floor-covering')).toMatchObject({ quantity: 14.7, unit: 'm²' });
    expect(bomLine(est, 'labour:uplift')).toMatchObject({ quantity: 14.7, unitPrice: 2, total: 29.4 });
    expect(bomLine(est, 'labour:disposal')).toMatchObject({ quantity: 14.7, unitPrice: 3, total: 44.1 });
    // fitting 14.7 m² x £5/m² = £73.50
    expect(bomLine(est, 'labour:fitting:carpet')).toMatchObject({ quantity: 14.7, unitPrice: DEFAULT_PRICES.labour.carpetFittingPerM2, total: 73.5 });
  });

  it('adds the priced lines up to the quoted total', () => {
    // materials 309.60 + 150 + 13.20 + 8 + 5 (underlay tape)        = 485.80
    // labour     73.50 + 29.40 + 44.10                              = 147.00
    // subtotal 632.80; VAT at 20 % = 126.56; total 759.36
    expect(est.totals.materialsCost).toBe(485.8);
    expect(est.totals.labourCost).toBe(147);
    expect(est.totals.subtotal).toBe(632.8);
    expect(est.totals.vat).toBe(126.56);
    expect(est.totals.total).toBe(759.36);
    expect(est.totals.netAreaM2).toBeCloseTo(14.7, 6);
  });

  it('raises nothing worse than an information note', () => {
    // sound floorboards under carpet need no preparation at all
    expect(codes(est.warnings)).toEqual(['UNDERLAY_ON_BOARDS']);
    expect(est.warnings.every((w) => w.level === 'info')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Is the 5 m roll worth it?
// ---------------------------------------------------------------------------

describe('scenario 2: a 5.0 x 6.0 m lounge — 4 m roll versus 5 m roll', () => {
  const carpet: BroadloomProduct = {
    id: 'lounge-carpet',
    name: 'Lounge twist',
    kind: 'carpet',
    rollWidth: 4000,
    alternativeRollWidths: [5000],
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 10,
    pricePerM2: 20,
  };
  const lounge: Room = {
    id: 'lounge',
    name: 'Lounge',
    shape: { kind: 'rectangle', length: 5000, width: 6000 },
    doorways: [],
    productId: carpet.id,
    subfloor: { type: 'floorboards', condition: 'good' },
  };
  const proj = project('scenario-2', { products: [carpet], rooms: [lounge] });
  const comparison = compareRollWidths(proj, 'lounge-carpet');
  const at4m = comparison.find((c) => c.rollWidth === 4000)!;
  const at5m = comparison.find((c) => c.rollWidth === 5000)!;

  it('compares the two standard UK carpet widths', () => {
    expect(comparison.map((c) => c.rollWidth)).toEqual([4000, 5000]);
  });

  it('needs a seam on the 4 m roll: 8.2 lm', () => {
    // Pile runs along the 6 m side, so the 5 m width has to be covered across the roll:
    //   main piece   4000 mm of the width (capped at the roll width), 6000 + 100 = 6100 long
    //   fill         the remaining 1000 mm + 100 allowance = 1100 wide, 6100 long
    // 'balanced' then cross-joins the fill, because segments cut side by side save over 1 m²:
    //   3 segments of ceil(6100 / 3) + 50 (join trim) = 2084 mm, laid 3 x 1100 = 3300 across the roll
    // cuts: 6100 (the main piece) + 2084 (the three segments) = 8184 -> 8200 to the 100 mm increment
    expect(at4m.orderLength).toBe(8200);
    expect(at4m.rollsRequired).toBe(1);
    // 1 side seam down the room + 2 cross joins in the fill
    expect(at4m.seams).toBe(3);
    // 8.2 lm x 4 m = 32.8 m² ordered for 30 m² net
    expect(at4m.orderedAreaM2).toBeCloseTo(32.8, 6);
    expect(at4m.wasteFraction).toBeCloseTo(2.8 / 32.8, 6);
  });

  it('has no seam at all on the 5 m roll: 6.1 lm', () => {
    // The 5 m width fits the 5 m roll exactly (no trim to spare — hence TIGHT_WIDTH):
    // one piece 6000 + 100 = 6100 long x the full 5 m roll width, ordered as 6.1 lm.
    expect(at5m.orderLength).toBe(6100);
    expect(at5m.seams).toBe(0);
    expect(at5m.rollsRequired).toBe(1);
    // ordered area = 6.1 lm x 5.0 m = 30.5 m²
    expect(at5m.orderedAreaM2).toBeCloseTo(30.5, 6);
    // 30.5 ordered against 30.0 net = 1.64 % waste
    expect(at5m.wasteFraction).toBeCloseTo(0.5 / 30.5, 6);
    expect(codes(at5m.warnings)).toContain('TIGHT_WIDTH');
  });

  it('shows the 5 m roll saving 2.3 m² of carpet and both seams', () => {
    // 32.8 - 30.5 = 2.3 m² less carpet, and 3 fewer joins to make
    expect(at4m.orderedAreaM2 - at5m.orderedAreaM2).toBeCloseTo(2.3, 6);
    expect(at4m.seams - at5m.seams).toBe(3);
    // the quote itself is built on the product's own 4 m width
    expect(estimateProject(proj).rollPlans[0]!.orderLength).toBe(at4m.orderLength);
  });
});

// ---------------------------------------------------------------------------
// 3. Hall, stairs and landing off one roll
// ---------------------------------------------------------------------------

describe('scenario 3: hall + L-shaped landing + a 13-riser stair, all one carpet, cap and band', () => {
  const carpet: BroadloomProduct = {
    id: 'hsl-carpet',
    name: 'Hall, stairs & landing heavy domestic 4 m',
    kind: 'carpet',
    rollWidth: 4000,
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 11,
    pricePerM2: 22,
  };
  const hall: Room = {
    id: 'hall',
    name: 'Hall',
    shape: { kind: 'rectangle', length: 4000, width: 1000 },
    doorways: [],
    productId: carpet.id,
    subfloor: { type: 'floorboards', condition: 'good' },
  };
  const landing: Room = {
    id: 'landing',
    name: 'Landing',
    // 3.0 x 2.0 overall with a 1.8 x 1.1 bite out of the top-right corner: 6.0 - 1.98 = 4.02 m²
    shape: { kind: 'l_shape', length: 3000, width: 2000, cutoutLength: 1800, cutoutWidth: 1100, cutoutCorner: 'top-right' },
    doorways: [],
    productId: carpet.id,
    subfloor: { type: 'floorboards', condition: 'good' },
  };
  const stairs: Staircase = {
    id: 'stairs',
    name: 'Stairs',
    productId: carpet.id,
    steps: straightSteps(13, 860),
    landings: [],
    method: 'cap_and_band',
    openSides: 'none',
    nosingOverhang: 20,
    subfloor: { type: 'floorboards', condition: 'good' },
  };
  const combined = project('scenario-3', { products: [carpet], rooms: [hall, landing], staircases: [stairs] });
  const est = estimateProject(combined);
  const plan = est.rollPlans[0]!;

  it('puts the hall, the landing and 13 stair pieces on one roll plan', () => {
    expect(est.rollPlans).toHaveLength(1);
    const owners = plan.pieces.map((p) => p.ownerId);
    expect(owners).toContain('hall');
    expect(owners).toContain('landing');
    expect(owners.filter((o) => o === 'stairs')).toHaveLength(13); // one per riser
    // hall: 4.0 x 1.0 -> a single 1100 x 4000 piece (1000 + 100 trim across, the full roll width along)
    expect(plan.pieces.filter((p) => p.ownerId === 'hall')).toEqual([
      expect.objectContaining({ label: 'Main piece', length: 1100, width: 4000 }),
    ]);
    // landing: the L is covered by a 1300 x 1200 main piece plus a cross-joined 1000 mm fill
    expect(plan.pieces.filter((p) => p.ownerId === 'landing')).toHaveLength(3);
  });

  it('cuts every step 548 x 960 mm — except the top riser, which has no going', () => {
    // wrap over one step = rise 200 + going 223 + nosing overhang 20            = 443
    // cut length        = 443 + 30 (tuck) + 75 (cap-and-band wrap under nosing) = 548
    // cut width         = tread 860 + 100 (50 mm tuck against each closed string) = 960
    const stairPieces = plan.pieces.filter((p) => p.ownerId === 'stairs');
    expect(stairPieces.filter((p) => p.length === 548 && p.width === 960)).toHaveLength(12);
    // Step 13 is the top riser: its "tread" is the landing, so it has no going —
    // wrap = 200 + 20 = 220, cut length = 220 + 30 + 75 = 325 (still 960 wide).
    expect(stairPieces.find((p) => p.label === 'Step 13')).toMatchObject({ length: 325, width: 960 });
    expect(stairPieces.every((p) => p.role === 'stair_step')).toBe(true);
  });

  it('gets four steps side by side across the 4 m roll', () => {
    // 4 x 960 = 3840 mm fits a 4000 mm roll with 160 mm to spare; a fifth (4800) would not.
    expect(4 * 960).toBeLessThanOrEqual(4000);
    expect(5 * 960).toBeGreaterThan(4000);
    const stepCuts = plan.cuts.filter((c) => c.length === 548);
    expect(stepCuts).toHaveLength(3); // 12 identical steps in 3 cuts of 4
    for (const cut of stepCuts) {
      expect(cut.pieces).toHaveLength(4);
      expect(cut.offcut).toEqual({ width: 160, length: 548 });
    }
  });

  it('orders no more carpet combined than planning the rooms and the stairs separately', () => {
    // rooms alone:  1600 (landing fill segments, 3 across) + 1100 (hall)        = 2700 mm
    // stairs alone: 3 cuts of 548 (four steps each) + 325 (the top riser)       = 1969 -> 2000 mm
    // separately 2700 + 2000 = 4700; together the packer gets the same 4700, because the
    // 548 mm step cuts leave only a 160 mm strip that no room piece can use.
    const roomsOnly = estimateProject({ ...combined, staircases: [] }).rollPlans[0]!;
    const stairsOnly = estimateProject({ ...combined, rooms: [] }).rollPlans[0]!;
    expect(roomsOnly.orderLength).toBe(2700);
    expect(stairsOnly.orderLength).toBe(2000);
    expect(plan.orderLength).toBe(4700);
    expect(plan.orderLength).toBeLessThanOrEqual(roomsOnly.orderLength + stairsOnly.orderLength);
  });

  it('quantifies the stair carpet, gripper and underlay', () => {
    const summary = est.staircases['stairs']!;
    expect(summary.stepCount).toBe(13);
    // carpet on the treads and risers = 12 x 443 x 860 + 220 x 860 = 4 760 960 mm² = 4.76096 m²
    expect(summary.carpetAreaM2).toBeCloseTo(4.76096, 6);
    // gripper: one length on each tread and each riser = 13 x 2 x 860 = 22 360 mm, x 1.10 = 24 596
    expect(summary.gripperLength).toBe(24596);
    // underlay pads: 12 x (200 + 223) x 860 + 200 x 860 = 4 537 360 mm² = 4.53736 m²
    expect(summary.underlayAreaM2).toBeCloseTo(4.53736, 6);
    expect(summary.bindingLength).toBe(0); // closed strings both sides: nothing to bind
    // 13 steps of fitting at £12 a step
    expect(bomLine(est, 'labour:stairs')).toMatchObject({ quantity: 13, unit: 'step', unitPrice: 12, total: 156 });
  });
});

// ---------------------------------------------------------------------------
// 4. A laminate box room
// ---------------------------------------------------------------------------

describe('scenario 4: a 2.6 x 2.4 m box room in 8 mm laminate, straight lay', () => {
  const laminate: PackProduct = {
    id: 'laminate-oak',
    name: 'Oak effect laminate 8 mm',
    kind: 'laminate',
    packCoverageM2: 2.22,
    boardLength: 1285,
    boardWidth: 192,
    boardsPerPack: 9,
    thickness: 8,
    pricePerPack: 24,
  };
  const boxRoom: Room = {
    id: 'box',
    name: 'Box room',
    shape: { kind: 'rectangle', length: 2600, width: 2400 },
    doorways: [{ id: 'door-box', edgeIndex: 0, offset: 200, width: 686, transition: 'carpet', label: 'Box room door' }],
    productId: laminate.id,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'none' },
    hardFloor: { layPattern: 'straight', useBeading: true },
  };
  const est = estimateProject(project('scenario-4', { products: [laminate], rooms: [boxRoom] }));
  const plan = est.details.hardFloorPlans['box']!;

  it('orders 4 packs: 6.24 m² net + 7 % straight-lay wastage over 2.22 m² packs', () => {
    // net    = 2.6 x 2.4                       = 6.24 m²
    // gross  = 6.24 x 1.07                     = 6.6768 m²   (7 % is the straight / random-stagger figure)
    // packs  = 6.6768 / 2.22 = 3.00757...      -> 4 packs (the room is 8 mm over three packs' worth)
    expect(plan.netAreaM2).toBeCloseTo(6.24, 6);
    expect(plan.wastage).toBeCloseTo(0.07, 6);
    expect(plan.grossAreaM2).toBeCloseTo(6.6768, 6);
    expect(plan.exactPacks).toBeCloseTo(6.6768 / 2.22, 6);
    expect(plan.packs).toBe(4);
    expect(bomLine(est, 'covering:laminate-oak')).toMatchObject({ quantity: 4, unit: 'pack', unitPrice: 24, total: 96 });
  });

  it('takes 1 pack of floating-floor underlay', () => {
    // underlay = net x 1.05 (trimming and joins) = 6.24 x 1.05 = 6.552 m²
    // packs    = ceil(6.552 / 15) = ceil(0.4368) = 1
    expect(plan.underlayAreaM2).toBeCloseTo(6.552, 6);
    expect(plan.underlayPacks).toBe(1);
    expect(bomLine(est, 'underlay:hardfloor:15')).toMatchObject({ quantity: 1, unit: 'pack' });
    // timber subfloor, so no polythene DPM under the underlay
    expect(plan.dpmSheetRolls).toBe(0);
  });

  it('beads the perimeter less the doorway: 5 lengths of 2.4 m', () => {
    // perimeter 2 x (2.6 + 2.4) = 10 000 mm, less the 686 mm opening = 9314 mm
    // x 1.10 cutting wastage = 10 245.4 mm;  10 245.4 / 2400 = 4.269 -> 5 lengths
    expect(plan.beadingMetres).toBeCloseTo(10.2454, 6);
    expect(plan.beadingLengths).toBe(5);
    expect(bomLine(est, 'trims:beading:2400')).toMatchObject({ quantity: 5, unit: 'length', unitPrice: 6, total: 30 });
    // the 10 mm expansion gap the beading covers
    expect(plan.expansionGap).toBe(10);
  });

  it('adds a ramp at the door and prices fitting at the laminate rate', () => {
    // laminate meeting the carpeted landing -> a ramp / reducer, one 900 mm bar for a 686 mm door
    expect(plan.thresholds).toEqual([expect.objectContaining({ profile: 'ramp', width: 686 })]);
    expect(bomLine(est, 'doorbar:ramp')).toMatchObject({ quantity: 1, unit: 'each', unitPrice: 15, total: 15 });
    // 6.24 m² x £12/m² = £74.88
    expect(bomLine(est, 'labour:fitting:laminate')).toMatchObject({ quantity: 6.24, unitPrice: 12, total: 74.88 });
  });
});

// ---------------------------------------------------------------------------
// 5. Glue-down LVT in a bathroom
// ---------------------------------------------------------------------------

describe('scenario 5: a 2.2 x 1.9 m bathroom in glue-down LVT over floorboards', () => {
  const lvt: PackProduct = {
    id: 'lvt-stone',
    name: 'Stone effect glue-down LVT 2.5 mm',
    kind: 'lvt_glue',
    packCoverageM2: 3.29,
    boardLength: 1220,
    boardWidth: 180,
    boardsPerPack: 15,
    thickness: 2.5,
    pricePerPack: 65,
  };
  const bathroom: Room = {
    id: 'bathroom',
    name: 'Bathroom',
    shape: { kind: 'rectangle', length: 2200, width: 1900 },
    doorways: [{ id: 'door-bath', edgeIndex: 0, offset: 200, width: 686, transition: 'carpet', label: 'Bathroom door' }],
    productId: lvt.id,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'vinyl', dpmKnown: true },
  };
  const est = estimateProject(project('scenario-5', { products: [lvt], rooms: [bathroom] }));
  const plan = est.details.hardFloorPlans['bathroom']!;

  it('overlays the floorboards with ply and skims the joints', () => {
    // BS 8203: a resilient floor never goes straight onto floorboards.
    // ply    = 4.18 m² x 1.10 wastage / (2.440 x 1.220 = 2.9768 m² per sheet) = 1.5446 -> 2 sheets
    // screws = 2 sheets x 150 = 300 screws / 200 per box = 1.5 -> 2 boxes
    // latex  = 4.18 x 1.10 x 3 mm skim / 13 m²·mm per bag = 1.0611 -> 2 bags (recommended, not required)
    const ply = bomLine(est, 'prep:ply:required:plywood-overlay-flooring-grade');
    expect(ply).toMatchObject({ quantity: 2, unit: 'sheet', unitPrice: 20, total: 40 });
    expect(ply.exactQuantity).toBeCloseTo(1.5446, 3);
    expect(bomLine(est, 'prep:ply_screws:required:ply-fixing-screws-300-screws-boxes-of-200')).toMatchObject({ quantity: 2, unit: 'box' });
    const latex = bomLine(est, 'prep:latex:recommended:latex-smoothing-compound-3-mm');
    expect(latex).toMatchObject({ quantity: 2, unit: 'bag' });
    expect(latex.exactQuantity).toBeCloseTo(1.0611, 3);
    // a recommended line is priced in its note but kept out of the totals
    expect(latex.total).toBeUndefined();
    expect(latex.notes).toContain('Recommended — not included in the totals');
    expect(est.details.floorPrep.perRoom['bathroom']).toEqual(expect.arrayContaining(['ply', 'latex']));
  });

  it('buys one tub of pressure-sensitive adhesive', () => {
    // net 2.2 x 1.9 = 4.18 m²; gross = 4.18 x 1.07 = 4.4726 m²
    // adhesive = 4.4726 / 4 m² per kg = 1.11815 kg -> ceil(1.11815 / 15 kg per tub) = 1 tub
    expect(plan.netAreaM2).toBeCloseTo(4.18, 6);
    expect(plan.grossAreaM2).toBeCloseTo(4.4726, 6);
    expect(plan.adhesiveKg).toBeCloseTo(1.11815, 6);
    expect(bomLine(est, 'adhesive:lvt')).toMatchObject({ quantity: 1, unit: 'tub', unitPrice: 45, total: 45 });
    // 4.4726 / 3.29 = 1.3595 -> 2 packs
    expect(bomLine(est, 'covering:lvt-stone')).toMatchObject({ quantity: 2, unit: 'pack', unitPrice: 65, total: 130 });
  });

  it('has no underlay and no beading: glue-down LVT is stuck down tight to the walls', () => {
    expect(plan.underlayPacks).toBe(0);
    expect(plan.underlayAreaM2).toBe(0);
    expect(linesIn(est, 'underlay')).toEqual([]);
    expect(plan.beadingLengths).toBe(0);
    expect(plan.beadingMetres).toBe(0);
    expect(hasLine(est, 'trims:beading:2400')).toBe(false);
    // no expansion gap either — nothing floats
    expect(plan.expansionGap).toBe(0);
    // and no carpet accessories anywhere on the job
    expect(linesIn(est, 'gripper')).toEqual([]);
    expect(est.details.underlay).toBeUndefined();
    expect(est.details.gripper).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Sheet vinyl with a seam
// ---------------------------------------------------------------------------

describe('scenario 6: a 3.6 x 4.6 m kitchen in 3 m sheet vinyl', () => {
  const vinyl: BroadloomProduct = {
    id: 'vinyl-3m',
    name: 'Cushioned sheet vinyl 3 m',
    kind: 'sheet_vinyl',
    rollWidth: 3000,
    maxRollLength: VINYL_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 2.5,
    pricePerM2: 16,
  };
  const kitchen: Room = {
    id: 'kitchen',
    name: 'Kitchen',
    shape: { kind: 'rectangle', length: 3600, width: 4600 },
    doorways: [{ id: 'door-kitchen', edgeIndex: 3, offset: 1000, width: 762, transition: 'carpet', label: 'Kitchen door' }],
    productId: vinyl.id,
    subfloor: { type: 'concrete', condition: 'good', existingCovering: 'none', dpmKnown: true },
  };
  const est = estimateProject(project('scenario-6', { products: [vinyl], rooms: [kitchen] }));
  const plan = est.rollPlans[0]!;
  const seams = plan.seamsByRoom['kitchen']!;

  it('needs a second drop beside the main one — one side seam', () => {
    // The room is 3.6 m across a 3.0 m roll, so one drop cannot cover it:
    //   main drop  4600 + 100 = 4700 long x the full 3000 roll width (3.0 m of the 3.6 m span)
    //   second     the remaining 600 mm + 100 allowance = 700 wide
    // A 3.6 m room on a 3 m roll = 2 drops, joined down the room: exactly one SIDE seam.
    expect(seams.filter((s) => s.kind === 'side')).toHaveLength(1);
    expect(plan.pieces.filter((p) => p.role === 'main')).toEqual([expect.objectContaining({ length: 4700, width: 3000 })]);
    // 'balanced' cuts the narrow second drop as 3 cross-joined segments side by side, because
    // 3 x 700 = 2100 fits across the roll: ceil(4700 / 3) + 50 = 1617 mm each, saving 3.1 m² of vinyl.
    const fills = plan.pieces.filter((p) => p.role === 'fill');
    expect(fills).toHaveLength(3);
    expect(fills.every((p) => p.length === 1617 && p.width === 700)).toBe(true);
    expect(seams.filter((s) => s.kind === 'cross')).toHaveLength(2);
    // cuts: 4700 (main) + 1617 (the three segments) = 6317 -> 6400 to the 100 mm increment
    expect(plan.orderLength).toBe(6400);
    expect(bomLine(est, 'covering:vinyl-3m')).toMatchObject({ quantity: 6.4, unit: 'lm', unitPrice: 48, total: 307.2 });
  });

  it('is fully bonded because it is seamed, and buys a tub of adhesive rather than tape', () => {
    // 3.6 x 4.6 = 16.56 m² is UNDER the 20 m² loose-lay limit, but a seam in a loose-laid sheet
    // lifts, so the seam alone forces a fully bonded floor.
    expect(plan.netAreaM2).toBeCloseTo(16.56, 6);
    expect(16.56).toBeLessThan(20);
    const fullyBonded = est.warnings.find((w) => w.code === 'VINYL_FULLY_BONDED')!;
    expect(fullyBonded.message).toContain('3 seams');
    // adhesive = 16.56 m² / 4 m² per kg = 4.14 kg -> ceil(4.14 / 15) = 1 tub
    expect(est.details.vinylSundries['kitchen']).toMatchObject({ adhesiveKg: 4.14, adhesiveTubs: 1, doubleSidedTapeLength: 0 });
    expect(bomLine(est, 'adhesive:vinyl')).toMatchObject({ quantity: 1, unit: 'tub', unitPrice: 45, total: 45 });
    // fully bonded, so no perimeter tape
    expect(hasLine(est, 'tape:double_sided')).toBe(false);
  });

  it('has no gripper and no underlay: vinyl is neither stretched nor padded', () => {
    expect(linesIn(est, 'gripper')).toEqual([]);
    expect(linesIn(est, 'underlay')).toEqual([]);
    expect(est.details.gripper).toBeUndefined();
    expect(est.details.underlay).toBeUndefined();
    // it is a carpet door bar's opposite number: a single-edge bar into the carpeted hall
    expect(bomLine(est, 'doorbar:single_edge')).toMatchObject({ quantity: 1, unit: 'each' });
    // 16.56 m² x £7/m² vinyl fitting = £115.92
    expect(bomLine(est, 'labour:fitting:sheet_vinyl')).toMatchObject({ quantity: 16.56, unitPrice: 7, total: 115.92 });
  });
});

// ---------------------------------------------------------------------------
// 7. A patterned carpet that has to be matched
// ---------------------------------------------------------------------------

describe('scenario 7: a patterned carpet (640 mm repeat) in a room that needs two pieces', () => {
  function loungeProject(patternRepeatLength: Mm): Project {
    const carpet: BroadloomProduct = {
      id: 'axminster',
      name: 'Axminster patterned 4 m',
      kind: 'carpet',
      rollWidth: 4000,
      maxRollLength: CARPET_MAX_ROLL_LENGTH,
      cutIncrement: CUT_INCREMENT,
      patternRepeatLength,
      thickness: 12,
      pricePerM2: 40,
    };
    const lounge: Room = {
      id: 'lounge',
      name: 'Lounge',
      shape: { kind: 'rectangle', length: 6500, width: 6000 },
      doorways: [],
      productId: carpet.id,
      subfloor: { type: 'floorboards', condition: 'good' },
    };
    return project('scenario-7', { products: [carpet], rooms: [lounge] });
  }
  const patterned = estimateProject(loungeProject(640));
  const plain = estimateProject(loungeProject(0));

  it('adds one 640 mm repeat to the SECOND piece only', () => {
    // The room is 6.5 m across the pile direction, so it takes two pieces:
    //   piece 1  4000 mm of the span, cut the full 4 m roll width, 6000 + 100 = 6100 long
    //   piece 2  the remaining 2500 mm + 100 allowance = 2600 wide
    // Plain, both pieces are 6100 long. Patterned, the second must start on the same point of the
    // repeat as the first, so it gains one full repeat: 6100 + 640 = 6740.
    const pieces = patterned.rollPlans[0]!.pieces;
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ label: 'Main piece', length: 6100, width: 4000 });
    expect(pieces[1]).toMatchObject({ label: 'Fill 1', length: 6740, width: 2600 });
    // the 2600 mm fill is over half the roll width, so it is never split into cross-joined segments
    expect(pieces[1]!.crossJoinGroup).toBeUndefined();
    // the same room in a plain carpet: both pieces 6100 long
    expect(plain.rollPlans[0]!.pieces.map((p) => p.length)).toEqual([6100, 6100]);
  });

  it('costs 0.7 lm more carpet than the same room in a plain', () => {
    // patterned: 6100 + 6740 = 12 840 -> 12 900 to the 100 mm increment
    // plain:     6100 + 6100 = 12 200 (already a multiple of 100)
    // difference 700 mm = the 640 mm repeat plus 60 mm of rounding up to the next 10 cm
    expect(patterned.rollPlans[0]!.orderLength).toBe(12900);
    expect(plain.rollPlans[0]!.orderLength).toBe(12200);
    expect(patterned.rollPlans[0]!.orderLength - plain.rollPlans[0]!.orderLength).toBe(700);
    // 12.9 lm x 4 m = 51.6 m² ordered for 6.5 x 6.0 = 39 m² net
    expect(patterned.rollPlans[0]!.orderedAreaM2).toBeCloseTo(51.6, 6);
    expect(patterned.rollPlans[0]!.netAreaM2).toBeCloseTo(39, 6);
  });

  it('tells the fitter why, and says nothing of the sort for a plain carpet', () => {
    const note = patterned.warnings.find((w) => w.code === 'PATTERN_MATCH')!;
    expect(note.level).toBe('info');
    expect(note.subjectId).toBe('lounge');
    // "1 extra pattern repeat(s) of 0.64 m added for matching"
    expect(note.message).toContain('1 extra pattern repeat');
    expect(note.message).toContain('0.64 m');
    expect(codes(plain.warnings)).not.toContain('PATTERN_MATCH');
  });
});

// ---------------------------------------------------------------------------
// 8. Winders break a waterfall
// ---------------------------------------------------------------------------

describe('scenario 8: a waterfall flight with three winders at the top', () => {
  const carpet: BroadloomProduct = {
    id: 'stair-carpet',
    name: 'Stair carpet 4 m',
    kind: 'carpet',
    rollWidth: 4000,
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 11,
    pricePerM2: 22,
  };
  const winder = (n: number): Step => ({ id: `step-${n}`, kind: 'winder', rise: 200, going: 380, width: 860, goingNarrow: 120 });
  const stairs: Staircase = {
    id: 'stairs',
    name: 'Stairs',
    productId: carpet.id,
    // 9 straight, then three kite winders turning the corner, then the top riser onto the landing
    steps: [...straightSteps(9, 860), winder(10), winder(11), winder(12), ...straightSteps(1, 860).map((s) => ({ ...s, id: 'step-13' }))],
    landings: [],
    method: 'waterfall',
    openSides: 'none',
    nosingOverhang: 20,
    subfloor: { type: 'floorboards', condition: 'good' },
  };
  const est = estimateProject(project('scenario-8', { products: [carpet], staircases: [stairs] }));
  const plan = est.rollPlans[0]!;

  it('splits into two continuous runs and three individual winder pieces', () => {
    // A winder is a kite: it cannot come out of a straight strip, so each one is cut on its own and
    // the waterfall stops either side of them. 2 runs + 3 winders = 5 pieces for 13 risers.
    expect(plan.pieces).toHaveLength(5);
    expect(plan.pieces.filter((p) => p.role === 'winder')).toHaveLength(3);
    expect(plan.pieces.filter((p) => p.role === 'stair_step')).toHaveLength(2);
    // run 1, steps 1-9: 9 x (wrap 443 + tuck 30) + 300 end allowance = 4257 + 300 = 4557 mm
    expect(plan.pieces.find((p) => p.label === 'Waterfall run 1 (steps 1–9)')).toMatchObject({ length: 4557, width: 960 });
    // each winder: wrap = rise 200 + going 380 (measured at the WIDE end) + nosing 20 = 600, + 30 tuck = 630
    // (no cap-and-band extra in a waterfall), width 860 + 100 = 960
    for (const n of [10, 11, 12]) {
      expect(plan.pieces.find((p) => p.label === `Step ${n} (winder)`)).toMatchObject({ length: 630, width: 960, role: 'winder' });
    }
    // run 2 is the top riser alone: wrap 200 + 20 = 220, + 30 tuck + 300 end allowance = 550
    expect(plan.pieces.find((p) => p.label === 'Waterfall run 2 (step 13)')).toMatchObject({ length: 550, width: 960 });
  });

  it('raises WATERFALL_SPLIT naming the winders as the reason', () => {
    const split = est.warnings.find((w) => w.code === 'WATERFALL_SPLIT')!;
    expect(split.level).toBe('info');
    expect(split.subjectId).toBe('stairs');
    expect(split.message).toContain('cut as 5 pieces');
    expect(split.message).toContain('winder step 10, winder step 11, winder step 12');
  });

  it('packs the runs and winders onto 5.2 lm of roll', () => {
    // cut 1 is 4557 long: run 1 (960) + the three winders (3 x 960) = 3840 of the 4000 width
    // cut 2 is 550 long: run 2 on its own
    // 4557 + 550 = 5107 -> 5200 mm to the 100 mm increment
    expect(plan.cuts.map((c) => [c.length, c.pieces.length])).toEqual([
      [4557, 4],
      [550, 1],
    ]);
    expect(plan.orderLength).toBe(5200);
    // gripper: the three winders take a third length each for the long back edge —
    // (13 x 2 + 3) x 860 = 24 940 mm, x 1.10 = 27 434 mm
    expect(est.staircases['stairs']!.gripperLength).toBe(27434);
  });
});

// ---------------------------------------------------------------------------
// 9. Nothing at all
// ---------------------------------------------------------------------------

describe('scenario 9: an empty project', () => {
  const empty = emptyProject('empty-project');
  const est = estimateProject(empty);

  it('quotes zero without a single warning', () => {
    expect(est.rollPlans).toEqual([]);
    expect(est.bom).toEqual([]);
    expect(est.warnings).toEqual([]);
    expect(est.warnings.filter((w) => w.level === 'error')).toEqual([]);
    expect(est.rooms).toEqual({});
    expect(est.staircases).toEqual({});
  });

  it('has zero totals rather than undefined or NaN', () => {
    expect(est.totals).toEqual({ netAreaM2: 0, materialsCost: 0, labourCost: 0, subtotal: 0, vat: 0, total: 0 });
    for (const value of Object.values(est.totals)) expect(Number.isFinite(value)).toBe(true);
  });

  it('survives a save and reload unchanged', () => {
    const parsed = parseProject(serializeProject(empty));
    if ('error' in parsed) throw new Error(`the empty project failed to reload: ${parsed.error}`);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.project).toEqual(empty);
    // and re-estimating the reloaded copy gives exactly the same quote
    expect(estimateProject(parsed.project).totals).toEqual(est.totals);
  });
});

// ---------------------------------------------------------------------------
// 10. Underfloor heating and the tog limit
// ---------------------------------------------------------------------------

describe('scenario 10: carpet over underfloor heating', () => {
  const carpet: BroadloomProduct = {
    id: 'ufh-carpet',
    name: 'Bedroom carpet 4 m',
    kind: 'carpet',
    rollWidth: 4000,
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 10,
    pricePerM2: 18,
  };
  const bedroom: Room = {
    id: 'bedroom',
    name: 'Bedroom',
    shape: { kind: 'rectangle', length: 4000, width: 3000 },
    doorways: [],
    productId: carpet.id,
    subfloor: { type: 'concrete', condition: 'good', underfloorHeating: true, dpmKnown: true },
  };
  const base = project('scenario-10', { products: [carpet], rooms: [bedroom] });

  /** The same project with a different underlay tog. */
  const withTog = (tog: number): Project => ({ ...base, options: { ...base.options, underlay: { ...base.options.underlay, tog } } });

  it('flags the default 2.3 tog underlay as too warm for UFH', () => {
    // A typical carpet is 1.0-1.5 tog on its own, so a 2.3 tog underlay puts the pair well over the
    // 2.5 tog ceiling for underfloor heating: the engine wants 1.0 tog or less under it.
    expect(DEFAULT_UNDERLAY.tog).toBe(2.3);
    const est = estimateProject(withTog(2.3));
    const tog = est.warnings.find((w) => w.code === 'UFH_TOG')!;
    expect(tog.level).toBe('warning');
    expect(tog.subjectId).toBe('bedroom');
    expect(tog.message).toContain('2.3 tog underlay');
    expect(tog.message).toContain('2.5 tog combined');
  });

  it('clears the tog warning with a 0.8 tog UFH underlay', () => {
    // 0.8 <= the 1.0 tog limit, so nothing to say about the tog any more.
    const est = estimateProject(withTog(0.8));
    expect(codes(est.warnings)).not.toContain('UFH_TOG');
    // the general "use UFH-compatible products" note stays either way — it is about the whole build-up
    expect(codes(est.warnings)).toContain('UFH_PRODUCTS');
    // and the quantities are untouched by the tog: the room's 4.0 m length matches the roll width
    // exactly, so one piece is cut the full 4000 wide (no trim to spare) x 3000 + 100 = 3100 long,
    // i.e. 3.1 lm off the roll.
    const plan = est.rollPlans[0]!;
    expect(plan.pieces).toEqual([expect.objectContaining({ length: 3100, width: 4000 })]);
    expect(plan.orderLength).toBe(3100);
  });

  it('keeps the underfloor-heating note on the room it belongs to', () => {
    const est = estimateProject(withTog(0.8));
    const ufh = est.warnings.find((w) => w.code === 'UFH_PRODUCTS')!;
    expect(ufh.subjectId).toBe('bedroom');
    expect(est.rooms['bedroom']!.warnings.map((w) => w.code)).toContain('UFH_PRODUCTS');
  });
});
