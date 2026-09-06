/**
 * Pack-sold floors — laminate, engineered wood, LVT (click and glue-down) and carpet tiles — plus
 * the sundries that go with sheet vinyl (adhesive, or double-sided tape).
 *
 * Everything here is pure and deterministic. Lengths are millimetres; areas are m² only where the
 * type says `M2`. Supply constants come from `defaults.ts` or the options object passed in; the few
 * trade rules that `defaults.ts` does not yet carry are exported from the "Local trade constants"
 * block below so they can be moved into `defaults.ts` later.
 *
 * A pack-floor estimate answers, in the order a fitter thinks about a room:
 *   1. how much floor — net m², wastage for the lay pattern and the room shape, whole packs;
 *   2. what goes under it — underlay for floating floors, a polythene DPM on damp-prone subfloors,
 *      adhesive for glue-down LVT, tackifier for carpet tiles;
 *   3. what finishes it — beading/scotia over the expansion gap, a threshold profile at each door;
 *   4. whether the layout will look right — board rows across the room (a sliver last row is
 *      re-centred), and intermediate expansion joints in long runs.
 */
import type {
  Mm,
  M2,
  Id,
  Polygon,
  Doorway,
  DoorwayTransition,
  Subfloor,
  SubfloorType,
  Warning,
  PackProduct,
  HardFloorOptions,
  LayPattern,
  AccessoryOptions,
  FloorPrepOptions,
} from './types';
import { polygonAreaM2, isRectilinear, boundingBox, fixingPerimeter, polygonPerimeter, doorwaySegment } from './geometry';
import {
  LAY_PATTERN_WASTAGE,
  BEADING_WASTAGE,
  LVT_ADHESIVE_M2_PER_KG,
  LVT_ADHESIVE_TUB_KG,
  TACKIFIER_M2_PER_LITRE,
  TACKIFIER_TUB_LITRES,
  CARPET_TILE_SIZE,
  CARPET_TILES_PER_BOX,
  CARPET_TILE_WASTAGE,
  VINYL_ADHESIVE_M2_PER_KG,
  VINYL_ADHESIVE_TUB_KG,
  DEFAULT_FLOOR_PREP,
} from './defaults';
import { ceilToStep, mm2ToM2, roundTo, MM_PER_M } from './units';

// ---------------------------------------------------------------------------
// Local trade constants (candidates for defaults.ts)
// ---------------------------------------------------------------------------

/** The covering kinds sold by the pack / box. */
export type PackKind = PackProduct['kind'];

/** Pack floors that float on an underlay (click / tongue-and-groove) rather than being stuck down. */
export type FloatingKind = 'laminate' | 'engineered_wood' | 'lvt_click';

/**
 * Rooms with a net area above this get `LARGE_ROOM_EXTRA_WASTAGE`. Long runs mean more end cuts
 * that cannot be reused, and a big order is more likely to include a damaged pack. 40 m² is where
 * UK laminate retailers' calculators move from "add 5-7 %" to "add 10 %".
 */
export const LARGE_ROOM_AREA_M2: M2 = 40;
export const LARGE_ROOM_EXTRA_WASTAGE = 0.02;

/**
 * A room with a wall that is not axis-aligned (bay window, splayed wall, angled hallway) has every
 * board along that wall cut at an angle, and the offcut is rarely usable elsewhere: +3 %.
 */
export const NON_RECTILINEAR_EXTRA_WASTAGE = 0.03;

/** Foam / fibreboard underlay is loose-laid and trimmed to the walls; 5 % covers trimming and joins. */
export const HARD_FLOOR_UNDERLAY_WASTAGE = 0.05;

/**
 * A last row narrower than this fraction of a board looks wrong and is hard to click in, so the
 * fitter rips the first row down as well to balance them. We flag it rather than change the count.
 */
export const MIN_LAST_ROW_FRACTION = 1 / 3;

/**
 * Longest run a floating floor can make in one direction before manufacturers ask for an
 * intermediate expansion joint (covered with a T-bar): laminate and floated wood 8 m, LVT click 10 m.
 */
export const EXPANSION_JOINT_MAX_RUN: Record<FloatingKind, Mm> = {
  laminate: 8000,
  engineered_wood: 8000,
  lvt_click: 10000,
};

/**
 * Subfloors that can pass ground moisture up into a floating floor. Unless the underlay has its own
 * DPM film, a polythene sheet goes down first (lapped and turned up at the walls).
 */
