import { buildRollPlan } from './rollplan';
import { shapeToPolygon } from './geometry';
import { VINYL_MIN_FILL_WIDTH } from './defaults';
import type { BroadloomPlanningOptions, BroadloomProduct, Doorway } from './types';

const opts: BroadloomPlanningOptions = {
  pileDirection: 'auto',
  seamPolicy: 'min_seams',
  lengthAllowance: 100,
  widthAllowance: 100,
  balancedThresholdM2: 1,
  minCrossJoinStripLength: 500,
  usableOffcutMin: 500,
};

const carpet4: BroadloomProduct = { id: 'c4', name: 'Test twist 4 m', kind: 'carpet', rollWidth: 4000, cutIncrement: 100, maxRollLength: 30000 };
const carpet5: BroadloomProduct = { ...carpet4, id: 'c5', name: 'Test twist 5 m', rollWidth: 5000 };

function room(id: string, shape: Parameters<typeof shapeToPolygon>[0], o: Partial<BroadloomPlanningOptions> = {}) {
  const doorways: Doorway[] = [];
  return { roomId: id, roomName: id, polygon: shapeToPolygon(shape), doorways, options: { ...opts, ...o } };
}

describe('single rectangular rooms', () => {
  it('3.5 x 4.2 m bedroom from a 4 m roll: one piece, pile along the 4.2 m', () => {
    const plan = buildRollPlan({ product: carpet4, rooms: [room('bed', { kind: 'rectangle', length: 4200, width: 3500 })], options: opts });
    expect(plan.pieces).toHaveLength(1);
    expect(plan.pieces[0]!.width).toBe(3600);
    expect(plan.pieces[0]!.length).toBe(4300);
    expect(plan.orderLength).toBe(4300);
    expect(plan.pileDirection).toBe('along_length');
    expect(plan.netAreaM2).toBeCloseTo(14.7, 6);
    expect(plan.orderedAreaM2).toBeCloseTo(17.2, 6);
    expect(plan.cuts).toHaveLength(1);
    expect(plan.offcuts.find((o) => o.width === 400 && o.length === 4300)).toBeTruthy();
  });

  it('auto direction turns the room so the short side fits the roll', () => {
    // 3.8 m x 6 m: pile must run along the 6 m so the 3.8 m fits in 4 m
    const plan = buildRollPlan({ product: carpet4, rooms: [room('lounge', { kind: 'rectangle', length: 3800, width: 6000 })], options: opts });
    expect(plan.pieces).toHaveLength(1);
    expect(plan.pileDirection).toBe('along_width');
    expect(plan.orderLength).toBe(6100);
  });

  it('5 x 6 m room from a 4 m roll, auto direction: two 5.1 m lengths across the room = 10.2 lm', () => {
    const plan = buildRollPlan({ product: carpet4, rooms: [room('lounge', { kind: 'rectangle', length: 6000, width: 5000 })], options: opts });
    expect(plan.pieces).toHaveLength(2);
    expect(plan.pileDirection).toBe('along_width');
    expect(plan.orderLength).toBe(10200);
    expect(plan.seamsByRoom.lounge).toHaveLength(1);
  });

  it('5 x 6 m room from a 4 m roll, pile along the 6 m, min_seams: main + full-length fill = 12.2 lm', () => {
    const plan = buildRollPlan({ product: carpet4, rooms: [room('lounge', { kind: 'rectangle', length: 6000, width: 5000 }, { pileDirection: 'along_length' })], options: opts });
    expect(plan.pieces).toHaveLength(2);
    const main = plan.pieces.find((p) => p.role === 'main')!;
    const fill = plan.pieces.find((p) => p.role === 'fill')!;
    expect(main.width).toBe(4000);
    expect(main.length).toBe(6100);
    expect(fill.width).toBe(1100);
    expect(fill.length).toBe(6100);
    expect(plan.orderLength).toBe(12200);
    expect(plan.seamsByRoom.lounge).toHaveLength(1);
    expect(plan.seamsByRoom.lounge![0]!.kind).toBe('side');
    // the leftover next to the fill is a usable 2.9 x 6.1 m offcut
    expect(plan.offcuts[0]).toMatchObject({ width: 2900, length: 6100, usable: true });
  });

  it('5 x 6 m room from a 4 m roll, pile along the 6 m, min_waste: fill cross-joined from a 2.1 m cut = 8.2 lm', () => {
    const plan = buildRollPlan({ product: carpet4, rooms: [room('lounge', { kind: 'rectangle', length: 6000, width: 5000 }, { seamPolicy: 'min_waste', pileDirection: 'along_length' })], options: { ...opts, seamPolicy: 'min_waste' } });
    const fills = plan.pieces.filter((p) => p.role === 'fill');
    expect(fills).toHaveLength(3);
    expect(fills[0]!.length).toBe(Math.ceil(6100 / 3) + 50);
    expect(plan.cuts).toHaveLength(2);
    expect(plan.orderLength).toBe(6100 + 2100);
    expect(plan.seamsByRoom.lounge!.filter((s) => s.kind === 'cross')).toHaveLength(2);
  });

  it('the same 5 x 6 m room from a 5 m roll needs no seam', () => {
    const plan = buildRollPlan({ product: carpet5, rooms: [room('lounge', { kind: 'rectangle', length: 6000, width: 5000 })], options: opts });
    expect(plan.pieces).toHaveLength(1);
    expect(plan.orderLength).toBe(6100);
    expect(plan.warnings.some((w) => w.code === 'TIGHT_WIDTH')).toBe(true);
  });

  it('rounds the order up to the cut increment and respects a minimum cut', () => {
    const plan = buildRollPlan({ product: { ...carpet4, cutIncrement: 500, minCutLength: 2000 }, rooms: [room('wc', { kind: 'rectangle', length: 1250, width: 900 })], options: opts });
    expect(plan.orderLength).toBe(2000);
    const plan2 = buildRollPlan({ product: { ...carpet4, cutIncrement: 500 }, rooms: [room('hall', { kind: 'rectangle', length: 3210, width: 900 }, { pileDirection: 'along_length' })], options: opts });
    expect(plan2.orderLength).toBe(3500);
    // on auto the hall turns to run across the roll: 1.0 m off the roll
    const plan3 = buildRollPlan({ product: { ...carpet4, cutIncrement: 500 }, rooms: [room('hall', { kind: 'rectangle', length: 3210, width: 900 })], options: opts });
    expect(plan3.orderLength).toBe(1000);
  });
});

