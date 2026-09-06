/**
 * The estimating engine's public API — everything the UI (or another front end) is allowed to use.
 *
 * The contract in five lines:
 * - A `Project` (rooms, staircases, products, options, prices) goes in; `estimateProject(project)`
 *   returns a `ProjectEstimate`: roll plans with every cut piece and seam, a priced bill of
 *   materials, per-room and per-staircase summaries, and warnings. Nothing else is needed to quote.
 * - Every length is in MILLIMETRES; every area is in square metres; money is in the price book's
 *   currency. Pile direction is the axis the roll's LENGTH runs along; pieces are never rotated.
 * - Every module is PURE: no DOM, no network, no clock, no randomness. The same project always
 *   yields the same estimate, which is what makes the whole thing testable and diffable.
 * - Nothing here throws for bad user data: impossible input comes back as a `Warning`, and a
 *   corrupt project FILE comes back as `{ error }` from `parseProject`.
 * - The specialist planners (`planRoom`, `buildRollPlan`, `planStaircase`, `planUnderlay`,
 *   `planGripper`, `planDoorBars`, `planTapes`, `planFloorPrep`, `planHardFloor`) are exported so a
 *   caller can drill into one step; `estimateProject` is simply all of them, in order, priced.
 */

// ---- Units -------------------------------------------------------------------------------------
export type { Mm, M2, LengthUnit } from './units';
export {
  MM_PER_M,
  MM_PER_INCH,
  MM_PER_FOOT,
  toMm,
  fromMm,
  parseLength,
  mm2ToM2,
  m2ToMm2,
  ceilToStep,
  roundTo,
  formatM,
  formatM2,
  formatFtIn,
} from './units';

// ---- Domain model ------------------------------------------------------------------------------
export type {
  Point,
  Polygon,
  Id,
  CoveringKind,
  BroadloomProduct,
  PackProduct,
  Product,
  RoomShape,
  WallFeature,
  Doorway,
  DoorwayTransition,
  SubfloorType,
  SubfloorCondition,
  Subfloor,
  Room,
  StepKind,
  Step,
  Landing,
  StairMethod,
  Staircase,
  PileDirection,
  SeamPolicy,
  BroadloomPlanningOptions,
  LayPattern,
  HardFloorOptions,
  UnderlayOptions,
  AccessoryOptions,
  FloorPrepOptions,
  PriceBook,
  Project,
  FloorPlanDocument,
  CutPiece,
  RollCut,
  Offcut,
  Seam,
  RollPlan,
  Warning,
  BomCategory,
  BomLine,
  Estimate,
  RoomSummary,
  StairSummary,
} from './types';
export { isBroadloom, isHardFloor } from './types';

// ---- Trade defaults (every one of these is user-editable in the UI) -----------------------------
export {
  CARPET_ROLL_WIDTHS,
  CARPET_ROLL_WIDTHS_OTHER,
  VINYL_ROLL_WIDTHS,
  CARPET_MAX_ROLL_LENGTH,
  VINYL_MAX_ROLL_LENGTH,
  CUT_INCREMENT,
  DEFAULT_CARPET_THICKNESS,
  DEFAULT_VINYL_THICKNESS,
  DEFAULT_BROADLOOM_OPTIONS,
  DEFAULT_UNDERLAY,
  UNDERLAY_ROLL_LENGTHS,
  MAX_TOG_WITH_UFH,
  MAX_UNDERLAY_THICKNESS_ON_STAIRS,
  DEFAULT_ACCESSORIES,
  GRIPPER_TRADE_BOX,
  UK_DOOR_WIDTHS,
  DEFAULT_DOOR_WIDTH,
  DEFAULT_FLOOR_PREP,
  MAX_SUBFLOOR_RH_RESILIENT,
  MAX_SUBFLOOR_RH_WOOD,
  LAY_PATTERN_WASTAGE,
  DEFAULT_HARD_FLOOR,
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
  DEFAULT_STEP,
  STAIR_REGS,
  DEFAULT_NOSING_OVERHANG,
  STEP_LENGTH_ALLOWANCE,
  CAP_AND_BAND_EXTRA,
  STEP_WIDTH_ALLOWANCE,
  OPEN_SIDE_WRAP,
  BULLNOSE_WRAP_FACTOR,
  BULLNOSE_WRAP_TUCK,
  RUNNER_END_ALLOWANCE,
  RUNNER_DEFAULT_WIDTH,
  GRIPPER_PER_STEP,
  DEFAULT_PRICES,
  PLY_SCREWS_PER_BOX,
  CARPET_PRICE_TIERS,
} from './defaults';

