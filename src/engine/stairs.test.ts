import { planStaircase, stepWrapLength, bullnoseWrapExtra, ceilMm, sideCount, STAIR_HARD_FLOOR_WASTAGE, DEFAULT_BULLNOSE_PROJECTION } from './stairs';
import type { AccessoryOptions, BroadloomPlanningOptions, BroadloomProduct, Landing, PackProduct, Product, Staircase, Step, UnderlayOptions } from './types';

// ---------------------------------------------------------------------------
// Fixtures — the standard UK domestic flight used throughout unless a test says otherwise:
// 13 risers of 200 mm, going 223 mm, 860 mm wide, 20 mm nosing overhang (DEFAULT_NOSING_OVERHANG),
// closed strings, 10% gripper wastage, 100 mm length/width allowances on landings.
//
//   wrap (steps 1–12) = 200 + 223 + 20 = 443
//   wrap (top step)   = 200 + 20       = 220   (its tread is the landing floor: no going)
// ---------------------------------------------------------------------------

const opts: BroadloomPlanningOptions = {
  pileDirection: 'auto',
  seamPolicy: 'balanced',
  lengthAllowance: 100,
  widthAllowance: 100,
  balancedThresholdM2: 1,
  minCrossJoinStripLength: 600,
  usableOffcutMin: 500,
};

const underlay: UnderlayOptions = { fit: true, rollWidth: 1370, rollLength: 11000, thickness: 10 };

const accessories: AccessoryOptions = {
  gripperLength: 1520,
  gripperPerPack: 10,
  gripperWastage: 0.1,
  doorBarLength: 900,
  doorBarLongLength: 2700,
  seamTapeRollLength: 20000,
  doubleSidedTapeRollLength: 25000,
  underlayTapeRollLength: 50000,
};

const carpet: BroadloomProduct = { id: 'c4', name: 'Twist 4 m', kind: 'carpet', rollWidth: 4000, cutIncrement: 100 };
const vinyl: BroadloomProduct = { id: 'v2', name: 'Sheet vinyl 2 m', kind: 'sheet_vinyl', rollWidth: 2000 };
const laminate: PackProduct = { id: 'lam', name: 'Oak laminate', kind: 'laminate', packCoverageM2: 2.2 };

function steps(count = 13, over: Partial<Step> = {}): Step[] {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, kind: 'straight' as const, rise: 200, going: 223, width: 860, ...over }));
}

function stair(over: Partial<Staircase> = {}): Staircase {
  return { id: 'st', name: 'Stairs', productId: 'c4', steps: steps(), landings: [], method: 'cap_and_band', openSides: 'none', ...over };
}

function plan(s: Staircase, product: Product = carpet, extra: { options?: Partial<BroadloomPlanningOptions>; underlay?: Partial<UnderlayOptions>; accessories?: Partial<AccessoryOptions> } = {}) {
  return planStaircase({
    staircase: s,
    product,
    options: { ...opts, ...extra.options },
    underlay: { ...underlay, ...extra.underlay },
    accessories: { ...accessories, ...extra.accessories },
  });
}

const codes = (p: ReturnType<typeof planStaircase>) => p.warnings.map((w) => w.code);

// Reference totals for the base flight (cap and band or waterfall — the carpet ON the stair is the same):
//   net area  = 12 x 443 x 860 + 220 x 860 = 4 571 760 + 189 200 = 4 760 960 mm²
//   gripper   = ceil((12 steps x 2 lengths + top riser x 1) x 860 x 1.10) = ceil(21 500 x 1.1) = 23 650 mm
//               (the top step's tread is the landing, so only its riser foot is gripped)
//   underlay  = 12 tread pads of (going 223 + PAD_NOSING_OVERLAP 50) x 860 = 2 817 360 mm² = 2.81736 m²
//               (pads go on the treads only; the top step has no tread of its own)
const BASE_NET = 4_760_960;
const BASE_GRIPPER = 23_650;
const BASE_UNDERLAY = 2.81736;
/** Every step but the top one carries a tread pad. */
const BASE_PADS = 12;
/** Underlay down the whole flight (`underlayRisers`): 12 x 423 x 860 + 200 x 860. */
const BASE_UNDERLAY_FULL_FLIGHT = 4.53736;

