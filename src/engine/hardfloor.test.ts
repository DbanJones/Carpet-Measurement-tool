import {
  planHardFloor,
  planSheetVinylSundries,
  wastageFor,
  hardFloorWastage,
  isFloatingFloor,
  thresholdProfileFor,
  estimateRows,
  LARGE_ROOM_AREA_M2,
  LARGE_ROOM_EXTRA_WASTAGE,
  NON_RECTILINEAR_EXTRA_WASTAGE,
  HARD_FLOOR_UNDERLAY_WASTAGE,
  EXPANSION_JOINT_MAX_RUN,
  DPM_SUBFLOORS,
  type HardFloorRoomInput,
} from './hardfloor';
import { shapeToPolygon } from './geometry';
import { DEFAULT_HARD_FLOOR, DEFAULT_ACCESSORIES, DEFAULT_FLOOR_PREP, LAY_PATTERN_WASTAGE, CARPET_TILE_WASTAGE, BEADING_WASTAGE } from './defaults';
import type { Doorway, DoorwayTransition, HardFloorOptions, PackProduct, Polygon, Subfloor, SubfloorType } from './types';

// ---- fixtures -------------------------------------------------------------------------------------

/** 4.2 m x 3.5 m bedroom: area 14.7 m², perimeter 15.4 m. */
const bedroom = shapeToPolygon({ kind: 'rectangle', length: 4200, width: 3500 });
/** 5.0 m x 4.0 m lounge: area 20 m², perimeter 18 m. */
const lounge = shapeToPolygon({ kind: 'rectangle', length: 5000, width: 4000 });
/** 3.0 m x 4.0 m kitchen: area 12 m², perimeter 14 m. */
const kitchen = shapeToPolygon({ kind: 'rectangle', length: 3000, width: 4000 });
/** 10 m x 7 m open-plan: area 70 m², perimeter 34 m. */
const openPlan = shapeToPolygon({ kind: 'rectangle', length: 10000, width: 7000 });
/** 6 x 5 m with a 2 x 1.5 m corner missing (rectilinear L): area 27 m². */
const lShape = shapeToPolygon({ kind: 'l_shape', length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: 'top-right' });
/**
 * 4 x 3 m with the bottom-left corner cut off on the diagonal (splayed wall):
 * shoelace: 4000*3000 + (4000*3000 - 1000*3000) + 1000*2000 = 12e6 + 9e6 + 2e6 = 23e6 -> /2 = 11.5 m².
 */
const splayed: Polygon = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 1000, y: 3000 },
  { x: 0, y: 2000 },
];
/** 10 x 6 m with the same 1 x 1 m diagonal corner: 60 - 0.5 = 59.5 m². */
const bigSplayed: Polygon = [
  { x: 0, y: 0 },
  { x: 10000, y: 0 },
  { x: 10000, y: 6000 },
  { x: 1000, y: 6000 },
  { x: 0, y: 5000 },
];

const timber: Subfloor = { type: 'floorboards', condition: 'good' };
const concrete: Subfloor = { type: 'concrete', condition: 'good' };

/** 2.22 m² packs, no board geometry. */
const laminate: PackProduct = { id: 'lam', name: 'Oak laminate 8 mm', kind: 'laminate', packCoverageM2: 2.22 };
/** Same pack with geometry: 1285 x 192 = 0.24672 m² per board, 9 per pack = 2.22048 m². */
const laminateBoards: PackProduct = { ...laminate, id: 'lam-b', boardLength: 1285, boardWidth: 192, boardsPerPack: 9 };
const wood: PackProduct = { id: 'eng', name: 'Engineered oak 14 mm', kind: 'engineered_wood', packCoverageM2: 2.16, boardLength: 1800, boardWidth: 150 };
const lvtClick: PackProduct = { id: 'lvtc', name: 'LVT click plank', kind: 'lvt_click', packCoverageM2: 2.0, boardLength: 1220, boardWidth: 180 };
const lvtGlue: PackProduct = { id: 'lvtg', name: 'LVT glue-down plank', kind: 'lvt_glue', packCoverageM2: 3.34 };
/** 20 x 500 mm tiles per box = 5 m². */
const tiles: PackProduct = { id: 'ct', name: 'Carpet tile 500', kind: 'carpet_tiles', packCoverageM2: 5 };

let seq = 0;
function dw(width: number, transition: DoorwayTransition, extra: Partial<Doorway> = {}): Doorway {
  seq += 1;
  return { id: `d${seq}`, edgeIndex: 0, offset: 500, width, transition, ...extra };
}

function room(polygon: Polygon, extra: Partial<HardFloorRoomInput> = {}): HardFloorRoomInput {
  return { ownerId: 'r1', ownerName: 'Room', polygon, doorways: [], subfloor: timber, ...extra };
}

/** Defaults but with 10 m² underlay packs (XPS / fibreboard) so the worked example in the brief holds. */
const opts: HardFloorOptions = { ...DEFAULT_HARD_FLOOR, underlayPackCoverageM2: 10 };

const codes = (w: { code: string }[]) => w.map((x) => x.code);

// ---- wastage ---------------------------------------------------------------------------------------

