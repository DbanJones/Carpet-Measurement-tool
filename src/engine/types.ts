/**
 * Shared domain model for the flooring estimating engine.
 *
 * Conventions
 * - All lengths are millimetres (`Mm`). Areas returned to callers are square metres (`M2`).
 * - Polygons are simple (non self-intersecting), listed in either winding order, closed implicitly.
 * - "Pile direction" / "roll direction" is the axis along which the roll's LENGTH runs. Every piece
 *   cut from a broadloom roll keeps that orientation (no 90° rotation of pieces).
 * - Every module is pure: no I/O, no Date.now(), deterministic for a given input.
 */
import type { Mm, M2 } from './units';

export type { Mm, M2 };

export interface Point {
  x: Mm;
  y: Mm;
}

export type Polygon = Point[];

/** A stable id for anything the UI needs to refer back to. */
export type Id = string;

// ---------------------------------------------------------------------------
// Floor coverings
// ---------------------------------------------------------------------------

export type CoveringKind =
  | 'carpet' // broadloom, from a roll
  | 'sheet_vinyl' // broadloom, from a roll (2/3/4 m)
  | 'laminate' // click boards sold by the pack
  | 'engineered_wood' // click/tongue-and-groove boards sold by the pack
  | 'lvt_click' // luxury vinyl tile/plank, click, sold by the pack
  | 'lvt_glue' // luxury vinyl tile/plank, glue-down, sold by the pack
  | 'carpet_tiles'; // 500x500 tiles sold by the box

export function isBroadloom(kind: CoveringKind): boolean {
  return kind === 'carpet' || kind === 'sheet_vinyl';
}

export function isHardFloor(kind: CoveringKind): boolean {
  return kind === 'laminate' || kind === 'engineered_wood' || kind === 'lvt_click' || kind === 'lvt_glue';
}

/** A broadloom product (carpet or sheet vinyl) as sold off the roll. */
export interface BroadloomProduct {
  id: Id;
  name: string;
  kind: 'carpet' | 'sheet_vinyl';
  /** Roll width the product is available in (mm). UK carpet: 4000 / 5000. Vinyl: 2000 / 3000 / 4000. */
  rollWidth: Mm;
  /** Alternative widths the same product comes in; the planner can compare. */
  alternativeRollWidths?: Mm[];
  /** Maximum length of a single roll (mm); longer requirements are split across rolls. */
  maxRollLength?: Mm;
  /** Cut lengths are sold in this increment (mm), e.g. 100 = to the nearest 10 cm. */
  cutIncrement?: Mm;
  /** Minimum cut length a supplier will sell (mm). */
  minCutLength?: Mm;
  /** Pattern repeat along the roll length (mm); 0/undefined for plain. */
  patternRepeatLength?: Mm;
  /** Pattern repeat across the roll width (mm); 0/undefined for plain. */
  patternRepeatWidth?: Mm;
  /** Total thickness incl. backing (mm), used for wrap allowances and door bar selection. */
  thickness?: Mm;
  /** Price per square metre (whole roll width x cut length is charged). */
  pricePerM2?: number;
}

/** A pack-sold product (laminate, LVT, wood, carpet tiles). */
export interface PackProduct {
  id: Id;
  name: string;
  kind: Exclude<CoveringKind, 'carpet' | 'sheet_vinyl'>;
  /** Coverage per pack/box in square metres. */
  packCoverageM2: M2;
  /** Optional plank/tile geometry for board counts and pattern maths. */
  boardLength?: Mm;
  boardWidth?: Mm;
  boardsPerPack?: number;
  thickness?: Mm;
  pricePerPack?: number;
  pricePerM2?: number;
}

export type Product = BroadloomProduct | PackProduct;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/** How the user described the room; every shape can be converted to a Polygon. */
export type RoomShape =
  | { kind: 'rectangle'; length: Mm; width: Mm }
  | {
      /** Overall rectangle with one rectangular corner removed. */
      kind: 'l_shape';
      length: Mm;
      width: Mm;
      cutoutLength: Mm; // along `length`
      cutoutWidth: Mm; // along `width`
      cutoutCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    }
  | {
      /** A rectangle plus rectangular projections (bays) or recesses (alcoves, chimney breasts) on its walls. */
      kind: 'rectangle_with_features';
      length: Mm;
      width: Mm;
      features: WallFeature[];
    }
  | { kind: 'polygon'; points: Polygon };