describe('helpers', () => {
  it('stepWrapLength: rise + going + nosing, or rise + nosing for the top step', () => {
    expect(stepWrapLength({ rise: 200, going: 223 }, 20)).toBe(443);
    expect(stepWrapLength({ rise: 200, going: 223 }, 20, true)).toBe(220);
    // negative / NaN inputs are treated as zero rather than propagating
    expect(stepWrapLength({ rise: -5, going: Number.NaN }, 20)).toBe(20);
  });

  it('bullnoseWrapExtra: 1.6 x projection + 50 per curved side', () => {
    // 1.6 x 150 + 50 = 290 on one side
    expect(bullnoseWrapExtra({ kind: 'bullnose', bullnoseProjection: 150, bullnoseSides: 'right' })).toEqual({ extra: 290, sides: 1, projection: 150, assumed: false });
    // curtail always both sides: 2 x (1.6 x 200 + 50) = 740
    expect(bullnoseWrapExtra({ kind: 'curtail', bullnoseProjection: 200 })).toEqual({ extra: 740, sides: 2, projection: 200, assumed: false });
    // unmeasured bullnose: assumed 150 mm projection -> 1.6 x 150 + 50 = 290
    expect(bullnoseWrapExtra({ kind: 'bullnose' })).toEqual({ extra: 290, sides: 1, projection: DEFAULT_BULLNOSE_PROJECTION, assumed: true });
    expect(bullnoseWrapExtra({ kind: 'straight' }).extra).toBe(0);
  });

  it('ceilMm ignores float drift and sideCount counts sides', () => {
    expect(ceilMm(21500 * 1.1)).toBe(23650);
    expect(ceilMm(24596.4)).toBe(24597);
    expect(sideCount('none')).toBe(0);
    expect(sideCount('left')).toBe(1);
    expect(sideCount('both')).toBe(2);
  });
});

describe('(1) cap and band, closed strings', () => {
  const p = plan(stair());

  it('cuts 13 individual pieces: 548 x 960 for steps 1–12 and 325 x 960 for the top step', () => {
    // length = wrap 443 + STEP_LENGTH_ALLOWANCE 30 + CAP_AND_BAND_EXTRA 75 = 548; top: 220 + 30 + 75 = 325
    // width  = 860 + STEP_WIDTH_ALLOWANCE 100 (50 mm tuck each side against the strings) = 960
    expect(p.stepCount).toBe(13);
    expect(p.pieces).toHaveLength(13);
    for (let i = 0; i < 12; i++) {
      expect(p.pieces[i]).toMatchObject({ id: `st:s${i + 1}`, ownerId: 'st', ownerName: 'Stairs', length: 548, width: 960, role: 'stair_step' });
    }
    expect(p.pieces[12]).toMatchObject({ id: 'st:s13', length: 325, width: 960, role: 'stair_step' });
  });

  it('reports the per-step wraps and piece sizes', () => {
    expect(p.perStep).toHaveLength(13);
    expect(p.perStep[0]).toMatchObject({ stepId: 's1', kind: 'straight', wrapLength: 443, pieceLength: 548, pieceWidth: 960 });
    expect(p.perStep[12]).toMatchObject({ stepId: 's13', wrapLength: 220, pieceLength: 325, pieceWidth: 960 });
    expect(p.perStep[12]!.notes).toContain('top step');
  });

  it('net area, gripper and underlay', () => {
    expect(p.netAreaMm2).toBe(BASE_NET);
    expect(p.gripperLength).toBe(BASE_GRIPPER);
    expect(p.underlayAreaM2).toBeCloseTo(BASE_UNDERLAY, 9);
    expect(p.underlayPads).toBe(BASE_PADS);
  });

  it('closed strings need no binding, rods or nosings and raise no warnings', () => {
    expect(p.bindingLength).toBe(0);
    expect(p.stairRods).toBe(0);
    expect(p.nosings).toBe(0);
    expect(p.nosingLength).toBe(0);
    expect(p.hardFloorAreaM2).toBeUndefined();
    expect(p.warnings).toEqual([]);
  });

  it('gripper wastage comes from the accessories options', () => {
    // 21 500 x 1.00 = 21 500; 21 500 x 1.05 = 22 575.000000000004 -> 22 575
    expect(plan(stair(), carpet, { accessories: { gripperWastage: 0 } }).gripperLength).toBe(21_500);
    expect(plan(stair(), carpet, { accessories: { gripperWastage: 0.05 } }).gripperLength).toBe(22_575);
  });
});

