/**
 * Floor preparation: what has to happen to the subfloor before the new floor goes down, and how
 * much of each material / labour item that takes.
 *
 * The trade rules live in a RULE TABLE (`PREP_RULES`). Each row selects on covering class or kind,
 * subfloor type, subfloor condition and a few boolean flags, and lists the preparation steps it
 * calls for (plus any warnings). `planFloorPrep` derives the flags for each room, collects the
 * steps of every matching row, quantifies each step from the room's area / perimeter / doorways
 * and the `FloorPrepOptions`, then MERGES identical steps across rooms BEFORE rounding up to whole
 * bags, sheets and litres — a project buys bags, not rooms.
 *
 * Standards referenced: BS 8203 (resilient floor coverings), BS 5325 (textile floor coverings),
 * BS 8425 (laminate). Everything here is pure and deterministic; lengths are mm, areas m².
 * Supply constants come from `defaults.ts` or the options object; the few trade rules that
 * `defaults.ts` does not yet carry are exported from the "Local trade constants" block below.
 */
import type { Mm, M2, Id, Subfloor, SubfloorType, SubfloorCondition, CoveringKind, Warning, FloorPrepOptions } from './types';
import { DEFAULT_HARD_FLOOR, PLY_SCREWS_PER_BOX, MAX_SUBFLOOR_RH_RESILIENT, MAX_SUBFLOOR_RH_WOOD, MAX_TOG_WITH_UFH } from './defaults';
import { MM_PER_M, mm2ToM2, roundTo } from './units';

// ---------------------------------------------------------------------------
// Local trade constants (candidates for defaults.ts)
// ---------------------------------------------------------------------------

/**
 * A subfloor in 'poor' condition needs at least this much smoothing compound (mm) to bury the
 * defects; the user's usual `latexThickness` applies if it is already higher.
 */
export const POOR_SUBFLOOR_MIN_LATEX_THICKNESS: Mm = 5;

/** Feather / skim coat over a plywood overlay to lose the sheet joints and screw heads (mm). */
export const PLY_SKIM_LATEX_THICKNESS: Mm = 3;

/** Hygrometer tests per room (BS 8203: at least one test per room / discrete area). */
export const MOISTURE_TESTS_PER_ROOM = 1;

/** Laminate and engineered wood must sit in the room, in their packs, this long before fitting. */
export const ACCLIMATISATION_HOURS = 48;

/**
 * Flatness a floating (click) floor needs: no more than `deviation` under a straightedge of `span`
 * (BS 8425 / surface regularity SR2). Used in item reasons; drives the 'uneven' -> latex rule.
 */
export const CLICK_FLATNESS_TOLERANCE: { deviation: Mm; span: Mm } = { deviation: 3, span: 2000 };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PrepItemKind =
  | 'uplift'
  | 'disposal'
  | 'gripper_removal'
  | 'moisture_test'
  | 'primer'
  | 'latex'
  | 'liquid_dpm'
  | 'dpm_sheet'
  | 'ply'
  | 'ply_screws'
  | 'hardboard'
  | 'sand_boards'
  | 'secure_boards'
  | 'door_easing'
  | 'skirting_refit'
  | 'acclimatise';

export interface PrepRoomInput {
  ownerId: Id;
  ownerName: string;
  areaM2: M2;
  perimeter: Mm;
  doorwayCount: number;
  subfloor: Subfloor;
  covering: CoveringKind;
  /** The new floor build-up is this much thicker than the old one (mm); > 0 drives door easing. */
  thicknessChange?: Mm;
  /** Hard floor option: remove & refit skirting instead of beading. */
  refitSkirting?: boolean;
  /** Click floors: the underlay has an integral DPM. Defaults to `DEFAULT_HARD_FLOOR.underlayHasDpm`. */
  underlayHasDpm?: boolean;
  /**
   * This owner is a staircase, not a room. Only `STAIR_PREP_KINDS` can apply to it: everything else
   * in the table is quantified over a floor area a flight does not have (you cannot pour latex or
   * lay a 2440 x 1220 ply sheet down a staircase).
   */
  isStaircase?: boolean;
  /** New gripper is being ordered for this owner, so the old gripper cannot be left down. */
  newGripper?: boolean;
}

export interface PrepItem {
  kind: PrepItemKind;
  description: string;
  /** Whole purchase units (bags, sheets, litres, boxes, each) or m² / m to 2 dp. */
  quantity: number;
  unit: string;
  /** Sum of the rooms' unrounded requirements in `unit`, for the quote's transparency column. */
  exactQuantity: number;
  ownerIds: Id[];
  /** false = recommended / conditional (e.g. "if the hygrometer reads over 75 % RH"). */
  required: boolean;
  reason: string;
  /** Boxed items only: how many individual pieces (e.g. screws) the boxes hold. */
  pieces?: number;
}

export interface FloorPrepPlan {
  items: PrepItem[];
  warnings: Warning[];
  /** Kinds that apply to each room, in trade sequence. */
  perRoom: Record<Id, PrepItemKind[]>;
}