describe('wastageFor', () => {
  it('reads the trade table for every pattern', () => {
    expect(wastageFor('straight')).toBe(LAY_PATTERN_WASTAGE.straight);
    expect(wastageFor('random_stagger')).toBe(0.07);
    expect(wastageFor('brick')).toBe(0.08);
    expect(wastageFor('diagonal')).toBe(0.15);
    expect(wastageFor('herringbone')).toBe(0.2);
    expect(wastageFor('chevron')).toBe(0.2);
  });

  it('prefers a valid override, including zero', () => {
    expect(wastageFor('herringbone', 0.12)).toBe(0.12);
    expect(wastageFor('straight', 0)).toBe(0);
  });

  it('ignores a negative or NaN override', () => {
    expect(wastageFor('straight', -0.1)).toBe(0.07);
    expect(wastageFor('straight', Number.NaN)).toBe(0.07);
  });
});

describe('hardFloorWastage', () => {
  it('adds the large-room and odd-shape increments independently', () => {
    expect(hardFloorWastage({ kind: 'laminate', layPattern: 'straight', netAreaM2: 14.7, rectilinear: true })).toEqual({ base: 0.07, largeRoomExtra: 0, oddShapeExtra: 0, total: 0.07 });
    // > 40 m²: 0.07 + 0.02
    expect(hardFloorWastage({ kind: 'laminate', layPattern: 'straight', netAreaM2: 40.5, rectilinear: true }).total).toBe(0.09);
    // exactly 40 m² is not "over 40"
    expect(hardFloorWastage({ kind: 'laminate', layPattern: 'straight', netAreaM2: LARGE_ROOM_AREA_M2, rectilinear: true }).total).toBe(0.07);
    // splayed wall: 0.07 + 0.03
    expect(hardFloorWastage({ kind: 'laminate', layPattern: 'straight', netAreaM2: 11.5, rectilinear: false }).total).toBe(0.1);
    // both: 0.07 + 0.02 + 0.03
    const both = hardFloorWastage({ kind: 'laminate', layPattern: 'straight', netAreaM2: 59.5, rectilinear: false });
    expect(both).toEqual({ base: 0.07, largeRoomExtra: LARGE_ROOM_EXTRA_WASTAGE, oddShapeExtra: NON_RECTILINEAR_EXTRA_WASTAGE, total: 0.12 });
  });

  it('carpet tiles use the tile wastage, not the plank pattern table, unless overridden', () => {
    expect(hardFloorWastage({ kind: 'carpet_tiles', layPattern: 'herringbone', netAreaM2: 20, rectilinear: true }).base).toBe(CARPET_TILE_WASTAGE);
    expect(hardFloorWastage({ kind: 'carpet_tiles', layPattern: 'straight', override: 0.1, netAreaM2: 20, rectilinear: true }).base).toBe(0.1);
    // an invalid override falls back to the tile figure, not the plank table
    expect(hardFloorWastage({ kind: 'carpet_tiles', layPattern: 'brick', override: -1, netAreaM2: 20, rectilinear: true }).base).toBe(CARPET_TILE_WASTAGE);
  });
});

describe('isFloatingFloor / thresholdProfileFor', () => {
  it('classifies the pack kinds', () => {
    expect(isFloatingFloor('laminate')).toBe(true);
    expect(isFloatingFloor('engineered_wood')).toBe(true);
    expect(isFloatingFloor('lvt_click')).toBe(true);
    expect(isFloatingFloor('lvt_glue')).toBe(false);
    expect(isFloatingFloor('carpet_tiles')).toBe(false);
  });

  it('maps transitions to profiles', () => {
    expect(thresholdProfileFor('laminate', 'same_floor')).toBe('T-bar');
    expect(thresholdProfileFor('laminate', 'hard_floor')).toBe('ramp');
    expect(thresholdProfileFor('lvt_glue', 'carpet')).toBe('ramp');
    expect(thresholdProfileFor('engineered_wood', 'external')).toBe('end');
    expect(thresholdProfileFor('laminate', 'none')).toBe('none');
    expect(thresholdProfileFor('laminate', 'same_floor', true)).toBe('none');
    // carpet tiles are finished like carpet: door bars are counted elsewhere
    expect(thresholdProfileFor('carpet_tiles', 'external')).toBe('none');
    expect(thresholdProfileFor('carpet_tiles', 'same_floor')).toBe('none');
  });
});

// ---- (1) straight-laid laminate --------------------------------------------------------------------

