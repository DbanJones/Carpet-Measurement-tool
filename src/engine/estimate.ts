/**
 * Project estimate: the orchestrator that turns a `Project` into an `Estimate`.
 *
 * It resolves every room and staircase to its product and dispatches to the specialist planners:
 * - broadloom (carpet, sheet vinyl): one roll plan per product (`rollplan.buildRollPlan`) with the
 *   stair / landing pieces of that product packed on the same roll, so offcuts serve the stairs;
 * - pack floors (laminate, wood, LVT, carpet tiles): `hardfloor.planHardFloor` per room, plus the
 *   stair cladding area from `stairs.planStaircase`;
 * - underlay, gripper, door bars and tapes (`accessories`), sheet vinyl adhesive / tape
 *   (`hardfloor.planSheetVinylSundries`) and floor preparation (`floorprep.planFloorPrep`).
 * The results are folded into a bill of materials with prices from the product list and the
 * project's price book, per-room / per-stair summaries for the UI, and one de-duplicated warning
 * list. Nothing here throws on bad input: a room whose product is missing is reported
 * (`MISSING_PRODUCT`) and left out of the quantities, an empty outline gets `EMPTY_ROOM`.
 *
 * Pure and deterministic: no I/O, no clock, no randomness. Lengths are mm; areas are m² only where
 * the type says `M2`; money is rounded to 2 dp at the line.
 */
import type {
  Mm,
  M2,
  Id,
  Project,
  Product,
  BroadloomProduct,
  PackProduct,
  Room,
  Staircase,
  Polygon,
  Seam,
  CutPiece,
  Warning,
  RollPlan,
  Estimate,
  RoomSummary,
  StairSummary,
  BomLine,
  BomCategory,
  BroadloomPlanningOptions,
  HardFloorOptions,
  UnderlayOptions,
  PriceBook,
  CoveringKind,
  Subfloor,
  Doorway,
} from './types';
import { shapeToPolygon, polygonAreaMm2, polygonPerimeter, fixingPerimeter, boundingBox, distance, isSimplePolygon, doorwayProblem, hasOverlappingDoorways, overlappingFeatures } from './geometry';
import { buildRollPlan, type RollPlanInput, type RollPlanRoom } from './rollplan';
import { planStaircase, type StairPlan } from './stairs';
import { planHardFloor, planSheetVinylSundries, isFloatingFloor, type HardFloorPlan, type SheetVinylSundries } from './hardfloor';
import {
  planUnderlay,
  planGripper,
  planDoorBars,
  planTapes,
  wholeUnitsWithTolerance,
  DOOR_BAR_TYPES,
  type UnderlayPlan,
  type UnderlayArea,
  type GripperPlan,
  type GripperRoom,
  type GripperExtra,
  type GripperPin,
  type DoorBarPlan,
  type DoorBarRoom,
  type DoorBarType,
  type TapePlan,
  type TapeRoom,
} from './accessories';
import { planFloorPrep, needsDoorEasing, type FloorPrepPlan, type PrepRoomInput, type PrepItem, type PrepItemKind } from './floorprep';
import {
  CARPET_ROLL_WIDTHS,
  VINYL_ROLL_WIDTHS,
  DEFAULT_CARPET_THICKNESS,
  DEFAULT_VINYL_THICKNESS,
  DEFAULT_UNDERLAY,
  VINYL_ADHESIVE_M2_PER_KG,
  VINYL_ADHESIVE_TUB_KG,
  LVT_ADHESIVE_TUB_KG,
  TACKIFIER_TUB_LITRES,
  GRIPPER_PER_STEP,
} from './defaults';
import { mm2ToM2, roundTo, ceilToStep, MM_PER_M } from './units';

// ---------------------------------------------------------------------------
// Local trade constants (candidates for defaults.ts)
// ---------------------------------------------------------------------------

/**
 * Sheet vinyl is perimeter-stuck (double-sided tape) in small rooms and fully bonded (adhesive over
 * the whole floor) above this net area, or whenever the room has a seam — a seam in a loose-laid
 * sheet lifts. 20 m² is where most UK fitters stop trusting tape.
 */
export const VINYL_FULLY_BONDED_MIN_AREA_M2: M2 = 20;

/**
 * A minimum-charge shortfall smaller than this is absorbed into the job rather than shown. Under it
 * the line is worth less than the paragraph it takes to explain, and a 20p "Minimum job charge" on a
 * customer's quote reads as an error.
 */
export const MINIMUM_JOB_DE_MINIMIS = 5;

/**
 * When a doorway is entered from both rooms it joins, the room with the "harder" floor decides
 * the profile (a ramp / reducer or end profile belongs to the hard floor; the carpet side is held
 * by the same bar). Lower ranks are planned first, so their view of a shared label wins.
 */
export const DOOR_BAR_PRECEDENCE: Record<CoveringKind, number> = {
  laminate: 0,
  engineered_wood: 0,
  lvt_click: 0,
  lvt_glue: 0,
  sheet_vinyl: 1,
  carpet_tiles: 2,
  carpet: 3,
};

/** Quote wording for each door bar / threshold type. */
export const DOOR_BAR_DESCRIPTIONS: Record<DoorBarType, string> = {
  double_carpet: 'Double-sided carpet door bar',
  single_edge: 'Single-edge carpet door bar',
  cover_strip: 'Flat cover strip',
  t_bar: 'T-bar threshold',
  ramp: 'Ramp / reducer threshold',
  end_profile: 'End profile',
  none: 'No bar',
};

/** Door bar types that are hard-floor thresholds, priced at `materials.thresholdPerItem` under 'trims'. */
export const THRESHOLD_BAR_TYPES: readonly DoorBarType[] = ['t_bar', 'ramp'];

/**
 * Typical build-up (mm) of an existing floor covering, used to tell whether a new CARPET is thicker
 * than what it replaces (which drives the "ease the doors" recommendation). Carpet is taken as
 * like-for-like: default carpet thickness plus a standard underlay. Laminate, wood and tiles vary
 * too much to guess, so no change is reported for them (hard floors get the door-easing
 * recommendation from the floor-prep rules regardless).
 */
export const EXISTING_BUILD_UP: Record<NonNullable<Subfloor['existingCovering']>, Mm | undefined> = {
  none: 0,
  carpet: DEFAULT_CARPET_THICKNESS + DEFAULT_UNDERLAY.thickness,
  vinyl: DEFAULT_VINYL_THICKNESS,
  laminate: undefined,
  tiles: undefined,
  wood: undefined,
};

/** Floor-preparation kinds bought as materials, and the price-book entry that prices them. */
export const PREP_MATERIAL_PRICE: Partial<Record<PrepItemKind, keyof PriceBook['materials']>> = {
  latex: 'latexPerBag',
  primer: 'primerPerCan',
  ply: 'plyPerSheet',
  ply_screws: 'plyScrewsPerBox',
  hardboard: 'hardboardPerSheet',
  liquid_dpm: 'liquidDpmPerKg',
  dpm_sheet: 'dpmSheetPerRoll',
};

/**
 * Preparation kinds that are LABOUR, priced on their own quantity (metres, m², tests) rather than
 * on the room area the way uplift / latex / ply are. The prep line itself carries the quantity and
 * the labour line carries the money, exactly as for uplift.
 */
export const PREP_LABOUR_RATE: Partial<Record<PrepItemKind, { key: keyof PriceBook['labour']; description: string }>> = {
  gripper_removal: { key: 'gripperRemovalPerM', description: 'Remove existing gripper' },
  moisture_test: { key: 'moistureTestPerTest', description: 'Subfloor moisture test' },
  secure_boards: { key: 'boardPrepPerM2', description: 'Secure loose floorboards' },
  sand_boards: { key: 'boardPrepPerM2', description: 'Sand floorboards flat' },
  skirting_refit: { key: 'skirtingRefitPerM', description: 'Remove and refit skirting' },
};

/** Preparation kinds that cost nothing to buy or do — they take time in the programme. */
export const PREP_NO_CHARGE: Partial<Record<PrepItemKind, string>> = {
  acclimatise: 'No charge — allow the time in the programme before fitting.',
};

/**
 * Preparation kinds whose money is on a labour line rather than the preparation line: the ones
 * priced per m² of the rooms they apply to, plus every kind in `PREP_LABOUR_RATE`. Used only to say
 * so in the note, so a required line never reads as free.
 */
const PREP_PRICED_AS_LABOUR: PrepItemKind[] = ['uplift', 'disposal', 'latex', 'ply', 'hardboard', 'door_easing', ...(Object.keys(PREP_LABOUR_RATE) as PrepItemKind[])];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The specialist plans behind the BOM, for the UI's detail views. */
export interface EstimateDetails {
  stairPlans: Record<Id, StairPlan>;
  hardFloorPlans: Record<Id, HardFloorPlan>;
  underlay?: UnderlayPlan;
  gripper?: GripperPlan;
  doorBars: DoorBarPlan;
  tapes: TapePlan;
  /** Sheet vinyl rooms: adhesive or double-sided tape, keyed by room id. */
  vinylSundries: Record<Id, SheetVinylSundries>;
  floorPrep: FloorPrepPlan;
  /** Product id each planned room / staircase resolved to. */
  productByOwner: Record<Id, Id>;
}