describe('(2) waterfall', () => {
  it('one continuous piece 6 226 x 960 down the whole flight', () => {
    // Σ (wrap + 30) = 12 x 473 + 250 = 5 676 + 250 = 5 926; + RUNNER_END_ALLOWANCE 300 = 6 226
    const p = plan(stair({ method: 'waterfall' }));
    expect(p.pieces).toHaveLength(1);
    expect(p.pieces[0]).toMatchObject({ id: 'st:r1', length: 6226, width: 960, role: 'stair_step' });
    for (const s of p.perStep) {
      expect(s.pieceLength).toBe(6226);
      expect(s.pieceWidth).toBe(960);
    }
    // the carpet on the stair is the same however it is cut
    expect(p.netAreaMm2).toBe(BASE_NET);
    expect(p.gripperLength).toBe(BASE_GRIPPER);
    expect(p.underlayAreaM2).toBeCloseTo(BASE_UNDERLAY, 9);
    expect(p.underlayPads).toBe(BASE_PADS);
    expect(codes(p)).not.toContain('WATERFALL_SPLIT');
  });
});

describe('(3) winders', () => {
  const withWinders = (method: Staircase['method']) => {
    const s = steps();
    for (const i of [5, 6, 7]) s[i] = { ...s[i]!, kind: 'winder', going: 600, goingNarrow: 150 };
    return stair({ steps: s, method });
  };

  it('waterfall: three winders split the flight into two runs plus three individual kites', () => {
    const p = plan(withWinders('waterfall'));
    // run 1, steps 1–5: 5 x 473 + 300 = 2 665
    // winders: wrap = 200 + 600 (max going) + 20 = 820; piece = 820 + 30 = 850 (no cap-and-band extra in a waterfall)
    // run 2, steps 9–13: 4 x 473 + (220 + 30) + 300 = 1 892 + 250 + 300 = 2 442
    expect(p.pieces.map((x) => [x.id, x.length, x.width, x.role])).toEqual([
      ['st:r1', 2665, 960, 'stair_step'],
      ['st:s6', 850, 960, 'winder'],
      ['st:s7', 850, 960, 'winder'],
      ['st:s8', 850, 960, 'winder'],
      ['st:r2', 2442, 960, 'stair_step'],
    ]);
    expect(codes(p)).toContain('WATERFALL_SPLIT');
    expect(p.perStep[5]).toMatchObject({ kind: 'winder', wrapLength: 820, pieceLength: 850 });
    expect(p.perStep[0]!.pieceLength).toBe(2665);
    expect(p.perStep[12]!.pieceLength).toBe(2442);
  });

  it('winder quantities: net area, an extra gripper length on the long back edge, pad from the widest going', () => {
    const p = plan(withWinders('waterfall'));
    // 9 straight steps (13 - 3 winders - top), 3 winders, 1 top:
    // net = 9 x 443 x 860 + 3 x 820 x 860 + 220 x 860 = 3 428 820 + 2 115 600 + 189 200 = 5 733 620
    expect(p.netAreaMm2).toBe(5_733_620);
    // gripper = (12 x 2 x 860 + 860 top riser + 3 x 860 winder back edges) x 1.1 = (21 500 + 2 580) x 1.1 = 26 488
    expect(p.gripperLength).toBe(26_488);
    // tread pads only: 9 x (223 + 50) x 860 + 3 winders x (600 + 50) x 860 = 2 113 020 + 1 677 000 = 3 790 020 mm²
    expect(p.underlayAreaM2).toBeCloseTo(3.79002, 9);
    expect(p.underlayPads).toBe(BASE_PADS);
  });

  it('cap and band: winders get the cap-and-band extra like every other piece', () => {
    const p = plan(withWinders('cap_and_band'));
    expect(p.pieces).toHaveLength(13);
    // 820 + 30 + 75 = 925
    expect(p.pieces[5]).toMatchObject({ id: 'st:s6', length: 925, width: 960, role: 'winder' });
    expect(p.pieces[4]).toMatchObject({ length: 548, role: 'stair_step' });
    expect(codes(p)).not.toContain('WATERFALL_SPLIT');
  });
});

