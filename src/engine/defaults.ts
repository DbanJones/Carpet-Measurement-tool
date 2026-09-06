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
  minFillWidth: 300, // never plan a sliver narrower than ~1 ft (MeasureSquare convention)
  maxCrossJoinsPerFill: 2, // a fill may be at most three strips joined end to end
};
/**
 * Sheet vinyl fills are never planned narrower than this. A 300 mm strip of cushioned vinyl curls,
 * cannot be rolled flat into an adhesive bed and leaves a seam within a footstep of the wall, so
 * vinyl gets a wider floor than carpet's `minFillWidth`.
 */
export const VINYL_MIN_FILL_WIDTH: Mm = 600;
/** Sheet vinyl is never cross-joined: a butt joint across a floor is a leak path (see rollplan.applyCrossJoins). */
export const VINYL_ALLOWS_CROSS_JOINS = false;

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
export const MAX_UNDERLAY_THICKNESS_ON_STAIRS: Mm = 10;

// ---- Accessories ------------------------------------------------------------------------------
export const DEFAULT_ACCESSORIES: AccessoryOptions = {
  gripperLength: 1520, // 5 ft
  gripperPerPack: 10, // retail pack; trade box = 100 lengths
  gripperWastage: 0.1, // UK calculators add 10% for cuts and corners
  doorBarLength: 900,
  doorBarLongLength: 2700,
  seamTapeRollLength: 20000,
  doubleSidedTapeRollLength: 25000,
  underlayTapeRollLength: 50000, // 50 mm x 50 m single-sided joining tape
};
export const GRIPPER_TRADE_BOX = 100;
/** UK internal door leaf widths (mm). */
export const UK_DOOR_WIDTHS: Mm[] = [610, 686, 762, 838, 914, 726, 826, 926]; // imperial leaves then metric
export const DEFAULT_DOOR_WIDTH: Mm = 838;

// ---- Floor preparation ------------------------------------------------------------------------
export const DEFAULT_FLOOR_PREP: FloorPrepOptions = {
  latexThickness: 3,
  latexBagCoverageM2PerMm: 13, // 1.5-1.65 kg/m²/mm: a 20 kg bag ≈ 4.3 m² at 3 mm
  latexWastage: 0.1,
  primerCoverageM2PerLitre: 20, // concentrate: a 5 L can covers ~100 m² diluted 1:4 on porous floors
  primerCoats: 1,
  primerCanLitres: 5, // primer is sold in sealed 5 L cans, not by the litre
  plySheetLength: 2440,
  plySheetWidth: 1220, // 2.977 m², 6 mm flooring-grade WBP
  plyWastage: 0.1,
  plyScrewsPerSheet: 150, // 150 mm grid over a 2440 x 1220 sheet (17 x 9)
  hardboardSheetLength: 1220,
  hardboardSheetWidth: 610,
  liquidDpmCoverageM2PerKg: 1.65, // two-pack epoxy at ~0.3 kg/m² per coat, two coats
  dpmSheetRollAreaM2: 100, // 4 m x 25 m polythene, 1000 gauge / 250 mu
  dpmOverlap: 0.15, // 200 mm laps, wall turn-ups and cutting
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
  underlayPackCoverageM2: 15, // 1 m x 15 m foam/foil roll (10 m² for XPS/fibreboard)
  underlayHasDpm: true,
};
export const BEADING_WASTAGE = 0.1;
/** Glue-down LVT pressure-sensitive adhesive: m² per kg (a 15 kg tub covers ~60 m²). */
export const LVT_ADHESIVE_M2_PER_KG = 4;
export const LVT_ADHESIVE_TUB_KG = 15;
/** Carpet tile tackifier: m² per litre; sold in 5 L tubs. */
export const TACKIFIER_M2_PER_LITRE = 7;
export const TACKIFIER_TUB_LITRES = 5;
export const CARPET_TILE_SIZE: Mm = 500;
export const CARPET_TILES_PER_BOX = 20; // 5 m²
export const CARPET_TILE_WASTAGE = 0.07;
/** Sheet vinyl: fully bonded adhesive coverage (m² per kg) or perimeter/seam tape. */
export const VINYL_ADHESIVE_M2_PER_KG = 4;
export const VINYL_ADHESIVE_TUB_KG = 15;