describe('planHardFloor: 4.2 x 3.5 m laminate bedroom (worked example)', () => {
  const plan = planHardFloor({ room: room(bedroom, { doorways: [dw(838, 'hard_floor', { label: 'Landing door' })] }), product: laminate, options: opts });

  it('net 14.7 m², 7 % -> gross 15.729 m², 8 packs of 2.22 m²', () => {
    expect(plan.ownerId).toBe('r1');
    expect(plan.netAreaM2).toBeCloseTo(14.7, 9);
    expect(plan.wastage).toBe(0.07);
    expect(plan.grossAreaM2).toBeCloseTo(15.729, 9);
    // 15.729 / 2.22 = 7.0851... -> 8
    expect(plan.exactPacks).toBeCloseTo(7.08513, 4);
    expect(plan.packs).toBe(8);
    expect(plan.boardsEstimate).toBeUndefined();
    expect(plan.rowsEstimate).toBeUndefined();
  });

  it('underlay 14.7 x 1.05 = 15.435 m² -> 2 packs of 10 m²; no DPM on floorboards', () => {
    expect(plan.underlayAreaM2).toBeCloseTo(15.435, 9);
    expect(plan.underlayPacks).toBe(2);
    expect(plan.dpmSheetRolls).toBe(0);
  });

  it('beading (15.4 - 0.838) x 1.1 = 16.0182 m -> 7 lengths of 2.4 m', () => {
    expect(plan.beadingMetres).toBeCloseTo(16.0182, 6);
    // 16.0182 / 2.4 = 6.674 -> 7
    expect(plan.beadingLengths).toBe(7);
  });

  it('one ramp threshold at the 838 mm door; no adhesive, tackifier or tiles; 10 mm expansion gap; no warnings', () => {
    expect(plan.thresholds).toEqual([{ doorwayId: 'd1', label: 'Landing door', width: 838, profile: 'ramp' }]);
    expect(plan.adhesiveKg).toBe(0);
    expect(plan.adhesiveTubs).toBe(0);
    expect(plan.tackifierLitres).toBe(0);
    expect(plan.tackifierTubs).toBe(0);
    expect(plan.tiles).toBeUndefined();
    expect(plan.boxes).toBeUndefined();
    expect(plan.expansionGap).toBe(DEFAULT_HARD_FLOOR.expansionGap);
    expect(plan.warnings).toEqual([]);
  });

  it('with board geometry: 64 boards, 19 rows of 192 mm across 3.5 m and a 44 mm sliver', () => {
    const p = planHardFloor({ room: room(bedroom), product: laminateBoards, options: opts });
    // 0.24672 m² per board: 63 boards = 15.543 < 15.729 < 64 boards = 15.790
    expect(p.boardsEstimate).toBe(64);
    // ceil(3500 / 192 = 18.23) = 19 rows; last = 3500 - 18 x 192 = 44 mm < 192 / 3 = 64 -> warn
    expect(p.rowsEstimate).toMatchObject({ alongLength: 19, alongWidth: 22, lastRowWidthMm: 44 });
    expect(p.rowsEstimate?.warning).toMatch(/44 mm/);
    expect(codes(p.warnings)).toEqual(['NARROW_LAST_ROW']);
  });

  it('with the skirting lifted instead of beading: no beading, everything else unchanged', () => {
    const p = planHardFloor({ room: room(bedroom), product: laminate, options: { ...opts, useBeading: false } });
    expect(p.beadingLengths).toBe(0);
    expect(p.beadingMetres).toBe(0);
    expect(p.packs).toBe(8);
    expect(p.underlayPacks).toBe(2);
  });

  it('labels unlabelled doorways by position and clamps the width to the edge', () => {
    const p = planHardFloor({ room: room(bedroom, { doorways: [dw(762, 'same_floor'), dw(2400, 'external', { offset: 3000 })] }), product: laminate, options: opts });
    expect(p.thresholds[0]).toMatchObject({ label: 'Doorway 1', width: 762, profile: 'T-bar' });
    // edge 0 is 4200 long: an opening from 3000 to 5400 is clamped to 1200
    expect(p.thresholds[1]).toMatchObject({ label: 'Doorway 2', width: 1200, profile: 'end' });
  });
});

// ---- (2) herringbone LVT click ---------------------------------------------------------------------

describe('planHardFloor: herringbone LVT click, 5 x 4 m lounge', () => {
  const plan = planHardFloor({ room: room(lounge), product: lvtClick, options: { ...DEFAULT_HARD_FLOOR, layPattern: 'herringbone' } });

  it('20 % wastage: gross 24 m² -> 12 packs of 2 m²', () => {
    expect(plan.wastage).toBe(0.2);
    expect(plan.grossAreaM2).toBeCloseTo(24, 9);
    expect(plan.exactPacks).toBeCloseTo(12, 9);
    expect(plan.packs).toBe(12);
  });

  it('underlay 20 x 1.05 = 21 m² -> 2 packs of 15 m²; beading 18 x 1.1 = 19.8 m -> 9 lengths', () => {
    expect(plan.underlayAreaM2).toBeCloseTo(21, 9);
    expect(plan.underlayPacks).toBe(2);
    expect(plan.beadingMetres).toBeCloseTo(19.8, 9);
    // 19.8 / 2.4 = 8.25 -> 9
    expect(plan.beadingLengths).toBe(9);
    expect(plan.expansionGap).toBe(10);
  });

  it('no row estimate for a herringbone lay even though the board geometry is known', () => {
    expect(plan.rowsEstimate).toBeUndefined();
    // boards are still estimated: 1220 x 180 = 0.2196 m²; 24 / 0.2196 = 109.3 -> 110
    expect(plan.boardsEstimate).toBe(110);
  });

  it('an explicit wastage override replaces the pattern figure: 10 % -> 22 m² -> 11 packs', () => {
    const p = planHardFloor({ room: room(lounge), product: lvtClick, options: { ...DEFAULT_HARD_FLOOR, layPattern: 'herringbone', wastage: 0.1 } });
    expect(p.wastage).toBe(0.1);
    expect(p.grossAreaM2).toBeCloseTo(22, 9);
    expect(p.packs).toBe(11);
  });
});

// ---- (3) glue-down LVT ---------------------------------------------------------------------------