/**
 * The only preparation that can physically happen on a flight of stairs: the old covering comes off,
 * goes in the skip, its gripper is pulled and a squeaking tread is screwed down. Levelling compound,
 * primer, ply / hardboard overlay, a DPM and skirting are all measured over a floor area a staircase
 * does not have, and none of them is a thing a fitter does to a flight.
 */
export const STAIR_PREP_KINDS: PrepItemKind[] = ['uplift', 'disposal', 'gripper_removal', 'secure_boards'];

/** Coverings grouped by what they demand of the subfloor. */
export type CoveringClass = 'carpet' | 'resilient' | 'click';

// ---------------------------------------------------------------------------
// Covering classes and room flags
// ---------------------------------------------------------------------------

export const COVERING_CLASS: Record<CoveringKind, CoveringClass> = {
  carpet: 'carpet',
  carpet_tiles: 'carpet',
  sheet_vinyl: 'resilient',
  lvt_glue: 'resilient',
  lvt_click: 'click',
  laminate: 'click',
  engineered_wood: 'click',
};

/**
 * Which preparation regime a covering falls under.
 * - 'carpet' (carpet, carpet tiles): underlay masks small defects; BS 5325.
 * - 'resilient' (sheet vinyl, glue-down LVT): every bump telegraphs through; BS 8203.
 * - 'click' (click LVT, laminate, engineered wood): floating, needs flatness; BS 8425.
 * Example: coveringClass('lvt_glue') -> 'resilient'; coveringClass('lvt_click') -> 'click'.
 */
export function coveringClass(kind: CoveringKind): CoveringClass {
  return COVERING_CLASS[kind];
}

/** Boolean facts about a room that the rule table selects on. */
export interface PrepFlags {
  /** An old covering is present (`existingCovering` set and not 'none'). */
  existingCovering: boolean;
  existingGripper: boolean;
  /** `subfloor.dpmKnown === false`: nobody knows whether the slab has a damp-proof membrane. */
  dpmUnknown: boolean;
  /** The click-floor underlay has an integral DPM (room value, else `DEFAULT_HARD_FLOOR`). */
  underlayHasDpm: boolean;
  /** The new floor is thicker than the old one (`thicknessChange > 0`). */
  thicknessIncrease: boolean;
  refitSkirting: boolean;
  underfloorHeating: boolean;
  /** New gripper is on the order for this owner (`PrepRoomInput.newGripper`). */
  newGripper: boolean;
}

/**
 * Derive the rule-table flags for a room.
 * Example: a room with `existingCovering: 'carpet'`, `existingGripper: true`, `dpmKnown: false`
 * and no `underlayHasDpm` gives `{ existingCovering: true, existingGripper: true, dpmUnknown: true,
 * underlayHasDpm: true (default), thicknessIncrease: false, refitSkirting: false, underfloorHeating: false }`.
 */
export function prepFlags(room: PrepRoomInput): PrepFlags {
  const sf = room.subfloor;
  return {
    existingCovering: sf.existingCovering !== undefined && sf.existingCovering !== 'none',
    existingGripper: sf.existingGripper === true,
    dpmUnknown: sf.dpmKnown === false,
    underlayHasDpm: room.underlayHasDpm ?? DEFAULT_HARD_FLOOR.underlayHasDpm,
    thicknessIncrease: (room.thicknessChange ?? 0) > 0,
    refitSkirting: room.refitSkirting === true,
    underfloorHeating: sf.underfloorHeating === true,
    newGripper: room.newGripper === true,
  };
}

// ---------------------------------------------------------------------------
// The rule table
// ---------------------------------------------------------------------------

export interface PrepStep {
  kind: PrepItemKind;
  /** false = recommended / conditional. */
  required: boolean;
  /** Shown on the quote. May contain `{room}` and `{existing}` placeholders. */
  reason: string;
  /** Product variant; kept as a separate merged line and appended to the description (e.g. 'anhydrite-specific'). */
  variant?: string;
  /** Latex only: fixed thickness (mm) instead of `options.latexThickness` (e.g. a skim over ply). */
  thickness?: Mm;
  /** Latex only: minimum thickness (mm) applied when the subfloor condition is 'poor'. */
  poorMinThickness?: Mm;
}

export interface PrepWarningTemplate {
  level: Warning['level'];
  code: string;
  /** May contain `{room}` and `{existing}` placeholders. */
  message: string;
}

export interface PrepRule {
  id: string;
  /** Any of these covering classes (omit = any). */
  coverings?: CoveringClass[];
  /** Any of these covering kinds (omit = any). Combined with `coverings` both must match. */
  kinds?: CoveringKind[];
  /** Any of these subfloor types (omit = any). */
  subfloors?: SubfloorType[];
  /** Any of these conditions (omit = any). */
  conditions?: SubfloorCondition[];
  /** Every listed flag must have this value. */
  flags?: Partial<PrepFlags>;
  steps: PrepStep[];
  warnings?: PrepWarningTemplate[];
}