describe('(4) bullnose and curtail steps', () => {
  const bullnoseBottom = (over: Partial<Step> = {}, method: Staircase['method'] = 'cap_and_band') => {
    const s = steps();
    s[0] = { ...s[0]!, kind: 'bullnose', bullnoseProjection: 150, bullnoseSides: 'right', ...over };
    return stair({ steps: s, method });
  };

  it('bullnose bottom step, projection 150 on the right, cap and band: width 1 250', () => {
    // 960 + 1.6 x 150 + 50 = 960 + 240 + 50 = 1 250
    const p = plan(bullnoseBottom());
    expect(p.pieces[0]).toMatchObject({ id: 'st:s1', length: 548, width: 1250, role: 'stair_step' });
    expect(p.pieces[1]).toMatchObject({ width: 960 });
    expect(p.perStep[0]!.notes).toContain('bullnose');
    expect(codes(p)).not.toContain('BULLNOSE_PROJECTION_ASSUMED');
  });

  it('bullnose on both sides doubles the wrap; a curtail is always both sides', () => {
    // both: 960 + 2 x 290 = 1 540
    expect(plan(bullnoseBottom({ bullnoseSides: 'both' })).pieces[0]!.width).toBe(1540);
    // curtail, projection 200: 960 + 2 x (1.6 x 200 + 50) = 960 + 740 = 1 700
    expect(plan(bullnoseBottom({ kind: 'curtail', bullnoseProjection: 200 })).pieces[0]!.width).toBe(1700);
  });

  it('an unmeasured projection is assumed and flagged', () => {
    // assumed 150 mm: 960 + 1.6 x 150 + 50 = 1 250
    const p = plan(bullnoseBottom({ bullnoseProjection: undefined }));
    expect(p.pieces[0]!.width).toBe(1250);
    expect(codes(p)).toContain('BULLNOSE_PROJECTION_ASSUMED');
  });

  it('waterfall: the bullnose is cut on its own and the run starts at step 2', () => {
    const p = plan(bullnoseBottom({}, 'waterfall'));
    // bullnose: 443 + 30 = 473 x 1 250 (no cap-and-band extra); run steps 2–13: 11 x 473 + 250 + 300 = 5 753
    expect(p.pieces.map((x) => [x.id, x.length, x.width])).toEqual([
      ['st:s1', 473, 1250],
      ['st:r1', 5753, 960],
    ]);
    expect(codes(p)).toContain('WATERFALL_SPLIT');
  });

  it('a runner just runs over a bullnose: no wrap, no split', () => {
    const p = plan(bullnoseBottom({}, 'waterfall'), carpet);
    expect(p.pieces).toHaveLength(2);
    const r = plan({ ...bullnoseBottom({}, 'waterfall'), runner: { width: 600, stairRods: false } });
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0]).toMatchObject({ length: 6226, width: 600, role: 'stair_runner' });
    expect(codes(r)).not.toContain('WATERFALL_SPLIT');
  });
});

describe('(5) open strings', () => {
  it('one open side: 150 mm extra width and the wrapped edge is bound', () => {
    const p = plan(stair({ openSides: 'left' }));
    // width 960 + OPEN_SIDE_WRAP 150 = 1 110; binding = Σ wrap = 12 x 443 + 220 = 5 536
    for (const piece of p.pieces) expect(piece.width).toBe(1110);
    expect(p.bindingLength).toBe(5536);
    expect(codes(p)).toContain('OPEN_STRING_BINDING');
    expect(p.warnings.find((w) => w.code === 'OPEN_STRING_BINDING')).toMatchObject({ level: 'info', subjectId: 'st' });
    // net area and gripper are unchanged: the wrap is allowance, not covered floor
    expect(p.netAreaMm2).toBe(BASE_NET);
    expect(p.gripperLength).toBe(BASE_GRIPPER);
  });

  it('both sides open: 300 mm extra width and both edges bound', () => {
    const p = plan(stair({ openSides: 'both', method: 'waterfall' }));
    expect(p.pieces[0]).toMatchObject({ length: 6226, width: 1260 });
    expect(p.bindingLength).toBe(11_072);
  });
});