describe('planHardFloor: glue-down LVT', () => {
  it('20 m² lounge: gross 21.4 m² -> 5.35 kg adhesive -> 1 tub; 7 packs of 3.34 m²', () => {
    const plan = planHardFloor({ room: room(lounge, { subfloor: concrete, doorways: [dw(838, 'same_floor')] }), product: lvtGlue, options: { ...DEFAULT_HARD_FLOOR, underlayHasDpm: false } });
    expect(plan.grossAreaM2).toBeCloseTo(21.4, 9);
    // 21.4 / 4 m² per kg = 5.35 kg; 5.35 / 15 kg tubs -> 1
    expect(plan.adhesiveKg).toBeCloseTo(5.35, 9);
    expect(plan.adhesiveTubs).toBe(1);
    // 21.4 / 3.34 = 6.407 -> 7
    expect(plan.packs).toBe(7);
    // stuck down: no underlay, no DPM sheet (even on concrete with a non-DPM underlay option), no gap, no beading
    expect(plan.underlayPacks).toBe(0);
    expect(plan.underlayAreaM2).toBe(0);
    expect(plan.dpmSheetRolls).toBe(0);
    expect(plan.expansionGap).toBe(0);
    expect(plan.beadingLengths).toBe(0);
    expect(plan.beadingMetres).toBe(0);
    // thresholds are still fitted
    expect(plan.thresholds).toEqual([{ doorwayId: expect.any(String), label: 'Doorway 1', width: 838, profile: 'T-bar' }]);
    expect(plan.tackifierLitres).toBe(0);
    expect(plan.warnings).toEqual([]);
  });

  it('70 m² open-plan: +2 % large room -> 76.3 m² -> 19.075 kg -> 2 tubs, and no expansion-joint warning', () => {
    const plan = planHardFloor({ room: room(openPlan), product: lvtGlue, options: DEFAULT_HARD_FLOOR });
    expect(plan.wastage).toBe(0.09);
    expect(plan.grossAreaM2).toBeCloseTo(76.3, 9);
    expect(plan.adhesiveKg).toBeCloseTo(19.075, 9);
    // 19.075 / 15 = 1.27 -> 2
    expect(plan.adhesiveTubs).toBe(2);
    expect(codes(plan.warnings)).toEqual(['LARGE_ROOM']);
  });
});

// ---- (4) carpet tiles ----------------------------------------------------------------------------

describe('planHardFloor: carpet tiles', () => {
  const plan = planHardFloor({ room: room(lounge, { doorways: [dw(838, 'external'), dw(762, 'same_floor', { offset: 2000 })] }), product: tiles, options: DEFAULT_HARD_FLOOR });

  it('20 m² -> 21.4 m² -> 86 tiles -> 5 boxes of 20', () => {
    expect(plan.wastage).toBe(CARPET_TILE_WASTAGE);
    expect(plan.grossAreaM2).toBeCloseTo(21.4, 9);
    // 21.4 / 0.25 = 85.6 -> 86
    expect(plan.tiles).toBe(86);
    expect(plan.boardsEstimate).toBe(86);
    // 5 m² box / 0.25 m² = 20 per box: 86 / 20 = 4.3 -> 5
    expect(plan.boxes).toBe(5);
    expect(plan.packs).toBe(5);
    expect(plan.exactPacks).toBeCloseTo(4.3, 9);
  });

  it('tackifier 21.4 / 7 m² per litre = 3.06 -> 4 L -> 1 tub of 5 L', () => {
    expect(plan.tackifierLitres).toBe(4);
    expect(plan.tackifierTubs).toBe(1);
    expect(plan.adhesiveKg).toBe(0);
    expect(plan.adhesiveTubs).toBe(0);
  });

  it('no underlay, DPM, beading or expansion gap; thresholds are all "none" (door bars counted elsewhere)', () => {
    expect(plan.underlayPacks).toBe(0);
    expect(plan.underlayAreaM2).toBe(0);
    expect(plan.dpmSheetRolls).toBe(0);
    expect(plan.beadingLengths).toBe(0);
    expect(plan.expansionGap).toBe(0);
    expect(plan.thresholds.map((t) => t.profile)).toEqual(['none', 'none']);
    expect(plan.thresholds.map((t) => t.width)).toEqual([838, 762]);
  });

  it('rows of 500 mm tiles: 8 courses across the 4 m width, last course 500 mm; 10 along the 5 m', () => {
    expect(plan.rowsEstimate).toEqual({ alongLength: 8, alongWidth: 10, lastRowWidthMm: 500 });
    expect(plan.warnings).toEqual([]);
  });

  it('boxes follow the product: 16 tiles per box -> 6 boxes', () => {
    const p = planHardFloor({ room: room(lounge), product: { ...tiles, packCoverageM2: 4, boardsPerPack: 16 }, options: DEFAULT_HARD_FLOOR });
    expect(p.tiles).toBe(86);
    // 86 / 16 = 5.375 -> 6
    expect(p.boxes).toBe(6);
    expect(p.packs).toBe(6);
    expect(p.exactPacks).toBeCloseTo(5.375, 9);
    // and a box whose coverage is unknown falls back to the trade default of 20
    const q = planHardFloor({ room: room(lounge), product: { ...tiles, packCoverageM2: 0 }, options: DEFAULT_HARD_FLOOR });
    expect(q.boxes).toBe(5);
    expect(codes(q.warnings)).toEqual([]);
  });

  it('70 m² office: 9 % -> 76.3 m² -> 306 tiles -> 16 boxes; 11 L tackifier -> 3 tubs', () => {
    const p = planHardFloor({ room: room(openPlan), product: tiles, options: DEFAULT_HARD_FLOOR });
    expect(p.wastage).toBe(0.09);
    // 76.3 / 0.25 = 305.2 -> 306; 306 / 20 = 15.3 -> 16
    expect(p.tiles).toBe(306);
    expect(p.boxes).toBe(16);
    // 76.3 / 7 = 10.9 -> 11 L; 11 / 5 = 2.2 -> 3 tubs
    expect(p.tackifierLitres).toBe(11);
    expect(p.tackifierTubs).toBe(3);
  });

  it('a wastage override applies to tiles too: 10 % -> 22 m² -> 88 tiles', () => {
    const p = planHardFloor({ room: room(lounge), product: tiles, options: { ...DEFAULT_HARD_FLOOR, wastage: 0.1 } });
    expect(p.tiles).toBe(88);
    expect(p.boxes).toBe(5);
  });
});

