/**
 * Accessories: underlay, gripper, door bars and tapes.
 *
 * Everything here is pure and deterministic. Lengths are millimetres; areas are m² only where the
 * type says `M2`. Supply constants come from `defaults.ts` or the options object; the handful of
 * trade rules that `defaults.ts` does not yet carry are exported from this module (see the
 * "Local trade constants" block) so they can be moved into `defaults.ts` later.
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
  CoveringKind,
  Seam,
  Warning,
  UnderlayOptions,
  AccessoryOptions,
  BroadloomProduct,
  BroadloomPlanningOptions,
  CutPiece,
} from './types';
import { isHardFloor } from './types';
import { planRoom, type RoomPlan } from './broadloom';
import { packOnRoll } from './packer';
import { fixingPerimeter, polygonAreaMm2, polygonPerimeter, distance, doorwaySegment } from './geometry';
import { MAX_TOG_WITH_UFH, MAX_UNDERLAY_THICKNESS_ON_STAIRS } from './defaults';
import { mm2ToM2, roundTo, ceilToStep } from './units';

// ---------------------------------------------------------------------------
// Local trade constants (candidates for defaults.ts)
// ---------------------------------------------------------------------------

/**
 * Extra underlay for areas given as a bare area (stairs): pads are cut one per tread/riser from the
 * roll and the small offcuts between pads are lost. 0.1 = 10 %.
 */
export const UNDERLAY_PAD_WASTAGE = 0.1;

/**
 * How far a requirement may overrun the last whole unit before another one is bought. Rolls of
 * underlay, packs of gripper and lengths of beading all carry an allowance for cuts already, and
 * every job leaves offcuts, so an overrun of up to 3 % of one unit (0.33 m of an 11 m roll, half a
 * gripper length in a pack of ten) is made up on site rather than ordered.
 */
export const OVER_RUN_TOLERANCE = 0.03;

/**
 * Highest underlay tog we accept without comment over underfloor heating. A typical carpet is
 * 1.0–1.5 tog on its own, so an underlay above 1.0 tog risks taking the carpet + underlay
 * combination over `MAX_TOG_WITH_UFH` (2.5 tog).
 */
export const MAX_UNDERLAY_TOG_WITH_UFH = 1.0;

/** An external opening wider than this is treated as a patio / bi-fold door rather than a single leaf. */
export const PATIO_DOOR_MIN_WIDTH: Mm = 1200;

/** Pin type assumed for extra gripper runs (stairs) when the caller gives no subfloor type. */
export const DEFAULT_GRIPPER_PIN: GripperPin = 'timber';

/**
 * Planner settings used to lay underlay strips. Underlay is not trimmed like carpet (no allowances),
 * is joined anywhere with tape (so the least-material policy is right), and offcuts down to 300 mm
 * are worth keeping for pads and fills.
 */