/** An `Estimate` plus the plans it was built from. */
export interface ProjectEstimate extends Estimate {
  details: EstimateDetails;
}

/** One row of `compareRollWidths`. */
export interface RollWidthComparison {
  rollWidth: Mm;
  orderLength: Mm;
  orderedAreaM2: M2;
  wasteFraction: number;
  /** Seams across all rooms (side and cross). */
  seams: number;
  rollsRequired: number;
  warnings: Warning[];
}

// ---------------------------------------------------------------------------
// Preparation: resolve products, geometry and options for every room and staircase
// ---------------------------------------------------------------------------

interface RoomCtx {
  room: Room;
  product: Product | undefined;
  polygon: Polygon;
  /** The room's doorways that actually sit on its outline; ones that do not are reported and dropped. */
  doorways: Doorway[];
  areaM2: M2;
  perimeter: Mm;
  fixingPerimeter: Mm;
  bbox: { length: Mm; width: Mm };
  broadloom: BroadloomPlanningOptions;
  hardFloor: HardFloorOptions;
  /** Product resolved and the outline has area: the room takes part in the quantities. */
  planned: boolean;
}

interface StairCtx {
  staircase: Staircase;
  product: Product | undefined;
  plan: StairPlan | undefined;
}

interface Prepared {
  rooms: RoomCtx[];
  stairs: StairCtx[];
  warnings: Warning[];
}

function isBroadloomProduct(p: Product): p is BroadloomProduct {
  return p.kind === 'carpet' || p.kind === 'sheet_vinyl';
}