// ---- (5) shape and size increments ----------------------------------------------------------------

describe('planHardFloor: wastage increments for shape and size', () => {
  it('a splayed wall adds 3 %: 11.5 m² -> 10 % -> 12.65 m² -> 6 packs, with an ODD_SHAPE note', () => {
    const plan = planHardFloor({ room: room(splayed), product: laminate, options: opts });
    expect(plan.netAreaM2).toBeCloseTo(11.5, 9);
    expect(plan.wastage).toBe(0.1);
    expect(plan.grossAreaM2).toBeCloseTo(12.65, 9);
    // 12.65 / 2.22 = 5.698 -> 6
    expect(plan.packs).toBe(6);
    expect(codes(plan.warnings)).toEqual(['ODD_SHAPE']);
    expect(plan.warnings[0]!.level).toBe('info');
    expect(plan.warnings[0]!.subjectId).toBe('r1');
  });

  it('a rectilinear L-shape gets no shape increment: 27 m² -> 7 % -> 28.89 m² -> 14 packs', () => {
    const plan = planHardFloor({ room: room(lShape), product: laminate, options: opts });
    expect(plan.netAreaM2).toBeCloseTo(27, 9);
    expect(plan.wastage).toBe(0.07);
    expect(plan.grossAreaM2).toBeCloseTo(28.89, 9);
    // 28.89 / 2.22 = 13.01 -> 14
    expect(plan.packs).toBe(14);
    expect(plan.warnings).toEqual([]);
  });

  it('large and splayed stack: 59.5 m² -> 12 % -> 66.64 m² -> 31 packs, both notes', () => {
    const plan = planHardFloor({ room: room(bigSplayed), product: laminate, options: opts });
    expect(plan.netAreaM2).toBeCloseTo(59.5, 9);
    expect(plan.wastage).toBe(0.12);
    expect(plan.grossAreaM2).toBeCloseTo(66.64, 9);
    // 66.64 / 2.22 = 30.02 -> 31
    expect(plan.packs).toBe(31);
    expect(codes(plan.warnings)).toEqual(expect.arrayContaining(['LARGE_ROOM', 'ODD_SHAPE', 'EXPANSION_GAP_LARGE_ROOM']));
  });

  it('exactly 40 m² (8 x 5) is not a large room; 40.5 m² (9 x 4.5) is', () => {
    const forty = planHardFloor({ room: room(shapeToPolygon({ kind: 'rectangle', length: 8000, width: 5000 })), product: laminate, options: opts });
    expect(forty.wastage).toBe(0.07);
    const bigger = planHardFloor({ room: room(shapeToPolygon({ kind: 'rectangle', length: 9000, width: 4500 })), product: laminate, options: opts });
    expect(bigger.wastage).toBe(0.09);
    expect(codes(bigger.warnings)).toContain('LARGE_ROOM');
  });
});

// ---- (6) DPM sheet -------------------------------------------------------------------------------

describe('planHardFloor: polythene DPM under a floating floor', () => {
  const noDpm: HardFloorOptions = { ...opts, underlayHasDpm: false };

  it('laminate on concrete with a plain underlay: 14.7 x 1.15 = 16.9 m² -> 1 roll of 100 m²', () => {
    const plan = planHardFloor({ room: room(bedroom, { subfloor: concrete }), product: laminate, options: noDpm });
    expect(DEFAULT_FLOOR_PREP.dpmOverlap).toBe(0.15);
    expect(DEFAULT_FLOOR_PREP.dpmSheetRollAreaM2).toBe(100);
    expect(plan.dpmSheetRolls).toBe(1);
    expect(codes(plan.warnings)).toEqual(['DPM_SHEET']);
    expect(plan.warnings[0]!.message).toMatch(/1 roll\b/);
  });

  it('90 m² on concrete: 90 x 1.15 = 103.5 m² -> 2 rolls (the 15 % lap allowance tips it over)', () => {
    const plan = planHardFloor({ room: room(shapeToPolygon({ kind: 'rectangle', length: 10000, width: 9000 }), { subfloor: concrete }), product: laminate, options: noDpm });
    expect(plan.dpmSheetRolls).toBe(2);
  });

  it('honours the project floor-prep options when passed: 50 m² rolls, 10 % laps -> 90 x 1.1 = 99 -> 2 rolls', () => {
    const plan = planHardFloor({
      room: room(shapeToPolygon({ kind: 'rectangle', length: 10000, width: 9000 }), { subfloor: concrete }),
      product: laminate,
      options: noDpm,
      floorPrep: { dpmSheetRollAreaM2: 50, dpmOverlap: 0.1 },
    });
    expect(plan.dpmSheetRolls).toBe(2);
  });

  it('no sheet when the underlay has its own DPM, or on a timber / sheet subfloor', () => {
    expect(planHardFloor({ room: room(bedroom, { subfloor: concrete }), product: laminate, options: opts }).dpmSheetRolls).toBe(0);
    for (const type of ['floorboards', 'chipboard', 'plywood', 'existing_vinyl'] as SubfloorType[]) {
      expect(planHardFloor({ room: room(bedroom, { subfloor: { type, condition: 'good' } }), product: laminate, options: noDpm }).dpmSheetRolls).toBe(0);
    }
  });

  it('every damp-prone subfloor needs one, for every floating kind', () => {
    expect(DPM_SUBFLOORS).toEqual(['concrete', 'anhydrite', 'asphalt', 'existing_tiles']);
    for (const type of DPM_SUBFLOORS) {
      for (const product of [laminate, wood, lvtClick]) {
        expect(planHardFloor({ room: room(bedroom, { subfloor: { type, condition: 'good' } }), product, options: noDpm }).dpmSheetRolls).toBe(1);
      }
    }
  });

  it('flags underfloor heating for the underlay choice', () => {
    const plan = planHardFloor({ room: room(bedroom, { subfloor: { ...concrete, underfloorHeating: true } }), product: wood, options: opts });
    expect(codes(plan.warnings)).toEqual(['UFH_UNDERLAY']);
  });
});