export interface WallFeature {
  id: Id;
  /** Which wall of the base rectangle. `top`/`bottom` run along `length`; `left`/`right` run along `width`. */
  wall: 'top' | 'right' | 'bottom' | 'left';
  /** Distance from the wall's start (clockwise from top-left) to the feature's start. */
  offset: Mm;
  /** Width of the feature along the wall. */
  width: Mm;
  /** How far the feature projects OUT of the room (bay, alcove = positive) or INTO the room (chimney breast, pillar = negative). */
  depth: Mm;
  label?: string;
}

/** Where the floor transitions to something else through an opening in the wall. */
export interface Doorway {
  id: Id;
  /** Index of the polygon edge the opening sits on (edge i runs from point i to point i+1). */
  edgeIndex: number;
  /** Distance along the edge from its start point to the opening's start. */
  offset: Mm;
  /** Clear opening width. UK internal doors: 610/686/762/838/926 mm; use 900 for a standard bar. */
  width: Mm;
  /** What is on the other side of the opening. Drives door-bar selection. */
  transition: DoorwayTransition;
  /** If the same broadloom continues through the opening without a bar (e.g. hall into landing). */
  continuous?: boolean;
  /**
   * The PHYSICAL opening this doorway is one side of. A door between two rooms is measured from
   * both rooms (each room's gripper has to stop at it), but there is only one door leaf and one bar
   * to buy: give both entries the same `sharedOpeningId` and the estimate counts the opening once.
   *
   * Never inferred from `label` — "Door", "Doorway" and "Door to landing" are exactly what people
   * type, and matching on them buys one bar for two different doorways (or two for one).
   */
  sharedOpeningId?: Id;
  label?: string;
}

export type DoorwayTransition =
  | 'carpet'
  | 'hard_floor' // laminate/LVT/wood/tile/vinyl in the adjoining room
  | 'same_floor' // same hard floor continues at the same level
  | 'external' // front/back door, patio door
  | 'none'; // opening with nothing to fix to (e.g. into a wardrobe) — still no gripper on this stretch

export type SubfloorType =
  | 'concrete' // concrete / sand-cement screed
  | 'anhydrite' // calcium sulphate screed (needs specific primers)
  | 'floorboards' // timber boards
  | 'chipboard' // sheet timber (flooring grade)
  | 'plywood'
  | 'existing_tiles'
  | 'existing_vinyl'
  | 'asphalt';

export type SubfloorCondition = 'good' | 'uneven' | 'poor';

export interface Subfloor {
  type: SubfloorType;
  condition: SubfloorCondition;
  /** Is there underfloor heating? Limits underlay tog and requires UFH-compatible products. */
  underfloorHeating?: boolean;
  /** Ground floor concrete without a known damp-proof membrane -> moisture test / surface DPM. */
  dpmKnown?: boolean;
  /** Existing covering to uplift and dispose of. */
  existingCovering?: 'none' | 'carpet' | 'vinyl' | 'laminate' | 'tiles' | 'wood';
  /** Existing gripper to remove (already there, can sometimes be reused). */
  existingGripper?: boolean;
}