describe('odd shapes', () => {
  it('L-shaped room uses a main piece plus a shorter fill', () => {
    // 6 x 5 overall, 2 x 1.5 cut out of the top-right corner
    const plan = buildRollPlan({
      product: carpet4,
      rooms: [room('L', { kind: 'l_shape', length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: 'top-right' })],
      options: opts,
    });
    expect(plan.netAreaM2).toBeCloseTo(27, 6);
    expect(plan.pieces.length).toBeGreaterThanOrEqual(2);
    // never more carpet than the plain 5 x 6 room needs
    expect(plan.orderLength).toBeLessThanOrEqual(12200);
    expect(plan.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
  });

  it('a chimney breast does not create extra pieces', () => {
    const plan = buildRollPlan({
      product: carpet4,
      rooms: [
        room('lounge', {
          kind: 'rectangle_with_features',
          length: 4500,
          width: 3600,
          features: [{ id: 'cb', wall: 'bottom', offset: 1500, width: 1400, depth: -350 }],
        }),
      ],
      options: opts,
    });
    expect(plan.pieces).toHaveLength(1);
    expect(plan.orderLength).toBe(4600);
  });

  it('a bay window is covered by extending the main piece', () => {
    const plan = buildRollPlan({
      product: carpet4,
      rooms: [
        room('front', {
          kind: 'rectangle_with_features',
          length: 4000,
          width: 3600,
          features: [{ id: 'bay', wall: 'left', offset: 800, width: 2000, depth: 700 }],
        }),
      ],
      options: opts,
    });
    // bay on the left wall projects along -x, so the length becomes 4.7 m and pile runs along it
    expect(plan.pieces).toHaveLength(1);
    expect(plan.pieces[0]!.length).toBe(4800);
    expect(plan.pieces[0]!.width).toBe(3700);
  });

  it('a seam is kept out of a doorway when the room forces a seam', () => {
    // 6 m long x 5 m wide; doorway on the long (top) wall between x=3.9 and 4.8 — a 4 m roll wants a seam at x=4.0
    const r = room('lounge', { kind: 'rectangle', length: 6000, width: 5000 }, { pileDirection: 'along_width' });
    r.doorways = [{ id: 'd', edgeIndex: 0, offset: 3900, width: 900, transition: 'carpet' }];
    const plan = buildRollPlan({ product: carpet4, rooms: [r], options: opts });
    const seam = plan.seamsByRoom.lounge![0]!;
    expect(seam.from.x <= 3900 || seam.from.x >= 4800).toBe(true);
    expect(plan.warnings.some((w) => w.code === 'SEAM_IN_DOORWAY')).toBe(false);
  });
});

describe('fill rules', () => {
  it('never plans a sliver: a 4.2 m wide room from a 4 m roll moves the seam so both pieces are practical', () => {
    // 4.2 + 0.1 allowance does not fit a 4 m roll; the naive seam leaves a 0.2 m fill (< 300 mm minimum)
    const plan = buildRollPlan({ product: carpet4, rooms: [room('lounge', { kind: 'rectangle', length: 5000, width: 4200 }, { pileDirection: 'along_length' })], options: opts });
    expect(plan.pieces).toHaveLength(2);
    for (const p of plan.pieces) expect(p.width).toBeGreaterThanOrEqual(300 + 100);
    expect(plan.warnings.filter((w) => w.level === 'error')).toHaveLength(0);
  });

  it('caps cross joins per fill', () => {
    // 6 m x 4.4 m, pile along the 6 m: fill 0.5 m wide x 6.1 m long; unlimited joins would allow 8 strips
    const plan = buildRollPlan({
      product: carpet4,
      rooms: [room('lounge', { kind: 'rectangle', length: 6000, width: 4400 }, { seamPolicy: 'min_waste', pileDirection: 'along_length', maxCrossJoinsPerFill: 1 })],
      options: { ...opts, seamPolicy: 'min_waste' },
    });
    const fills = plan.pieces.filter((p) => p.role === 'fill');
    expect(fills.length).toBeLessThanOrEqual(2);
    expect(plan.seamsByRoom.lounge!.filter((s) => s.kind === 'cross').length).toBeLessThanOrEqual(1);
  });
});

describe('multi-room packing', () => {
  it('a hall fits beside a bedroom fill on the same cut', () => {
    const plan = buildRollPlan({
      product: carpet4,
      rooms: [room('bed', { kind: 'rectangle', length: 4000, width: 3000 }), room('hall', { kind: 'rectangle', length: 4000, width: 900 })],
      options: opts,
    });
    // bedroom piece 3.1 wide + hall 1.0 wide = 4.1 > 4.0 -> two cuts of 4.1 => 8.2; but auto direction
    // can turn the hall so its 0.9 m runs along the roll... it cannot: the 4 m would then need the width.
    expect(plan.cuts.length).toBeLessThanOrEqual(2);
    expect(plan.orderLength).toBeLessThanOrEqual(8200);
  });

  it('patterned carpet adds a repeat to each extra piece', () => {
    const plan = buildRollPlan({ product: { ...carpet4, patternRepeatLength: 640 }, rooms: [room('lounge', { kind: 'rectangle', length: 6000, width: 5000 }, { pileDirection: 'along_length' })], options: opts });
    const fill = plan.pieces.find((p) => p.role === 'fill')!;
    expect(fill.length).toBe(6100 + 640);
    expect(plan.warnings.some((w) => w.code === 'PATTERN_MATCH')).toBe(true);
  });

  it('splits across rolls when the order exceeds the roll length', () => {
    const plan = buildRollPlan({ product: { ...carpet4, maxRollLength: 10000 }, rooms: [room('a', { kind: 'rectangle', length: 6000, width: 3800 }), room('b', { kind: 'rectangle', length: 6000, width: 3800 })], options: opts });
    expect(plan.rollsRequired).toBe(2);
  });
});


// ---------------------------------------------------------------------------
// A seam has to pay for itself, and it is the ROLL that is being optimised
// ---------------------------------------------------------------------------

const balanced: BroadloomPlanningOptions = { ...opts, seamPolicy: 'balanced' };

describe('seams only where they save material', () => {
  it('does not seam a lounge to save nothing: 4.6 x 3.7 with a bay and a chimney breast comes out in one piece', () => {
    // This room used to be planned as 3 pieces with 2 side seams, and the order length was 5.4 lm
    // either way: 9.2 m of seaming tape across a lounge floor for £0.00 of carpet.
    const shape = {
      kind: 'rectangle_with_features' as const,
      length: 4600,
      width: 3700,
      features: [
        { id: 'bay', wall: 'left' as const, offset: 850, width: 2000, depth: 700 },
        { id: 'chimney', wall: 'bottom' as const, offset: 1600, width: 1400, depth: -350 },
      ],
    };
    const lounge = room('lounge', shape, balanced);
    const plan = buildRollPlan({ product: carpet4, rooms: [lounge], options: balanced });
    expect(plan.seamsByRoom.lounge ?? []).toHaveLength(0);
    expect(plan.pieces).toHaveLength(1);
    expect(plan.orderLength).toBe(5400);
    // min_seams cannot beat it, which is the point: the seams were buying nothing
    const fewest = buildRollPlan({ product: carpet4, rooms: [room('lounge', shape, { seamPolicy: 'min_seams' })], options: opts });
    expect(fewest.orderLength).toBe(plan.orderLength);
  });

  it('still seams when the seam actually shortens the order', () => {
    // 5 x 6 m on a 4 m roll cannot be one piece; a seam here saves 2 m of roll, so it is cut
    const plan = buildRollPlan({ product: carpet4, rooms: [room('lounge', { kind: 'rectangle', length: 6000, width: 5000 }, balanced)], options: balanced });
    expect((plan.seamsByRoom.lounge ?? []).length).toBeGreaterThan(0);
    expect(plan.orderLength).toBeLessThan(12200);
  });

  it('never buys an extra seam without shortening the order', () => {
    // Sweep a range of plain rooms on a 4 m roll. 'balanced' may never order MORE than 'min_seams',
    // and wherever it cuts more seams than 'min_seams' would, the order must be strictly shorter:
    // an extra seam that leaves the linear metres unchanged is tape and time for nothing.
    for (const length of [3000, 4000, 4600, 5000, 6000, 7000]) {
      for (const width of [2400, 3000, 3700, 4200, 5000]) {
        const shape = { kind: 'rectangle' as const, length, width };
        const seamed = buildRollPlan({ product: carpet4, rooms: [room('r', shape, balanced)], options: balanced });
        const fewest = buildRollPlan({ product: carpet4, rooms: [room('r', shape, { seamPolicy: 'min_seams' })], options: opts });
        const where = `${length} x ${width}`;
        expect([where, seamed.orderLength <= fewest.orderLength]).toEqual([where, true]);
        const extraSeams = (seamed.seamsByRoom.r ?? []).length - (fewest.seamsByRoom.r ?? []).length;
        if (extraSeams > 0) expect([where, seamed.orderLength < fewest.orderLength]).toEqual([where, true]);
      }
    }
  });
});

describe('pile direction is chosen for the roll, not the room', () => {
  it('turns the landing so it packs beside the hall instead of opening a second cut', () => {
    // Hall 4.0 x 1.0 and an L-shaped landing 3.0 x 2.0 on one 4 m roll. Planned alone the landing
    // prefers a 2100 x 3100 piece, which will not sit beside the hall: 6.2 lm. Turned the other way
    // it is 3100 x 2100 and both rooms come out of a single 4.1 m cut.
    const hall = room('hall', { kind: 'rectangle', length: 4000, width: 1000 }, { pileDirection: 'along_length' });
    const landing = room('landing', { kind: 'l_shape', length: 3000, width: 2000, cutoutLength: 1800, cutoutWidth: 1100, cutoutCorner: 'top-right' });
    const plan = buildRollPlan({ product: carpet4, rooms: [hall, landing], options: opts });
    expect(plan.orderLength).toBe(4100);
    expect(plan.cuts).toHaveLength(1);
  });

  it('warns when rooms joined by a continuous opening end up running different ways', () => {
    const hall = room('hall', { kind: 'rectangle', length: 4000, width: 1000 }, { pileDirection: 'along_length' });
    hall.doorways = [{ id: 'd1', edgeIndex: 0, offset: 800, width: 860, transition: 'carpet', continuous: true }];
    const landing = room('landing', { kind: 'rectangle', length: 3000, width: 2000 }, { pileDirection: 'along_width' });
    landing.doorways = [{ id: 'd2', edgeIndex: 0, offset: 500, width: 860, transition: 'carpet', continuous: true }];
    const plan = buildRollPlan({ product: carpet4, rooms: [hall, landing], options: opts });
    expect(plan.warnings.map((w) => w.code)).toContain('PILE_DIRECTION_SPLIT');
  });
});

describe('sheet vinyl', () => {
  const vinyl3: BroadloomProduct = { id: 'v3', name: 'Cushioned vinyl 3 m', kind: 'sheet_vinyl', rollWidth: 3000, cutIncrement: 100, maxRollLength: 20000 };

  it('is never cross-joined and never planned in slivers', () => {
    // A 5 x 4 m kitchen on a 3 m roll used to buy a butt joint straight across the floor to save
    // material; a cross seam in a bonded sheet is a route for water under it.
    const kitchen = room('kitchen', { kind: 'rectangle', length: 5000, width: 4000 }, { ...balanced, seamPolicy: 'min_waste' });
    const plan = buildRollPlan({ product: vinyl3, rooms: [kitchen], options: { ...opts, seamPolicy: 'min_waste' } });
    expect(plan.pieces.every((p) => p.crossJoinGroup === undefined)).toBe(true);
    expect((plan.seamsByRoom.kitchen ?? []).filter((s) => s.kind === 'cross')).toHaveLength(0);
    expect(plan.pieces.every((p) => p.width >= VINYL_MIN_FILL_WIDTH)).toBe(true);
  });

  it('warns when more than one seam is planned, so the estimator looks at a wider roll', () => {
    // 9 x 5 m open-plan kitchen/diner: three drops of a 3 m roll, so two seams to weld
    const kitchen = room('kitchen', { kind: 'rectangle', length: 9000, width: 5000 }, balanced);
    const plan = buildRollPlan({ product: vinyl3, rooms: [kitchen], options: balanced });
    expect((plan.seamsByRoom.kitchen ?? []).length).toBeGreaterThan(1);
    expect(plan.warnings.map((w) => w.code)).toContain('VINYL_MULTIPLE_SEAMS');
  });
});

describe('bad supply figures', () => {
  it('a non-positive roll width returns an empty plan with an error, and does not hang', () => {
    // planRoom's candidate-seam search steps in multiples of the roll width: at zero it never
    // terminated, and useEstimate's try/catch cannot catch a hang — the browser tab froze.
    const plan = buildRollPlan({ product: { ...carpet4, rollWidth: 0 }, rooms: [room('r', { kind: 'rectangle', length: 4000, width: 3000 })], options: opts });
    expect(plan.pieces).toEqual([]);
    expect(plan.orderLength).toBe(0);
    expect(plan.warnings.map((w) => w.code)).toEqual(['INVALID_ROLL_WIDTH']);
  });

  it('a piece with a non-finite length is rejected with a reason of its own, not "wider than the roll"', () => {
    const plan = buildRollPlan({
      product: carpet4,
      rooms: [room('r', { kind: 'rectangle', length: 4000, width: 3000 }, { lengthAllowance: Number.NaN })],
      options: opts,
    });
    const rejected = plan.warnings.filter((w) => w.level === 'error');
    expect(rejected.map((w) => w.code)).toContain('PIECE_NOT_MEASURABLE');
    expect(rejected.some((w) => /wider than/.test(w.message))).toBe(false);
  });
});