// ---- (7) sheet vinyl sundries --------------------------------------------------------------------

describe('planSheetVinylSundries', () => {
  const vinylRoom = { ownerId: 'k', polygon: kitchen, doorways: [dw(762, 'carpet')] };

  it('fully bonded 12 m² kitchen: 12 / 4 = 3 kg -> 1 tub; no tape', () => {
    const s = planSheetVinylSundries({ room: vinylRoom, fullyBonded: true, seamLengthMm: 3000, accessories: DEFAULT_ACCESSORIES });
    expect(s).toEqual({ adhesiveKg: 3, adhesiveTubs: 1, doubleSidedTapeLength: 0, doubleSidedTapeRolls: 0 });
  });

  it('fully bonded 70 m²: 17.5 kg -> 2 tubs of 15 kg', () => {
    const s = planSheetVinylSundries({ room: { ownerId: 'o', polygon: openPlan, doorways: [] }, fullyBonded: true, seamLengthMm: 0, accessories: DEFAULT_ACCESSORIES });
    expect(s.adhesiveKg).toBeCloseTo(17.5, 9);
    expect(s.adhesiveTubs).toBe(2);
  });

  it('perimeter-stuck: 14 m perimeter + 3 m seam = 17 m -> 1 roll of 25 m; no adhesive', () => {
    const s = planSheetVinylSundries({ room: vinylRoom, fullyBonded: false, seamLengthMm: 3000, accessories: DEFAULT_ACCESSORIES });
    expect(s).toEqual({ adhesiveKg: 0, adhesiveTubs: 0, doubleSidedTapeLength: 17000, doubleSidedTapeRolls: 1 });
  });

  it('perimeter-stuck with 12 m of seams: 26 m -> 2 rolls; shorter rolls change the count', () => {
    const s = planSheetVinylSundries({ room: vinylRoom, fullyBonded: false, seamLengthMm: 12000, accessories: DEFAULT_ACCESSORIES });
    expect(s.doubleSidedTapeLength).toBe(26000);
    expect(s.doubleSidedTapeRolls).toBe(2);
    const t = planSheetVinylSundries({ room: vinylRoom, fullyBonded: false, seamLengthMm: 3000, accessories: { ...DEFAULT_ACCESSORIES, doubleSidedTapeRollLength: 10000 } });
    // 17 m / 10 m -> 2
    expect(t.doubleSidedTapeRolls).toBe(2);
  });

  it('a negative seam length counts as none; an empty room needs nothing', () => {
    const s = planSheetVinylSundries({ room: vinylRoom, fullyBonded: false, seamLengthMm: -500, accessories: DEFAULT_ACCESSORIES });
    expect(s.doubleSidedTapeLength).toBe(14000);
    const e = planSheetVinylSundries({ room: { ownerId: 'e', polygon: [], doorways: [] }, fullyBonded: true, seamLengthMm: 0, accessories: DEFAULT_ACCESSORIES });
    expect(e).toEqual({ adhesiveKg: 0, adhesiveTubs: 0, doubleSidedTapeLength: 0, doubleSidedTapeRolls: 0 });
    const f = planSheetVinylSundries({ room: { ownerId: 'e', polygon: [], doorways: [] }, fullyBonded: false, seamLengthMm: 3000, accessories: DEFAULT_ACCESSORIES });
    expect(f.doubleSidedTapeRolls).toBe(0);
  });
});

// ---- (8) rows and expansion joints ----------------------------------------------------------------

describe('estimateRows', () => {
  it('190 mm boards across 3000 mm: 16 rows, last row 150 mm (>= 63.3, no warning); 22 rows the other way', () => {
    // ceil(3000 / 190 = 15.79) = 16; 3000 - 15 x 190 = 150; 190 / 3 = 63.3 -> fine. ceil(4000 / 190 = 21.05) = 22.
    expect(estimateRows({ length: 4000, width: 3000 }, 190)).toEqual({ alongLength: 16, alongWidth: 22, lastRowWidthMm: 150 });
  });

  it('190 mm boards across 3100 mm: 17 rows, last row 60 mm < 63.3 -> warning', () => {
    // ceil(3100 / 190 = 16.32) = 17; 3100 - 16 x 190 = 60
    const r = estimateRows({ length: 4000, width: 3100 }, 190)!;
    expect(r).toMatchObject({ alongLength: 17, alongWidth: 22, lastRowWidthMm: 60 });
    expect(r.warning).toMatch(/60 mm/);
  });

  it('an exact fit gives a full last row: 3040 / 190 = 16 rows of 190', () => {
    expect(estimateRows({ length: 4000, width: 3040 }, 190)).toEqual({ alongLength: 16, alongWidth: 22, lastRowWidthMm: 190 });
  });

  it('a room narrower than one board is a single row', () => {
    expect(estimateRows({ length: 4000, width: 100 }, 190)).toMatchObject({ alongLength: 1, lastRowWidthMm: 100 });
  });

  it('is undefined without a board width or a room extent', () => {
    expect(estimateRows({ length: 4000, width: 3000 }, 0)).toBeUndefined();
    expect(estimateRows({ length: 0, width: 3000 }, 190)).toBeUndefined();
  });
});