export const DPM_SUBFLOORS: readonly SubfloorType[] = ['concrete', 'anhydrite', 'asphalt', 'existing_tiles'];

/** Lay patterns where boards run parallel to a wall, so counting rows across the room means something. */
export const ROW_PATTERNS: readonly LayPattern[] = ['straight', 'random_stagger', 'brick'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HardFloorRoomInput {
  ownerId: Id;
  ownerName: string;
  polygon: Polygon;
  doorways: Doorway[];
  subfloor: Subfloor;
}

/** Profile fitted across a doorway where a hard floor meets whatever is on the other side. */
export type ThresholdProfile = 'T-bar' | 'ramp' | 'end' | 'none';

export interface HardFloorThreshold {
  doorwayId: Id;
  label: string;
  width: Mm;
  profile: ThresholdProfile;
}

export interface RowsEstimate {
  /** Rows across the room when boards run along the room's length (x axis). */
  alongLength: number;
  /** Rows across the room when boards run along the room's width (y axis). */
  alongWidth: number;
  /** Width of the last row for the boards-along-length layout (a full board when it divides exactly). */
  lastRowWidthMm: Mm;
  /** Set when the last row is narrower than `MIN_LAST_ROW_FRACTION` of a board. */
  warning?: string;
}

export interface HardFloorPlan {
  ownerId: Id;
  netAreaM2: M2;
  /** Total wastage fraction applied (pattern + large-room + odd-shape increments). */
  wastage: number;
  grossAreaM2: M2;
  packs: number;
  exactPacks: number;
  /** ceil(gross / board area) when the product's board geometry is known. For carpet tiles: the tile count. */
  boardsEstimate?: number;
  /** Floating (click) floors only; glue-down LVT and carpet tiles have none. */
  underlayPacks: number;
  underlayAreaM2: M2;
  /** Polythene DPM sheet rolls: floating floors on a `DPM_SUBFLOORS` subfloor when the underlay has no DPM. */
  dpmSheetRolls: number;
  /** Beading / scotia over the expansion gap: floating floors only, and only when `options.useBeading`. */
  beadingLengths: number;
  beadingMetres: number;
  thresholds: HardFloorThreshold[];
  /** Glue-down LVT only. */
  adhesiveKg: number;
  adhesiveTubs: number;
  /** Carpet tiles only. Litres are whole litres. */
  tackifierLitres: number;
  tackifierTubs: number;
  /** Carpet tiles only. */
  tiles?: number;
  boxes?: number;
  /** Boards / tiles laid parallel to the walls only (not diagonal, herringbone or chevron). */
  rowsEstimate?: RowsEstimate;
  /** Perimeter expansion gap to leave (mm); 0 for glue-down LVT and carpet tiles, which are fitted tight. */
  expansionGap: Mm;
  warnings: Warning[];
}

export interface HardFloorPlanInput {
  room: HardFloorRoomInput;
  product: PackProduct;
  options: HardFloorOptions;
  /** DPM sheet roll size and lapping allowance; defaults to `DEFAULT_FLOOR_PREP`. */
  floorPrep?: Pick<FloorPrepOptions, 'dpmSheetRollAreaM2' | 'dpmOverlap'>;
}

export interface WastageBreakdown {
  /** From the lay pattern (or the caller's override; carpet tiles use `CARPET_TILE_WASTAGE`). */
  base: number;
  largeRoomExtra: number;
  oddShapeExtra: number;
  /** base + increments, rounded to 4 decimals. */
  total: number;
}

export interface SheetVinylSundriesInput {
  room: { ownerId: Id; polygon: Polygon; doorways: Doorway[] };
  /** Fully bonded (adhesive over the whole floor) or perimeter-stuck (double-sided tape). */
  fullyBonded: boolean;
  /** Total seam length in the room (mm). */
  seamLengthMm: Mm;
  accessories: AccessoryOptions;
}

export interface SheetVinylSundries {
  adhesiveKg: number;
  adhesiveTubs: number;
  doubleSidedTapeLength: Mm;
  doubleSidedTapeRolls: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Number of whole units (packs, rolls, lengths, tiles) needed to cover `value`. 0 for a non-positive
 * value or unit size, so a broken option never puts Infinity or NaN in a BOM.
 * Example: 15.729 m² from 2.22 m² packs -> ceil(7.085) = 8.
 */
function wholeUnits(value: number, unit: number): number {
  if (!(value > 0) || !(unit > 0)) return 0;
  return Math.round(ceilToStep(value, unit) / unit);
}

/** a / b, or 0 when b is not a positive number. */
function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

/**
 * True for pack floors that float on an underlay: laminate, engineered wood (click or T&G, floated)
 * and click LVT. Glue-down LVT and carpet tiles are stuck to the subfloor, so they get no underlay,
 * no DPM sheet, no expansion gap and no beading.
 */
export function isFloatingFloor(kind: PackKind): boolean {
  return kind === 'laminate' || kind === 'engineered_wood' || kind === 'lvt_click';
}

/**
 * Wastage fraction for a lay pattern: the caller's override when given (a finite, non-negative
 * number), else the trade table `LAY_PATTERN_WASTAGE`.
 * Example: `wastageFor('herringbone')` -> 0.2; `wastageFor('herringbone', 0.12)` -> 0.12.
 */
export function wastageFor(pattern: LayPattern, override?: number): number {
  return validWastage(override) ?? LAY_PATTERN_WASTAGE[pattern];
}

/** A caller-supplied wastage fraction, or undefined when it is missing, negative or NaN. */
function validWastage(override: number | undefined): number | undefined {
  return override !== undefined && Number.isFinite(override) && override >= 0 ? override : undefined;
}

/**
 * Total wastage for a room: the pattern's base (carpet tiles use `CARPET_TILE_WASTAGE` — they are
 * square, so the plank patterns do not apply) plus `LARGE_ROOM_EXTRA_WASTAGE` above
 * `LARGE_ROOM_AREA_M2` and `NON_RECTILINEAR_EXTRA_WASTAGE` when any wall is off-axis.
 *
 * Example: a 59.5 m² lounge with a splayed bay, straight-laid laminate:
 *   0.07 (straight) + 0.02 (> 40 m²) + 0.03 (diagonal wall) = 0.12.
 */
export function hardFloorWastage(input: { kind: PackKind; layPattern: LayPattern; override?: number; netAreaM2: M2; rectilinear: boolean }): WastageBreakdown {
  const base = input.kind === 'carpet_tiles' ? (validWastage(input.override) ?? CARPET_TILE_WASTAGE) : wastageFor(input.layPattern, input.override);
  const largeRoomExtra = input.netAreaM2 > LARGE_ROOM_AREA_M2 ? LARGE_ROOM_EXTRA_WASTAGE : 0;
  const oddShapeExtra = input.rectilinear ? 0 : NON_RECTILINEAR_EXTRA_WASTAGE;
  return { base, largeRoomExtra, oddShapeExtra, total: roundTo(base + largeRoomExtra + oddShapeExtra, 4) };
}

/**
 * Which profile goes across a doorway. A hard floor meeting the same floor at the same level is
 * covered with a T-bar; meeting carpet or a different hard floor (different thickness) with a ramp /
 * reducer; an external door gets an end profile; an opening with nothing to fix to, or a floor that
 * simply continues through, gets none. Carpet tiles are finished like carpet (door bars are counted
 * elsewhere), so they always return 'none'.
 * Example: laminate hall into a carpeted lounge -> 'ramp'.
 */
export function thresholdProfileFor(kind: PackKind, transition: DoorwayTransition, continuous?: boolean): ThresholdProfile {
  if (kind === 'carpet_tiles' || continuous) return 'none';
  switch (transition) {
    case 'same_floor':
      return 'T-bar';
    case 'hard_floor':
    case 'carpet':
      return 'ramp';
    case 'external':
      return 'end';
    case 'none':
      return 'none';
  }
}

/**
 * Rows of boards across a room. Boards are laid along the room's length, so the rows stack across
 * its width: rows = ceil(width / boardWidth), and the last row is what is left after (rows - 1) full
 * boards. A last row narrower than `MIN_LAST_ROW_FRACTION` of a board is flagged — the fitter rips
 * the first row down too so the two edges balance. The other orientation is reported as well.
 *
 * Example: 190 mm boards in a 4000 x 3100 mm room -> ceil(3100 / 190) = 17 rows, last row
 *   3100 - 16 x 190 = 60 mm < 190 / 3 = 63.3 mm -> warning. Along the width: ceil(4000 / 190) = 22.
 * Returns undefined when the board width or the room extent is not positive.
 */
export function estimateRows(extent: { length: Mm; width: Mm }, boardWidth: Mm): RowsEstimate | undefined {
  if (!(boardWidth > 0) || !(extent.width > 0) || !(extent.length > 0)) return undefined;
  const alongLength = Math.max(1, wholeUnits(extent.width, boardWidth));
  const alongWidth = Math.max(1, wholeUnits(extent.length, boardWidth));
  const lastRowWidthMm = extent.width - (alongLength - 1) * boardWidth;
  const minLast = boardWidth * MIN_LAST_ROW_FRACTION;
  const est: RowsEstimate = { alongLength, alongWidth, lastRowWidthMm };
  if (lastRowWidthMm < minLast - 1e-6) {
    est.warning = `Laid along the length the last row would be ${Math.round(lastRowWidthMm)} mm wide (board ${Math.round(boardWidth)} mm). Split the difference between the first and last rows.`;
  }
  return est;
}

/** Board (or tile) area in m² from the product, or undefined when neither geometry nor pack count is known. */
function boardAreaM2(product: PackProduct): M2 | undefined {
  const length = product.boardLength ?? (product.kind === 'carpet_tiles' ? CARPET_TILE_SIZE : undefined);
  const width = product.boardWidth ?? (product.kind === 'carpet_tiles' ? CARPET_TILE_SIZE : undefined);
  if (length !== undefined && width !== undefined && length > 0 && width > 0) return mm2ToM2(length * width);
  if (product.boardsPerPack !== undefined && product.boardsPerPack > 0 && product.packCoverageM2 > 0) return product.packCoverageM2 / product.boardsPerPack;
  return undefined;
}

// ---------------------------------------------------------------------------
// Pack floors
// ---------------------------------------------------------------------------

/**
 * Plan one room of a pack-sold floor.
 *
 * Trade rules encoded
 * - gross = net x (1 + wastage), wastage from `hardFloorWastage` (pattern + large room + odd shape);
 *   packs = ceil(gross / pack coverage). Carpet tiles are counted individually: tiles =
 *   ceil(gross / tile area), boxes = ceil(tiles / tiles per box), and `packs` = boxes.
 * - Floating floors get underlay at net x (1 + `HARD_FLOOR_UNDERLAY_WASTAGE`), and a polythene DPM
 *   (net x (1 + dpmOverlap) / roll area) on a `DPM_SUBFLOORS` subfloor when the underlay has no DPM.
 * - Beading covers the expansion gap: fixing perimeter (walls minus openings) x (1 + BEADING_WASTAGE)
 *   in lengths of `options.beadingLength`; none if the skirting is to be lifted, or the floor is stuck down.
 * - Glue-down LVT: adhesive = gross / `LVT_ADHESIVE_M2_PER_KG` in tubs of `LVT_ADHESIVE_TUB_KG`.
 *   Carpet tiles: tackifier = gross / `TACKIFIER_M2_PER_LITRE`, whole litres, tubs of `TACKIFIER_TUB_LITRES`.
 *   (Gross rather than net so trowel loss and the residue left in the tub are covered.)
 * - One threshold per doorway (`thresholdProfileFor`).
 * - Floating floors longer than `EXPANSION_JOINT_MAX_RUN` in either direction get a warning.
 *
 * Worked example — 4.2 x 3.5 m bedroom, straight-laid laminate in 2.22 m² packs, 10 m² underlay
 * packs, one 838 mm door, 2.4 m beading, floorboard subfloor:
 *   net 14.7 m²; wastage 0.07 -> gross 15.729 m²; packs ceil(15.729 / 2.22 = 7.085) = 8;
 *   underlay 14.7 x 1.05 = 15.435 m² -> ceil(1.5435) = 2 packs; no DPM (timber);
 *   beading (15.4 - 0.838) x 1.1 = 16.018 m -> ceil(16.018 / 2.4 = 6.67) = 7 lengths.
 */
export function planHardFloor(input: HardFloorPlanInput): HardFloorPlan {
  const { room, product, options } = input;
  const floorPrep = input.floorPrep ?? DEFAULT_FLOOR_PREP;
  const warnings: Warning[] = [];
  const warn = (level: Warning['level'], code: string, message: string): void => {
    warnings.push({ level, code, message: `${room.ownerName}: ${message}`, subjectId: room.ownerId });
  };

  const netAreaM2 = room.polygon.length >= 3 ? polygonAreaM2(room.polygon) : 0;
  const floating = isFloatingFloor(product.kind);
  const rectilinear = room.polygon.length >= 3 ? isRectilinear(room.polygon) : true;
  const wastage = hardFloorWastage({ kind: product.kind, layPattern: options.layPattern, override: options.wastage, netAreaM2, rectilinear });

  const plan: HardFloorPlan = {
    ownerId: room.ownerId,
    netAreaM2,
    wastage: wastage.total,
    grossAreaM2: 0,
    packs: 0,
    exactPacks: 0,
    underlayPacks: 0,
    underlayAreaM2: 0,
    dpmSheetRolls: 0,
    beadingLengths: 0,
    beadingMetres: 0,
    thresholds: [],
    adhesiveKg: 0,
    adhesiveTubs: 0,
    tackifierLitres: 0,
    tackifierTubs: 0,
    expansionGap: floating ? options.expansionGap : 0,
    warnings,
  };

  if (netAreaM2 <= 0) {
    warn('error', 'EMPTY_ROOM', 'room has no area.');
    return plan;
  }

  // ---- 1. floor ------------------------------------------------------------------------------------
  if (wastage.largeRoomExtra > 0) {
    warn('info', 'LARGE_ROOM', `${roundTo(netAreaM2, 2)} m² is over ${LARGE_ROOM_AREA_M2} m² — wastage increased by ${Math.round(wastage.largeRoomExtra * 100)} % for the extra end cuts.`);
  }
  if (wastage.oddShapeExtra > 0) {
    warn('info', 'ODD_SHAPE', `a wall is not square to the room — wastage increased by ${Math.round(wastage.oddShapeExtra * 100)} % for the angled cuts.`);
  }
  const grossAreaM2 = netAreaM2 * (1 + wastage.total);
  plan.grossAreaM2 = grossAreaM2;

  const boardArea = boardAreaM2(product);
  if (product.kind === 'carpet_tiles') {
    const tileArea = boardArea ?? mm2ToM2(CARPET_TILE_SIZE * CARPET_TILE_SIZE);
    const tiles = wholeUnits(grossAreaM2, tileArea);
    const tilesPerBox =
      product.boardsPerPack !== undefined && product.boardsPerPack > 0
        ? product.boardsPerPack
        : product.packCoverageM2 > 0 && Math.round(product.packCoverageM2 / tileArea) >= 1
          ? Math.round(product.packCoverageM2 / tileArea)
          : CARPET_TILES_PER_BOX;
    const boxes = wholeUnits(tiles, tilesPerBox);
    plan.tiles = tiles;
    plan.boxes = boxes;
    plan.packs = boxes;
    plan.exactPacks = tiles / tilesPerBox;
    plan.boardsEstimate = tiles;
    plan.tackifierLitres = wholeUnits(grossAreaM2, TACKIFIER_M2_PER_LITRE);
    plan.tackifierTubs = wholeUnits(plan.tackifierLitres, TACKIFIER_TUB_LITRES);
  } else {
    if (product.packCoverageM2 > 0) {
      plan.packs = wholeUnits(grossAreaM2, product.packCoverageM2);
      plan.exactPacks = grossAreaM2 / product.packCoverageM2;
    } else {
      warn('error', 'PACK_COVERAGE_MISSING', `"${product.name}" has no coverage per pack — cannot count packs.`);
    }
    if (boardArea !== undefined) plan.boardsEstimate = wholeUnits(grossAreaM2, boardArea);
    if (product.kind === 'lvt_glue') {
      plan.adhesiveKg = safeDiv(grossAreaM2, LVT_ADHESIVE_M2_PER_KG);
      plan.adhesiveTubs = wholeUnits(plan.adhesiveKg, LVT_ADHESIVE_TUB_KG);
    }
  }

  // ---- 2. under the floor ----------------------------------------------------------------------
  if (floating) {
    plan.underlayAreaM2 = netAreaM2 * (1 + HARD_FLOOR_UNDERLAY_WASTAGE);
    if (options.underlayPackCoverageM2 > 0) {
      plan.underlayPacks = wholeUnits(plan.underlayAreaM2, options.underlayPackCoverageM2);
    } else {
      warn('warning', 'UNDERLAY_PACK_COVERAGE_MISSING', 'underlay pack coverage is not set — underlay packs not counted.');
    }
    if (room.subfloor.underfloorHeating) {
      warn('info', 'UFH_UNDERLAY', 'underfloor heating — use a low-tog UFH-rated underlay and check the floor is approved for UFH.');
    }
    if (!options.underlayHasDpm && DPM_SUBFLOORS.includes(room.subfloor.type)) {
      plan.dpmSheetRolls = wholeUnits(netAreaM2 * (1 + floorPrep.dpmOverlap), floorPrep.dpmSheetRollAreaM2);
      warn('info', 'DPM_SHEET', `${room.subfloor.type.replace('_', ' ')} subfloor and the underlay has no DPM — lay a polythene DPM sheet under the underlay (${plan.dpmSheetRolls} roll${plan.dpmSheetRolls === 1 ? '' : 's'}).`);
    }
  }

  // ---- 3. finishing ------------------------------------------------------------------------------
  if (floating && options.useBeading) {
    const beadingMm = fixingPerimeter(room.polygon, room.doorways) * (1 + BEADING_WASTAGE);
    plan.beadingMetres = beadingMm / MM_PER_M;
    if (options.beadingLength > 0) {
      plan.beadingLengths = wholeUnits(beadingMm, options.beadingLength);
    } else {
      warn('warning', 'BEADING_LENGTH_INVALID', 'beading length is not set — beading lengths not counted.');
    }
  }
  plan.thresholds = room.doorways.map((d, i) => ({
    doorwayId: d.id,
    label: d.label ?? `Doorway ${i + 1}`,
    width: doorwaySegment(room.polygon, d).width,
    profile: thresholdProfileFor(product.kind, d.transition, d.continuous),
  }));

  // ---- 4. layout ---------------------------------------------------------------------------------
  const bbox = boundingBox(room.polygon);
  if (ROW_PATTERNS.includes(options.layPattern)) {
    const boardWidth = product.boardWidth ?? (product.kind === 'carpet_tiles' ? CARPET_TILE_SIZE : undefined);
    if (boardWidth !== undefined) {
      const rows = estimateRows({ length: bbox.length, width: bbox.width }, boardWidth);
      if (rows) {
        plan.rowsEstimate = rows;
        if (rows.warning) warn('info', 'NARROW_LAST_ROW', rows.warning);
      }
    }
  }
  if (floating) {
    const maxRun = EXPANSION_JOINT_MAX_RUN[product.kind as FloatingKind];
    const run = Math.max(bbox.length, bbox.width);
    if (run > maxRun + 1e-6) {
      warn(
        'warning',
        'EXPANSION_GAP_LARGE_ROOM',
        `the floor runs ${roundTo(run / MM_PER_M, 2)} m in one direction — over ${maxRun / MM_PER_M} m a floated ${product.kind.replace('_', ' ')} usually needs an intermediate expansion joint (check the manufacturer's maximum run).`,
      );
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Sheet vinyl sundries
// ---------------------------------------------------------------------------

/**
 * Adhesive or tape for one room of sheet vinyl.
 *
 * Fully bonded: adhesive over the whole floor, area / `VINYL_ADHESIVE_M2_PER_KG` in tubs of
 * `VINYL_ADHESIVE_TUB_KG`; no tape. Perimeter-stuck: double-sided tape round the whole perimeter
 * (openings included — it runs under the door bar, matching `accessories.planTapes`) plus every seam,
 * in rolls of `accessories.doubleSidedTapeRollLength`; no adhesive. Use this OR `planTapes` for a
 * vinyl room, not both.
 *
 * Worked example — 3 x 4 m kitchen (12 m², perimeter 14 m) with one 3 m seam, 25 m tape rolls:
 *   fully bonded: 12 / 4 = 3 kg -> 1 tub;  perimeter-stuck: 14 + 3 = 17 m -> 1 roll.
 */
export function planSheetVinylSundries(input: SheetVinylSundriesInput): SheetVinylSundries {
  const poly = input.room.polygon;
  const areaM2 = poly.length >= 3 ? polygonAreaM2(poly) : 0;
  const out: SheetVinylSundries = { adhesiveKg: 0, adhesiveTubs: 0, doubleSidedTapeLength: 0, doubleSidedTapeRolls: 0 };
  if (areaM2 <= 0) return out;
  if (input.fullyBonded) {
    out.adhesiveKg = safeDiv(areaM2, VINYL_ADHESIVE_M2_PER_KG);
    out.adhesiveTubs = wholeUnits(out.adhesiveKg, VINYL_ADHESIVE_TUB_KG);
  } else {
    const seams = input.seamLengthMm > 0 ? input.seamLengthMm : 0;
    out.doubleSidedTapeLength = Math.ceil(polygonPerimeter(poly) + seams);
    out.doubleSidedTapeRolls = wholeUnits(out.doubleSidedTapeLength, input.accessories.doubleSidedTapeRollLength);
  }
  return out;
}