export interface Room {
  id: Id;
  name: string;
  shape: RoomShape;
  doorways: Doorway[];
  /** Which product covers this room. */
  productId: Id;
  subfloor: Subfloor;
  /** Optional per-room overrides of the broadloom planning options. */
  planning?: Partial<BroadloomPlanningOptions>;
  /** Optional per-room override of hard flooring options. */
  hardFloor?: Partial<HardFloorOptions>;
  /** Free-text notes shown on the quote. */
  notes?: string;
  /** For rooms traced from a floor plan: the source document and pixel polygon. */
  source?: { floorPlanId: Id; pixelPolygon: { x: number; y: number }[] };
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

export type StepKind = 'straight' | 'winder' | 'bullnose' | 'curtail';

export interface Step {
  id: Id;
  kind: StepKind;
  /** Riser height (vertical). */
  rise: Mm;
  /** Going (tread depth, nosing to nosing) for straight steps; the MAXIMUM going (at the wide end) for winders. */
  going: Mm;
  /** Tread width (wall to wall or string to string). */
  width: Mm;
  /** For winders: the minimum going at the narrow end (informational, affects underlay pad size). */
  goingNarrow?: Mm;
  /** For bullnose/curtail steps: how far the curved end projects beyond the string on each side. */
  bullnoseProjection?: Mm;
  bullnoseSides?: 'left' | 'right' | 'both';
}

export interface Landing {
  id: Id;
  kind: 'quarter' | 'half' | 'top';
  length: Mm;
  width: Mm;
  /** Position in the sequence: after step index n (0-based). */
  afterStepIndex: number;
}

export type StairMethod =
  /** One continuous piece down the flight ("waterfall"). Needs a straight flight; nicest look, most waste. */
  | 'waterfall'
  /** Individual piece per step ("cap and band"), cut from offcuts / a cut across the roll. Least waste. */
  | 'cap_and_band';

export interface Staircase {
  id: Id;
  name: string;
  productId: Id;
  /** Steps from the BOTTOM up. Each step = one riser + the tread above it. The top riser's "tread" is the landing. */
  steps: Step[];
  landings: Landing[];
  method: StairMethod;
  /** Which sides are open (no string/wall): carpet wraps around the exposed edge and is bound. */
  openSides: 'none' | 'left' | 'right' | 'both';
  /** Fit a runner (bound both sides, stair rods) rather than fully fitted. */
  runner?: { width: Mm; stairRods: boolean };
  /** Nosing overhang of the tread beyond the riser (adds to the wrap around the nose). */
  nosingOverhang?: Mm;
  /**
   * The top riser's tread is the landing. By default the stair carpet covers the top riser (no going).
   * Set true when the landing carpet runs over the top nosing and down the top riser instead: the
   * stairs then stop one riser short and the landing piece gains rise + tuck.
   */
  topRiserByLanding?: boolean;
  /**
   * Underlay the risers as well as the treads (a continuous pad down the whole flight). Off by
   * default: UK practice is a pad per tread, wrapped `PAD_NOSING_OVERLAP` over the nosing.
   */
  underlayRisers?: boolean;
  subfloor?: Subfloor;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Planning options
// ---------------------------------------------------------------------------

export type PileDirection = 'auto' | 'along_length' | 'along_width';

export type SeamPolicy =
  /** Fewest seams: each fill is one full-length strip, no cross joins. */
  | 'min_seams'
  /** Least material: fills may be made of several shorter strips (cross joins) cut side by side from one cut. */
  | 'min_waste'
  /** Cross joins allowed only where they save at least `balancedThresholdM2` of carpet. */
  | 'balanced';

export interface BroadloomPlanningOptions {
  pileDirection: PileDirection;
  seamPolicy: SeamPolicy;
  /** Extra added to every cut piece's LENGTH (mm) for trimming to the walls. Trade norm: 100 mm. */
  lengthAllowance: Mm;
  /** Extra added to every cut piece's WIDTH where it does not span the full roll (mm). */
  widthAllowance: Mm;
  /** Lowest seam count vs waste trade-off threshold for 'balanced' (m²). */
  balancedThresholdM2: M2;
  /** Never split a piece narrower than this into cross-joined strips (mm). */
  minCrossJoinStripLength: Mm;
  /** Reserve offcuts at least this size (both dimensions) as "usable". */
  usableOffcutMin: Mm;
  /** Never plan a fill narrower than this (mm); the seam moves so both pieces are practical. Default 300. */
  minFillWidth?: Mm;
  /** Maximum cross seams in one fill run (a fill of k strips has k-1). Default 2. */
  maxCrossJoinsPerFill?: number;
}

export type LayPattern = 'straight' | 'diagonal' | 'herringbone' | 'chevron' | 'random_stagger' | 'brick';

export interface HardFloorOptions {
  layPattern: LayPattern;
  /** Wastage fraction applied to net area before packing into packs (0.05 = 5%). If omitted, derived from pattern. */
  wastage?: number;
  /** Perimeter expansion gap (mm) — informational and drives beading/scotia. */
  expansionGap: Mm;
  /** Cover the expansion gap with beading/scotia (true) or remove-and-refit skirting (false). */
  useBeading: boolean;
  beadingLength: Mm;
  underlayPackCoverageM2: M2;
  /** Underlay includes a damp-proof membrane (else add polythene DPM on concrete). */
  underlayHasDpm: boolean;
}

export interface UnderlayOptions {
  /** Fit underlay under carpet (false for felt-backed / stick-down). */
  fit: boolean;
  rollWidth: Mm;
  rollLength: Mm;
  thickness: Mm;
  /** Tog rating; with UFH the carpet+underlay combination should stay <= 2.5 tog. */
  tog?: number;
  pricePerRoll?: number;
  pricePerM2?: number;
}

export interface AccessoryOptions {
  gripperLength: Mm;
  gripperPerPack: number;
  gripperWastage: number; // fraction, e.g. 0.05
  doorBarLength: Mm;
  doorBarLongLength: Mm;
  /** Seaming tape roll length. */
  seamTapeRollLength: Mm;
  /** Double-sided tape roll length for vinyl perimeter/seams. */
  doubleSidedTapeRollLength: Mm;
  /** Underlay joining tape roll length. */
  underlayTapeRollLength: Mm;
}

export interface FloorPrepOptions {
  /** Smoothing compound thickness to allow for (mm). */
  latexThickness: Mm;
  /** Coverage of one bag expressed as m² at 1 mm thickness (e.g. a 20 kg bag ≈ 13.5 m²·mm). */
  latexBagCoverageM2PerMm: number;
  latexWastage: number;
  /** Primer coverage m² per litre (diluted, one coat). */
  primerCoverageM2PerLitre: number;
  primerCoats: number;
  /** Primer is sold in sealed cans of this many litres; the order is rounded up to whole cans. */
  primerCanLitres: number;
  plySheetLength: Mm;
  plySheetWidth: Mm;
  plyWastage: number;
  plyScrewsPerSheet: number;
  hardboardSheetLength: Mm;
  hardboardSheetWidth: Mm;
  /** Liquid DPM coverage in m² per kg (two coats). */
  liquidDpmCoverageM2PerKg: number;
  /** Polythene DPM roll area (m²). */
  dpmSheetRollAreaM2: number;
  dpmOverlap: number; // fraction
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface PriceBook {
  currency: string;
  vatRate: number; // 0.2
  applyVat: boolean;
  /** Labour and sundry unit prices (indicative defaults, user editable). */
  labour: {
    carpetFittingPerM2: number;
    vinylFittingPerM2: number;
    laminateFittingPerM2: number;
    lvtFittingPerM2: number;
    stairsPerStep: number;
    upliftPerM2: number;
    disposalPerM2: number;
    latexPerM2: number;
    plyPerM2: number;
    doorEasingPerDoor: number;
    bindingPerM: number;
    /**
     * Least the LABOUR on a job is charged, whatever the area. A 2.2 x 1.9 m bathroom in glue-down
     * LVT over a new ply overlay is a full day cutting round a WC pan and pedestal, but pure £/m²
     * rates price it at about £130. The shortfall is added as its own line so the quote says why.
     * A per-ROOM minimum is deliberately not used: at £5/m² carpet it would put a minimum charge on
     * every room under 24 m² of a whole-house job, which no fitter charges. Set 0 to switch off.
     */
    minimumJobLabour: number;
    /** Lifting old gripper (per metre of perimeter). */
    gripperRemovalPerM: number;
    /** Screwing down or sanding floorboards before an overlay (per m²). */
    boardPrepPerM2: number;
    /** Taking skirting off and refitting it over the expansion gap (per metre). */
    skirtingRefitPerM: number;
    /** One hygrometer / RH test of the slab. */
    moistureTestPerTest: number;
  };
  materials: {
    gripperPerLength: number;
    /** A retail pack of `AccessoryOptions.gripperPerPack` lengths; gripper is bought by the pack. */
    gripperPerPack: number;
    doorBarPerBar: number;
    latexPerBag: number;
    /** A sealed can of primer — the unit it is actually sold in (see FloorPrepOptions.primerCanLitres). */
    primerPerCan: number;
    plyPerSheet: number;
    hardboardPerSheet: number;
    liquidDpmPerKg: number;
    dpmSheetPerRoll: number;
    seamTapePerRoll: number;
    doubleSidedTapePerRoll: number;
    underlayTapePerRoll: number;
    /** Hard floor (laminate / LVT) underlay, per pack of `HardFloorOptions.underlayPackCoverageM2`. */
    hardFloorUnderlayPerPack: number;
    beadingPerLength: number;
    thresholdPerItem: number;
    stairNosingPerItem: number;
    stairRodPerItem: number;
    adhesivePerTub: number;
    tackifierPerTub: number;
    plyScrewsPerBox: number;
    /** Cold weld / seam sealer for a bonded sheet vinyl seam, per metre of seam. */
    vinylSeamWeldPerM: number;
  };
}

export interface Project {
  id: Id;
  name: string;
  /** Display unit for the UI; the engine stays in mm. */
  displayUnit: 'metric' | 'imperial';
  products: Product[];
  rooms: Room[];
  staircases: Staircase[];
  floorPlans: FloorPlanDocument[];
  options: {
    broadloom: BroadloomPlanningOptions;
    hardFloor: HardFloorOptions;
    underlay: UnderlayOptions;
    accessories: AccessoryOptions;
    floorPrep: FloorPrepOptions;
  };
  prices: PriceBook;
  /**
   * Who and when the quote is for. Free text, filled in by the UI and printed above the figures —
   * the engine never reads them and never fills the date in for itself (it has no clock).
   */
  customer?: string;
  siteAddress?: string;
  quoteRef?: string;
  /** Date the quote was prepared, as the user typed or picked it (ISO `YYYY-MM-DD` from the UI). */
  quoteDate?: string;
  /** How long the price holds, e.g. "30 days". */
  validFor?: string;
  /** Free-text notes and terms, printed under the bill of materials. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Floor plans
// ---------------------------------------------------------------------------

export interface FloorPlanDocument {
  id: Id;
  name: string;
  /** Data URL of the rendered raster (PNG/JPEG). PDFs are rendered to a raster on import. */
  imageDataUrl: string;
  widthPx: number;
  heightPx: number;
  /** Set once the user calibrates: millimetres represented by one pixel. */
  mmPerPx?: number;
  calibration?: { a: { x: number; y: number }; b: { x: number; y: number }; distance: Mm };
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface CutPiece {
  id: Id;
  /** Which room/staircase the piece belongs to. */
  ownerId: Id;
  ownerName: string;
  label: string;
  /** Dimension ALONG the roll length (pile direction), incl. allowances. */
  length: Mm;
  /** Dimension ACROSS the roll width, incl. allowances. */
  width: Mm;
  /** Where the piece lands in the room (room coordinates, mm), for the seam diagram. */
  placement?: { polygon: Polygon };
  /** True if this piece is one segment of a cross-joined fill. */
  crossJoinGroup?: Id;
  /** Piece purpose. */
  role: 'main' | 'fill' | 'stair_step' | 'stair_runner' | 'landing' | 'winder' | 'other';
}

export interface RollCut {
  /** Sequential cut across the roll ("shelf"). */
  index: number;
  /** Length taken off the roll for this cut (mm). */
  length: Mm;
  /** Pieces placed across the roll width in this cut, left to right. */
  pieces: { pieceId: Id; x: Mm; width: Mm; length: Mm }[];
  /** Leftover width x this cut's length. */
  offcut?: { width: Mm; length: Mm };
}

export interface Offcut {
  width: Mm;
  length: Mm;
  areaM2: M2;
  usable: boolean;
  fromCutIndex: number;
}

export interface Seam {
  /** Line in room coordinates. */
  from: Point;
  to: Point;
  kind: 'side' | 'cross';
}

export interface RollPlan {
  productId: Id;
  rollWidth: Mm;
  pileDirection: 'along_length' | 'along_width';
  pieces: CutPiece[];
  cuts: RollCut[];
  /** Total linear length to order (sum of cuts, rounded to the supplier's increment). */
  orderLength: Mm;
  /** Number of physical rolls required (given maxRollLength). */
  rollsRequired: number;
  orderedAreaM2: M2;
  netAreaM2: M2;
  /** (ordered - net) / ordered */
  wasteFraction: number;
  offcuts: Offcut[];
  seamsByRoom: Record<Id, Seam[]>;
  warnings: Warning[];
}

export interface Warning {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  /** Room/staircase the warning concerns. */
  subjectId?: Id;
}

export type BomCategory =
  | 'floor_covering'
  | 'underlay'
  | 'gripper'
  | 'door_bars'
  | 'floor_preparation'
  | 'adhesives_tapes'
  | 'trims'
  | 'stairs'
  | 'labour'
  | 'other';

export interface BomLine {
  id: Id;
  category: BomCategory;
  description: string;
  quantity: number;
  unit: string; // 'm', 'm²', 'roll', 'length', 'bag', 'sheet', 'pack', 'each', 'litre', 'kg', 'step'
  /** Quantity before rounding up to whole units, for transparency. */
  exactQuantity?: number;
  unitPrice?: number;
  total?: number;
  /** Which rooms/staircases contribute. */
  subjectIds: Id[];
  notes?: string;
}

export interface Estimate {
  rollPlans: RollPlan[];
  bom: BomLine[];
  warnings: Warning[];
  totals: {
    netAreaM2: M2;
    materialsCost?: number;
    labourCost?: number;
    subtotal?: number;
    vat?: number;
    total?: number;
  };
  /** Per-room summaries for the UI. */
  rooms: Record<Id, RoomSummary>;
  staircases: Record<Id, StairSummary>;
}

export interface RoomSummary {
  roomId: Id;
  netAreaM2: M2;
  perimeter: Mm;
  gripperPerimeter: Mm;
  boundingBox: { length: Mm; width: Mm };
  pieces: CutPiece[];
  seams: Seam[];
  warnings: Warning[];
}

export interface StairSummary {
  staircaseId: Id;
  stepCount: number;
  carpetAreaM2: M2;
  pieces: CutPiece[];
  gripperLength: Mm;
  bindingLength: Mm;
  underlayAreaM2: M2;
  warnings: Warning[];
}