// ---- Geometry ----------------------------------------------------------------------------------
export type { BBox } from './geometry';
export {
  shapeToPolygon,
  rectanglePolygon,
  applyWallFeatures,
  walkToPolygon,
  normalizePolygon,
  polygonAreaM2,
  polygonAreaMm2,
  polygonPerimeter,
  boundingBox,
  fixingPerimeter,
  doorwaySegment,
  edgeLength,
  pointAlongEdge,
  pointInPolygon,
  isRectilinear,
  centroid,
  distance,
} from './geometry';

// ---- Broadloom planning: room -> pieces -> roll ------------------------------------------------
export type { RoomPlanInput, RoomPlan } from './broadloom';
export { planRoom } from './broadloom';
export type { RollPlanRoom, RollPlanInput } from './rollplan';
export { buildRollPlan, chooseDirection, CROSS_JOIN_ALLOWANCE } from './rollplan';
export type { PackInput, PackResult } from './packer';
export { packOnRoll, splitIntoRolls } from './packer';

// ---- Stairs ------------------------------------------------------------------------------------
export type { StairPlanInput, StairPlanStep, StairPlan } from './stairs';
export { planStaircase, stepWrapLength, bullnoseWrapExtra } from './stairs';

// ---- Underlay, gripper, door bars, tapes -------------------------------------------------------
export type { UnderlayInput, UnderlayPlan, UnderlayOwnerPlan, UnderlayArea } from './accessories';
export type { GripperInput, GripperPlan, GripperOwnerPlan, GripperRoom, GripperExtra, GripperPin } from './accessories';
export type { DoorBarInput, DoorBarPlan, DoorBarLine, DoorBarRoom, DoorBarType } from './accessories';
export type { TapeInput, TapePlan, TapeRoom } from './accessories';
export { planUnderlay, planGripper, planDoorBars, planTapes, doorBarTypeFor, doorBarsForWidth, gripperPinFor, needsGripper, DOOR_BAR_TYPES } from './accessories';

// ---- Floor preparation -------------------------------------------------------------------------
export type { PrepRoomInput, PrepItem, PrepItemKind, FloorPrepPlan, CoveringClass } from './floorprep';
export { planFloorPrep, coveringClass, COVERING_CLASS } from './floorprep';

// ---- Hard floors and sheet vinyl sundries ------------------------------------------------------
export type {
  HardFloorRoomInput,
  HardFloorPlanInput,
  HardFloorPlan,
  HardFloorThreshold,
  ThresholdProfile,
  RowsEstimate,
  WastageBreakdown,
  PackKind,
  FloatingKind,
  SheetVinylSundriesInput,
  SheetVinylSundries,
} from './hardfloor';
export { planHardFloor, planSheetVinylSundries, wastageFor, hardFloorWastage, estimateRows, isFloatingFloor, thresholdProfileFor } from './hardfloor';

// ---- The whole estimate ------------------------------------------------------------------------
export type { ProjectEstimate, EstimateDetails, RollWidthComparison } from './estimate';
export { estimateProject, compareRollWidths, fittingLabour, buildUpChange } from './estimate';

// ---- Example projects --------------------------------------------------------------------------
export { sampleProject, emptyProject, SAMPLE_IDS } from './fixtures';

// ---- Project files -----------------------------------------------------------------------------
export type { ProjectFile, ParseResult, ParsedProject, ParseFailure } from './serialize';
export { serializeProject, parseProject, PROJECT_SCHEMA_VERSION } from './serialize';
