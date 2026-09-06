/**
 * Trade defaults for the UK market. Every number here is a sensible starting point, is user-editable
 * in the UI, and is documented with its rationale in docs/DOMAIN.md. Nothing else in the engine
 * hard-codes a supply constant.
 */
import type { BroadloomPlanningOptions, HardFloorOptions, UnderlayOptions, AccessoryOptions, FloorPrepOptions, PriceBook, LayPattern, Mm, Step } from './types';

// ---- Broadloom --------------------------------------------------------------------------------
export const CARPET_ROLL_WIDTHS: Mm[] = [4000, 5000];
export const CARPET_ROLL_WIDTHS_OTHER: Mm[] = [3660, 4570, 2000, 3000]; // 12 ft, 15 ft, narrow
export const VINYL_ROLL_WIDTHS: Mm[] = [2000, 3000, 4000];
/** Typical maximum length of a roll as delivered (carpet ~30 m, sheet vinyl ~20-25 m). */
export const CARPET_MAX_ROLL_LENGTH: Mm = 30000;
export const VINYL_MAX_ROLL_LENGTH: Mm = 20000;
/** Cut lengths are sold to the nearest 10 cm by most UK retailers. */
export const CUT_INCREMENT: Mm = 100;
export const DEFAULT_CARPET_THICKNESS: Mm = 10;
export const DEFAULT_VINYL_THICKNESS: Mm = 2.5;

export const DEFAULT_BROADLOOM_OPTIONS: BroadloomPlanningOptions = {
  pileDirection: 'auto',
  seamPolicy: 'balanced',
  lengthAllowance: 100, // "add 10 cm to every measurement"
  widthAllowance: 100,
  balancedThresholdM2: 1.0, // accept a cross join if it saves at least 1 m² of carpet
  minCrossJoinStripLength: 600,
  usableOffcutMin: 500,
};

// ---- Underlay ---------------------------------------------------------------------------------
export const DEFAULT_UNDERLAY: UnderlayOptions = {
  fit: true,
  rollWidth: 1370,
  rollLength: 11000, // 15.07 m² — the standard UK carpet underlay roll
  thickness: 10,
  tog: 2.3,
  pricePerRoll: 75,
};
export const UNDERLAY_ROLL_LENGTHS: Mm[] = [11000, 15000];
/** With underfloor heating the combined carpet + underlay tog should not exceed this. */
export const MAX_TOG_WITH_UFH = 2.5;
/** Underlay thicker than this is not recommended on stairs (nosing wear, tuck-in). */
export const MAX_UNDERLAY_THICKNESS_ON_STAIRS: Mm = 11;

// ---- Accessories ------------------------------------------------------------------------------
export const DEFAULT_ACCESSORIES: AccessoryOptions = {
  gripperLength: 1520, // 5 ft
  gripperPerPack: 10, // retail pack; trade box = 100 lengths
  gripperWastage: 0.05,
  doorBarLength: 900,
  doorBarLongLength: 2700,
  seamTapeRollLength: 20000,
  doubleSidedTapeRollLength: 25000,
  underlayTapeRollLength: 20000,
};
export const GRIPPER_TRADE_BOX = 100;
/** UK internal door leaf widths (mm). */
export const UK_DOOR_WIDTHS: Mm[] = [610, 686, 762, 838, 926];
export const DEFAULT_DOOR_WIDTH: Mm = 838;

// ---- Floor preparation ------------------------------------------------------------------------
export const DEFAULT_FLOOR_PREP: FloorPrepOptions = {
  latexThickness: 3,
  latexBagCoverageM2PerMm: 13.5, // a 20 kg bag ≈ 4.5 m² at 3 mm
  latexWastage: 0.1,
  primerCoverageM2PerLitre: 6, // diluted acrylic primer, one coat
  primerCoats: 1,
  plySheetLength: 2440,
  plySheetWidth: 1220, // 2.977 m², 6 mm flooring-grade WBP
  plyWastage: 0.1,
  plyScrewsPerSheet: 120, // ~150 mm centres
  hardboardSheetLength: 1220,
  hardboardSheetWidth: 610,
  liquidDpmCoverageM2PerKg: 1.7, // two-coat epoxy DPM
  dpmSheetRollAreaM2: 100, // 4 m x 25 m polythene, 1000 gauge / 250 mu
  dpmOverlap: 0.1,
};
/** BS 8203: resilient floor coverings need the subfloor at or below this relative humidity. */
export const MAX_SUBFLOOR_RH_RESILIENT = 75;
/** Wood floors are more sensitive. */
export const MAX_SUBFLOOR_RH_WOOD = 65;

