import {
  planUnderlay,
  planGripper,
  planDoorBars,
  planTapes,
  gripperPinFor,
  needsGripper,
  doorBarTypeFor,
  doorBarsForWidth,
  UNDERLAY_PAD_WASTAGE,
  MAX_UNDERLAY_TOG_WITH_UFH,
  PATIO_DOOR_MIN_WIDTH,
  DOOR_BAR_TYPES,
  type DoorBarRoom,
  type GripperRoom,
} from './accessories';
import { shapeToPolygon } from './geometry';
import { DEFAULT_UNDERLAY, DEFAULT_ACCESSORIES, MAX_UNDERLAY_THICKNESS_ON_STAIRS } from './defaults';
import type { Doorway, DoorwayTransition, Subfloor, SubfloorType, CoveringKind } from './types';

// ---- fixtures -------------------------------------------------------------------------------------

/** 4.2 m x 3.5 m bedroom: area 14.7 m², perimeter 15.4 m. */
const bedroom = shapeToPolygon({ kind: 'rectangle', length: 4200, width: 3500 });
/** 3.0 m x 0.6 m hall: area 1.8 m², perimeter 7.2 m. */
const hall = shapeToPolygon({ kind: 'rectangle', length: 3000, width: 600 });
/** 5.0 m x 4.0 m lounge: area 20 m², perimeter 18 m. */
const lounge = shapeToPolygon({ kind: 'rectangle', length: 5000, width: 4000 });
/** 6 x 5 m with a 2 x 1.5 m corner missing: area 27 m². */
const lShape = shapeToPolygon({ kind: 'l_shape', length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: 'top-right' });

const timber: Subfloor = { type: 'floorboards', condition: 'good' };
const concrete: Subfloor = { type: 'concrete', condition: 'good' };

let seq = 0;
function dw(width: number, transition: DoorwayTransition, extra: Partial<Doorway> = {}): Doorway {
  seq += 1;
  return { id: `d${seq}`, edgeIndex: 0, offset: 500, width, transition, ...extra };
}

// ===================================================================================================
// 1. Underlay
// ===================================================================================================