describe('(6) runners', () => {
  it('600 mm runner with rods, waterfall: 6 226 x 600, bound both edges and ends, 13 rods', () => {
    const p = plan(stair({ method: 'waterfall', runner: { width: 600, stairRods: true } }));
    expect(p.pieces).toHaveLength(1);
    expect(p.pieces[0]).toMatchObject({ id: 'st:r1', length: 6226, width: 600, role: 'stair_runner' });
    // binding = 2 x 6 226 + 2 x 600 = 12 452 + 1 200 = 13 652
    expect(p.bindingLength).toBe(13_652);
    expect(p.stairRods).toBe(13);
    // gripper = ceil((12 x 2 + 1) x 600 x 1.1) = ceil(15 000 x 1.1) = 16 500
    expect(p.gripperLength).toBe(16_500);
    // net = (12 x 443 + 220) x 600 = 5 536 x 600 = 3 321 600; tread pads = 12 x 273 x 600 = 1 965 600 mm²
    expect(p.netAreaMm2).toBe(3_321_600);
    expect(p.underlayAreaM2).toBeCloseTo(1.9656, 9);
    expect(p.underlayPads).toBe(BASE_PADS);
    expect(codes(p)).not.toContain('OPEN_STRING_BINDING');
  });

  it('no rods when not wanted; open strings add nothing to a runner', () => {
    const p = plan(stair({ method: 'waterfall', openSides: 'both', runner: { width: 600, stairRods: false } }));
    expect(p.stairRods).toBe(0);
    expect(p.pieces[0]!.width).toBe(600);
    expect(p.bindingLength).toBe(13_652);
  });

  it('cap and band runner: 13 strips 548 x 600, every strip bound', () => {
    const p = plan(stair({ method: 'cap_and_band', runner: { width: 600, stairRods: true } }));
    expect(p.pieces).toHaveLength(13);
    expect(p.pieces[0]).toMatchObject({ length: 548, width: 600, role: 'stair_runner' });
    expect(p.pieces[12]).toMatchObject({ length: 325, width: 600 });
    // 2 x (12 x 548 + 325) + 2 x 600 = 2 x 6 901 + 1 200 = 15 002
    expect(p.bindingLength).toBe(15_002);
  });

  it('a missing runner width defaults to 600 mm; a runner wider than the tread is flagged', () => {
    const p = plan(stair({ method: 'waterfall', runner: { width: 0, stairRods: false } }));
    expect(p.pieces[0]!.width).toBe(600);
    expect(codes(p)).toContain('RUNNER_WIDTH_DEFAULTED');
    const wide = plan(stair({ method: 'waterfall', runner: { width: 900, stairRods: false } }));
    expect(codes(wide)).toContain('RUNNER_WIDER_THAN_STAIR');
    expect(wide.pieces[0]!.width).toBe(900);
  });

  it('a runner is ignored (with a note) on anything but carpet', () => {
    const p = plan(stair({ method: 'waterfall', runner: { width: 600, stairRods: true } }), vinyl);
    expect(codes(p)).toContain('RUNNER_NOT_APPLICABLE');
    expect(p.pieces[0]!.width).toBe(960);
    expect(p.stairRods).toBe(0);
  });
});

describe('(7) landings', () => {
  const half: Landing = { id: 'L1', kind: 'half', length: 1720, width: 860, afterStepIndex: 5 };

  it('half landing after step 6, cap and band: a 1 820 x 960 landing piece after the step-6 piece', () => {
    const p = plan(stair({ landings: [half] }));
    expect(p.pieces).toHaveLength(14);
    expect(p.pieces[6]).toMatchObject({ id: 'st:l1', label: 'Half landing', length: 1820, width: 960, role: 'landing', ownerId: 'st' });
    expect(p.pieces[5]).toMatchObject({ id: 'st:s6' });
    expect(p.pieces[7]).toMatchObject({ id: 'st:s7' });
    // net area adds 860 x 1 720 = 1 479 200 -> 6 240 160
    expect(p.netAreaMm2).toBe(BASE_NET + 860 * 1720);
    expect(p.netAreaMm2).toBe(6_240_160);
    // gripper adds perimeter - width = 2 x 1 720 + 2 x 860 - 860 = 4 300: ceil((21 500 + 4 300) x 1.1) = 28 380
    expect(p.gripperLength).toBe(28_380);
    expect(p.gripperLength).toBe(ceilMm((21_500 + (2 * 1720 + 2 * 860 - 860)) * 1.1));
    // underlay adds the landing area (landings are floors, padded across): 2.81736 + 1.4792 = 4.29656
    expect(p.underlayAreaM2).toBeCloseTo(4.29656, 9);
    expect(p.underlayPads).toBe(BASE_PADS);
  });

  it('waterfall: the landing breaks the flight into two runs', () => {
    const p = plan(stair({ landings: [half], method: 'waterfall' }));
    // run 1 steps 1–6: 6 x 473 + 300 = 3 138; run 2 steps 7–13: 6 x 473 + 250 + 300 = 3 388
    expect(p.pieces.map((x) => [x.id, x.length, x.width, x.role])).toEqual([
      ['st:r1', 3138, 960, 'stair_step'],
      ['st:l1', 1820, 960, 'landing'],
      ['st:r2', 3388, 960, 'stair_step'],
    ]);
    expect(codes(p)).toContain('WATERFALL_SPLIT');
  });

  it('landing allowances come from the planning options', () => {
    const p = plan(stair({ landings: [half] }), carpet, { options: { lengthAllowance: 150, widthAllowance: 50 } });
    expect(p.pieces[6]).toMatchObject({ length: 1870, width: 910 });
  });

  it('a top landing after the last step does not split a waterfall', () => {
    const top: Landing = { id: 'L2', kind: 'top', length: 1000, width: 900, afterStepIndex: 12 };
    const p = plan(stair({ landings: [top], method: 'waterfall' }));
    expect(p.pieces.map((x) => x.id)).toEqual(['st:r1', 'st:l1']);
    expect(codes(p)).not.toContain('WATERFALL_SPLIT');
  });
});