describe('planHardFloor: layout warnings', () => {
  const board190: PackProduct = { id: 'b', name: '1200 x 190 board', kind: 'laminate', packCoverageM2: 2.28, boardLength: 1200, boardWidth: 190 };

  it('reports the rows and a NARROW_LAST_ROW note for a 4 x 3.1 m room', () => {
    const plan = planHardFloor({ room: room(shapeToPolygon({ kind: 'rectangle', length: 4000, width: 3100 })), product: board190, options: opts });
    // net 12.4 m² -> 13.268 m²; 1200 x 190 = 0.228 m² -> 13.268 / 0.228 = 58.19 -> 59 boards
    expect(plan.boardsEstimate).toBe(59);
    expect(plan.rowsEstimate).toMatchObject({ alongLength: 17, alongWidth: 22, lastRowWidthMm: 60 });
    expect(codes(plan.warnings)).toEqual(['NARROW_LAST_ROW']);
    expect(plan.warnings[0]!.message).toMatch(/^Room: /);
  });

  it('uses the bounding box for an L-shape (6 x 5 m overall): 27 rows of 190 across 5 m, last 60 mm', () => {
    const plan = planHardFloor({ room: room(lShape), product: board190, options: opts });
    // ceil(5000 / 190 = 26.3) = 27; 5000 - 26 x 190 = 60
    expect(plan.rowsEstimate).toMatchObject({ alongLength: 27, lastRowWidthMm: 60 });
  });

  it('no rows for diagonal / chevron lays', () => {
    for (const layPattern of ['diagonal', 'chevron', 'herringbone'] as const) {
      expect(planHardFloor({ room: room(bedroom), product: board190, options: { ...opts, layPattern } }).rowsEstimate).toBeUndefined();
    }
    expect(planHardFloor({ room: room(bedroom), product: board190, options: { ...opts, layPattern: 'brick' } }).rowsEstimate).toBeDefined();
  });

  it('warns about an intermediate expansion joint over 8 m (laminate / wood) or 10 m (LVT click)', () => {
    expect(EXPANSION_JOINT_MAX_RUN).toEqual({ laminate: 8000, engineered_wood: 8000, lvt_click: 10000 });
    const nine = shapeToPolygon({ kind: 'rectangle', length: 9000, width: 4000 });
    const eight = shapeToPolygon({ kind: 'rectangle', length: 8000, width: 4000 });
    const eleven = shapeToPolygon({ kind: 'rectangle', length: 3500, width: 11000 }); // long side along the width; 38.5 m² so not a large room
    // geometry-free LVT so a narrow last row (4000 / 180 leaves 40 mm) does not muddy the check
    const lvtPlain: PackProduct = { id: 'lvtp', name: 'LVT click', kind: 'lvt_click', packCoverageM2: 2 };
    expect(codes(planHardFloor({ room: room(nine), product: laminate, options: opts }).warnings)).toEqual(['EXPANSION_GAP_LARGE_ROOM']);
    expect(codes(planHardFloor({ room: room(nine), product: wood, options: opts }).warnings)).toContain('EXPANSION_GAP_LARGE_ROOM');
    expect(codes(planHardFloor({ room: room(eight), product: laminate, options: opts }).warnings)).toEqual([]);
    expect(codes(planHardFloor({ room: room(nine), product: lvtPlain, options: opts }).warnings)).toEqual([]);
    expect(codes(planHardFloor({ room: room(eleven), product: lvtPlain, options: opts }).warnings)).toEqual(['EXPANSION_GAP_LARGE_ROOM']);
    const msg = planHardFloor({ room: room(eleven), product: lvtPlain, options: opts }).warnings[0]!;
    expect(msg.level).toBe('warning');
    expect(msg.message).toMatch(/11 m in one direction — over 10 m/);
    // stuck-down floors never get one
    expect(codes(planHardFloor({ room: room(eleven), product: lvtGlue, options: opts }).warnings)).toEqual([]);
    // (7 courses of 500 mm tiles fit the 3.5 m exactly, so no row note either)
    expect(codes(planHardFloor({ room: room(eleven), product: tiles, options: opts }).warnings)).toEqual([]);
  });
});

// ---- edge cases ------------------------------------------------------------------------------------