/** Subfloors that take an acrylic primer and a cementitious smoothing compound. */
const CONCRETE_LIKE: SubfloorType[] = ['concrete', 'existing_tiles', 'existing_vinyl'];
/** Timber subfloors. */
const BOARDS: SubfloorType[] = ['floorboards', 'chipboard', 'plywood'];
/** Timber subfloors that are always overlaid with ply under a resilient floor (plywood itself is not). */
const RAW_BOARDS: SubfloorType[] = ['floorboards', 'chipboard'];
const WOOD_KINDS: CoveringKind[] = ['laminate', 'engineered_wood'];
/** Every covering except broadloom carpet: gripper is of no use to them. */
const NON_GRIPPER_KINDS: CoveringKind[] = ['carpet_tiles', 'sheet_vinyl', 'lvt_glue', 'lvt_click', 'laminate', 'engineered_wood'];

const step = (kind: PrepItemKind, required: boolean, reason: string, extra: Partial<Omit<PrepStep, 'kind' | 'required' | 'reason'>> = {}): PrepStep => ({
  kind,
  required,
  reason,
  ...extra,
});

const FLATNESS = `${CLICK_FLATNESS_TOLERANCE.deviation} mm over ${CLICK_FLATNESS_TOLERANCE.span / MM_PER_M} m`;
const DOOR_EASING_REASON = 'doors may need trimming for the new floor height';
const PRIME_REASON = 'prime the base before the smoothing compound';
const ANHYDRITE_PRIME_REASON = 'sand off the laitance and use an anhydrite-specific primer';
const ASPHALT_LATEX_REASON = 'use a compatible (asphalt-tolerant) compound; no primer';
const POOR = { poorMinThickness: POOR_SUBFLOOR_MIN_LATEX_THICKNESS };
/**
 * A skim over a new ply overlay. It is quantified over the WHOLE room at
 * `PLY_SKIM_LATEX_THICKNESS`, not from the joint length, so it gets its own variant and its own
 * wording on the quote — "skim ply joints" reads as a few metres of filler when it is a thin pour.
 */
const SKIM = { thickness: PLY_SKIM_LATEX_THICKNESS, variant: 'over ply overlay' };
const SKIM_REASON = `skim the new ply at ${PLY_SKIM_LATEX_THICKNESS} mm over the whole floor so the joints and screw heads do not telegraph through`;

/**
 * The rule table. Rows are evaluated in order for every room; every matching row contributes its
 * steps. A room never gets the same kind twice: where two rows both produce a kind, the required
 * one wins, else the first.
 */