describe('(8) top riser by landing', () => {
  const top: Landing = { id: 'L', kind: 'top', length: 1000, width: 900, afterStepIndex: 12 };

  it('the stairs stop one riser short and the landing piece gains rise + nosing + tuck', () => {
    const p = plan(stair({ landings: [top], topRiserByLanding: true }));
    // 12 step pieces + 1 landing; landing length = 1 000 + 100 + 200 + 20 + 30 = 1 350, width 900 + 100 = 1 000
    expect(p.pieces).toHaveLength(13);
    expect(p.pieces.filter((x) => x.role === 'stair_step')).toHaveLength(12);
    expect(p.pieces[12]).toMatchObject({ id: 'st:l1', length: 1350, width: 1000, role: 'landing' });
    expect(p.pieces[12]!.label).toContain('top riser');
    expect(p.pieces[11]).toMatchObject({ id: 'st:s12', length: 548 });
    expect(p.stepCount).toBe(13);
    expect(p.perStep[12]!.pieceLength).toBeUndefined();
    expect(p.perStep[12]!.notes).toContain('landing');
    expect(codes(p)).not.toContain('TOP_RISER_BY_LANDING');
  });

  it('the top riser is still carpeted, padded and grippered — via the landing', () => {
    const p = plan(stair({ landings: [top], topRiserByLanding: true }));
    // net = 12 x 443 x 860 + 220 x 860 (riser + nosing) + 1 000 x 900 = 4 571 760 + 189 200 + 900 000 = 5 660 960
    expect(p.netAreaMm2).toBe(5_660_960);
    // gripper = 12 x 2 x 860 (steps) + 860 (top riser foot only) + 2 x 1 000 + 900 (landing) = 20 640 + 860 + 2 900 = 24 400; x1.1 = 26 840
    expect(p.gripperLength).toBe(26_840);
    // underlay = 12 tread pads of 273 x 860 + the landing 1 000 x 900 = 2 817 360 + 900 000 = 3 717 360 mm²
    expect(p.underlayAreaM2).toBeCloseTo(3.71736, 9);
    expect(p.underlayPads).toBe(12);
    // the whole-flight option puts a pad on every riser too: 12 x 423 x 860 + 200 x 860 + the landing
    const full = plan(stair({ landings: [top], topRiserByLanding: true, underlayRisers: true }));
    expect(full.underlayAreaM2).toBeCloseTo(BASE_UNDERLAY_FULL_FLIGHT + 0.9, 9);
  });

  it('waterfall: the run covers steps 1–12 only', () => {
    const p = plan(stair({ landings: [top], topRiserByLanding: true, method: 'waterfall' }));
    // 12 x 473 + 300 = 5 976
    expect(p.pieces.map((x) => [x.id, x.length, x.width])).toEqual([
      ['st:r1', 5976, 960],
      ['st:l1', 1350, 1000],
    ]);
    expect(codes(p)).not.toContain('WATERFALL_SPLIT');
  });

  it('with no top landing to take it, the top riser stays on the stairs and the flag is noted', () => {
    const p = plan(stair({ topRiserByLanding: true }));
    expect(codes(p)).toContain('TOP_RISER_BY_LANDING');
    expect(p.warnings.find((w) => w.code === 'TOP_RISER_BY_LANDING')!.level).toBe('info');
    expect(p.pieces).toHaveLength(13);
    expect(p.pieces[12]).toMatchObject({ id: 'st:s13', length: 325 });
    expect(p.gripperLength).toBe(BASE_GRIPPER);
    // a mid-flight landing cannot take the top riser either
    const half: Landing = { id: 'H', kind: 'half', length: 1720, width: 860, afterStepIndex: 5 };
    const q = plan(stair({ landings: [half], topRiserByLanding: true }));
    expect(codes(q)).toContain('TOP_RISER_BY_LANDING');
    expect(q.pieces.filter((x) => x.role === 'stair_step')).toHaveLength(13);
    expect(q.pieces.find((x) => x.role === 'landing')).toMatchObject({ length: 1820 });
  });
});