describe('planHardFloor: edge cases', () => {
  it('an empty or degenerate polygon gives a zero plan with an EMPTY_ROOM error', () => {
    for (const polygon of [[], [{ x: 0, y: 0 }, { x: 1000, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }]] as Polygon[]) {
      const plan = planHardFloor({ room: room(polygon, { doorways: [dw(838, 'external')] }), product: laminate, options: opts });
      expect(plan.netAreaM2).toBe(0);
      expect(plan.grossAreaM2).toBe(0);
      expect(plan.packs).toBe(0);
      expect(plan.exactPacks).toBe(0);
      expect(plan.underlayPacks).toBe(0);
      expect(plan.beadingLengths).toBe(0);
      expect(plan.thresholds).toEqual([]);
      expect(plan.warnings).toEqual([{ level: 'error', code: 'EMPTY_ROOM', message: 'Room: room has no area.', subjectId: 'r1' }]);
    }
  });

  it('a tiny WC (0.9 x 1.2 m): 1.08 m² -> 1.1556 m² -> 1 pack, 1 underlay pack, 1 tile box, 1 tub of everything', () => {
    const wc = shapeToPolygon({ kind: 'rectangle', length: 1200, width: 900 });
    const lam = planHardFloor({ room: room(wc), product: laminate, options: opts });
    expect(lam.grossAreaM2).toBeCloseTo(1.1556, 9);
    expect(lam.packs).toBe(1);
    expect(lam.underlayPacks).toBe(1);
    // beading 4.2 m x 1.1 = 4.62 m -> 2 lengths
    expect(lam.beadingLengths).toBe(2);
    const ct = planHardFloor({ room: room(wc), product: tiles, options: opts });
    // 1.1556 / 0.25 = 4.6 -> 5 tiles -> 1 box; 1.1556 / 7 = 0.17 -> 1 L -> 1 tub
    expect(ct.tiles).toBe(5);
    expect(ct.boxes).toBe(1);
    expect(ct.tackifierLitres).toBe(1);
    expect(ct.tackifierTubs).toBe(1);
    const glue = planHardFloor({ room: room(wc), product: lvtGlue, options: opts });
    expect(glue.adhesiveTubs).toBe(1);
  });

  it('a huge 30 x 20 m hall: 600 m² -> 9 % -> 654 m² -> 295 packs, 63 x 10 m² underlay, 7 DPM rolls', () => {
    const hall = shapeToPolygon({ kind: 'rectangle', length: 30000, width: 20000 });
    const plan = planHardFloor({ room: room(hall, { subfloor: concrete }), product: laminate, options: { ...opts, underlayHasDpm: false } });
    expect(plan.grossAreaM2).toBeCloseTo(654, 9);
    // 654 / 2.22 = 294.59 -> 295
    expect(plan.packs).toBe(295);
    // 600 x 1.05 = 630 / 10 = 63
    expect(plan.underlayPacks).toBe(63);
    // 600 x 1.15 = 690 / 100 = 6.9 -> 7
    expect(plan.dpmSheetRolls).toBe(7);
    // 100 m x 1.1 = 110 m / 2.4 = 45.8 -> 46
    expect(plan.beadingLengths).toBe(46);
    expect(codes(plan.warnings)).toEqual(expect.arrayContaining(['LARGE_ROOM', 'DPM_SHEET', 'EXPANSION_GAP_LARGE_ROOM']));
  });

  it('a product without pack coverage cannot be counted: PACK_COVERAGE_MISSING error, 0 packs', () => {
    const plan = planHardFloor({ room: room(bedroom), product: { ...laminate, packCoverageM2: 0 }, options: opts });
    expect(plan.packs).toBe(0);
    expect(plan.exactPacks).toBe(0);
    expect(plan.grossAreaM2).toBeCloseTo(15.729, 9);
    expect(plan.warnings).toContainEqual(expect.objectContaining({ level: 'error', code: 'PACK_COVERAGE_MISSING' }));
    // board count still works from geometry
    const withBoards = planHardFloor({ room: room(bedroom), product: { ...laminateBoards, packCoverageM2: 0 }, options: opts });
    expect(withBoards.boardsEstimate).toBe(64);
  });

  it('boards per pack without geometry still gives a board estimate: 2.22 / 9 = 0.2467 m² -> 64', () => {
    const plan = planHardFloor({ room: room(bedroom), product: { ...laminate, boardsPerPack: 9 }, options: opts });
    // 15.729 / 0.24667 = 63.77 -> 64
    expect(plan.boardsEstimate).toBe(64);
    expect(plan.rowsEstimate).toBeUndefined();
  });

  it('missing or zero option sizes warn instead of dividing by zero', () => {
    const plan = planHardFloor({ room: room(bedroom), product: laminate, options: { ...opts, underlayPackCoverageM2: 0, beadingLength: 0 } });
    expect(plan.underlayPacks).toBe(0);
    expect(plan.underlayAreaM2).toBeCloseTo(15.435, 9);
    expect(plan.beadingLengths).toBe(0);
    expect(plan.beadingMetres).toBeCloseTo(15.4 * (1 + BEADING_WASTAGE), 9);
    expect(codes(plan.warnings).sort()).toEqual(['BEADING_LENGTH_INVALID', 'UNDERLAY_PACK_COVERAGE_MISSING']);
    expect(Number.isFinite(plan.exactPacks)).toBe(true);
  });

  it('underlay wastage is 5 %', () => {
    expect(HARD_FLOOR_UNDERLAY_WASTAGE).toBe(0.05);
  });

  it('is deterministic', () => {
    const input = { room: room(bigSplayed, { subfloor: concrete, doorways: [dw(838, 'carpet')] }), product: laminateBoards, options: { ...opts, underlayHasDpm: false } };
    expect(planHardFloor(input)).toEqual(planHardFloor(input));
  });
});