export const PREP_RULES: PrepRule[] = [
  // ---- Existing floor ------------------------------------------------------------------------
  {
    id: 'existing-covering',
    flags: { existingCovering: true },
    steps: [step('uplift', true, 'existing {existing} to be lifted'), step('disposal', true, 'skip / tip charge for the old {existing}')],
  },
  {
    // Only while no new gripper is on the order: you cannot fit a fresh length of gripper on top of
    // the old one, so a quote that buys both must charge for taking the old one up (see below).
    id: 'gripper-reuse',
    kinds: ['carpet'],
    flags: { existingGripper: true, newGripper: false },
    steps: [step('gripper_removal', false, 'existing gripper can often be reused for a new carpet if it is sound')],
  },
  {
    id: 'gripper-replace',
    kinds: ['carpet'],
    flags: { existingGripper: true, newGripper: true },
    steps: [step('gripper_removal', true, 'new gripper is on the order for this floor, so the old gripper has to come up first')],
  },
  {
    id: 'gripper-remove',
    kinds: NON_GRIPPER_KINDS,
    flags: { existingGripper: true },
    steps: [step('gripper_removal', true, 'gripper is not used with this floor and must come up')],
  },

  // ---- Moisture (ground-floor concrete / anhydrite with no known DPM) ------------------------
  {
    id: 'moisture-resilient',
    kinds: ['sheet_vinyl', 'lvt_glue'],
    subfloors: ['concrete', 'anhydrite'],
    flags: { dpmUnknown: true },
    steps: [
      step('moisture_test', true, 'BS 8203: no known DPM — hygrometer test the slab before laying'),
      step('liquid_dpm', false, `if hygrometer > ${MAX_SUBFLOOR_RH_RESILIENT}% RH (BS 8203)`),
    ],
  },
  {
    id: 'moisture-click-vinyl',
    kinds: ['lvt_click'],
    subfloors: ['concrete', 'anhydrite'],
    flags: { dpmUnknown: true, underlayHasDpm: true },
    steps: [
      step('moisture_test', true, 'BS 8203: no known DPM — hygrometer test the slab before laying'),
      step('liquid_dpm', false, `if hygrometer > ${MAX_SUBFLOOR_RH_RESILIENT}% RH (BS 8203)`),
    ],
  },
  {
    id: 'moisture-click-vinyl-sheet',
    kinds: ['lvt_click'],
    subfloors: ['concrete', 'anhydrite'],
    flags: { dpmUnknown: true, underlayHasDpm: false },
    steps: [
      step('moisture_test', true, 'BS 8203: no known DPM — hygrometer test the slab before laying'),
      step('dpm_sheet', true, 'underlay has no integral DPM — lay polythene over the slab'),
    ],
  },
  {
    id: 'moisture-wood',
    kinds: WOOD_KINDS,
    subfloors: ['concrete', 'anhydrite'],
    flags: { dpmUnknown: true, underlayHasDpm: true },
    steps: [
      step('moisture_test', true, 'BS 8425: no known DPM — hygrometer test the slab before laying'),
      step('liquid_dpm', false, `if hygrometer > ${MAX_SUBFLOOR_RH_WOOD}% RH (wood-based floors)`),
    ],
  },
  {
    id: 'moisture-wood-sheet',
    kinds: WOOD_KINDS,
    subfloors: ['concrete', 'anhydrite'],
    flags: { dpmUnknown: true, underlayHasDpm: false },
    steps: [
      step('moisture_test', true, 'BS 8425: no known DPM — hygrometer test the slab before laying'),
      step('dpm_sheet', true, 'underlay has no integral DPM — lay polythene over the slab'),
    ],
  },

  // ---- Resilient (sheet vinyl, glue-down LVT): BS 8203 -----------------------------------------
  {
    id: 'resilient-concrete',
    coverings: ['resilient'],
    subfloors: CONCRETE_LIKE,
    steps: [step('primer', true, PRIME_REASON), step('latex', true, 'BS 8203: resilient floors need a smooth, sound base', POOR)],
  },
  {
    id: 'resilient-anhydrite',
    coverings: ['resilient'],
    subfloors: ['anhydrite'],
    steps: [
      step('primer', true, ANHYDRITE_PRIME_REASON, { variant: 'anhydrite-specific' }),
      step('latex', true, 'BS 8203: resilient floors need a smooth, sound base', POOR),
    ],
  },
  {
    id: 'resilient-asphalt',
    coverings: ['resilient'],
    subfloors: ['asphalt'],
    steps: [step('latex', true, ASPHALT_LATEX_REASON, { variant: 'asphalt-compatible', ...POOR })],
  },
  {
    id: 'resilient-boards-overlay',
    coverings: ['resilient'],
    subfloors: RAW_BOARDS,
    steps: [
      step('ply', true, 'BS 8203: overlay boards with flooring-grade ply before a resilient floor'),
      step('latex', false, SKIM_REASON, SKIM),
    ],
  },
  {
    id: 'resilient-plywood-good',
    coverings: ['resilient'],
    subfloors: ['plywood'],
    conditions: ['good'],
    steps: [step('latex', false, SKIM_REASON, SKIM)],
  },
  {
    id: 'resilient-plywood-worn',
    coverings: ['resilient'],
    subfloors: ['plywood'],
    conditions: ['uneven', 'poor'],
    steps: [step('ply', true, 'existing ply is not flat enough — overlay with new ply'), step('latex', false, SKIM_REASON, SKIM)],
  },
  {
    id: 'resilient-boards-fix',
    coverings: ['resilient'],
    subfloors: BOARDS,
    conditions: ['uneven', 'poor'],
    steps: [
      step('secure_boards', true, 'screw down loose or springy boards before overlaying'),
      step('sand_boards', false, 'sand high spots so the ply sits flat'),
    ],
  },

  // ---- Carpet (broadloom, carpet tiles): BS 5325 ----------------------------------------------
  {
    id: 'carpet-hard-uneven',
    coverings: ['carpet'],
    subfloors: CONCRETE_LIKE,
    conditions: ['uneven'],
    steps: [step('primer', false, PRIME_REASON), step('latex', false, 'recommended for a smooth finish')],
  },
  {
    id: 'carpet-anhydrite-uneven',
    coverings: ['carpet'],
    subfloors: ['anhydrite'],
    conditions: ['uneven'],
    steps: [step('primer', false, ANHYDRITE_PRIME_REASON, { variant: 'anhydrite-specific' }), step('latex', false, 'recommended for a smooth finish')],
  },
  {
    id: 'carpet-asphalt-uneven',
    coverings: ['carpet'],
    subfloors: ['asphalt'],
    conditions: ['uneven'],
    steps: [step('latex', false, `recommended for a smooth finish; ${ASPHALT_LATEX_REASON}`, { variant: 'asphalt-compatible' })],
  },
  {
    id: 'carpet-hard-poor',
    coverings: ['carpet'],
    subfloors: CONCRETE_LIKE,
    conditions: ['poor'],
    steps: [step('primer', true, PRIME_REASON), step('latex', true, 'BS 5325: the subfloor must be sound and level', POOR)],
  },
  {
    id: 'carpet-anhydrite-poor',
    coverings: ['carpet'],
    subfloors: ['anhydrite'],
    conditions: ['poor'],
    steps: [
      step('primer', true, ANHYDRITE_PRIME_REASON, { variant: 'anhydrite-specific' }),
      step('latex', true, 'BS 5325: the subfloor must be sound and level', POOR),
    ],
  },
  {
    id: 'carpet-asphalt-poor',
    coverings: ['carpet'],
    subfloors: ['asphalt'],
    conditions: ['poor'],
    steps: [step('latex', true, `BS 5325: the subfloor must be sound and level; ${ASPHALT_LATEX_REASON}`, { variant: 'asphalt-compatible', ...POOR })],
  },
  {
    id: 'carpet-boards-good',
    coverings: ['carpet'],
    subfloors: BOARDS,
    conditions: ['good'],
    steps: [],
    warnings: [{ level: 'info', code: 'UNDERLAY_ON_BOARDS', message: '{room}: no preparation planned — a good underlay takes up minor board irregularities.' }],
  },
  {
    id: 'carpet-boards-uneven',
    coverings: ['carpet'],
    subfloors: BOARDS,
    conditions: ['uneven'],
    steps: [step('hardboard', false, 'recommended to stop board lines showing through the carpet')],
  },
  {
    id: 'carpet-boards-poor',
    coverings: ['carpet'],
    subfloors: BOARDS,
    conditions: ['poor'],
    steps: [
      step('hardboard', true, 'BS 5325: boards too poor to carpet over directly'),
      step('secure_boards', true, 'screw down loose or springy boards before overlaying'),
    ],
  },

  // ---- Click (click LVT, laminate, engineered wood): BS 8425 -----------------------------------
  {
    id: 'click-hard-worn',
    coverings: ['click'],
    subfloors: CONCRETE_LIKE,
    conditions: ['uneven', 'poor'],
    steps: [step('primer', true, PRIME_REASON), step('latex', true, `BS 8425: floating floors need the base flat to ${FLATNESS}`, POOR)],
  },
  {
    id: 'click-anhydrite-worn',
    coverings: ['click'],
    subfloors: ['anhydrite'],
    conditions: ['uneven', 'poor'],
    steps: [
      step('primer', true, ANHYDRITE_PRIME_REASON, { variant: 'anhydrite-specific' }),
      step('latex', true, `BS 8425: floating floors need the base flat to ${FLATNESS}`, POOR),
    ],
  },
  {
    id: 'click-asphalt-worn',
    coverings: ['click'],
    subfloors: ['asphalt'],
    conditions: ['uneven', 'poor'],
    steps: [step('latex', true, `BS 8425: floating floors need the base flat to ${FLATNESS}; ${ASPHALT_LATEX_REASON}`, { variant: 'asphalt-compatible', ...POOR })],
  },
  {
    id: 'click-boards-uneven',
    coverings: ['click'],
    subfloors: BOARDS,
    conditions: ['uneven'],
    steps: [
      step('sand_boards', false, `sand high spots to get the boards flat to ${FLATNESS} (alternative: ply overlay)`),
      step('ply', false, `overlay with ply if sanding will not get the boards flat to ${FLATNESS}`),
    ],
  },
  {
    id: 'click-boards-poor',
    coverings: ['click'],
    subfloors: BOARDS,
    conditions: ['poor'],
    steps: [
      step('secure_boards', true, 'screw down loose or springy boards before overlaying'),
      step('ply', true, `BS 8425: boards too poor for a floating floor — overlay with ply to ${FLATNESS}`),
    ],
  },
  {
    id: 'acclimatise',
    kinds: WOOD_KINDS,
    steps: [step('acclimatise', true, `leave the packs in the room for ${ACCLIMATISATION_HOURS} h before fitting`)],
  },

  // ---- Doors, skirting, heating -----------------------------------------------------------------
  { id: 'door-easing-hard', coverings: ['resilient', 'click'], steps: [step('door_easing', false, DOOR_EASING_REASON)] },
  { id: 'door-easing-thicker', coverings: ['carpet'], flags: { thicknessIncrease: true }, steps: [step('door_easing', false, DOOR_EASING_REASON)] },
  {
    id: 'skirting-refit',
    flags: { refitSkirting: true },
    steps: [step('skirting_refit', true, 'skirting removed and refitted over the expansion gap instead of beading')],
  },
  {
    id: 'ufh',
    flags: { underfloorHeating: true },
    steps: [],
    warnings: [
      {
        level: 'warning',
        code: 'UFH_PRODUCTS',
        message: `{room}: underfloor heating — use UFH-compatible adhesive, smoothing compound and underlay; keep carpet + underlay at or below ${MAX_TOG_WITH_UFH} tog.`,
      },
    ],
  },
];