describe('(9) hard floor on stairs', () => {
  it('laminate: no pieces, one nosing per step, net and gross area', () => {
    const p = plan(stair(), laminate);
    expect(p.pieces).toEqual([]);
    expect(p.nosings).toBe(13);
    // 13 x 860 = 11 180
    expect(p.nosingLength).toBe(11_180);
    // (12 x 423 x 860 + 200 x 860) / 1e6 = 4.53736; gross x 1.15 = 5.217964
    expect(p.hardFloorAreaM2).toBeCloseTo(4.53736, 9);
    expect(p.hardFloorGrossAreaM2).toBeCloseTo(4.53736 * 1.15, 9);
    expect(p.hardFloorGrossAreaM2).toBeCloseTo(4.53736 * (1 + STAIR_HARD_FLOOR_WASTAGE), 9);
    // 5.217964 / 2.2 m² per pack = 2.37 -> 3 packs
    expect(p.hardFloorPacks).toBe(3);
    expect(codes(p)).toContain('HARD_FLOOR_STAIRS_SPECIALIST');
    expect(p.warnings.find((w) => w.code === 'HARD_FLOOR_STAIRS_SPECIALIST')!.level).toBe('info');
    // nothing carpet-related
    expect(p.gripperLength).toBe(0);
    expect(p.bindingLength).toBe(0);
    expect(p.underlayAreaM2).toBe(0);
    expect(p.underlayPads).toBe(0);
    expect(p.stairRods).toBe(0);
    expect(p.perStep[0]!.pieceLength).toBeUndefined();
    expect(p.perStep[0]!.notes).toContain('nosing');
  });

  it('landings are clad too', () => {
    const half: Landing = { id: 'L1', kind: 'half', length: 1720, width: 860, afterStepIndex: 5 };
    const p = plan(stair({ landings: [half] }), laminate);
    // 4.53736 + 1.4792 = 6.01656
    expect(p.hardFloorAreaM2).toBeCloseTo(6.01656, 9);
    expect(p.pieces).toEqual([]);
  });

  it('a product without pack coverage reports areas but no pack count', () => {
    const p = plan(stair(), { ...laminate, packCoverageM2: 0 });
    expect(p.hardFloorAreaM2).toBeCloseTo(4.53736, 9);
    expect(p.hardFloorPacks).toBeUndefined();
  });
});

describe('(10) building regulations check', () => {
  it('the default 200 / 223 stair is inside Approved Document K (pitch 41.9°)', () => {
    expect(codes(plan(stair()))).not.toContain('STAIR_OUTSIDE_REGS');
  });

  it('a 230 mm rise is flagged (info)', () => {
    const p = plan(stair({ steps: steps(13, { rise: 230 }) }));
    const w = p.warnings.find((x) => x.code === 'STAIR_OUTSIDE_REGS');
    expect(w).toBeDefined();
    expect(w!.level).toBe('info');
    expect(w!.message).toContain('rise 230');
  });

  it('a short going and a steep pitch are flagged', () => {
    expect(codes(plan(stair({ steps: steps(13, { going: 210 }) })))).toContain('STAIR_OUTSIDE_REGS');
    // 220 / 225: rise and going both in range, pitch atan(220/225) = 44.4° > 42°
    const p = plan(stair({ steps: steps(13, { rise: 220, going: 225 }) }));
    expect(p.warnings.find((x) => x.code === 'STAIR_OUTSIDE_REGS')!.message).toContain('pitch');
  });

  it('a winder is not judged on its (maximum) going', () => {
    const s = steps();
    s[5] = { ...s[5]!, kind: 'winder', going: 600 };
    expect(codes(plan(stair({ steps: s })))).not.toContain('STAIR_OUTSIDE_REGS');
  });
});

describe('(11) underlay options', () => {
  it('underlay off: no area and no pads', () => {
    const p = plan(stair(), carpet, { underlay: { fit: false } });
    expect(p.underlayAreaM2).toBe(0);
    expect(p.underlayPads).toBe(0);
    expect(p.gripperLength).toBe(BASE_GRIPPER);
  });

  it('underlay thicker than 10 mm is flagged for stairs', () => {
    const p = plan(stair(), carpet, { underlay: { thickness: 12 } });
    expect(codes(p)).toContain('UNDERLAY_TOO_THICK_FOR_STAIRS');
    expect(p.underlayAreaM2).toBeCloseTo(BASE_UNDERLAY, 9);
    expect(codes(plan(stair(), carpet, { underlay: { thickness: 10 } }))).not.toContain('UNDERLAY_TOO_THICK_FOR_STAIRS');
  });
});