/** Spread `over` onto `base`, ignoring keys whose value is undefined (a UI may leave them unset). */
function mergeDefined<T extends object>(base: T, over: Partial<T> | undefined): T {
  const out = { ...base };
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * A recess (negative depth) deeper than the room would break through the opposite wall. The geometry
 * clamps it so the outline stays simple; this says so, because the room is then not the shape the
 * user typed.
 */
function featureWarnings(room: Room): Warning[] {
  if (room.shape.kind !== 'rectangle_with_features') return [];
  const { length, width, features } = room.shape;
  const out: Warning[] = [];
  for (const f of features ?? []) {
    const limit = f.wall === 'top' || f.wall === 'bottom' ? width : length;
    if (f.depth < 0 && -f.depth > limit + 1e-6) {
      out.push({
        level: 'warning',
        code: 'FEATURE_TOO_DEEP',
        message: `${room.name}: "${f.label ?? 'recess'}" is ${Math.round(-f.depth)} mm deep on a wall only ${Math.round(limit)} mm from the far side — it has been cut back to the opposite wall. Check the measurement.`,
        subjectId: room.id,
      });
    }
  }
  return out;
}

function safePolygon(room: Room): Polygon {
  try {
    const poly = shapeToPolygon(room.shape);
    return Array.isArray(poly) && poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? poly : [];
  } catch {
    return [];
  }
}

/**
 * The project's products with any repeated id dropped (the first one wins, as in `prepare`).
 * A room can only resolve to one product per id, so quoting a duplicated entry twice would put the
 * same carpet on the order — and in the totals — twice.
 */
function uniqueProducts(project: Project): Product[] {
  const seen = new Set<Id>();
  const out: Product[] = [];
  for (const p of project.products ?? []) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function prepare(project: Project): Prepared {
  const warnings: Warning[] = [];
  const products = new Map<Id, Product>();
  for (const p of uniqueProducts(project)) products.set(p.id, p);
  const opts = project.options;

  const rooms: RoomCtx[] = (project.rooms ?? []).map((room) => {
    const polygon = safePolygon(room);
    // A bowtie still has a (partly cancelled) shoelace area, so check the area FIRST: a room with no
    // area at all is simply not measured yet, which is a different thing to say than "it crosses itself".
    const areaMm2 = polygon.length >= 3 ? polygonAreaMm2(polygon) : 0;
    const simple = areaMm2 > 0 && isSimplePolygon(polygon);
    const hasArea = simple;
    const areaM2 = hasArea ? mm2ToM2(areaMm2) : 0;
    const product = products.get(room.productId);
    if (!product) {
      warnings.push({ level: 'error', code: 'MISSING_PRODUCT', message: `${room.name}: no product selected (or the product was deleted) — the room is not included in the quantities.`, subjectId: room.id });
    }
    if (areaMm2 <= 0) {
      warnings.push({ level: 'error', code: 'EMPTY_ROOM', message: `${room.name}: the outline has no area — enter its dimensions.`, subjectId: room.id });
    } else if (!simple) {
      // Name the two features when the cause is a pair of recesses eating into the same corner: a
      // generic "check the wall lengths" is no help against an outline the shape editor built.
      const clash = room.shape.kind === 'rectangle_with_features' ? overlappingFeatures(room.shape.length, room.shape.width, room.shape.features ?? [])[0] : undefined;
      const why = clash
        ? `"${clash[0].label ?? 'recess'}" on the ${clash[0].wall} wall and "${clash[1].label ?? 'recess'}" on the ${clash[1].wall} wall cut into the same corner; reduce one of their depths or widths so they do not overlap.`
        : 'Check the wall lengths (a recess deeper than the room, or points in the wrong order).';
      warnings.push({
        level: 'error',
        code: 'SELF_INTERSECTING',
        message: `${room.name}: the outline crosses itself, so its area and the carpet it needs cannot be worked out. ${why}`,
        subjectId: room.id,
      });
    }
    warnings.push(...featureWarnings(room));
    // A doorway whose edge no longer exists (the shape was changed after it was entered) must not be
    // quietly reattached to another wall by the index wrapping, nor billed a bar it cannot fit.
    const doorways: Doorway[] = [];
    for (const d of room.doorways ?? []) {
      const problem = hasArea ? doorwayProblem(polygon, d) : null;
      if (problem === null) {
        doorways.push(d);
        continue;
      }
      const label = d.label?.trim() || `doorway ${d.id}`;
      warnings.push({
        level: 'warning',
        code: 'DOORWAY_OFF_EDGE',
        message:
          problem === 'no_such_edge'
            ? `${room.name}: "${label}" is on wall ${d.edgeIndex + 1}, which this outline no longer has (${polygon.length} walls) — it is left out of the gripper and the door bars. Put it back on a wall.`
            : `${room.name}: "${label}" starts ${Math.round(d.offset)} mm along a wall that is shorter than that — it is left out of the gripper and the door bars. Check its position.`,
        subjectId: room.id,
      });
    }
    if (hasArea && hasOverlappingDoorways(polygon, doorways)) {
      warnings.push({
        level: 'warning',
        code: 'DOORWAY_OVERLAP',
        message: `${room.name}: two openings overlap on the same wall — they are counted as one hole for the gripper. Check their positions.`,
        subjectId: room.id,
      });
    }
    const bb = hasArea ? boundingBox(polygon) : { length: 0, width: 0 };
    return {
      room,
      product,
      polygon,
      doorways,
      areaM2,
      perimeter: hasArea ? polygonPerimeter(polygon) : 0,
      fixingPerimeter: hasArea ? fixingPerimeter(polygon, doorways) : 0,
      bbox: { length: bb.length, width: bb.width },
      broadloom: mergeDefined(opts.broadloom, room.planning),
      hardFloor: mergeDefined(opts.hardFloor, room.hardFloor),
      planned: hasArea && product !== undefined,
    };
  });

  const stairs: StairCtx[] = (project.staircases ?? []).map((staircase) => {
    const product = products.get(staircase.productId);
    if (!product) {
      warnings.push({ level: 'error', code: 'MISSING_PRODUCT', message: `${staircase.name}: no product selected (or the product was deleted) — the staircase is not included in the quantities.`, subjectId: staircase.id });
      return { staircase, product: undefined, plan: undefined };
    }
    const plan = planStaircase({ staircase, product, options: opts.broadloom, underlay: opts.underlay, accessories: opts.accessories });
    return { staircase, product, plan };
  });

  return { rooms, stairs, warnings };
}

/** Everything one broadloom product has to supply: its rooms plus the stair pieces cut from it. */
function rollPlanInputFor(prep: Prepared, product: BroadloomProduct, base: BroadloomPlanningOptions, rollWidth?: Mm): RollPlanInput | null {
  const rooms: RollPlanRoom[] = prep.rooms
    .filter((r) => r.planned && r.product?.id === product.id)
    .map((r) => ({ roomId: r.room.id, roomName: r.room.name, polygon: r.polygon, doorways: r.doorways, options: r.broadloom }));
  const extraPieces: CutPiece[] = [];
  let extraNetAreaMm2 = 0;
  for (const s of prep.stairs) {
    if (!s.plan || s.product?.id !== product.id) continue;
    extraPieces.push(...s.plan.pieces);
    extraNetAreaMm2 += s.plan.netAreaMm2;
  }
  if (rooms.length === 0 && extraPieces.length === 0) return null;
  const input: RollPlanInput = { product, rooms, extraPieces, extraNetAreaMm2, options: base };
  if (rollWidth !== undefined) input.rollWidth = rollWidth;
  return input;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const money = (v: number): number => roundTo(v, 2);

/** Whole units covering `value`; 0 when either side is not positive (never Infinity in a BOM). */
function wholeUnits(value: number, unit: number): number {
  if (!(value > 0) || !(unit > 0)) return 0;
  return Math.round(ceilToStep(value, unit) / unit);
}

function sumSeamLength(seams: Seam[]): Mm {
  return seams.reduce((s, seam) => s + distance(seam.from, seam.to), 0);
}

function fmtM2(v: M2): string {
  return `${roundTo(v, 2).toFixed(2)} m²`;
}

function fmtM(mm: Mm): string {
  return `${roundTo(mm / MM_PER_M, 2).toFixed(2)} m`;
}

function fmtPct(fraction: number): string {
  return `${roundTo(fraction * 100, 1)}%`;
}

/**
 * One way of saying "how much floor is this and how much of what you buy is waste", used identically
 * for broadloom and for pack floors so two lines on one quote can be compared.
 * Waste is always measured against what is BOUGHT, and the bought figure is what is actually ordered
 * (whole packs, whole linear metres) — not an intermediate gross area nobody pays for.
 * Example: 8.88 m² bought for 6.24 m² of floor (29.7% waste).
 */
function coverageNote(boughtM2: M2, netM2: M2): string {
  const waste = boughtM2 > 0 ? Math.max(0, (boughtM2 - netM2) / boughtM2) : 0;
  return `${fmtM2(boughtM2)} bought for ${fmtM2(netM2)} of floor (${fmtPct(waste)} waste)`;
}

/** Lower-case id fragment from free text: "Latex smoothing compound, 3 mm" -> "latex-smoothing-compound-3-mm". */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The stair planner reports gripper WITH the cutting wastage, and the gripper planner adds the
 * wastage to every extra run it is given; passing the net figure keeps the wastage from being
 * applied twice. ceil(net x (1 + w)) reproduces the stair figure exactly.
 * Example: stairs 26 488 mm at 10% -> 24 080 mm net -> planGripper: ceil(24 080 x 1.1) = 26 488.
 */
function netOfWastage(length: Mm, wastage: number): Mm {
  const factor = 1 + (Number.isFinite(wastage) && wastage > 0 ? wastage : 0);
  return length / factor;
}

/**
 * How much thicker the new floor build-up is than the old one (mm), or undefined when either side
 * is unknown. Carpet build-up includes the underlay when one is fitted.
 * Example: new 11 mm carpet + 10 mm underlay over old carpet (10 + 10 assumed) -> +1 mm.
 */
export function buildUpChange(product: Product, subfloor: Subfloor, underlay: UnderlayOptions): Mm | undefined {
  const existing = subfloor.existingCovering ?? 'none';
  const old = EXISTING_BUILD_UP[existing];
  if (old === undefined) return undefined;
  let fresh: Mm | undefined;
  if (product.kind === 'carpet') fresh = (product.thickness ?? DEFAULT_CARPET_THICKNESS) + (underlay.fit ? underlay.thickness : 0);
  else if (product.kind === 'sheet_vinyl') fresh = product.thickness ?? DEFAULT_VINYL_THICKNESS;
  else fresh = product.thickness;
  if (fresh === undefined || !Number.isFinite(fresh)) return undefined;
  return roundTo(fresh - old, 2);
}

/** Labour rate and wording for fitting a covering, from the price book. */
export function fittingLabour(kind: CoveringKind, labour: PriceBook['labour']): { key: string; description: string; rate: number; note?: string } {
  switch (kind) {
    case 'carpet':
      return { key: 'carpet', description: 'Carpet fitting', rate: labour.carpetFittingPerM2 };
    case 'sheet_vinyl':
      return { key: 'sheet_vinyl', description: 'Sheet vinyl fitting', rate: labour.vinylFittingPerM2 };
    case 'laminate':
    case 'engineered_wood':
      return { key: 'laminate', description: 'Laminate / wood floor fitting', rate: labour.laminateFittingPerM2 };
    case 'lvt_click':
    case 'lvt_glue':
      return { key: 'lvt', description: 'LVT fitting', rate: labour.lvtFittingPerM2 };
    case 'carpet_tiles':
      return { key: 'carpet_tiles', description: 'Carpet tile fitting', rate: labour.carpetFittingPerM2, note: 'Priced at the carpet fitting rate.' };
  }
}

// ---------------------------------------------------------------------------
// BOM line builder
// ---------------------------------------------------------------------------

interface LineSpec {
  id: string;
  category: BomCategory;
  description: string;
  quantity: number;
  unit: string;
  exactQuantity?: number;
  unitPrice?: number;
  subjectIds: Id[];
  notes?: string;
  /** Recommended / conditional work: priced but left out of the totals. */
  optional?: boolean;
}

class Bom {
  readonly lines: BomLine[] = [];
  constructor(
    private readonly currency: string,
    private readonly warnings: Warning[] = [],
  ) {}

  add(spec: LineSpec): BomLine | undefined {
    // A quantity the engine INTENDED to add but cannot express as a number is a hole in the quote,
    // not a line to drop: a NaN piece length once produced a carpet-less estimate with no warning.
    if (!Number.isFinite(spec.quantity)) {
      this.warnings.push({
        level: 'error',
        code: 'QUANTITY_INVALID',
        message: `"${spec.description}" could not be quantified (${spec.quantity}) and is missing from the quote — check the room dimensions, allowances and supply sizes.`,
        ...(spec.subjectIds[0] !== undefined ? { subjectId: spec.subjectIds[0] } : {}),
      });
      return undefined;
    }
    if (spec.quantity <= 0) return undefined;
    const line: BomLine = {
      id: `bom:${spec.id}`,
      category: spec.category,
      description: spec.description,
      quantity: spec.quantity,
      unit: spec.unit,
      subjectIds: Array.from(new Set(spec.subjectIds)),
    };
    if (spec.exactQuantity !== undefined && Number.isFinite(spec.exactQuantity)) line.exactQuantity = roundTo(spec.exactQuantity, 4);
    const priced = spec.unitPrice !== undefined && Number.isFinite(spec.unitPrice) && spec.unitPrice >= 0;
    if (priced) line.unitPrice = spec.unitPrice;
    const notes: string[] = [];
    if (spec.optional) {
      const cost = priced ? ` (about ${this.currency} ${money(spec.quantity * spec.unitPrice!).toFixed(2)} if needed)` : '';
      notes.push(`Recommended — not included in the totals${cost}.`);
    } else if (priced) {
      line.total = money(spec.quantity * spec.unitPrice!);
    }
    if (spec.notes) notes.push(spec.notes);
    if (notes.length > 0) line.notes = notes.join(' ');
    this.lines.push(line);
    return line;
  }
}

// ---------------------------------------------------------------------------
// The estimate
// ---------------------------------------------------------------------------

/**
 * Estimate a whole project.
 *
 * Trade rules encoded here (the planners hold the rest):
 * - Broadloom is bought by the linear metre at the roll width: BOM quantity = order length, unit
 *   price = £/m² x roll width in m. A 9.9 lm order of a 4 m carpet at £22/m² is 9.9 x 88 = £871.20.
 * - Pack floors are bought by the pack for the whole project: the rooms' exact pack requirements
 *   are summed BEFORE rounding up, so two rooms needing 3.4 + 2.3 packs order 6, not 4 + 3 = 7.
 *   Stairs in a pack product add their gross cladding area. Rigid pack goods round UP, full stop:
 *   3.008 packs of laminate is four packs, because "the last 0.02 m²" is a whole plank that has to
 *   exist. Continuous goods (gripper packs, beading, foam underlay) may round down within
 *   `OVER_RUN_TOLERANCE`, where the shortfall genuinely does come out of the offcuts.
 * - Every covering line reports the same three figures: what is BOUGHT, the floor area, and the
 *   waste as a fraction of what is bought (`coverageNote`), so two lines can be compared.
 * - Underlay covers carpet rooms and carpet stair pads only; gripper only carpet (stairs included);
 *   door bars and door easing are counted once per PHYSICAL opening — doorways entered from both
 *   rooms are joined by `Doorway.sharedOpeningId`, never by matching their labels. The one door leaf
 *   is credited to a side that needs easing, so pairing an opening can never delete the work.
 * - Sheet vinyl is fully bonded above `VINYL_FULLY_BONDED_MIN_AREA_M2` or when seamed, else
 *   perimeter-stuck with double-sided tape. Adhesive and tape are merged across rooms before
 *   rounding to tubs / rolls.
 * - Floor preparation items keep their required / recommended status: recommended lines are
 *   priced but excluded from the totals, with the cost shown in the notes.
 * - Floor preparation covers the STAIRCASES as well as the rooms: a flight of old carpet has to be
 *   stripped, skipped and its gripper pulled like any floor (and is the slowest uplift on the job).
 * - Labour: fitting per m² of net room area by covering kind; stairs per step; uplift, disposal,
 *   smoothing compound and ply overlay per m² of the rooms they apply to; gripper removal, skirting
 *   refit, board preparation and moisture tests on their own quantities; door easing per door leaf;
 *   binding per metre of bound stair edge; and never less than `labour.minimumJobLabour` in total
 *   (a shortfall under `MINIMUM_JOB_DE_MINIMIS` is absorbed instead of printed as a 20p line).
 * - Totals: materials + labour = subtotal; VAT at `prices.vatRate` when `prices.applyVat`.
 *
 * Worked example — a single 4.2 x 3.5 m bedroom in 4 m carpet at £18/m² with default prices:
 *   one piece 4.3 x 3.6 m -> 4.3 lm x £72/lm = £309.60; underlay 3 strips x 4.2 m = 12.6 m -> 2 rolls
 *   x £75 = £150; gripper (15.4 - 0.762 door) x 1.1 = 16.1 m -> 11 lengths x £1.20 = £13.20;
 *   fitting 14.7 m² x £5 = £73.50; subtotal £546.30 (+ door bar, uplift etc. as entered).
 */
export function estimateProject(project: Project): ProjectEstimate {
  const opts = project.options;
  const prices = project.prices;
  const prep = prepare(project);
  const warnings: Warning[] = [...prep.warnings];
  const productByOwner: Record<Id, Id> = {};

  // ---- 1. broadloom roll plans (one per product, stairs packed with the rooms) -----------------------
  const rollPlans: RollPlan[] = [];
  const products = uniqueProducts(project);
  for (const product of products) {
    if (!isBroadloomProduct(product)) continue;
    const input = rollPlanInputFor(prep, product, opts.broadloom);
    if (!input) continue;
    const plan = buildRollPlan(input);
    rollPlans.push(plan);
    warnings.push(...plan.warnings);
  }
  const rollPlanByProduct = new Map<Id, RollPlan>(rollPlans.map((p) => [p.productId, p]));
  const seamsFor = (r: RoomCtx): Seam[] => (r.product ? (rollPlanByProduct.get(r.product.id)?.seamsByRoom[r.room.id] ?? []) : []);

  // ---- 2. stairs --------------------------------------------------------------------------------------
  const stairPlans: Record<Id, StairPlan> = {};
  for (const s of prep.stairs) {
    if (!s.plan || !s.product) continue;
    stairPlans[s.staircase.id] = s.plan;
    productByOwner[s.staircase.id] = s.product.id;
    warnings.push(...s.plan.warnings);
  }

  // ---- 3. pack floors ----------------------------------------------------------------------------------
  const hardFloorPlans: Record<Id, HardFloorPlan> = {};
  for (const r of prep.rooms) {
    if (!r.planned || !r.product) continue;
    productByOwner[r.room.id] = r.product.id;
    if (isBroadloomProduct(r.product)) continue;
    const plan = planHardFloor({
      room: { ownerId: r.room.id, ownerName: r.room.name, polygon: r.polygon, doorways: r.doorways, subfloor: r.room.subfloor },
      product: r.product,
      options: r.hardFloor,
      floorPrep: opts.floorPrep,
    });
    hardFloorPlans[r.room.id] = plan;
    warnings.push(...plan.warnings);
  }

  const plannedRooms = prep.rooms.filter((r): r is RoomCtx & { product: Product } => r.planned && r.product !== undefined);
  const carpetRooms = plannedRooms.filter((r) => r.product.kind === 'carpet');
  const vinylRooms = plannedRooms.filter((r) => r.product.kind === 'sheet_vinyl');
  const carpetStairs = prep.stairs.filter((s): s is StairCtx & { plan: StairPlan; product: Product } => s.plan !== undefined && s.product?.kind === 'carpet');

  // ---- 4. underlay -------------------------------------------------------------------------------------
  const underlayAreas: UnderlayArea[] = carpetRooms.map((r) => {
    const area: UnderlayArea = { ownerId: r.room.id, ownerName: r.room.name, polygon: r.polygon };
    if (r.room.subfloor.underfloorHeating) area.underfloorHeating = true;
    return area;
  });
  for (const s of carpetStairs) {
    if (s.plan.underlayAreaM2 > 0) underlayAreas.push({ ownerId: s.staircase.id, ownerName: s.staircase.name, areaM2: s.plan.underlayAreaM2 });
  }
  const underlay = underlayAreas.length > 0 ? planUnderlay({ areas: underlayAreas, options: opts.underlay, accessories: opts.accessories }) : undefined;
  if (underlay) warnings.push(...underlay.warnings);

  // ---- 5. gripper --------------------------------------------------------------------------------------
  const gripperRooms: GripperRoom[] = carpetRooms.map((r) => ({
    ownerId: r.room.id,
    ownerName: r.room.name,
    polygon: r.polygon,
    doorways: r.doorways,
    subfloor: r.room.subfloor,
    covering: 'carpet',
  }));
  const gripperExtras: GripperExtra[] = [];
  for (const s of carpetStairs) {
    if (s.plan.gripperLength <= 0) continue;
    const extra: GripperExtra = { ownerId: s.staircase.id, ownerName: s.staircase.name, length: netOfWastage(s.plan.gripperLength, opts.accessories.gripperWastage) };
    if (s.staircase.subfloor) extra.subfloorType = s.staircase.subfloor.type;
    gripperExtras.push(extra);
  }
  const gripper = gripperRooms.length + gripperExtras.length > 0 ? planGripper({ rooms: gripperRooms, extra: gripperExtras, options: opts.accessories }) : undefined;
  if (gripper) warnings.push(...gripper.warnings);

  // ---- 6. door bars (hard floors first so their profile wins for a shared doorway) ------------------------
  // Hard floors first, so a shared opening takes the profile its harder side needs. Between two
  // rooms of the same class the side whose build-up changes most wins: it is the side that decides
  // whether the door leaf has to come off, and it owns the opening for the door-easing count too.
  const buildUpOf = (r: RoomCtx & { product: Product }) => buildUpChange(r.product, r.room.subfloor, opts.underlay) ?? 0;
  const doorBarRooms: DoorBarRoom[] = [...plannedRooms]
    .sort((a, b) => DOOR_BAR_PRECEDENCE[a.product.kind] - DOOR_BAR_PRECEDENCE[b.product.kind] || buildUpOf(b) - buildUpOf(a))
    .map((r) => {
      const room: DoorBarRoom = { ownerId: r.room.id, ownerName: r.room.name, doorways: r.doorways, covering: r.product.kind, polygon: r.polygon };
      if (r.product.thickness !== undefined) room.productThickness = r.product.thickness;
      return room;
    });
  const doorBars = planDoorBars({ rooms: doorBarRooms, options: opts.accessories });
  warnings.push(...doorBars.warnings);

  // ---- 7. tapes and vinyl sundries ------------------------------------------------------------------------
  const tapeRooms: TapeRoom[] = carpetRooms.map((r) => ({ ownerId: r.room.id, ownerName: r.room.name, covering: 'carpet', polygon: r.polygon, seams: seamsFor(r) }));
  const tapes = planTapes({ rooms: tapeRooms, options: opts.accessories });

  const vinylSundries: Record<Id, SheetVinylSundries> = {};
  let vinylAdhesiveKg = 0;
  let doubleSidedTapeMm = 0;
  const vinylAdhesiveOwners: Id[] = [];
  const doubleSidedOwners: Id[] = [];
  for (const r of vinylRooms) {
    const seams = seamsFor(r);
    const fullyBonded = r.areaM2 > VINYL_FULLY_BONDED_MIN_AREA_M2 || seams.length > 0;
    const sundries = planSheetVinylSundries({
      room: { ownerId: r.room.id, polygon: r.polygon, doorways: r.doorways },
      fullyBonded,
      seamLengthMm: sumSeamLength(seams),
      accessories: opts.accessories,
    });
    vinylSundries[r.room.id] = sundries;
    if (fullyBonded) {
      vinylAdhesiveKg += sundries.adhesiveKg;
      vinylAdhesiveOwners.push(r.room.id);
      warnings.push({
        level: 'info',
        code: 'VINYL_FULLY_BONDED',
        message: `${r.room.name}: sheet vinyl fully bonded (${seams.length > 0 ? `${seams.length} seam${seams.length === 1 ? '' : 's'}` : `${fmtM2(r.areaM2)} is over ${VINYL_FULLY_BONDED_MIN_AREA_M2} m²`}) — adhesive rather than perimeter tape.`,
        subjectId: r.room.id,
      });
    } else {
      doubleSidedTapeMm += sundries.doubleSidedTapeLength;
      doubleSidedOwners.push(r.room.id);
    }
  }
  // vinyl on stairs is always fully bonded (see stairs.VINYL_STAIRS_NOSINGS)
  for (const s of prep.stairs) {
    if (!s.plan || s.product?.kind !== 'sheet_vinyl' || s.plan.netAreaMm2 <= 0) continue;
    vinylAdhesiveKg += mm2ToM2(s.plan.netAreaMm2) / VINYL_ADHESIVE_M2_PER_KG;
    vinylAdhesiveOwners.push(s.staircase.id);
  }

  // ---- 8. floor preparation ----------------------------------------------------------------------------------
  // Owners the gripper order covers: new gripper cannot be nailed down on top of the old, so wherever
  // the BOM buys gripper the old gripper has to come up — required work, not a "reuse it if it is
  // sound" recommendation.
  const newGripperOwners = new Set<Id>((gripper?.perOwner ?? []).filter((o) => o.lengths > 0).map((o) => o.ownerId));
  const prepRooms: PrepRoomInput[] = plannedRooms.map((r) => {
    const input: PrepRoomInput = {
      ownerId: r.room.id,
      ownerName: r.room.name,
      areaM2: r.areaM2,
      perimeter: r.perimeter,
      doorwayCount: 0, // filled in below, one leaf per physical opening
      subfloor: r.room.subfloor,
      covering: r.product.kind,
      underlayHasDpm: r.hardFloor.underlayHasDpm,
    };
    if (newGripperOwners.has(r.room.id)) input.newGripper = true;
    const change = buildUpChange(r.product, r.room.subfloor, opts.underlay);
    if (change !== undefined) input.thicknessChange = change;
    if (!isBroadloomProduct(r.product) && isFloatingFloor(r.product.kind) && r.hardFloor.useBeading === false) input.refitSkirting = true;
    return input;
  });
  // Doors are eased once per DOOR LEAF, and one leaf can be shared by two rooms. The leaf belongs to
  // a side that actually needs easing: crediting it to whichever room won the door BAR loses the door
  // altogether when that side's floor did not get thicker and the other side's did. An external door
  // is eased like any other — a front door swings inward over the new carpet.
  {
    const byRoom = new Map<Id, PrepRoomInput>(prepRooms.map((r) => [r.ownerId, r]));
    const openings = new Map<Id, Id[]>();
    for (const r of plannedRooms) {
      for (const d of r.doorways) {
        if (d.continuous || d.transition === 'none') continue;
        const openingId = d.sharedOpeningId?.trim() || d.id;
        const rooms = openings.get(openingId) ?? [];
        if (!rooms.includes(r.room.id)) rooms.push(r.room.id);
        openings.set(openingId, rooms);
      }
    }
    const wantsEasing = (id: Id): boolean => {
      const input = byRoom.get(id);
      return input !== undefined && needsDoorEasing(input);
    };
    for (const rooms of openings.values()) {
      const ownerId = rooms.find(wantsEasing) ?? rooms[0];
      const owner = ownerId !== undefined ? byRoom.get(ownerId) : undefined;
      if (owner) owner.doorwayCount += 1;
    }
  }
  // Stairs need stripping, skipping and their gripper pulling just like a room — more so, in fact,
  // as it is the slowest uplift on the job. The "perimeter" of a flight is its gripper run.
  // `isStaircase` keeps the room-only rules (latex, primer, ply, DPM, skirting) off the flight.
  for (const st of prep.stairs) {
    if (!st.plan || !st.product || !st.staircase.subfloor) continue;
    const areaM2 = isBroadloomProduct(st.product) ? mm2ToM2(st.plan.netAreaMm2) : (st.plan.hardFloorAreaM2 ?? 0);
    if (!(areaM2 > 0)) continue;
    const stairPrep: PrepRoomInput = {
      ownerId: st.staircase.id,
      ownerName: st.staircase.name,
      areaM2,
      perimeter: GRIPPER_PER_STEP * (st.staircase.steps ?? []).reduce((sum, step) => sum + Math.max(0, step.width), 0),
      doorwayCount: 0,
      subfloor: st.staircase.subfloor,
      covering: st.product.kind,
      isStaircase: true,
    };
    if (newGripperOwners.has(st.staircase.id)) stairPrep.newGripper = true;
    prepRooms.push(stairPrep);
  }
  const floorPrep = planFloorPrep({ rooms: prepRooms, options: opts.floorPrep });
  warnings.push(...floorPrep.warnings);

  // ---- 9. bill of materials ---------------------------------------------------------------------------------
  const bom = new Bom(prices.currency, warnings);
  const areaOf = new Map<Id, M2>(plannedRooms.map((r) => [r.room.id, r.areaM2]));
  for (const st of prepRooms) if (!areaOf.has(st.ownerId)) areaOf.set(st.ownerId, st.areaM2);

  // floor coverings: broadloom by the linear metre
  for (const product of products) {
    const plan = rollPlanByProduct.get(product.id);
    if (!plan || !isBroadloomProduct(product)) continue;
    const owners = [...plan.pieces.map((p) => p.ownerId)];
    const cutTotal = plan.cuts.reduce((s, c) => s + c.length, 0);
    const notes = [
      coverageNote(plan.orderedAreaM2, plan.netAreaM2),
      `${plan.rollsRequired} roll${plan.rollsRequired === 1 ? '' : 's'}, ${plan.cuts.length} cut${plan.cuts.length === 1 ? '' : 's'}`,
      `pile ${plan.pileDirection === 'along_length' ? 'along the length' : 'across the width'} of the rooms`,
    ];
    bom.add({
      id: `covering:${product.id}`,
      category: 'floor_covering',
      description: `${product.name} — ${fmtM(plan.rollWidth)} wide`,
      quantity: roundTo(plan.orderLength / MM_PER_M, 2),
      unit: 'lm',
      exactQuantity: cutTotal / MM_PER_M,
      unitPrice: product.pricePerM2 !== undefined ? money(product.pricePerM2 * (plan.rollWidth / MM_PER_M)) : undefined,
      subjectIds: owners,
      notes: notes.join('; '),
    });
  }

  // floor coverings: pack floors by the pack, merged across rooms (+ stairs)
  for (const product of products) {
    if (isBroadloomProduct(product)) continue;
    const roomPlans = plannedRooms.filter((r) => r.product.id === product.id).map((r) => hardFloorPlans[r.room.id]).filter((p): p is HardFloorPlan => p !== undefined);
    const stairPlansFor = prep.stairs.filter((s) => s.plan && s.product?.id === product.id).map((s) => s.plan!);
    if (roomPlans.length + stairPlansFor.length === 0) continue;
    let exactPacks = 0;
    let netM2 = 0;
    let grossM2 = 0;
    const owners: Id[] = [];
    for (const p of roomPlans) {
      exactPacks += p.exactPacks;
      netM2 += p.netAreaM2;
      grossM2 += p.grossAreaM2;
      owners.push(p.ownerId);
    }
    for (const sp of stairPlansFor) {
      if (sp.hardFloorGrossAreaM2 === undefined || sp.hardFloorAreaM2 === undefined) continue;
      netM2 += sp.hardFloorAreaM2;
      grossM2 += sp.hardFloorGrossAreaM2;
      // the stair planner already includes STAIR_HARD_FLOOR_WASTAGE in the gross area; packs (or boxes of tiles) follow the pack coverage
      if (product.packCoverageM2 > 0) exactPacks += sp.hardFloorGrossAreaM2 / product.packCoverageM2;
      owners.push(sp.staircaseId);
    }
    // Rigid pack goods round UP, with no over-run tolerance. "Find the last 0.02 m² in the offcuts"
    // works for a roll good; for a click floor it means a whole plank of the right length has to
    // exist already, and 27 boards of 1.285 m do not cover 13 rows of 2.6 m. See OVER_RUN_TOLERANCE.
    const packs = Math.ceil(exactPacks - 1e-9);
    const unit = product.kind === 'carpet_tiles' ? 'box' : 'pack';
    const unitPrice = product.pricePerPack ?? (product.pricePerM2 !== undefined ? money(product.pricePerM2 * product.packCoverageM2) : undefined);
    const boughtM2 = packs * product.packCoverageM2;
    const notes = [
      coverageNote(boughtM2, netM2),
      `${packs} ${unit}${packs === 1 ? '' : 's'} for ${fmtM2(netM2)} net + ${fmtPct(netM2 > 0 ? (grossM2 - netM2) / netM2 : 0)} cutting wastage = ${fmtM2(grossM2)}${stairPlansFor.length > 0 ? ' incl. stairs' : ''}`,
    ];
    bom.add({
      id: `covering:${product.id}`,
      category: 'floor_covering',
      description: `${product.name} (${product.packCoverageM2} m² per ${unit})`,
      quantity: packs,
      unit,
      exactQuantity: exactPacks,
      unitPrice,
      subjectIds: owners,
      notes: notes.join('; '),
    });
    // A spare pack is kept back for later repairs: the same batch will not be available in a year.
    if (packs > 0) {
      bom.add({
        id: `covering:${product.id}:spare`,
        category: 'floor_covering',
        description: `${product.name} — spare ${unit} kept for repairs`,
        quantity: 1,
        unit,
        unitPrice,
        subjectIds: owners,
        optional: true,
        notes: 'Batch and shade change between production runs; one spare now is the only way to repair a damaged board later.',
      });
    }
  }

  // underlay
  if (underlay && underlay.rolls > 0) {
    const u = opts.underlay;
    const rollAreaM2 = mm2ToM2(u.rollWidth * u.rollLength);
    const unitPrice = u.pricePerRoll ?? (u.pricePerM2 !== undefined ? money(u.pricePerM2 * rollAreaM2) : undefined);
    bom.add({
      id: 'underlay:carpet',
      category: 'underlay',
      description: `Carpet underlay ${u.thickness} mm, ${fmtM(u.rollWidth)} x ${fmtM(u.rollLength)} rolls (${roundTo(rollAreaM2, 2)} m²)`,
      quantity: underlay.rolls,
      unit: 'roll',
      exactQuantity: underlay.exactRolls,
      unitPrice,
      subjectIds: underlay.perOwner.map((o) => o.ownerId),
      notes: `${fmtM2(underlay.totalAreaM2)} to cover; ${fmtM(underlay.stripLengthMm)} of strip off the roll (${underlay.exactRolls} rolls)`,
    });
  }
  // hard floor underlay, merged per pack size
  {
    const byCoverage = new Map<number, { areaM2: M2; owners: Id[] }>();
    for (const r of plannedRooms) {
      const p = hardFloorPlans[r.room.id];
      if (!p || p.underlayAreaM2 <= 0) continue;
      const cov = r.hardFloor.underlayPackCoverageM2;
      const acc = byCoverage.get(cov) ?? { areaM2: 0, owners: [] };
      acc.areaM2 += p.underlayAreaM2;
      acc.owners.push(r.room.id);
      byCoverage.set(cov, acc);
    }
    for (const [cov, acc] of byCoverage) {
      const { units, shortfall } = wholeUnitsWithTolerance(acc.areaM2, cov);
      bom.add({
        id: `underlay:hardfloor:${cov}`,
        category: 'underlay',
        description: `Hard floor underlay, ${cov} m² packs`,
        quantity: units,
        unit: 'pack',
        exactQuantity: cov > 0 ? acc.areaM2 / cov : 0,
        unitPrice: prices.materials.hardFloorUnderlayPerPack,
        subjectIds: acc.owners,
        notes: `${fmtM2(acc.areaM2)} incl. trimming allowance${shortfall > 0 ? `; ${fmtM2(shortfall)} to come out of the offcuts` : ''}`,
      });
    }
  }

  // gripper, per pin type
  if (gripper) {
    for (const pin of ['timber', 'concrete'] as GripperPin[]) {
      const owners = gripper.perOwner.filter((o) => o.pin === pin);
      const lengths = owners.reduce((s, o) => s + o.lengths, 0);
      if (lengths <= 0) continue;
      const mm = gripper.byPin[pin];
      const perPack = opts.accessories.gripperPerPack;
      // Quantity, unit and price on ONE basis. Where gripper is sold in packs the order is packs —
      // it used to quote 63 lengths at the per-length price and then tell you to buy 7 packs of 10.
      const byPack = perPack > 1;
      const { units, shortfall } = byPack ? wholeUnitsWithTolerance(lengths, perPack) : { units: lengths, shortfall: 0 };
      const spare = byPack ? units * perPack - lengths : 0;
      bom.add({
        id: `gripper:${pin}`,
        category: 'gripper',
        description: byPack
          ? `Carpet gripper, ${pin} pin, packs of ${perPack} x ${fmtM(opts.accessories.gripperLength)}`
          : `Carpet gripper, ${pin} pin, ${fmtM(opts.accessories.gripperLength)} lengths`,
        quantity: units,
        unit: byPack ? 'pack' : 'length',
        exactQuantity: byPack ? lengths / perPack : opts.accessories.gripperLength > 0 ? mm / opts.accessories.gripperLength : 0,
        unitPrice: byPack ? prices.materials.gripperPerPack : prices.materials.gripperPerLength,
        subjectIds: owners.map((o) => o.ownerId),
        notes: `${fmtM(mm)} incl. ${fmtPct(opts.accessories.gripperWastage)} wastage = ${lengths} length${lengths === 1 ? '' : 's'}${
          byPack ? ` (${units * perPack} in ${units} pack${units === 1 ? '' : 's'}${spare > 0 ? `, ${spare} spare` : ''})` : ''
        }${shortfall > 0 ? `; ${Math.ceil(shortfall)} length${Math.ceil(shortfall) === 1 ? '' : 's'} short — make it up from offcuts or add a pack` : ''}`,
      });
    }
  }

  // door bars and thresholds, per type; long bars separately
  for (const type of DOOR_BAR_TYPES) {
    if (type === 'none') continue;
    const lines = doorBars.bars.filter((b) => b.type === type);
    const std = lines.reduce((s, b) => s + b.bars, 0);
    const long = lines.reduce((s, b) => s + b.longBars, 0);
    if (std + long === 0) continue;
    const threshold = THRESHOLD_BAR_TYPES.includes(type);
    const category: BomCategory = threshold ? 'trims' : 'door_bars';
    const unitPrice = threshold ? prices.materials.thresholdPerItem : prices.materials.doorBarPerBar;
    const labels = (which: 'std' | 'long') => lines.filter((b) => (which === 'std' ? b.bars > 0 : b.longBars > 0)).map((b) => `${b.label} (${b.width} mm)`).join(', ');
    if (std > 0) {
      bom.add({
        id: `doorbar:${type}`,
        category,
        description: `${DOOR_BAR_DESCRIPTIONS[type]}, ${fmtM(opts.accessories.doorBarLength)}`,
        quantity: std,
        unit: 'each',
        unitPrice,
        subjectIds: lines.filter((b) => b.bars > 0).map((b) => b.ownerId),
        notes: labels('std'),
      });
    }
    if (long > 0) {
      bom.add({
        id: `doorbar:${type}:long`,
        category,
        description: `${DOOR_BAR_DESCRIPTIONS[type]}, long ${fmtM(opts.accessories.doorBarLongLength)} (cut to size)`,
        quantity: long,
        unit: 'each',
        unitPrice,
        subjectIds: lines.filter((b) => b.longBars > 0).map((b) => b.ownerId),
        notes: `${labels('long')}. Priced at the standard bar rate — check the long-bar price.`,
      });
    }
  }

  // beading / scotia, merged per length
  {
    const byLength = new Map<Mm, { mm: Mm; owners: Id[] }>();
    for (const r of plannedRooms) {
      const p = hardFloorPlans[r.room.id];
      if (!p || p.beadingMetres <= 0) continue;
      const len = r.hardFloor.beadingLength;
      const acc = byLength.get(len) ?? { mm: 0, owners: [] };
      acc.mm += p.beadingMetres * MM_PER_M;
      acc.owners.push(r.room.id);
      byLength.set(len, acc);
    }
    for (const [len, acc] of byLength) {
      const { units, shortfall } = wholeUnitsWithTolerance(acc.mm, len);
      bom.add({
        id: `trims:beading:${len}`,
        category: 'trims',
        description: `Beading / scotia, ${fmtM(len)} lengths`,
        quantity: units,
        unit: 'length',
        exactQuantity: len > 0 ? acc.mm / len : 0,
        unitPrice: prices.materials.beadingPerLength,
        subjectIds: acc.owners,
        notes: `${fmtM(acc.mm)} incl. cutting wastage${shortfall > 0 ? `; the last ${fmtM(shortfall)} comes out of the offcuts` : ''}`,
      });
    }
  }

  // stairs: nosings and rods
  {
    const nosingStairs = prep.stairs.filter((s) => s.plan && s.plan.nosings > 0);
    const nosings = nosingStairs.reduce((s, x) => s + x.plan!.nosings, 0);
    if (nosings > 0) {
      bom.add({
        id: 'stairs:nosings',
        category: 'stairs',
        description: 'Stair nosing profiles',
        quantity: nosings,
        unit: 'each',
        unitPrice: prices.materials.stairNosingPerItem,
        subjectIds: nosingStairs.map((s) => s.staircase.id),
        notes: `${fmtM(nosingStairs.reduce((s, x) => s + x.plan!.nosingLength, 0))} in total; one per step`,
      });
    }
    const rodStairs = prep.stairs.filter((s) => s.plan && s.plan.stairRods > 0);
    const rods = rodStairs.reduce((s, x) => s + x.plan!.stairRods, 0);
    if (rods > 0) {
      bom.add({
        id: 'stairs:rods',
        category: 'stairs',
        description: 'Stair rods (runner)',
        quantity: rods,
        unit: 'each',
        unitPrice: prices.materials.stairRodPerItem,
        subjectIds: rodStairs.map((s) => s.staircase.id),
      });
    }
  }

  // floor preparation items (materials priced; site work listed without a price)
  for (const item of floorPrep.items) {
    const priceKey = PREP_MATERIAL_PRICE[item.kind];
    const labour = PREP_LABOUR_RATE[item.kind];
    const notes = [item.reason];
    if (!priceKey) {
      const noCharge = PREP_NO_CHARGE[item.kind];
      if (noCharge) notes.push(noCharge);
      else if (labour || PREP_PRICED_AS_LABOUR.includes(item.kind)) notes.push('Priced under labour below.');
      else notes.push('Included in the fitting rate.');
    }
    bom.add({
      id: `prep:${item.kind}:${item.required ? 'required' : 'recommended'}:${slug(item.description)}`,
      category: 'floor_preparation',
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      exactQuantity: item.exactQuantity,
      unitPrice: priceKey ? prices.materials[priceKey] : undefined,
      subjectIds: item.ownerIds,
      notes: notes.join(' '),
      optional: !item.required,
    });
  }
  // polythene DPM sheet under floating floors (only where floor prep has not already listed one)
  {
    let rolls = 0;
    const owners: Id[] = [];
    for (const r of plannedRooms) {
      const p = hardFloorPlans[r.room.id];
      if (!p || p.dpmSheetRolls <= 0) continue;
      if ((floorPrep.perRoom[r.room.id] ?? []).includes('dpm_sheet')) continue;
      rolls += p.dpmSheetRolls;
      owners.push(r.room.id);
    }
    if (rolls > 0) {
      bom.add({
        id: 'prep:dpm_sheet:hardfloor',
        category: 'floor_preparation',
        description: 'Polythene sheet DPM under floating floor',
        quantity: rolls,
        unit: 'roll',
        unitPrice: prices.materials.dpmSheetPerRoll,
        subjectIds: owners,
        notes: 'Underlay has no integral DPM on a concrete-type subfloor.',
      });
    }
  }

  // adhesives and tapes
  if (tapes.seamTapeRolls > 0) {
    bom.add({
      id: 'tape:seam',
      category: 'adhesives_tapes',
      description: `Carpet seaming tape, ${fmtM(opts.accessories.seamTapeRollLength)} rolls`,
      quantity: tapes.seamTapeRolls,
      unit: 'roll',
      exactQuantity: opts.accessories.seamTapeRollLength > 0 ? tapes.seamTapeLength / opts.accessories.seamTapeRollLength : 0,
      unitPrice: prices.materials.seamTapePerRoll,
      subjectIds: tapeRooms.filter((r) => r.seams.length > 0).map((r) => r.ownerId),
      notes: `${fmtM(tapes.seamTapeLength)} of seams`,
    });
  }
  {
    const rolls = wholeUnits(doubleSidedTapeMm, opts.accessories.doubleSidedTapeRollLength);
    if (rolls > 0) {
      bom.add({
        id: 'tape:double_sided',
        category: 'adhesives_tapes',
        description: `Double-sided vinyl tape, ${fmtM(opts.accessories.doubleSidedTapeRollLength)} rolls`,
        quantity: rolls,
        unit: 'roll',
        exactQuantity: opts.accessories.doubleSidedTapeRollLength > 0 ? doubleSidedTapeMm / opts.accessories.doubleSidedTapeRollLength : 0,
        unitPrice: prices.materials.doubleSidedTapePerRoll,
        subjectIds: doubleSidedOwners,
        notes: `${fmtM(doubleSidedTapeMm)} round the perimeter and seams (perimeter-stuck vinyl)`,
      });
    }
  }
  if (underlay && underlay.tapeRolls > 0) {
    bom.add({
      id: 'tape:underlay',
      category: 'adhesives_tapes',
      description: `Underlay joining tape, ${fmtM(opts.accessories.underlayTapeRollLength)} rolls`,
      quantity: underlay.tapeRolls,
      unit: 'roll',
      exactQuantity: opts.accessories.underlayTapeRollLength > 0 ? underlay.tapeLength / opts.accessories.underlayTapeRollLength : 0,
      unitPrice: prices.materials.underlayTapePerRoll,
      subjectIds: underlay.perOwner.filter((o) => o.strips > 1).map((o) => o.ownerId),
      notes: `${fmtM(underlay.tapeLength)} of joins`,
    });
  }
  {
    const tubs = wholeUnits(vinylAdhesiveKg, VINYL_ADHESIVE_TUB_KG);
    if (tubs > 0) {
      bom.add({
        id: 'adhesive:vinyl',
        category: 'adhesives_tapes',
        description: `Sheet vinyl adhesive, ${VINYL_ADHESIVE_TUB_KG} kg tubs`,
        quantity: tubs,
        unit: 'tub',
        exactQuantity: vinylAdhesiveKg / VINYL_ADHESIVE_TUB_KG,
        unitPrice: prices.materials.adhesivePerTub,
        subjectIds: vinylAdhesiveOwners,
        notes: `${roundTo(vinylAdhesiveKg, 2)} kg at ${VINYL_ADHESIVE_M2_PER_KG} m²/kg (fully bonded)`,
      });
    }
  }
  {
    // A bonded sheet vinyl seam is not finished until it is cold-welded: the seam sealer closes the
    // cut edges so water cannot get under the sheet. Only bonded floors get one; a perimeter-stuck
    // sheet has no seam by definition (it is fully bonded as soon as it is seamed).
    let weldMm = 0;
    const weldOwners: Id[] = [];
    for (const r of vinylRooms) {
      const sundries = vinylSundries[r.room.id];
      if (!sundries || sundries.adhesiveKg <= 0) continue;
      const mm = sumSeamLength(seamsFor(r));
      if (mm <= 0) continue;
      weldMm += mm;
      weldOwners.push(r.room.id);
    }
    if (weldMm > 0) {
      bom.add({
        id: 'adhesive:vinyl_seam_weld',
        category: 'adhesives_tapes',
        description: 'Vinyl cold weld / seam sealer',
        quantity: roundTo(weldMm / MM_PER_M, 2),
        unit: 'm',
        unitPrice: prices.materials.vinylSeamWeldPerM,
        subjectIds: weldOwners,
        notes: 'Every seam in a bonded sheet vinyl is welded; an unwelded seam lets water under the floor.',
      });
    }
  }
  {
    let kg = 0;
    let litres = 0;
    const lvtOwners: Id[] = [];
    const tileOwners: Id[] = [];
    for (const r of plannedRooms) {
      const p = hardFloorPlans[r.room.id];
      if (!p) continue;
      if (p.adhesiveKg > 0) {
        kg += p.adhesiveKg;
        lvtOwners.push(r.room.id);
      }
      if (p.tackifierLitres > 0) {
        litres += p.tackifierLitres;
        tileOwners.push(r.room.id);
      }
    }
    const lvtTubs = wholeUnits(kg, LVT_ADHESIVE_TUB_KG);
    if (lvtTubs > 0) {
      bom.add({
        id: 'adhesive:lvt',
        category: 'adhesives_tapes',
        description: `LVT pressure-sensitive adhesive, ${LVT_ADHESIVE_TUB_KG} kg tubs`,
        quantity: lvtTubs,
        unit: 'tub',
        exactQuantity: kg / LVT_ADHESIVE_TUB_KG,
        unitPrice: prices.materials.adhesivePerTub,
        subjectIds: lvtOwners,
        notes: `${roundTo(kg, 2)} kg over the gross area`,
      });
    }
    const tackTubs = wholeUnits(litres, TACKIFIER_TUB_LITRES);
    if (tackTubs > 0) {
      bom.add({
        id: 'adhesive:tackifier',
        category: 'adhesives_tapes',
        description: `Carpet tile tackifier, ${TACKIFIER_TUB_LITRES} L tubs`,
        quantity: tackTubs,
        unit: 'tub',
        exactQuantity: litres / TACKIFIER_TUB_LITRES,
        unitPrice: prices.materials.tackifierPerTub,
        subjectIds: tileOwners,
        notes: `${litres} L over the gross area`,
      });
    }
  }

  // labour: fitting per m² by covering kind
  {
    const groups = new Map<string, { description: string; rate: number; areaM2: M2; owners: Id[]; note?: string }>();
    for (const r of plannedRooms) {
      const f = fittingLabour(r.product.kind, prices.labour);
      const g = groups.get(f.key) ?? { description: f.description, rate: f.rate, areaM2: 0, owners: [], ...(f.note ? { note: f.note } : {}) };
      g.areaM2 += r.areaM2;
      g.owners.push(r.room.id);
      groups.set(f.key, g);
    }
    for (const [key, g] of groups) {
      bom.add({
        id: `labour:fitting:${key}`,
        category: 'labour',
        description: g.description,
        quantity: roundTo(g.areaM2, 2),
        unit: 'm²',
        unitPrice: g.rate,
        subjectIds: g.owners,
        ...(g.note !== undefined ? { notes: g.note } : {}),
      });
    }
  }
  // labour: stairs per step
  {
    const withPlan = prep.stairs.filter((s) => s.plan && s.plan.stepCount > 0);
    const steps = withPlan.reduce((s, x) => s + x.plan!.stepCount, 0);
    if (steps > 0) {
      bom.add({
        id: 'labour:stairs',
        category: 'labour',
        description: 'Stair fitting',
        quantity: steps,
        unit: 'step',
        unitPrice: prices.labour.stairsPerStep,
        subjectIds: withPlan.map((s) => s.staircase.id),
      });
    }
  }
  // labour: from the floor-prep items
  {
    const areaOfOwners = (ids: Id[]): M2 => ids.reduce((s, id) => s + (areaOf.get(id) ?? 0), 0);
    const byKind = (kinds: PrepItemKind[], required: boolean): PrepItem[] => floorPrep.items.filter((i) => kinds.includes(i.kind) && i.required === required);
    const perM2 = (id: string, description: string, kinds: PrepItemKind[], rate: number, required: boolean) => {
      const items = byKind(kinds, required);
      if (items.length === 0) return;
      const owners = Array.from(new Set(items.flatMap((i) => i.ownerIds)));
      bom.add({
        id: `labour:${id}${required ? '' : ':recommended'}`,
        category: 'labour',
        description,
        quantity: roundTo(areaOfOwners(owners), 2),
        unit: 'm²',
        unitPrice: rate,
        subjectIds: owners,
        optional: !required,
      });
    };
    for (const required of [true, false]) {
      perM2('uplift', 'Uplift existing floor covering', ['uplift'], prices.labour.upliftPerM2, required);
      perM2('disposal', 'Disposal of old floor covering', ['disposal'], prices.labour.disposalPerM2, required);
      perM2('latex', 'Apply smoothing compound', ['latex'], prices.labour.latexPerM2, required);
      perM2('ply', 'Lay ply / hardboard overlay', ['ply', 'hardboard'], prices.labour.plyPerM2, required);
      const perOwnQuantity = (id: string, description: string, kind: PrepItemKind, unit: string, rateKey: keyof PriceBook['labour']) => {
        const items = byKind([kind], required);
        const quantity = roundTo(
          items.reduce((sum, i) => sum + i.quantity, 0),
          2,
        );
        if (quantity <= 0) return;
        bom.add({
          id: `labour:${id}${required ? '' : ':recommended'}`,
          category: 'labour',
          description,
          quantity,
          unit,
          unitPrice: prices.labour[rateKey],
          subjectIds: Array.from(new Set(items.flatMap((i) => i.ownerIds))),
          optional: !required,
        });
      };
      for (const [kind, spec] of Object.entries(PREP_LABOUR_RATE) as [PrepItemKind, { key: keyof PriceBook['labour']; description: string }][]) {
        const unit = kind === 'gripper_removal' || kind === 'skirting_refit' ? 'm' : kind === 'moisture_test' ? 'each' : 'm²';
        perOwnQuantity(kind, spec.description, kind, unit, spec.key);
      }
      const easing = byKind(['door_easing'], required);
      const doors = easing.reduce((s, i) => s + i.quantity, 0);
      if (doors > 0) {
        bom.add({
          id: `labour:door_easing${required ? '' : ':recommended'}`,
          category: 'labour',
          description: 'Ease / trim doors',
          quantity: doors,
          unit: 'each',
          unitPrice: prices.labour.doorEasingPerDoor,
          subjectIds: easing.flatMap((i) => i.ownerIds),
          optional: !required,
        });
      }
    }
  }
  // labour: binding
  {
    const bound = prep.stairs.filter((s) => s.plan && s.plan.bindingLength > 0);
    const mm = bound.reduce((s, x) => s + x.plan!.bindingLength, 0);
    if (mm > 0) {
      bom.add({
        id: 'labour:binding',
        category: 'labour',
        description: 'Binding / whipping carpet edges',
        quantity: roundTo(mm / MM_PER_M, 2),
        unit: 'm',
        unitPrice: prices.labour.bindingPerM,
        subjectIds: bound.map((s) => s.staircase.id),
      });
    }
  }

  // labour: a job is never charged less than the minimum, however small it is
  {
    const labourSoFar = money(bom.lines.filter((l) => l.category === 'labour').reduce((s, l) => s + (l.total ?? 0), 0));
    const minimum = prices.labour.minimumJobLabour;
    // A shortfall of a few pounds is absorbed rather than printed: "Minimum job charge, 1 each @
    // 0.20" with a paragraph explaining it is not a line anyone sends to a customer.
    if (minimum > 0 && labourSoFar > 0 && minimum - labourSoFar > MINIMUM_JOB_DE_MINIMIS) {
      bom.add({
        id: 'labour:minimum',
        category: 'labour',
        description: 'Minimum job charge',
        quantity: 1,
        unit: 'each',
        unitPrice: money(minimum - labourSoFar),
        subjectIds: plannedRooms.map((r) => r.room.id),
        notes: `The work above prices at ${prices.currency} ${labourSoFar.toFixed(2)} of labour, under the ${prices.currency} ${money(minimum).toFixed(2)} minimum for a visit. A small room is still most of a day once the floor is prepared and cut in.`,
      });
    }
  }

  // ---- 10. totals --------------------------------------------------------------------------------------------
  const sumTotals = (pred: (l: BomLine) => boolean) => money(bom.lines.filter(pred).reduce((s, l) => s + (l.total ?? 0), 0));
  const materialsCost = sumTotals((l) => l.category !== 'labour');
  const labourCost = sumTotals((l) => l.category === 'labour');
  const subtotal = money(materialsCost + labourCost);
  const vat = prices.applyVat ? money(subtotal * prices.vatRate) : 0;
  const total = money(subtotal + vat);

  let netAreaM2 = plannedRooms.reduce((s, r) => s + r.areaM2, 0);
  for (const s of prep.stairs) {
    if (!s.plan || !s.product) continue;
    netAreaM2 += isBroadloomProduct(s.product) ? mm2ToM2(s.plan.netAreaMm2) : (s.plan.hardFloorAreaM2 ?? 0);
  }

  // ---- 11. warnings and summaries ------------------------------------------------------------------------------
  const allWarnings = dedupeWarnings(warnings);
  const rooms: Record<Id, RoomSummary> = {};
  for (const r of prep.rooms) {
    const plan = r.product ? rollPlanByProduct.get(r.product.id) : undefined;
    rooms[r.room.id] = {
      roomId: r.room.id,
      netAreaM2: r.areaM2,
      perimeter: r.perimeter,
      gripperPerimeter: r.fixingPerimeter,
      boundingBox: r.bbox,
      pieces: plan ? plan.pieces.filter((p) => p.ownerId === r.room.id) : [],
      seams: seamsFor(r),
      warnings: allWarnings.filter((w) => w.subjectId === r.room.id),
    };
  }
  const staircases: Record<Id, StairSummary> = {};
  for (const s of prep.stairs) {
    const plan = s.plan;
    const rollPlan = s.product ? rollPlanByProduct.get(s.product.id) : undefined;
    staircases[s.staircase.id] = {
      staircaseId: s.staircase.id,
      stepCount: plan?.stepCount ?? (s.staircase.steps ?? []).length,
      carpetAreaM2: plan ? (s.product && isBroadloomProduct(s.product) ? mm2ToM2(plan.netAreaMm2) : (plan.hardFloorAreaM2 ?? 0)) : 0,
      pieces: rollPlan ? rollPlan.pieces.filter((p) => p.ownerId === s.staircase.id) : (plan?.pieces ?? []),
      gripperLength: plan?.gripperLength ?? 0,
      bindingLength: plan?.bindingLength ?? 0,
      underlayAreaM2: plan?.underlayAreaM2 ?? 0,
      warnings: allWarnings.filter((w) => w.subjectId === s.staircase.id),
    };
  }

  const details: EstimateDetails = { stairPlans, hardFloorPlans, doorBars, tapes, vinylSundries, floorPrep, productByOwner };
  if (underlay) details.underlay = underlay;
  if (gripper) details.gripper = gripper;

  return {
    rollPlans,
    bom: bom.lines,
    warnings: allWarnings,
    totals: { netAreaM2, materialsCost, labourCost, subtotal, vat, total },
    rooms,
    staircases,
    details,
  };
}

const LEVEL_RANK: Record<Warning['level'], number> = { error: 0, warning: 1, info: 2 };

/** Drop repeated warnings (same code, subject and message) and put errors first, keeping the original order otherwise. */
export function dedupeWarnings(list: Warning[]): Warning[] {
  const seen = new Set<string>();
  const out: Warning[] = [];
  for (const w of list) {
    const key = `${w.code}|${w.subjectId ?? ''}|${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out
    .map((w, i) => ({ w, i }))
    .sort((a, b) => LEVEL_RANK[a.w.level] - LEVEL_RANK[b.w.level] || a.i - b.i)
    .map((x) => x.w);
}

// ---------------------------------------------------------------------------
// Roll width comparison
// ---------------------------------------------------------------------------

/**
 * Plan one broadloom product's rooms (and stairs) at every roll width worth considering — the
 * product's own width, its listed alternatives and the standard UK widths for its kind (4 / 5 m
 * carpet; 2 / 3 / 4 m vinyl) — so the UI can say "a 5 m roll would need 6.1 lm with 0 seams".
 * Widths are de-duplicated and returned ascending. A product that is not broadloom, is unknown,
 * or has nothing to plan gives an empty list.
 *
 * Example: a 5 x 6 m lounge in a 4 m carpet: 4 m -> 10.2 lm (two 5.1 m drops, 1 seam, 40.8 m²);
 * 5 m -> 6.1 lm (one piece, 0 seams, 30.5 m²) — the 5 m roll saves 10.3 m² of carpet.
 */
export function compareRollWidths(project: Project, productId: Id): RollWidthComparison[] {
  const product = (project.products ?? []).find((p) => p.id === productId);
  if (!product || !isBroadloomProduct(product)) return [];
  const prep = prepare(project);
  const standard = product.kind === 'carpet' ? CARPET_ROLL_WIDTHS : VINYL_ROLL_WIDTHS;
  const widths = Array.from(new Set([product.rollWidth, ...(product.alternativeRollWidths ?? []), ...standard]))
    .filter((w) => Number.isFinite(w) && w > 0)
    .sort((a, b) => a - b);
  const base = rollPlanInputFor(prep, product, project.options.broadloom);
  if (!base) return [];
  const out: RollWidthComparison[] = [];
  for (const rollWidth of widths) {
    const plan = buildRollPlan({ ...base, rollWidth });
    const seams = Object.values(plan.seamsByRoom).reduce((s, list) => s + list.length, 0);
    out.push({
      rollWidth,
      orderLength: plan.orderLength,
      orderedAreaM2: plan.orderedAreaM2,
      wasteFraction: plan.wasteFraction,
      seams,
      rollsRequired: plan.rollsRequired,
      warnings: dedupeWarnings(plan.warnings),
    });
  }
  return out;
}