describe('planUnderlay', () => {
  it('4.2 x 3.5 m bedroom: 3 strips of 1.37 m along the 4.2 m = 12.6 m -> 2 rolls of 11 m (1.15 exact)', () => {
    // along the 4.2 m: 3500 / 1370 = 2.55 -> 3 strips x 4200 = 12 600
    // along the 3.5 m: 4200 / 1370 = 3.07 -> 4 strips x 3500 = 14 000  -> keep 12 600
    // rolls: 12 600 / 11 000 = 1.1454.. -> 2 (exact 1.15)
    // tape: 2 joins x 4200 = 8 400 -> 8 400 / 50 000 -> 1 roll
    const plan = planUnderlay({ areas: [{ ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom }], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(plan.totalAreaM2).toBeCloseTo(14.7, 6);
    expect(plan.stripLengthMm).toBe(12600);
    expect(plan.rolls).toBe(2);
    expect(plan.exactRolls).toBe(1.15);
    expect(plan.tapeLength).toBe(8400);
    expect(plan.tapeRolls).toBe(1);
    expect(plan.perOwner).toEqual([{ ownerId: 'bed', ownerName: 'Bedroom', strips: 3, lengthMm: 12600, areaM2: 14.7 }]);
    expect(plan.warnings).toEqual([]);
  });

  it('a hall packed with the bedroom reuses the offcut beside the bedroom part-strip', () => {
    // hall 3.0 x 0.6: across the 3 m -> 3 strips (1370, 1370, 260) x 600 = 1 800 (vs 1 x 3 000 along it)
    // bedroom strips: 1370, 1370, 760 wide x 4200. The 260 x 600 hall strip fits beside the 760 x 4200
    // strip (760 + 260 = 1020 <= 1370): shelves 4200 x 3 + 600 x 2 = 13 800 (not 12 600 + 1 800 = 14 400)
    // rolls: 13 800 / 11 000 = 1.2545 -> 2 (exact 1.25); tape 8 400 + 2 x 600 = 9 600
    const plan = planUnderlay({
      areas: [
        { ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom },
        { ownerId: 'hall', ownerName: 'Hall', polygon: hall },
      ],
      options: DEFAULT_UNDERLAY,
      accessories: DEFAULT_ACCESSORIES,
    });
    expect(plan.totalAreaM2).toBeCloseTo(16.5, 6);
    expect(plan.stripLengthMm).toBe(13800);
    expect(plan.rolls).toBe(2);
    expect(plan.exactRolls).toBe(1.25);
    expect(plan.tapeLength).toBe(9600);
    expect(plan.perOwner[1]).toEqual({ ownerId: 'hall', ownerName: 'Hall', strips: 3, lengthMm: 1800, areaM2: 1.8 });
  });

  it('L-shaped room: strips follow the two legs with no waste, 22 m off the roll', () => {
    // along the 6 m leg (roll runs along x): slabs 1.5 m wide x 4 m deep and 3.5 m wide x 6 m deep
    // -> pieces 1370 + 130 wide x 4000 and 1370 + 1370 + 760 wide x 6000: 5 strips, 26 000 mm cut
    // packed: three 6000 shelves (the 130 x 4000 goes beside the 760) + one 4000 shelf = 22 000
    // the other direction also packs to 22 000; ties keep along-length. 22 000 / 11 000 = 2.00 rolls
    // tape: seams 4000 + 4000 + 6000 + 6000 = 20 000 -> 20 000 / 50 000 -> 1 roll of 50 m
    const plan = planUnderlay({ areas: [{ ownerId: 'L', ownerName: 'L room', polygon: lShape }], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(plan.totalAreaM2).toBeCloseTo(27, 6);
    expect(plan.perOwner[0]!.strips).toBe(5);
    expect(plan.perOwner[0]!.lengthMm).toBe(26000);
    expect(plan.stripLengthMm).toBe(22000);
    expect(plan.rolls).toBe(2);
    expect(plan.exactRolls).toBe(2);
    expect(plan.tapeLength).toBe(20000);
    expect(plan.tapeRolls).toBe(1);
  });

  it('stairs given as an area: area / roll width + 10 % pads', () => {
    // 4.5 m² / 1.37 m = 3 284.67 mm x 1.1 = 3 613.14 -> 3 614 mm; 3 614 / 11 000 = 0.33 -> 1 roll; no joins
    expect(UNDERLAY_PAD_WASTAGE).toBe(0.1);
    const plan = planUnderlay({ areas: [{ ownerId: 'st', ownerName: 'Stairs', areaM2: 4.5 }], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(plan.totalAreaM2).toBe(4.5);
    expect(plan.stripLengthMm).toBe(3614);
    expect(plan.rolls).toBe(1);
    expect(plan.exactRolls).toBe(0.33);
    expect(plan.tapeLength).toBe(0);
    expect(plan.tapeRolls).toBe(0);
    expect(plan.perOwner).toEqual([{ ownerId: 'st', ownerName: 'Stairs', strips: 1, lengthMm: 3614, areaM2: 4.5 }]);
    expect(plan.warnings).toEqual([]);
  });

  it('a polygon wins over an area when both are given', () => {
    const plan = planUnderlay({ areas: [{ ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom, areaM2: 99 }], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(plan.totalAreaM2).toBeCloseTo(14.7, 6);
    expect(plan.stripLengthMm).toBe(12600);
  });

  it('tiny WC 0.5 x 0.4 m: one 500 mm wide strip 400 mm long', () => {
    // across the 0.5 m: 1 strip x 400 (vs 1 strip x 500 along it) -> 400; 400 / 11 000 = 0.04
    const plan = planUnderlay({ areas: [{ ownerId: 'wc', ownerName: 'WC', polygon: shapeToPolygon({ kind: 'rectangle', length: 500, width: 400 }) }], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(plan.stripLengthMm).toBe(400);
    expect(plan.rolls).toBe(1);
    expect(plan.exactRolls).toBe(0.04);
    expect(plan.perOwner[0]!.strips).toBe(1);
    expect(plan.tapeLength).toBe(0);
  });

  it('huge 20 x 15 m hall: 11 strips x 20 m = 220 m -> exactly 20 rolls of 11 m, 15 rolls of 15 m', () => {
    // across the 15 m: 15 000 / 1370 = 10.95 -> 11 strips x 20 000 = 220 000
    // across the 20 m: 20 000 / 1370 = 14.6 -> 15 strips x 15 000 = 225 000 -> keep 220 000
    // tape: 10 joins x 20 000 = 200 000 -> 4 rolls of 50 m
    const big = shapeToPolygon({ kind: 'rectangle', length: 20000, width: 15000 });
    const plan = planUnderlay({ areas: [{ ownerId: 'h', ownerName: 'Hall', polygon: big }], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(plan.totalAreaM2).toBe(300);
    expect(plan.perOwner[0]!.strips).toBe(11);
    expect(plan.stripLengthMm).toBe(220000);
    expect(plan.rolls).toBe(20);
    expect(plan.exactRolls).toBe(20);
    expect(plan.tapeLength).toBe(200000);
    expect(plan.tapeRolls).toBe(4);
    // 220 000 / 15 000 = 14.67 -> 15 rolls
    const long = planUnderlay({ areas: [{ ownerId: 'h', ownerName: 'Hall', polygon: big }], options: { ...DEFAULT_UNDERLAY, rollLength: 15000 }, accessories: DEFAULT_ACCESSORIES });
    expect(long.rolls).toBe(15);
    expect(long.exactRolls).toBe(14.67);
  });

  it('fit=false returns zeros with an info note', () => {
    const plan = planUnderlay({ areas: [{ ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom }], options: { ...DEFAULT_UNDERLAY, fit: false }, accessories: DEFAULT_ACCESSORIES });
    expect(plan).toMatchObject({ totalAreaM2: 0, stripLengthMm: 0, rolls: 0, exactRolls: 0, tapeLength: 0, tapeRolls: 0, perOwner: [] });
    expect(plan.warnings.map((w) => w.code)).toEqual(['UNDERLAY_NOT_FITTED']);
  });

  it('a zero roll width is an error, not a hang; a zero roll length still plans strips but cannot count rolls', () => {
    // the strip planner cannot run without a roll width -> empty plan + UNDERLAY_ROLL_WIDTH
    const noWidth = planUnderlay({ areas: [{ ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom }], options: { ...DEFAULT_UNDERLAY, rollWidth: 0 }, accessories: DEFAULT_ACCESSORIES });
    expect(noWidth).toMatchObject({ totalAreaM2: 0, stripLengthMm: 0, rolls: 0, exactRolls: 0, tapeLength: 0, tapeRolls: 0, perOwner: [] });
    expect(noWidth.warnings.map((w) => [w.code, w.level])).toEqual([['UNDERLAY_ROLL_WIDTH', 'error']]);
    const negWidth = planUnderlay({ areas: [{ ownerId: 'st', ownerName: 'Stairs', areaM2: 4.5 }], options: { ...DEFAULT_UNDERLAY, rollWidth: -1370 }, accessories: DEFAULT_ACCESSORIES });
    expect(negWidth.warnings.map((w) => w.code)).toEqual(['UNDERLAY_ROLL_WIDTH']);
    // the same 12 600 mm of strips as the bedroom case, but 12 600 / 0 rolls is meaningless -> 0 + error
    const noLength = planUnderlay({ areas: [{ ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom }], options: { ...DEFAULT_UNDERLAY, rollLength: 0 }, accessories: DEFAULT_ACCESSORIES });
    expect(noLength.stripLengthMm).toBe(12600);
    expect(noLength.tapeLength).toBe(8400);
    expect(noLength.rolls).toBe(0);
    expect(noLength.exactRolls).toBe(0);
    expect(noLength.warnings.map((w) => [w.code, w.level])).toEqual([['UNDERLAY_ROLL_LENGTH', 'error']]);
  });

  it('no areas at all -> zeros and no warnings', () => {
    const plan = planUnderlay({ areas: [], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(plan).toEqual({ totalAreaM2: 0, stripLengthMm: 0, rolls: 0, exactRolls: 0, tapeLength: 0, tapeRolls: 0, perOwner: [], warnings: [] });
  });

  it('an area with neither outline nor area is skipped with UNDERLAY_NO_AREA; an empty outline is an EMPTY_ROOM error', () => {
    const plan = planUnderlay({
      areas: [
        { ownerId: 'x', ownerName: 'Mystery' },
        { ownerId: 'e', ownerName: 'Empty', polygon: [] },
        { ownerId: 'z', ownerName: 'Zero', areaM2: 0 },
      ],
      options: DEFAULT_UNDERLAY,
      accessories: DEFAULT_ACCESSORIES,
    });
    expect(plan.warnings.map((w) => [w.code, w.subjectId])).toEqual([
      ['UNDERLAY_NO_AREA', 'x'],
      ['EMPTY_ROOM', 'e'],
      ['UNDERLAY_NO_AREA', 'z'],
    ]);
    expect(plan.perOwner).toEqual([{ ownerId: 'e', ownerName: 'Empty', strips: 0, lengthMm: 0, areaM2: 0 }]);
    expect(plan.stripLengthMm).toBe(0);
    expect(plan.rolls).toBe(0);
  });

  it('warns UFH_TOG only for heated areas under an underlay above 1.0 tog', () => {
    expect(MAX_UNDERLAY_TOG_WITH_UFH).toBe(1.0);
    const areas = [
      { ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom, underfloorHeating: true },
      { ownerId: 'hall', ownerName: 'Hall', polygon: hall },
    ];
    const hot = planUnderlay({ areas, options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES }); // tog 2.3
    expect(hot.warnings.map((w) => [w.code, w.subjectId, w.level])).toEqual([['UFH_TOG', 'bed', 'warning']]);
    expect(hot.warnings[0]!.message).toContain('2.5');
    const low = planUnderlay({ areas, options: { ...DEFAULT_UNDERLAY, tog: 0.8 }, accessories: DEFAULT_ACCESSORIES });
    expect(low.warnings).toEqual([]);
    const unknown = planUnderlay({ areas, options: { ...DEFAULT_UNDERLAY, tog: undefined }, accessories: DEFAULT_ACCESSORIES });
    expect(unknown.warnings).toEqual([]);
  });

  it('warns about thick underlay on stairs', () => {
    const stairs = [{ ownerId: 'st', ownerName: 'Stairs', areaM2: 4.5 }];
    const ok = planUnderlay({ areas: stairs, options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES }); // 10 mm
    expect(ok.warnings).toEqual([]);
    const thick = planUnderlay({ areas: stairs, options: { ...DEFAULT_UNDERLAY, thickness: MAX_UNDERLAY_THICKNESS_ON_STAIRS + 1 }, accessories: DEFAULT_ACCESSORIES });
    expect(thick.warnings.map((w) => w.code)).toEqual(['UNDERLAY_THICK_ON_STAIRS']);
  });

  it('is deterministic', () => {
    const run = () => planUnderlay({ areas: [{ ownerId: 'L', ownerName: 'L', polygon: lShape }, { ownerId: 'b', ownerName: 'B', polygon: bedroom }], options: DEFAULT_UNDERLAY, accessories: DEFAULT_ACCESSORIES });
    expect(run()).toEqual(run());
  });
});

// ===================================================================================================
// 2. Gripper
// ===================================================================================================

describe('planGripper', () => {
  it('4.2 x 3.5 m carpet bedroom with one 838 door: 15.29 m -> 11 lengths -> 2 packs', () => {
    // (15 400 - 838) x 1.10 = 16 018.2 -> 16 019 mm; 16 019 / 1520 = 10.54 -> 11 lengths; 11 / 10 -> 2 packs
    const room: GripperRoom = { ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom, doorways: [dw(838, 'carpet')], subfloor: timber, covering: 'carpet' };
    const plan = planGripper({ rooms: [room], extra: [], options: DEFAULT_ACCESSORIES });
    expect(plan.totalLength).toBe(16019);
    expect(plan.lengths).toBe(11);
    expect(plan.packs).toBe(2);
    expect(plan.byPin).toEqual({ timber: 16019, concrete: 0 });
    expect(plan.perOwner).toEqual([{ ownerId: 'bed', ownerName: 'Bedroom', length: 16019, lengths: 11, pin: 'timber' }]);
    expect(plan.warnings).toEqual([]);
  });

  it('sums rooms, rounds lengths per room, splits by pin type and flags reusable gripper', () => {
    // lounge 5 x 4 on concrete, doors 838 + 762: (18 000 - 1 600) x 1.10 = 18 040 -> 18 040 / 1520 = 11.87 -> 12
    // bedroom 11 lengths (above) -> 23 lengths -> 3 packs
    const plan = planGripper({
      rooms: [
        { ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom, doorways: [dw(838, 'carpet')], subfloor: timber, covering: 'carpet' },
        { ownerId: 'lng', ownerName: 'Lounge', polygon: lounge, doorways: [dw(838, 'carpet'), dw(762, 'hard_floor', { edgeIndex: 2 })], subfloor: { ...concrete, existingGripper: true }, covering: 'carpet' },
      ],
      extra: [],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan.totalLength).toBe(16019 + 18040);
    expect(plan.lengths).toBe(23);
    expect(plan.packs).toBe(3);
    expect(plan.byPin).toEqual({ timber: 16019, concrete: 18040 });
    expect(plan.perOwner[1]).toEqual({ ownerId: 'lng', ownerName: 'Lounge', length: 18040, lengths: 12, pin: 'concrete' });
    expect(plan.warnings).toEqual([{ level: 'info', code: 'REUSE_GRIPPER', message: expect.stringContaining('Lounge'), subjectId: 'lng' }]);
  });

  it('only broadloom carpet needs gripper', () => {
    const kinds: CoveringKind[] = ['sheet_vinyl', 'laminate', 'engineered_wood', 'lvt_click', 'lvt_glue', 'carpet_tiles'];
    for (const k of kinds) expect(needsGripper(k)).toBe(false);
    expect(needsGripper('carpet')).toBe(true);
    const plan = planGripper({
      rooms: kinds.map((covering, i) => ({ ownerId: `r${i}`, ownerName: covering, polygon: lounge, doorways: [], subfloor: timber, covering })),
      extra: [],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan).toEqual({ totalLength: 0, lengths: 0, packs: 0, byPin: { timber: 0, concrete: 0 }, perOwner: [], warnings: [] });
  });

  it('openings with nothing to fix to and continuous openings still come off the perimeter', () => {
    // 15 400 - 900 - 838 = 13 662 x 1.10 = 15 028.2 -> 15 029; / 1520 = 9.89 -> 10 lengths -> 1 pack
    const plan = planGripper({
      rooms: [{ ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom, doorways: [dw(900, 'none'), dw(838, 'carpet', { continuous: true, edgeIndex: 2 })], subfloor: timber, covering: 'carpet' }],
      extra: [],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan.totalLength).toBe(15029);
    expect(plan.lengths).toBe(10);
    expect(plan.packs).toBe(1);
  });

  it('extra runs (stairs) get the wastage and default to timber pins', () => {
    // 13 steps x 2 lengths x 860 = 22 360 x 1.10 = 24 596; / 1520 = 16.18 -> 17 lengths -> 2 packs
    const plan = planGripper({ rooms: [], extra: [{ ownerId: 'st', ownerName: 'Stairs', length: 22360 }], options: DEFAULT_ACCESSORIES });
    expect(plan.perOwner).toEqual([{ ownerId: 'st', ownerName: 'Stairs', length: 24596, lengths: 17, pin: 'timber' }]);
    expect(plan.packs).toBe(2);
    const onConcrete = planGripper({ rooms: [], extra: [{ ownerId: 'st', ownerName: 'Stairs', length: 22360, subfloorType: 'concrete' }], options: DEFAULT_ACCESSORIES });
    expect(onConcrete.byPin).toEqual({ timber: 0, concrete: 24596 });
  });

  it('zero wastage and an empty input', () => {
    // 14 562 / 1520 = 9.58 -> 10 lengths -> 1 pack
    const plan = planGripper({
      rooms: [{ ownerId: 'bed', ownerName: 'Bedroom', polygon: bedroom, doorways: [dw(838, 'carpet')], subfloor: timber, covering: 'carpet' }],
      extra: [],
      options: { ...DEFAULT_ACCESSORIES, gripperWastage: 0 },
    });
    expect(plan.totalLength).toBe(14562);
    expect(plan.lengths).toBe(10);
    expect(plan.packs).toBe(1);
    expect(planGripper({ rooms: [], extra: [], options: DEFAULT_ACCESSORIES })).toEqual({ totalLength: 0, lengths: 0, packs: 0, byPin: { timber: 0, concrete: 0 }, perOwner: [], warnings: [] });
  });

  it('maps every subfloor type to a pin', () => {
    const expected: Record<SubfloorType, 'timber' | 'concrete'> = {
      concrete: 'concrete',
      anhydrite: 'concrete',
      existing_tiles: 'concrete',
      asphalt: 'concrete',
      floorboards: 'timber',
      chipboard: 'timber',
      plywood: 'timber',
      existing_vinyl: 'timber',
    };
    for (const [type, pin] of Object.entries(expected) as [SubfloorType, 'timber' | 'concrete'][]) expect(gripperPinFor(type)).toBe(pin);
  });
});

// ===================================================================================================
// 3. Door bars
// ===================================================================================================

describe('planDoorBars', () => {
  it('transition matrix', () => {
    const cases: [CoveringKind, DoorwayTransition, string][] = [
      ['carpet', 'carpet', 'double_carpet'],
      ['carpet', 'hard_floor', 'single_edge'],
      ['carpet', 'same_floor', 'single_edge'],
      ['carpet', 'external', 'single_edge'],
      ['carpet', 'none', 'none'],
      ['carpet_tiles', 'carpet', 'double_carpet'],
      ['carpet_tiles', 'hard_floor', 'single_edge'],
      ['sheet_vinyl', 'carpet', 'single_edge'],
      ['sheet_vinyl', 'hard_floor', 'cover_strip'],
      ['sheet_vinyl', 'same_floor', 'cover_strip'],
      ['sheet_vinyl', 'external', 'end_profile'],
      ['sheet_vinyl', 'none', 'none'],
      ['laminate', 'same_floor', 't_bar'],
      ['laminate', 'hard_floor', 'ramp'],
      ['laminate', 'carpet', 'ramp'],
      ['laminate', 'external', 'end_profile'],
      ['laminate', 'none', 'none'],
      ['engineered_wood', 'carpet', 'ramp'],
      ['lvt_click', 'same_floor', 't_bar'],
      ['lvt_glue', 'external', 'end_profile'],
    ];
    for (const [covering, transition, type] of cases) expect(doorBarTypeFor(covering, transition)).toBe(type);
    expect(doorBarTypeFor('carpet', 'carpet', true)).toBe('none');
  });

  it('bar counts by opening width (900 mm standard, 2700 mm long)', () => {
    expect(doorBarsForWidth(838, DEFAULT_ACCESSORIES)).toEqual({ bars: 1, longBars: 0 });
    expect(doorBarsForWidth(900, DEFAULT_ACCESSORIES)).toEqual({ bars: 1, longBars: 0 });
    expect(doorBarsForWidth(901, DEFAULT_ACCESSORIES)).toEqual({ bars: 0, longBars: 1 });
    expect(doorBarsForWidth(2700, DEFAULT_ACCESSORIES)).toEqual({ bars: 0, longBars: 1 });
    expect(doorBarsForWidth(2701, DEFAULT_ACCESSORIES)).toEqual({ bars: 0, longBars: 2 }); // 2701 / 2700 -> 2
    expect(doorBarsForWidth(6000, DEFAULT_ACCESSORIES)).toEqual({ bars: 0, longBars: 3 }); // 6000 / 2700 = 2.22 -> 3
    expect(doorBarsForWidth(0, DEFAULT_ACCESSORIES)).toEqual({ bars: 0, longBars: 0 });
    // no long bar available: butt standard bars, 1800 / 900 -> 2
    expect(doorBarsForWidth(1800, { ...DEFAULT_ACCESSORIES, doorBarLongLength: 900 })).toEqual({ bars: 2, longBars: 0 });
  });

  it('a mixed house: carpet bedroom, vinyl kitchen, laminate lounge', () => {
    const rooms: DoorBarRoom[] = [
      {
        ownerId: 'bed',
        ownerName: 'Bedroom',
        covering: 'carpet',
        doorways: [
          dw(838, 'carpet', { id: 'b1', label: 'Bedroom door' }),
          dw(1800, 'external', { id: 'b2', label: 'Patio' }),
          dw(900, 'none', { id: 'b3', label: 'Wardrobe' }),
          dw(838, 'carpet', { id: 'b4', continuous: true }),
        ],
      },
      {
        ownerId: 'kit',
        ownerName: 'Kitchen',
        covering: 'sheet_vinyl',
        doorways: [dw(762, 'carpet', { id: 'k1' }), dw(838, 'hard_floor', { id: 'k2' }), dw(1800, 'external', { id: 'k3' })],
      },
      {
        ownerId: 'lng',
        ownerName: 'Lounge',
        covering: 'laminate',
        productThickness: 8,
        doorways: [dw(926, 'same_floor', { id: 'l1' }), dw(926, 'hard_floor', { id: 'l2' }), dw(926, 'carpet', { id: 'l3' }), dw(6000, 'external', { id: 'l4', label: 'Bi-fold' })],
      },
    ];
    const plan = planDoorBars({ rooms, options: DEFAULT_ACCESSORIES });
    expect(plan.bars).toHaveLength(11);
    expect(plan.bars.map((b) => [b.doorwayId, b.type, b.bars, b.longBars])).toEqual([
      ['b1', 'double_carpet', 1, 0],
      ['b2', 'single_edge', 0, 1],
      ['b3', 'none', 0, 0],
      ['b4', 'none', 0, 0],
      ['k1', 'single_edge', 1, 0],
      ['k2', 'cover_strip', 1, 0],
      ['k3', 'end_profile', 0, 1],
      ['l1', 't_bar', 0, 1], // 926 > 900 -> a long bar cut down
      ['l2', 'ramp', 0, 1],
      ['l3', 'ramp', 0, 1],
      ['l4', 'end_profile', 0, 3], // 6000 / 2700 = 2.22 -> 3
    ]);
    // labels: explicit where given, else "<room> doorway n"
    expect(plan.bars[0]!.label).toBe('Bedroom door');
    expect(plan.bars[3]!.label).toBe('Bedroom doorway 4');
    expect(plan.bars[1]!.width).toBe(1800);
    // standard: b1, k1, k2 = 3; long: b2, k3, l1, l2, l3 = 5 + l4 x 3 = 8
    expect(plan.standardBars).toBe(3);
    expect(plan.longBars).toBe(8);
    expect(plan.totalsByType).toEqual({ double_carpet: 1, single_edge: 2, cover_strip: 1, t_bar: 1, ramp: 2, end_profile: 4, none: 2 });
    expect(plan.warnings.map((w) => [w.code, w.subjectId])).toEqual([
      ['PATIO_DOOR', 'bed'],
      ['RAMP_ASSUMED', 'lng'],
    ]);
    expect(plan.warnings[1]!.message).toContain('8 mm');
    expect(PATIO_DOOR_MIN_WIDTH).toBe(1200);
  });

  it('counts a doorway entered from both rooms once, keeping the first room\'s bar', () => {
    const plan = planDoorBars({
      rooms: [
        { ownerId: 'bed', ownerName: 'Bedroom', covering: 'carpet', doorways: [dw(838, 'hard_floor', { id: 'a', label: 'Bedroom Door' })] },
        { ownerId: 'lnd', ownerName: 'Landing', covering: 'laminate', doorways: [dw(838, 'carpet', { id: 'b', label: ' bedroom door ' }), dw(838, 'carpet', { id: 'c', label: 'Bathroom door' })] },
        // the same label twice inside one room is two doorways, not a duplicate
        { ownerId: 'lng', ownerName: 'Lounge', covering: 'carpet', doorways: [dw(838, 'carpet', { id: 'd', label: 'Door' }), dw(838, 'carpet', { id: 'e', label: 'Door' })] },
      ],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan.bars.map((b) => b.doorwayId)).toEqual(['a', 'c', 'd', 'e']);
    expect(plan.bars[0]!.type).toBe('single_edge');
    expect(plan.standardBars).toBe(4);
    expect(plan.warnings).toEqual([{ level: 'info', code: 'DOORWAY_DUPLICATE', message: expect.stringContaining('Bedroom'), subjectId: 'lnd' }]);
  });

  it('no rooms / no doorways -> empty totals with every type present', () => {
    const plan = planDoorBars({ rooms: [{ ownerId: 'r', ownerName: 'Room', covering: 'carpet', doorways: [] }], options: DEFAULT_ACCESSORIES });
    expect(plan.bars).toEqual([]);
    expect(plan.standardBars).toBe(0);
    expect(plan.longBars).toBe(0);
    expect(Object.keys(plan.totalsByType).sort()).toEqual([...DOOR_BAR_TYPES].sort());
    for (const t of DOOR_BAR_TYPES) expect(plan.totalsByType[t]).toBe(0);
    expect(plan.warnings).toEqual([]);
  });

  it('a 1.2 m external opening from carpet is not a patio door; 1.201 m is', () => {
    const at = planDoorBars({ rooms: [{ ownerId: 'r', ownerName: 'Room', covering: 'carpet', doorways: [dw(1200, 'external')] }], options: DEFAULT_ACCESSORIES });
    expect(at.warnings).toEqual([]);
    const over = planDoorBars({ rooms: [{ ownerId: 'r', ownerName: 'Room', covering: 'carpet', doorways: [dw(1201, 'external')] }], options: DEFAULT_ACCESSORIES });
    expect(over.warnings.map((w) => w.code)).toEqual(['PATIO_DOOR']);
    // vinyl to the outside is an end profile with no patio note
    const vinyl = planDoorBars({ rooms: [{ ownerId: 'r', ownerName: 'Room', covering: 'sheet_vinyl', doorways: [dw(1800, 'external')] }], options: DEFAULT_ACCESSORIES });
    expect(vinyl.warnings).toEqual([]);
  });
});

// ===================================================================================================
// 4. Tapes
// ===================================================================================================

describe('planTapes', () => {
  const kitchen = shapeToPolygon({ kind: 'rectangle', length: 4000, width: 3000 });

  it('vinyl kitchen 4 x 3 m with one 3 m seam: perimeter 14 m + 3 m = 17 m -> 1 roll of 25 m', () => {
    const plan = planTapes({
      rooms: [{ ownerId: 'k', ownerName: 'Kitchen', covering: 'sheet_vinyl', polygon: kitchen, seams: [{ from: { x: 2000, y: 0 }, to: { x: 2000, y: 3000 }, kind: 'side' }] }],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan).toEqual({ seamTapeLength: 0, seamTapeRolls: 0, doubleSidedTapeLength: 17000, doubleSidedTapeRolls: 1 });
  });

  it('carpet seams (side and cross) add up to seam tape; 22.4 m -> 2 rolls of 20 m', () => {
    // lounge: 2 x 6000 side + 1 x 2000 cross = 14 000; bedroom: 2 x 4200 = 8 400 -> 22 400 / 20 000 = 1.12 -> 2
    const plan = planTapes({
      rooms: [
        {
          ownerId: 'lng',
          ownerName: 'Lounge',
          covering: 'carpet',
          polygon: lounge,
          seams: [
            { from: { x: 0, y: 4000 }, to: { x: 6000, y: 4000 }, kind: 'side' },
            { from: { x: 0, y: 4000 }, to: { x: 6000, y: 4000 }, kind: 'side' },
            { from: { x: 2000, y: 4000 }, to: { x: 2000, y: 6000 }, kind: 'cross' },
          ],
        },
        {
          ownerId: 'bed',
          ownerName: 'Bedroom',
          covering: 'carpet',
          polygon: bedroom,
          seams: [
            { from: { x: 0, y: 1370 }, to: { x: 4200, y: 1370 }, kind: 'side' },
            { from: { x: 0, y: 2740 }, to: { x: 4200, y: 2740 }, kind: 'side' },
          ],
        },
      ],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan.seamTapeLength).toBe(22400);
    expect(plan.seamTapeRolls).toBe(2);
    expect(plan.doubleSidedTapeLength).toBe(0);
    expect(plan.doubleSidedTapeRolls).toBe(0);
  });

  it('a diagonal seam is measured along its length (3-4-5)', () => {
    const plan = planTapes({
      rooms: [{ ownerId: 'r', ownerName: 'Room', covering: 'carpet', polygon: kitchen, seams: [{ from: { x: 0, y: 0 }, to: { x: 3000, y: 4000 }, kind: 'side' }] }],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan.seamTapeLength).toBe(5000);
    expect(plan.seamTapeRolls).toBe(1);
  });

  it('two vinyl rooms: 4 x 3 with a 3 m seam (17 m) + 3 x 3 (12 m) = 29 m -> 2 rolls', () => {
    const plan = planTapes({
      rooms: [
        { ownerId: 'k', ownerName: 'Kitchen', covering: 'sheet_vinyl', polygon: kitchen, seams: [{ from: { x: 2000, y: 0 }, to: { x: 2000, y: 3000 }, kind: 'side' }] },
        { ownerId: 'u', ownerName: 'Utility', covering: 'sheet_vinyl', polygon: shapeToPolygon({ kind: 'rectangle', length: 3000, width: 3000 }), seams: [] },
      ],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan.doubleSidedTapeLength).toBe(29000);
    expect(plan.doubleSidedTapeRolls).toBe(2);
  });

  it('hard floors and carpet tiles need neither tape; empty input is all zeros', () => {
    const seams = [{ from: { x: 0, y: 0 }, to: { x: 4000, y: 0 }, kind: 'side' as const }];
    const plan = planTapes({
      rooms: [
        { ownerId: 'a', ownerName: 'A', covering: 'laminate', polygon: kitchen, seams },
        { ownerId: 'b', ownerName: 'B', covering: 'lvt_glue', polygon: kitchen, seams },
        { ownerId: 'c', ownerName: 'C', covering: 'carpet_tiles', polygon: kitchen, seams },
      ],
      options: DEFAULT_ACCESSORIES,
    });
    expect(plan).toEqual({ seamTapeLength: 0, seamTapeRolls: 0, doubleSidedTapeLength: 0, doubleSidedTapeRolls: 0 });
    expect(planTapes({ rooms: [], options: DEFAULT_ACCESSORIES })).toEqual({ seamTapeLength: 0, seamTapeRolls: 0, doubleSidedTapeLength: 0, doubleSidedTapeRolls: 0 });
  });
});