describe('(12) empty and degenerate input', () => {
  it('no steps: empty plan with NO_STEPS', () => {
    const p = plan(stair({ steps: [] }));
    expect(codes(p)).toEqual(['NO_STEPS']);
    expect(p).toMatchObject({ staircaseId: 'st', stepCount: 0, pieces: [], netAreaMm2: 0, gripperLength: 0, bindingLength: 0, underlayAreaM2: 0, underlayPads: 0, stairRods: 0, nosings: 0, nosingLength: 0, perStep: [] });
  });

  it('a step with a zero width is flagged but the rest is still planned', () => {
    const s = steps();
    s[3] = { ...s[3]!, width: 0 };
    const p = plan(stair({ steps: s }));
    expect(codes(p)).toContain('INVALID_STEP');
    expect(p.pieces).toHaveLength(13);
    expect(p.pieces[3]!.width).toBe(100);
  });

  it('a zero going on the top step is fine (its tread is the landing)', () => {
    const s = steps();
    s[12] = { ...s[12]!, going: 0 };
    const p = plan(stair({ steps: s }));
    expect(codes(p)).not.toContain('INVALID_STEP');
    expect(p.pieces[12]!.length).toBe(325);
  });
});

describe('sizes and other products', () => {
  it('a single riser to a landing: 220 wrap, 325 x 960 piece', () => {
    const p = plan(stair({ steps: steps(1) }));
    expect(p.pieces).toHaveLength(1);
    expect(p.pieces[0]).toMatchObject({ length: 325, width: 960 });
    expect(p.netAreaMm2).toBe(220 * 860);
    // the only step IS the top step: one gripper length at the riser foot, and no tread to pad
    // ceil(860 x 1.1) = ceil(946.0000000000001) = 946
    expect(p.gripperLength).toBe(946);
    expect(p.underlayAreaM2).toBe(0);
    expect(p.underlayPads).toBe(0);
  });

  it('a 40-riser flight scales linearly', () => {
    const p = plan(stair({ steps: steps(40), method: 'waterfall' }));
    // 39 x 473 + 250 + 300 = 18 447 + 550 = 18 997
    expect(p.pieces[0]).toMatchObject({ length: 18_997, width: 960 });
    expect(plan(stair({ steps: steps(40) })).pieces).toHaveLength(40);
    // 39 tread pads: the 40th step's tread is the landing
    expect(p.underlayPads).toBe(39);
  });

  it('a measured nosing overhang overrides the default', () => {
    const p = plan(stair({ nosingOverhang: 25 }));
    expect(p.perStep[0]!.wrapLength).toBe(448);
    expect(p.perStep[12]!.wrapLength).toBe(225);
    expect(p.pieces[0]!.length).toBe(553);
  });

  it('sheet vinyl: pieces like carpet, nosings, but no gripper or underlay', () => {
    const p = plan(stair(), vinyl);
    expect(p.pieces).toHaveLength(13);
    expect(p.pieces[0]).toMatchObject({ length: 548, width: 960 });
    expect(p.nosings).toBe(13);
    expect(p.nosingLength).toBe(11_180);
    expect(p.gripperLength).toBe(0);
    expect(p.underlayAreaM2).toBe(0);
    expect(p.underlayPads).toBe(0);
    expect(p.bindingLength).toBe(0);
    expect(codes(p)).toContain('VINYL_STAIRS_NOSINGS');
    expect(p.hardFloorAreaM2).toBeUndefined();
  });

  it('is deterministic and does not mutate its input', () => {
    const s = stair({ landings: [{ id: 'L', kind: 'half', length: 1720, width: 860, afterStepIndex: 5 }], openSides: 'left', method: 'waterfall' });
    const snapshot = JSON.stringify(s);
    const a = plan(s);
    const b = plan(s);
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('every warning names the staircase', () => {
    const p = plan(stair({ openSides: 'both', steps: steps(13, { rise: 230 }) }), carpet, { underlay: { thickness: 12 } });
    expect(p.warnings.length).toBeGreaterThanOrEqual(3);
    for (const w of p.warnings) {
      expect(w.subjectId).toBe('st');
      expect(w.code).toMatch(/^[A-Z_]+$/);
      expect(w.message).toContain('Stairs');
    }
  });
});