export const UNDERLAY_PLANNING: Omit<BroadloomPlanningOptions, 'pileDirection'> = {
  seamPolicy: 'min_waste',
  lengthAllowance: 0,
  widthAllowance: 0,
  balancedThresholdM2: 0,
  minCrossJoinStripLength: 300,
  usableOffcutMin: 300,
  minFillWidth: 1, // underlay strips can be any width; offcuts are reused
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Number of whole units (rolls, lengths, packs) needed to cover `value`. 0 for a non-positive value
 * or a non-positive unit size (a broken option must not produce Infinity in a BOM).
 * Example: 12 600 mm of underlay from 11 000 mm rolls -> 2.
 */
/**
 * Whole purchase units covering `value`. `!(x > 0)` also rejects NaN, so a broken option can never
 * put Infinity or NaN on a bill of materials (the twins in hardfloor.ts and estimate.ts agree).
 */
function wholeUnits(value: number, unit: number): number {
  if (!(value > 0) || !(unit > 0)) return 0;
  return Math.round(ceilToStep(value, unit) / unit);
}

/**
 * Whole units, but a requirement that overruns the last unit by less than `OVER_RUN_TOLERANCE` is
 * met from offcuts rather than by buying another one. 4.02 rolls of underlay is FOUR rolls and
 * 0.22 m to make up, not five: no merchant sells a fifth roll for 219 mm and no fitter buys one.
 * Returns the count and the shortfall (in the same unit as `value`) so the caller can say so.
 */
export function wholeUnitsWithTolerance(value: number, unit: number, tolerance = OVER_RUN_TOLERANCE): { units: number; shortfall: number } {
  if (!(value > 0) || !(unit > 0)) return { units: 0, shortfall: 0 };
  const exact = value / unit;
  const floor = Math.floor(exact + 1e-9);
  const over = exact - floor;
  if (floor >= 1 && over > 0 && over <= tolerance) return { units: floor, shortfall: over * unit };
  return { units: Math.round(ceilToStep(value, unit) / unit), shortfall: 0 };
}

function sumSeamLength(seams: Seam[]): Mm {
  return seams.reduce((s, seam) => s + distance(seam.from, seam.to), 0);
}

// ---------------------------------------------------------------------------
// 1. Underlay
// ---------------------------------------------------------------------------

export interface UnderlayArea {
  ownerId: Id;
  ownerName: string;
  /** Room outline (mm). Strips are planned across it with the broadloom planner. */
  polygon?: Polygon;
  /** Net area (m²) for things without an outline (stairs): pads are cut from the roll. Ignored when a polygon is given. */
  areaM2?: M2;
  /** Underfloor heating under this area: limits the tog of the carpet + underlay combination. */
  underfloorHeating?: boolean;
}

export interface UnderlayOwnerPlan {
  ownerId: Id;
  ownerName: string;
  /** Number of strips (pieces) cut for this owner; 1 for a bare-area entry. */
  strips: number;
  /** Sum of the strip lengths for this owner before packing (mm). */
  lengthMm: Mm;
  /** Net area covered (m²). */
  areaM2: M2;
}

export interface UnderlayPlan {
  /** Net area to be covered (m²). */
  totalAreaM2: M2;
  /** Linear length off the roll after packing every owner's strips together (mm). */
  stripLengthMm: Mm;
  rolls: number;
  /** stripLengthMm / rollLength, rounded to 2 dp for the quote's transparency column. */
  exactRolls: number;
  /** Length (mm) the rounded-down roll count leaves to make up from offcuts; 0 when it rounds up. */
  rollShortfall: Mm;
  /** Total length of strip-to-strip joins to tape (mm). */
  tapeLength: Mm;
  tapeRolls: number;
  perOwner: UnderlayOwnerPlan[];
  warnings: Warning[];
}

export interface UnderlayInput {
  areas: UnderlayArea[];
  options: UnderlayOptions;
  accessories: AccessoryOptions;
}

/**
 * Plan carpet underlay.
 *
 * Trade rule: underlay comes in narrow rolls (1.37 m x 11 m in the UK) and is laid in parallel strips
 * at right angles to the carpet seams where possible; strips are joined with underlay tape and never
 * need trimming allowances. Each room is planned with the broadloom planner in both directions and
 * the direction that takes less off the roll is kept; every owner's strips are then packed onto one
 * roll so a narrow strip for the hall can come out of the offcut beside a bedroom's part-width strip.
 * Stairs (given as an area) take area / roll width plus `UNDERLAY_PAD_WASTAGE` for the pad offcuts.
 * Joining tape is the sum of the planner's seam lengths: for a rectangle that is (strips - 1) x strip
 * length; for an L-shape only the overlap where two neighbouring strips actually touch.
 *
 * Worked example — 4.2 m x 3.5 m bedroom, 1370 mm x 11 m rolls, 50 m tape rolls:
 *   strips along the 4.2 m: 3500 / 1370 = 2.55 -> 3 strips x 4.2 m = 12.6 m
 *   strips along the 3.5 m: 4200 / 1370 = 3.07 -> 4 strips x 3.5 m = 14.0 m
 *   keep 12.6 m -> 12.6 / 11 = 1.15 rolls -> 2 rolls; tape = 2 joins x 4.2 m = 8.4 m -> 1 roll of 50 m.
 *
 * Warnings: `UNDERLAY_NOT_FITTED` (info, options.fit false), `UNDERLAY_ROLL_WIDTH` / `UNDERLAY_ROLL_LENGTH`
 * (error, a non-positive roll size in the options — the width one returns an empty plan because the
 * strip planner cannot run without a roll width), `UNDERLAY_NO_AREA` (an area with neither outline nor
 * area), `UFH_TOG` (underfloor heating under an underlay above `MAX_UNDERLAY_TOG_WITH_UFH`),
 * `UNDERLAY_THICK_ON_STAIRS` (thicker than `MAX_UNDERLAY_THICKNESS_ON_STAIRS` under a stair area),
 * `UNDERLAY_OVER_RUN` (info: the roll count was rounded DOWN within `OVER_RUN_TOLERANCE` and this
 * much is to be made up from offcuts), plus any `EMPTY_ROOM` / `UNPLANNABLE` errors from the planner.
 */
export function planUnderlay(input: UnderlayInput): UnderlayPlan {
  const { areas, options, accessories } = input;
  const warnings: Warning[] = [];
  const perOwner: UnderlayOwnerPlan[] = [];

  const emptyPlan = (why: Warning): UnderlayPlan => ({ totalAreaM2: 0, stripLengthMm: 0, rolls: 0, exactRolls: 0, rollShortfall: 0, tapeLength: 0, tapeRolls: 0, perOwner, warnings: [why] });

  if (!options.fit) {
    return emptyPlan({ level: 'info', code: 'UNDERLAY_NOT_FITTED', message: 'No underlay: the carpet is felt-backed or stuck down.' });
  }
  // `!(x > 0)` also rejects NaN / undefined. The strip planner's seam search loops forever on a zero
  // roll width, and a bare-area length would divide by zero, so this is a hard stop.
  if (!(options.rollWidth > 0)) {
    return emptyPlan({ level: 'error', code: 'UNDERLAY_ROLL_WIDTH', message: `Underlay roll width must be greater than zero (got ${options.rollWidth} mm) — check the underlay options.` });
  }
  if (!(options.rollLength > 0)) {
    warnings.push({ level: 'error', code: 'UNDERLAY_ROLL_LENGTH', message: `Underlay roll length must be greater than zero (got ${options.rollLength} mm) — strips are planned but rolls cannot be counted.` });
  }

  const rollWidth = options.rollWidth;
  const product: BroadloomProduct = { id: 'underlay', name: 'underlay', kind: 'carpet', rollWidth };
  const pieces: CutPiece[] = [];
  let totalAreaMm2 = 0;
  let tapeLength = 0;

  for (const area of areas) {
    let strips = 0;
    let lengthMm = 0;
    let areaMm2 = 0;
    if (area.polygon) {
      areaMm2 = polygonAreaMm2(area.polygon);
      const plan = planUnderlayStrips(area.ownerId, area.ownerName, area.polygon, product);
      // planner warnings about trim widths are for carpet, not underlay: keep only hard errors
      warnings.push(...plan.warnings.filter((w) => w.level === 'error'));
      pieces.push(...plan.pieces);
      strips = plan.pieces.length;
      lengthMm = plan.pieces.reduce((s, p) => s + p.length, 0);
      tapeLength += sumSeamLength(plan.seams);
    } else if (area.areaM2 !== undefined && area.areaM2 > 0) {
      areaMm2 = area.areaM2 * 1_000_000;
      lengthMm = Math.ceil((areaMm2 / rollWidth) * (1 + UNDERLAY_PAD_WASTAGE));
      strips = 1;
      pieces.push({
        id: `${area.ownerId}:underlay-pads`,
        ownerId: area.ownerId,
        ownerName: area.ownerName,
        label: 'Underlay pads',
        length: lengthMm,
        width: rollWidth,
        role: 'stair_step',
      });
      if (options.thickness > MAX_UNDERLAY_THICKNESS_ON_STAIRS) {
        warnings.push({
          level: 'warning',
          code: 'UNDERLAY_THICK_ON_STAIRS',
          message: `${area.ownerName}: ${options.thickness} mm underlay is thicker than the ${MAX_UNDERLAY_THICKNESS_ON_STAIRS} mm recommended on stairs (nosing wear, tuck-in).`,
          subjectId: area.ownerId,
        });
      }
    } else {
      warnings.push({
        level: 'warning',
        code: 'UNDERLAY_NO_AREA',
        message: `${area.ownerName}: no outline or area given — no underlay allowed for it.`,
        subjectId: area.ownerId,
      });
      continue;
    }
    if (area.underfloorHeating && options.tog !== undefined && options.tog > MAX_UNDERLAY_TOG_WITH_UFH) {
      warnings.push({
        level: 'warning',
        code: 'UFH_TOG',
        message: `${area.ownerName}: underfloor heating with a ${options.tog} tog underlay — carpet + underlay should not exceed ${MAX_TOG_WITH_UFH} tog combined; use a UFH-rated underlay of ${MAX_UNDERLAY_TOG_WITH_UFH} tog or less.`,
        subjectId: area.ownerId,
      });
    }
    totalAreaMm2 += areaMm2;
    perOwner.push({ ownerId: area.ownerId, ownerName: area.ownerName, strips, lengthMm, areaM2: mm2ToM2(areaMm2) });
  }

  const packed = packOnRoll({ rollWidth, pieces, usableOffcutMin: UNDERLAY_PLANNING.usableOffcutMin });
  for (const r of packed.rejected) {
    warnings.push({
      level: 'error',
      code: 'PIECE_TOO_WIDE',
      message: `${r.ownerName}: underlay piece "${r.label}" (${(r.width / 1000).toFixed(2)} m) is wider than the ${(rollWidth / 1000).toFixed(2)} m roll.`,
      subjectId: r.ownerId,
    });
  }
  const stripLengthMm = packed.totalLength;
  // 4.02 rolls is FOUR rolls plus 0.22 m made up from offcuts, not five: a whole 15 m² roll is not
  // bought to supply 219 mm. See OVER_RUN_TOLERANCE.
  const { units: rolls, shortfall: rollShortfall } = wholeUnitsWithTolerance(stripLengthMm, options.rollLength);
  const exactRolls = options.rollLength > 0 ? roundTo(stripLengthMm / options.rollLength, 2) : 0;
  if (rollShortfall > 0) {
    warnings.push({
      level: 'info',
      code: 'UNDERLAY_OVER_RUN',
      message: `${rolls} roll${rolls === 1 ? '' : 's'} of underlay leaves ${(rollShortfall / 1000).toFixed(2)} m to make up from offcuts (${exactRolls} rolls exactly). Add a roll if you would rather not.`,
    });
  }
  tapeLength = Math.ceil(tapeLength);
  const tapeRolls = wholeUnits(tapeLength, accessories.underlayTapeRollLength);

  return {
    totalAreaM2: mm2ToM2(totalAreaMm2),
    stripLengthMm,
    rolls,
    exactRolls,
    rollShortfall,
    tapeLength,
    tapeRolls,
    perOwner,
    warnings,
  };
}

/**
 * Plan one room's underlay strips in both directions and keep the one that takes less off the roll
 * (ties go to strips along the room's length). Returns the plan with its warnings; a room with no
 * area comes back with no pieces and an `EMPTY_ROOM` error.
 */
function planUnderlayStrips(ownerId: Id, ownerName: string, polygon: Polygon, product: BroadloomProduct): RoomPlan {
  const rollWidth = product.rollWidth;
  let best: RoomPlan | null = null;
  let bestLength = Infinity;
  let fallback: RoomPlan | null = null;
  for (const pileDirection of ['along_length', 'along_width'] as const) {
    const plan = planRoom({
      roomId: ownerId,
      roomName: ownerName,
      polygon,
      doorways: [],
      product,
      rollWidth,
      options: { ...UNDERLAY_PLANNING, pileDirection },
      pileDirection,
    });
    fallback ??= plan;
    if (plan.pieces.length === 0) continue;
    const alone = packOnRoll({ rollWidth, pieces: plan.pieces, usableOffcutMin: UNDERLAY_PLANNING.usableOffcutMin });
    if (alone.totalLength < bestLength - 1e-6) {
      bestLength = alone.totalLength;
      best = plan;
    }
  }
  return best ?? fallback!;
}

// ---------------------------------------------------------------------------
// 2. Gripper
// ---------------------------------------------------------------------------

export type GripperPin = 'timber' | 'concrete';

export interface GripperRoom {
  ownerId: Id;
  ownerName: string;
  polygon: Polygon;
  doorways: Doorway[];
  subfloor: Subfloor;
  covering: CoveringKind;
}

/** A gripper run that is not a room perimeter (stairs, landings) — give the net length. */
export interface GripperExtra {
  ownerId: Id;
  ownerName: string;
  length: Mm;
  subfloorType?: SubfloorType;
}

export interface GripperOwnerPlan {
  ownerId: Id;
  ownerName: string;
  /** Length incl. wastage (mm). */
  length: Mm;
  /** Whole gripper lengths for this owner. */
  lengths: number;
  pin: GripperPin;
}

export interface GripperPlan {
  totalLength: Mm;
  lengths: number;
  packs: number;
  byPin: { timber: Mm; concrete: Mm };
  perOwner: GripperOwnerPlan[];
  warnings: Warning[];
}

export interface GripperInput {
  rooms: GripperRoom[];
  extra: GripperExtra[];
  options: AccessoryOptions;
}

/**
 * Which gripper pin suits a subfloor: concrete pins (hardened, short) for concrete, anhydrite
 * screed, tiles and asphalt; standard timber pins for boards, chipboard, ply and existing vinyl
 * over a timber deck.
 */
export function gripperPinFor(subfloor: SubfloorType): GripperPin {
  switch (subfloor) {
    case 'concrete':
    case 'anhydrite':
    case 'existing_tiles':
    case 'asphalt':
      return 'concrete';
    case 'floorboards':
    case 'chipboard':
    case 'plywood':
    case 'existing_vinyl':
      return 'timber';
  }
}

/** Only stretched-in broadloom carpet is fixed to gripper; vinyl, tiles and hard floors are not. */
export function needsGripper(covering: CoveringKind): boolean {
  return covering === 'carpet';
}

/**
 * Plan gripper rod.
 *
 * Trade rule: gripper runs around every wall of a carpeted room except across doorways (a bar goes
 * there) and openings with nothing to fix to. Each room's fixing perimeter gets the cutting wastage,
 * is rounded up to whole lengths (1.52 m / 5 ft) per room, and the lengths are summed and rounded
 * up to packs. Extra runs (stairs) are treated the same way; they take `DEFAULT_GRIPPER_PIN` when no
 * subfloor type is given.
 *
 * Worked example — 4.2 m x 3.5 m room, one 838 mm door, floorboards, 5 % wastage, 1520 mm lengths,
 * 10 per pack:
 *   (15 400 - 838) x 1.05 = 15 290.1 -> 15 291 mm -> 15 291 / 1520 = 10.06 -> 11 lengths -> 2 packs,
 *   timber pins.
 *
 * Warnings: `REUSE_GRIPPER` (info) when the room already has gripper down — sound gripper is often
 * left in place, so the fitter may need fewer lengths than quoted.
 */
export function planGripper(input: GripperInput): GripperPlan {
  const { options } = input;
  const warnings: Warning[] = [];
  const perOwner: GripperOwnerPlan[] = [];
  const byPin = { timber: 0, concrete: 0 };
  const factor = 1 + options.gripperWastage;

  const add = (ownerId: Id, ownerName: string, netLength: Mm, pin: GripperPin) => {
    const length = Math.ceil(Math.max(0, netLength) * factor - 1e-6); // guard float drift (22 360 x 1.1)
    const lengths = wholeUnits(length, options.gripperLength);
    byPin[pin] += length;
    perOwner.push({ ownerId, ownerName, length, lengths, pin });
  };

  for (const room of input.rooms) {
    if (!needsGripper(room.covering)) continue;
    add(room.ownerId, room.ownerName, fixingPerimeter(room.polygon, room.doorways), gripperPinFor(room.subfloor.type));
    if (room.subfloor.existingGripper) {
      warnings.push({
        level: 'info',
        code: 'REUSE_GRIPPER',
        message: `${room.ownerName}: existing gripper — if it is sound it can be reused, reducing the gripper needed.`,
        subjectId: room.ownerId,
      });
    }
  }
  for (const x of input.extra) {
    add(x.ownerId, x.ownerName, x.length, x.subfloorType ? gripperPinFor(x.subfloorType) : DEFAULT_GRIPPER_PIN);
  }

  const totalLength = perOwner.reduce((s, o) => s + o.length, 0);
  const lengths = perOwner.reduce((s, o) => s + o.lengths, 0);
  // half a length over a whole pack comes out of the offcuts, not out of another pack
  const packs = wholeUnitsWithTolerance(lengths, options.gripperPerPack).units;
  return { totalLength, lengths, packs, byPin, perOwner, warnings };
}

// ---------------------------------------------------------------------------
// 3. Door bars
// ---------------------------------------------------------------------------

export type DoorBarType = 'double_carpet' | 'single_edge' | 'cover_strip' | 't_bar' | 'ramp' | 'end_profile' | 'none';

export const DOOR_BAR_TYPES: DoorBarType[] = ['double_carpet', 'single_edge', 'cover_strip', 't_bar', 'ramp', 'end_profile', 'none'];

export interface DoorBarRoom {
  ownerId: Id;
  ownerName: string;
  doorways: Doorway[];
  covering: CoveringKind;
  /** Room outline: when given, the bar is sized from the opening as it actually lands on the wall. */
  polygon?: Polygon;
  /** Product thickness (mm), quoted in the ramp note where a height difference is assumed. */
  productThickness?: Mm;
}

export interface DoorBarLine {
  ownerId: Id;
  ownerName: string;
  doorwayId: Id;
  label: string;
  type: DoorBarType;
  width: Mm;
  /** What is on the other side; carried through so the caller can count door leaves once per opening. */
  transition: DoorwayTransition;
  /** The covering continues through the opening: no bar, and no door to ease. */
  continuous: boolean;
  /** The physical opening this line covers (`Doorway.sharedOpeningId`, else the doorway's own id). */
  openingId: Id;
  /** Standard-length bars. */
  bars: number;
  /** Long bars (cut to size). */
  longBars: number;
}

export interface DoorBarPlan {
  bars: DoorBarLine[];
  /** Bars (standard + long) per type; for 'none' the number of doorways that need no bar. */
  totalsByType: Record<DoorBarType, number>;
  standardBars: number;
  longBars: number;
  warnings: Warning[];
}

export interface DoorBarInput {
  rooms: DoorBarRoom[];
  options: AccessoryOptions;
}

/**
 * Door bar (threshold strip) selection: what is in the room x what is on the other side.
 *
 * - carpet / carpet tiles: to carpet = double-sided carpet bar; to a hard floor, the same hard floor
 *   or outside = single-edge bar (grips the carpet, the other side is a plain edge); to nothing = none.
 * - sheet vinyl: to carpet = single-edge bar (the carpet edge is gripped, the vinyl edge is covered);
 *   to a hard floor = flat cover strip; to outside = end profile; to nothing = none.
 * - hard floors (laminate, engineered wood, LVT): to the same floor at the same level = T-bar; to a
 *   different hard floor = ramp (a height difference is assumed); to carpet = ramp / reducer down to
 *   the carpet; to outside = end profile; to nothing = none.
 * - a broadloom that continues through the opening (`continuous`) needs no bar at all.
 *
 * Example: laminate lounge, doorway to the carpeted hall -> 'ramp'.
 */
export function doorBarTypeFor(covering: CoveringKind, transition: DoorwayTransition, continuous?: boolean): DoorBarType {
  if (continuous || transition === 'none') return 'none';
  if (covering === 'carpet' || covering === 'carpet_tiles') {
    switch (transition) {
      case 'carpet':
        return 'double_carpet';
      case 'hard_floor':
      case 'same_floor':
      case 'external':
        return 'single_edge';
    }
  }
  if (covering === 'sheet_vinyl') {
    switch (transition) {
      case 'carpet':
        return 'single_edge';
      case 'hard_floor':
      case 'same_floor':
        return 'cover_strip';
      case 'external':
        return 'end_profile';
    }
  }
  if (isHardFloor(covering)) {
    switch (transition) {
      case 'same_floor':
        return 't_bar';
      case 'hard_floor':
      case 'carpet':
        return 'ramp';
      case 'external':
        return 'end_profile';
    }
  }
  return 'none';
}

/**
 * How many bars cover an opening: one standard bar (900 mm) up to the standard length, one long bar
 * (2.7 m) cut to size beyond that, and several long bars butted together for anything wider. If no
 * long bar is configured (long <= standard) standard bars are butted instead.
 *
 * Examples with 900 / 2700 mm bars: 838 mm -> 1 standard; 1800 mm patio door -> 1 long;
 * 6000 mm bi-fold -> 6000 / 2700 = 2.22 -> 3 long.
 */
export function doorBarsForWidth(width: Mm, options: AccessoryOptions): { bars: number; longBars: number } {
  if (width <= 0) return { bars: 0, longBars: 0 };
  const std = options.doorBarLength;
  const long = options.doorBarLongLength;
  if (std > 0 && width <= std) return { bars: 1, longBars: 0 };
  if (long > std) {
    return { bars: 0, longBars: wholeUnits(width, long) };
  }
  return { bars: std > 0 ? wholeUnits(width, std) : 0, longBars: 0 };
}

/**
 * Plan door bars for every doorway of every room.
 *
 * Trade rule: one bar per PHYSICAL opening, chosen by `doorBarTypeFor`, sized by `doorBarsForWidth`.
 * A door between two rooms is normally measured from both sides (each room's gripper stops at it),
 * so the two entries are joined by an explicit `Doorway.sharedOpeningId`: the second one is reported
 * (`DOORWAY_SHARED`, info) and not bought again — the first room planned wins the profile, which is
 * why the caller sorts hard floors first.
 *
 * Identity is NEVER guessed from the label. "Door", "Doorway" and "Door to landing" are what people
 * actually type, so two different doorways would collapse into one bar (a bar short on site) and one
 * opening described differently from each side would buy two.
 *
 * Worked example — carpet bedroom with an 838 mm door to the carpeted landing and a 1800 mm patio
 * door; laminate lounge with a 926 mm door to the carpeted hall:
 *   bedroom door -> double_carpet, 1 standard bar; patio -> single_edge, 1 long bar (PATIO_DOOR note);
 *   lounge door -> ramp, 1 standard bar (RAMP_ASSUMED note). Totals: 2 standard, 1 long.
 *
 * Warnings: `DOORWAY_SHARED` (info), `DOORWAY_WIDTH_MISMATCH` (warning: the two sides of one opening
 * were measured differently — the wider is used), `PATIO_DOOR` (info: carpet meets a wide external
 * threshold — a cover strip / threshold plate may suit better), `RAMP_ASSUMED` (info: hard floor to
 * hard floor assumes a height difference; use a T-bar if the levels match).
 */
export function planDoorBars(input: DoorBarInput): DoorBarPlan {
  const { options } = input;
  const warnings: Warning[] = [];
  const lines: DoorBarLine[] = [];
  const totalsByType = Object.fromEntries(DOOR_BAR_TYPES.map((t) => [t, 0])) as Record<DoorBarType, number>;
  const seenOpenings = new Map<Id, { ownerName: string; width: Mm; label: string }>();
  let standardBars = 0;
  let longBars = 0;

  for (const room of input.rooms) {
    room.doorways.forEach((d, i) => {
      const label = d.label?.trim() || `${room.ownerName} doorway ${i + 1}`;
      // The bar spans the opening as it actually lands on the wall, so it can never disagree with
      // the gripper gap the same segment produced (see geometry.doorwaySegment).
      const width = room.polygon ? doorwaySegment(room.polygon, d).width : d.width;
      const openingId = d.sharedOpeningId?.trim() || d.id;
      const seen = seenOpenings.get(openingId);
      if (seen) {
        warnings.push({
          level: 'info',
          code: 'DOORWAY_SHARED',
          message: `${room.ownerName}: "${label}" is the same opening as "${seen.label}" in ${seen.ownerName} — one bar is counted for it.`,
          subjectId: room.ownerId,
        });
        if (Math.abs(seen.width - width) > 1) {
          warnings.push({
            level: 'warning',
            code: 'DOORWAY_WIDTH_MISMATCH',
            message: `${room.ownerName}: "${label}" is ${Math.round(width)} mm here and ${Math.round(seen.width)} mm in ${seen.ownerName} — the same opening cannot be two widths. The wider figure is used; re-measure it.`,
            subjectId: room.ownerId,
          });
        }
        return;
      }
      seenOpenings.set(openingId, { ownerName: room.ownerName, width, label });
      const type = doorBarTypeFor(room.covering, d.transition, d.continuous);
      const count = type === 'none' ? { bars: 0, longBars: 0 } : doorBarsForWidth(width, options);
      lines.push({
        ownerId: room.ownerId,
        ownerName: room.ownerName,
        doorwayId: d.id,
        label,
        type,
        width,
        transition: d.transition,
        continuous: d.continuous === true,
        openingId,
        bars: count.bars,
        longBars: count.longBars,
      });
      totalsByType[type] += type === 'none' ? 1 : count.bars + count.longBars;
      standardBars += count.bars;
      longBars += count.longBars;

      if (type !== 'none' && d.transition === 'external' && (room.covering === 'carpet' || room.covering === 'carpet_tiles') && width > PATIO_DOOR_MIN_WIDTH) {
        warnings.push({
          level: 'info',
          code: 'PATIO_DOOR',
          message: `${room.ownerName}: "${label}" is a ${(width / 1000).toFixed(2)} m external opening — a cover strip or threshold plate may suit the patio track better than a single-edge bar.`,
          subjectId: room.ownerId,
        });
      }
      if (type === 'ramp' && d.transition === 'hard_floor') {
        const thick = room.productThickness !== undefined ? ` (${room.productThickness} mm floor)` : '';
        warnings.push({
          level: 'info',
          code: 'RAMP_ASSUMED',
          message: `${room.ownerName}: "${label}" meets another hard floor${thick} — a ramp is assumed for a height difference; use a T-bar if the levels match.`,
          subjectId: room.ownerId,
        });
      }
    });
  }

  return { bars: lines, totalsByType, standardBars, longBars, warnings };
}

// ---------------------------------------------------------------------------
// 4. Tapes
// ---------------------------------------------------------------------------

export interface TapeRoom {
  ownerId: Id;
  ownerName: string;
  covering: CoveringKind;
  polygon: Polygon;
  seams: Seam[];
}

export interface TapePlan {
  seamTapeLength: Mm;
  seamTapeRolls: number;
  doubleSidedTapeLength: Mm;
  doubleSidedTapeRolls: number;
}

export interface TapeInput {
  rooms: TapeRoom[];
  options: AccessoryOptions;
}

/**
 * Tapes for broadloom.
 *
 * Trade rule: every carpet seam (side or cross) is joined on hot-melt seaming tape, so the seam tape
 * is the sum of the seam lengths. Sheet vinyl is perimeter-stuck: double-sided tape runs round the
 * whole perimeter (openings included — it runs under the bar) and along every seam. Hard floors and
 * carpet tiles use neither.
 *
 * Worked example — 3 m x 4 m vinyl kitchen with one 3 m seam, 25 m rolls of double-sided tape:
 *   perimeter 14 m + seam 3 m = 17 m -> 1 roll.
 * Carpet lounge with two 4.2 m seams, 20 m rolls of seam tape: 8.4 m -> 1 roll.
 */
export function planTapes(input: TapeInput): TapePlan {
  let seamTape = 0;
  let doubleSided = 0;
  for (const room of input.rooms) {
    if (room.covering === 'carpet') {
      seamTape += sumSeamLength(room.seams);
    } else if (room.covering === 'sheet_vinyl') {
      doubleSided += polygonPerimeter(room.polygon) + sumSeamLength(room.seams);
    }
  }
  const seamTapeLength = Math.ceil(seamTape);
  const doubleSidedTapeLength = Math.ceil(doubleSided);
  return {
    seamTapeLength,
    seamTapeRolls: wholeUnits(seamTapeLength, input.options.seamTapeRollLength),
    doubleSidedTapeLength,
    doubleSidedTapeRolls: wholeUnits(doubleSidedTapeLength, input.options.doubleSidedTapeRollLength),
  };
}