// ---- Stairs -----------------------------------------------------------------------------------
export const DEFAULT_STEP: Omit<Step, 'id'> = { kind: 'straight', rise: 200, going: 223, width: 860 }; // 13 x 200 = 2.6 m floor to floor, pitch 41.9°
/** Approved Document K (England) limits for private stairs. */
export const STAIR_REGS = { minRise: 150, maxRise: 220, minGoing: 220, maxGoing: 300, maxPitchDeg: 42 };
export const DEFAULT_NOSING_OVERHANG: Mm = 20;
/** Extra length per step beyond rise + going + nosing overhang: the trade's "+50 mm per step" is 20 mm nosing + 30 mm tuck. */
export const STEP_LENGTH_ALLOWANCE: Mm = 30;
/** Cap-and-band (individual step pieces) wraps under the nosing and needs 50-100 mm more per step than waterfall. */
export const CAP_AND_BAND_EXTRA: Mm = 75;
/** Extra width per step for tucking against closed strings: 50 mm per side, both sides together. */
export const STEP_WIDTH_ALLOWANCE: Mm = 100;
/** Extra width per OPEN side: carpet wraps over the exposed edge and under, then is bound. */
export const OPEN_SIDE_WRAP: Mm = 150; // tread thickness + return + fixing/trim (unverified; user editable)
/** Bullnose: the carpet follows the curved end; extra width ≈ 1.6 x projection + tuck. */
export const BULLNOSE_WRAP_FACTOR = 1.6;
export const BULLNOSE_WRAP_TUCK: Mm = 50;
/** Extra length at the top and bottom of a waterfall runner (tuck under landing nosing, floor). */
export const RUNNER_END_ALLOWANCE: Mm = 300;
export const RUNNER_DEFAULT_WIDTH: Mm = 600;
/** Gripper per step: one length on the tread (back) and one on the riser (bottom). */
export const GRIPPER_PER_STEP = 2;
/**
 * How far a stair underlay pad wraps over the nosing. UK practice is a pad per TREAD only — the
 * risers are left bare so the carpet pulls tight against them — with the pad running about 50 mm
 * over the nose so there is padding where the foot lands. Set `Staircase.underlayRisers` for the
 * full-flight (waterfall) build-up instead.
 */
export const PAD_NOSING_OVERLAP: Mm = 50;

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
    stairsPerStep: 12,
    upliftPerM2: 2,
    disposalPerM2: 3,
    latexPerM2: 7.5,
    plyPerM2: 14,
    doorEasingPerDoor: 15,
    bindingPerM: 6.5, // whipping; taped binding is ~£12/m
    minimumJobLabour: 180, // a fitter's minimum charge for a visit (UK typically £150-£200)
    gripperRemovalPerM: 1.5,
    boardPrepPerM2: 4,
    skirtingRefitPerM: 6,
    moistureTestPerTest: 25,
  },
  materials: {
    gripperPerLength: 1.2,
    gripperPerPack: 11, // a pack of 10 lengths at a small pack discount on 10 x £1.20
    doorBarPerBar: 8,
    latexPerBag: 20,
    primerPerCan: 30, // a 5 L can of acrylic primer concentrate
    plyPerSheet: 20,
    hardboardPerSheet: 8,
    liquidDpmPerKg: 12,
    dpmSheetPerRoll: 30,
    seamTapePerRoll: 10,
    doubleSidedTapePerRoll: 8,
    underlayTapePerRoll: 5,
    hardFloorUnderlayPerPack: 22, // 15 m² foam/foil roll with an integral DPM
    beadingPerLength: 6,
    thresholdPerItem: 15,
    stairNosingPerItem: 30,
    stairRodPerItem: 15,
    adhesivePerTub: 45,
    tackifierPerTub: 30,
    plyScrewsPerBox: 8,
    vinylSeamWeldPerM: 3, // cold weld / seam sealer, per metre of welded seam
  },
};
export const PLY_SCREWS_PER_BOX = 200;
export const CARPET_PRICE_TIERS = { budget: 8, mid: 18, premium: 35 }; // £/m²