// ---- Hard flooring ----------------------------------------------------------------------------
export const LAY_PATTERN_WASTAGE: Record<LayPattern, number> = {
  straight: 0.07,
  random_stagger: 0.07,
  brick: 0.08,
  diagonal: 0.15,
  herringbone: 0.2,
  chevron: 0.2,
};
export const DEFAULT_HARD_FLOOR: HardFloorOptions = {
  layPattern: 'straight',
  expansionGap: 10,
  useBeading: true,
  beadingLength: 2400,
  underlayPackCoverageM2: 10,
  underlayHasDpm: true,
};
export const BEADING_WASTAGE = 0.1;
/** Glue-down LVT adhesive: m² per kg (a 15 kg tub covers ~45 m²). */
export const LVT_ADHESIVE_M2_PER_KG = 3;
export const LVT_ADHESIVE_TUB_KG = 15;
/** Carpet tile tackifier: m² per litre; sold in 5 L tubs. */
export const TACKIFIER_M2_PER_LITRE = 6;
export const TACKIFIER_TUB_LITRES = 5;
export const CARPET_TILE_SIZE: Mm = 500;
export const CARPET_TILES_PER_BOX = 20; // 5 m²
export const CARPET_TILE_WASTAGE = 0.07;
/** Sheet vinyl: fully bonded adhesive coverage (m² per kg) or perimeter/seam tape. */
export const VINYL_ADHESIVE_M2_PER_KG = 4;
export const VINYL_ADHESIVE_TUB_KG = 15;

// ---- Stairs -----------------------------------------------------------------------------------
export const DEFAULT_STEP: Omit<Step, 'id'> = { kind: 'straight', rise: 190, going: 240, width: 860 };
/** Approved Document K (England) limits for private stairs. */
export const STAIR_REGS = { minRise: 150, maxRise: 220, minGoing: 220, maxGoing: 300, maxPitchDeg: 42 };
export const DEFAULT_NOSING_OVERHANG: Mm = 20;
/** Extra length per step for tucking under the nosing and into the crotch of the riser. */
export const STEP_LENGTH_ALLOWANCE: Mm = 50;
/** Extra width per step for tucking against closed strings (both sides together). */
export const STEP_WIDTH_ALLOWANCE: Mm = 50;
/** Extra width per OPEN side: carpet wraps over the exposed edge and under, then is bound. */
export const OPEN_SIDE_WRAP: Mm = 100;
/** Bullnose: the carpet follows the curved end; extra width ≈ 1.6 x projection + tuck. */
export const BULLNOSE_WRAP_FACTOR = 1.6;
export const BULLNOSE_WRAP_TUCK: Mm = 50;
/** Extra length at the top and bottom of a waterfall runner (tuck under landing nosing, floor). */
export const RUNNER_END_ALLOWANCE: Mm = 300;
export const RUNNER_DEFAULT_WIDTH: Mm = 600;
/** Gripper per step: one length on the tread (back) and one on the riser (bottom). */
export const GRIPPER_PER_STEP = 2;

// ---- Pricing (indicative UK 2025/26; user editable) -------------------------------------------
export const DEFAULT_PRICES: PriceBook = {
  currency: 'GBP',
  vatRate: 0.2,
  applyVat: true,
  labour: {
    carpetFittingPerM2: 5,
    vinylFittingPerM2: 7,
    laminateFittingPerM2: 12,
    lvtFittingPerM2: 18,
    stairsPerStep: 8,
    upliftPerM2: 2,
    disposalPerM2: 2,
    latexPerM2: 10,
    plyPerM2: 14,
    doorEasingPerDoor: 20,
    bindingPerM: 4,
  },
  materials: {
    gripperPerLength: 1.2,
    doorBarPerBar: 8,
    latexPerBag: 22,
    primerPerLitre: 7,
    plyPerSheet: 20,
    hardboardPerSheet: 8,
    liquidDpmPerKg: 12,
    dpmSheetPerRoll: 30,
    seamTapePerRoll: 10,
    doubleSidedTapePerRoll: 8,
    underlayTapePerRoll: 5,
    beadingPerLength: 6,
    thresholdPerItem: 15,
    stairNosingPerItem: 12,
    stairRodPerItem: 8,
    adhesivePerTub: 45,
    tackifierPerTub: 30,
    plyScrewsPerBox: 8,
  },
};
export const PLY_SCREWS_PER_BOX = 200;
export const CARPET_PRICE_TIERS = { budget: 8, mid: 18, premium: 35 }; // £/m²