/**
 * Rows of `PREP_RULES` that apply to a room. A row matches when every selector it names matches:
 * covering class, covering kind, subfloor type, condition, and each listed flag.
 * Example: sheet vinyl on 'uneven' concrete with an old carpet and a doorway matches
 * 'existing-covering', 'resilient-concrete' and 'door-easing-hard' (3 rows).
 */
export function matchingRules(room: PrepRoomInput, flags: PrepFlags = prepFlags(room), rules: PrepRule[] = PREP_RULES): PrepRule[] {
  const cls = coveringClass(room.covering);
  return rules.filter((r) => {
    if (r.coverings && !r.coverings.includes(cls)) return false;
    if (r.kinds && !r.kinds.includes(room.covering)) return false;
    if (r.subfloors && !r.subfloors.includes(room.subfloor.type)) return false;
    if (r.conditions && !r.conditions.includes(room.subfloor.condition)) return false;
    if (r.flags) {
      for (const [name, wanted] of Object.entries(r.flags) as [keyof PrepFlags, boolean][]) {
        if (flags[name] !== wanted) return false;
      }
    }
    return true;
  });
}

/**
 * True when this room's rules call for the door leaf to be eased (a hard floor, or carpet whose
 * build-up got thicker). One physical opening has ONE leaf, so the estimator credits it to a side
 * that needs easing rather than to whichever side happened to win the door bar.
 */
export function needsDoorEasing(room: PrepRoomInput): boolean {
  if (room.isStaircase) return false;
  return matchingRules(room).some((r) => r.steps.some((s) => s.kind === 'door_easing'));
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export interface QuantityContext {
  areaM2: M2;
  perimeterM: number;
  doorways: number;
  /** Latex thickness for this step (mm). */
  thickness: Mm;
  options: FloorPrepOptions;
}

export interface PrepItemSpec {
  description: string;
  unit: string;
  /** true: round the merged total UP to whole units; false: m² / m reported to 2 dp. */
  whole: boolean;
  /** Unrounded requirement for one room in `unit`. */
  exact: (c: QuantityContext) => number;
}

/**
 * How each kind is measured and priced. Sheet-goods formulas divide by the sheet area in m²
 * (e.g. 2440 x 1220 mm ply = 2.9768 m²); latex divides by the bag's m²·mm coverage.
 */
export const PREP_ITEM_SPECS: Record<PrepItemKind, PrepItemSpec> = {
  uplift: { description: 'Uplift existing floor covering', unit: 'm²', whole: false, exact: (c) => c.areaM2 },
  disposal: { description: 'Dispose of old floor covering', unit: 'm²', whole: false, exact: (c) => c.areaM2 },
  gripper_removal: { description: 'Remove existing gripper', unit: 'm', whole: false, exact: (c) => c.perimeterM },
  moisture_test: { description: 'Subfloor moisture test (hygrometer)', unit: 'each', whole: true, exact: () => MOISTURE_TESTS_PER_ROOM },
  // Primer is sold in sealed cans, not by the litre: 0.8 L of primer is still one can to buy.
  primer: {
    description: 'Primer',
    unit: 'can',
    whole: true,
    exact: (c) => (c.areaM2 * c.options.primerCoats) / c.options.primerCoverageM2PerLitre / Math.max(c.options.primerCanLitres, 1e-9),
  },
  latex: {
    description: 'Latex smoothing compound',
    unit: 'bag',
    whole: true,
    exact: (c) => (c.areaM2 * (1 + c.options.latexWastage) * c.thickness) / c.options.latexBagCoverageM2PerMm,
  },
  liquid_dpm: { description: 'Liquid (epoxy) surface DPM, two coats', unit: 'kg', whole: true, exact: (c) => c.areaM2 / c.options.liquidDpmCoverageM2PerKg },
  dpm_sheet: { description: 'Polythene sheet DPM', unit: 'roll', whole: true, exact: (c) => (c.areaM2 * (1 + c.options.dpmOverlap)) / c.options.dpmSheetRollAreaM2 },
  ply: {
    description: 'Plywood overlay, flooring grade',
    unit: 'sheet',
    whole: true,
    exact: (c) => (c.areaM2 * (1 + c.options.plyWastage)) / mm2ToM2(c.options.plySheetLength * c.options.plySheetWidth),
  },
  /** Derived from the merged ply sheet count in `planFloorPrep`; never quantified per room. */
  ply_screws: { description: 'Ply fixing screws', unit: 'box', whole: true, exact: () => 0 },
  hardboard: {
    description: 'Hardboard overlay',
    unit: 'sheet',
    whole: true,
    exact: (c) => (c.areaM2 * (1 + c.options.plyWastage)) / mm2ToM2(c.options.hardboardSheetLength * c.options.hardboardSheetWidth),
  },
  sand_boards: { description: 'Sand floorboards flat', unit: 'm²', whole: false, exact: (c) => c.areaM2 },
  secure_boards: { description: 'Secure loose floorboards', unit: 'm²', whole: false, exact: (c) => c.areaM2 },
  door_easing: { description: 'Ease / trim doors to the new floor height', unit: 'each', whole: true, exact: (c) => c.doorways },
  skirting_refit: { description: 'Remove and refit skirting', unit: 'm', whole: false, exact: (c) => c.perimeterM },
  acclimatise: { description: `Acclimatise packs in the room, ${ACCLIMATISATION_HOURS} h`, unit: 'each', whole: true, exact: () => 1 },
};

/** Order items appear on the quote: the order the work happens in. */
export const PREP_SEQUENCE: PrepItemKind[] = [
  'uplift',
  'disposal',
  'gripper_removal',
  'moisture_test',
  'secure_boards',
  'sand_boards',
  'ply',
  'ply_screws',
  'hardboard',
  'primer',
  'latex',
  'liquid_dpm',
  'dpm_sheet',
  'door_easing',
  'skirting_refit',
  'acclimatise',
];

/**
 * Smoothing-compound thickness for a latex step: the step's fixed thickness (a ply skim) or the
 * user's `latexThickness`, raised to `poorMinThickness` on a 'poor' subfloor.
 * Example: options 3 mm, step {poorMinThickness: 5} on a 'poor' slab -> 5; on 'uneven' -> 3;
 * options 6 mm on 'poor' -> 6 (already thicker).
 */
export function latexThicknessFor(step: PrepStep, condition: SubfloorCondition, options: FloorPrepOptions): Mm {
  let t = step.thickness ?? options.latexThickness;
  if (condition === 'poor' && step.poorMinThickness !== undefined) t = Math.max(t, step.poorMinThickness);
  return t;
}

/**
 * Unrounded quantity of one step for one room, in the kind's purchase unit.
 * Example: latex at 3 mm on 20 m² with 10 % wastage and 13.5 m²·mm per bag ->
 * 20 x 1.1 x 3 / 13.5 = 4.889 bags (the caller merges rooms, then rounds up to 5).
 * Primer on 20 m², one coat at 6 m²/L -> 3.333 L. Ply on 15 m² + 10 % from 2.9768 m² sheets -> 5.543 sheets.
 */
export function prepStepQuantity(step: PrepStep, room: PrepRoomInput, options: FloorPrepOptions): { exact: number; unit: string; thickness: Mm } {
  const spec = PREP_ITEM_SPECS[step.kind];
  const thickness = latexThicknessFor(step, room.subfloor.condition, options);
  const ctx: QuantityContext = {
    areaM2: Math.max(0, room.areaM2),
    perimeterM: Math.max(0, room.perimeter) / MM_PER_M,
    doorways: Math.max(0, Math.floor(room.doorwayCount)),
    thickness,
    options,
  };
  return { exact: spec.exact(ctx), unit: spec.unit, thickness };
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

interface Accumulator {
  kind: PrepItemKind;
  required: boolean;
  variant?: string;
  exact: number;
  ownerIds: Id[];
  reasons: string[];
  thicknesses: Mm[];
}

/** Round a merged total to what gets bought: whole units up, or 2 dp for m² / m. */
function purchaseQuantity(exact: number, whole: boolean): number {
  return whole ? Math.ceil(exact - 1e-9) : roundTo(exact, 2);
}

function fill(template: string, room: PrepRoomInput): string {
  const existing = room.subfloor.existingCovering && room.subfloor.existingCovering !== 'none' ? room.subfloor.existingCovering : 'floor covering';
  return template.replace(/\{room\}/g, room.ownerName).replace(/\{existing\}/g, existing);
}

function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

function sequenceIndex(kind: PrepItemKind): number {
  const i = PREP_SEQUENCE.indexOf(kind);
  return i < 0 ? PREP_SEQUENCE.length : i;
}

function describe(acc: Accumulator, options: FloorPrepOptions): string {
  let d = PREP_ITEM_SPECS[acc.kind].description;
  if (acc.variant) d += ` (${acc.variant})`;
  if (acc.kind === 'primer' && options.primerCanLitres > 0) d += `, ${options.primerCanLitres} L cans`;
  if (acc.kind === 'latex' && acc.thicknesses.length > 0) {
    const lo = Math.min(...acc.thicknesses);
    const hi = Math.max(...acc.thicknesses);
    d += lo === hi ? `, ${lo} mm` : `, ${lo}–${hi} mm`;
  }
  return d;
}

/**
 * Plan the floor preparation for a set of rooms.
 *
 * Trade rules (see `PREP_RULES`): the old floor comes up and goes in the skip; a slab with no known
 * DPM is hygrometer-tested before a resilient or click floor (BS 8203 / BS 8425); primer is ordered
 * in whole cans, not litres; resilient floors
 * get primer + smoothing compound on concrete and a ply overlay on boards; carpet only needs
 * levelling when the base is uneven or poor (BS 5325); click floors need flatness within
 * 3 mm over 2 m; laminate / wood acclimatises 48 h; hard floors may need doors easing.
 *
 * Quantities are merged across rooms BEFORE rounding: two 5 m² vinyl rooms at 3 mm latex with
 * 13.5 m²·mm bags and 10 % wastage need 5 x 1.1 x 3 / 13.5 = 1.222 bags each -> 2.444 -> 3 bags,
 * not 2 + 2 = 4. Ply screws follow the ROUNDED sheet count: 6 sheets x 120 screws = 720 ->
 * 720 / 200 per box = 3.6 -> 4 boxes.
 *
 * Items are merged by (kind, required, variant): a required latex line and a "recommended" latex
 * line stay separate so the quote can show the optional work. Rooms with no area are skipped with
 * a `NO_AREA` warning; a zero coverage / sheet size option yields `INVALID_PREP_OPTION` and no item.
 * An owner flagged `isStaircase` is restricted to `STAIR_PREP_KINDS`.
 */
export function planFloorPrep(input: { rooms: PrepRoomInput[]; options: FloorPrepOptions }): FloorPrepPlan {
  const { options } = input;
  const warnings: Warning[] = [];
  const perRoom: Record<Id, PrepItemKind[]> = {};
  const groups = new Map<string, Accumulator>();
  const invalidKinds: PrepItemKind[] = [];

  for (const room of input.rooms) {
    const kinds: PrepItemKind[] = [];
    perRoom[room.ownerId] = kinds;
    if (!(room.areaM2 > 0)) {
      warnings.push({ level: 'warning', code: 'NO_AREA', message: `${room.ownerName}: no floor area — floor preparation skipped.`, subjectId: room.ownerId });
      continue;
    }
    const flags = prepFlags(room);
    // Collect steps; the same kind from two rows collapses to one (required wins, else first).
    const chosen = new Map<PrepItemKind, PrepStep>();
    for (const rule of matchingRules(room, flags)) {
      for (const w of rule.warnings ?? []) {
        warnings.push({ level: w.level, code: w.code, message: fill(w.message, room), subjectId: room.ownerId });
      }
      for (const s of rule.steps) {
        const prev = chosen.get(s.kind);
        if (!prev || (!prev.required && s.required)) chosen.set(s.kind, s);
      }
    }
    for (const s of chosen.values()) {
      // A staircase draws only the handful of steps that physically apply to a flight.
      if (room.isStaircase && !STAIR_PREP_KINDS.includes(s.kind)) continue;
      const q = prepStepQuantity(s, room, options);
      if (!Number.isFinite(q.exact) || q.exact < 0) {
        pushUnique(invalidKinds, s.kind);
        continue;
      }
      if (q.exact <= 0) continue;
      const key = `${s.kind}|${s.required}|${s.variant ?? ''}`;
      let acc = groups.get(key);
      if (!acc) {
        acc = { kind: s.kind, required: s.required, exact: 0, ownerIds: [], reasons: [], thicknesses: [] };
        if (s.variant !== undefined) acc.variant = s.variant;
        groups.set(key, acc);
      }
      acc.exact += q.exact;
      pushUnique(acc.ownerIds, room.ownerId);
      pushUnique(acc.reasons, fill(s.reason, room));
      if (s.kind === 'latex') pushUnique(acc.thicknesses, q.thickness);
      pushUnique(kinds, s.kind);
    }
  }

  const items: PrepItem[] = [];
  for (const acc of groups.values()) {
    const spec = PREP_ITEM_SPECS[acc.kind];
    items.push({
      kind: acc.kind,
      description: describe(acc, options),
      quantity: purchaseQuantity(acc.exact, spec.whole),
      unit: spec.unit,
      exactQuantity: roundTo(acc.exact, 4),
      ownerIds: [...acc.ownerIds],
      required: acc.required,
      reason: acc.reasons.join('; '),
    });
  }

  // Ply screws follow the rounded sheet count of each ply line (one screw grid per sheet).
  for (const ply of items.filter((i) => i.kind === 'ply')) {
    const screws = ply.quantity * options.plyScrewsPerSheet;
    const exactBoxes = screws / PLY_SCREWS_PER_BOX;
    if (!Number.isFinite(exactBoxes) || exactBoxes < 0) {
      pushUnique(invalidKinds, 'ply_screws');
      continue;
    }
    if (exactBoxes <= 0) continue;
    items.push({
      kind: 'ply_screws',
      description: `${PREP_ITEM_SPECS.ply_screws.description} (${screws} screws, boxes of ${PLY_SCREWS_PER_BOX})`,
      quantity: purchaseQuantity(exactBoxes, true),
      unit: PREP_ITEM_SPECS.ply_screws.unit,
      exactQuantity: roundTo(exactBoxes, 4),
      ownerIds: [...ply.ownerIds],
      required: ply.required,
      reason: `${options.plyScrewsPerSheet} screws per sheet x ${ply.quantity} sheets`,
      pieces: screws,
    });
    for (const id of ply.ownerIds) {
      const kinds = perRoom[id];
      if (kinds) pushUnique(kinds, 'ply_screws');
    }
  }

  for (const kind of invalidKinds) {
    warnings.push({
      level: 'error',
      code: 'INVALID_PREP_OPTION',
      message: `Floor preparation option for "${kind}" is zero or missing (coverage / sheet size); its quantity was not calculated.`,
    });
  }

  items.sort(
    (a, b) =>
      sequenceIndex(a.kind) - sequenceIndex(b.kind) ||
      Number(b.required) - Number(a.required) ||
      a.description.localeCompare(b.description),
  );
  for (const kinds of Object.values(perRoom)) kinds.sort((a, b) => sequenceIndex(a) - sequenceIndex(b));

  return { items, warnings, perRoom };
}
