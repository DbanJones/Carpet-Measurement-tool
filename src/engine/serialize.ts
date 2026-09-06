/**
 * Project files: turn a `Project` into JSON and read one back **defensively**.
 *
 * Contract
 * - `serializeProject` writes `{ schemaVersion, savedAt: null, project }` as pretty JSON. The engine
 *   never reads a clock, so `savedAt` is always null here; a caller (the UI) may stamp the string.
 * - `parseProject` NEVER throws and never fetches anything. It either returns `{ error }` (the text
 *   is not JSON, is not a project, or has no usable product) or `{ project, warnings }` where the
 *   project is guaranteed to satisfy the `Project` type: every enum is a real union member, every
 *   length/area/price is finite and >= 0, every id is unique, and every reference resolves.
 *   Each repair is described in `warnings` in the language of the quote ("Lounge: ...").
 * - Two deliberate exceptions to "no negative numbers": wall-feature `depth` (negative = a chimney
 *   breast projecting INTO the room) and polygon/pixel coordinates, which are positions, not lengths.
 * - Missing option and price keys are filled from `defaults.ts` key by key, so a file written by an
 *   older version — one that never heard of `options.broadloom.minFillWidth` — still loads cleanly.
 * - Pure: no DOM, no clock, no randomness. The same text always parses to the same project.
 */
import type {
  AccessoryOptions,
  BroadloomPlanningOptions,
  BroadloomProduct,
  CoveringKind,
  Doorway,
  FloorPlanDocument,
  FloorPrepOptions,
  HardFloorOptions,
  Id,
  Landing,
  Mm,
  M2,
  PackProduct,
  Point,
  Polygon,
  PriceBook,
  Product,
  Project,
  Room,
  RoomShape,
  Staircase,
  Step,
  Subfloor,
  UnderlayOptions,
  WallFeature,
} from './types';
import { isBroadloom } from './types';
import {
  CARPET_ROLL_WIDTHS,
  CARPET_TILES_PER_BOX,
  CARPET_TILE_SIZE,
  DEFAULT_ACCESSORIES,
  DEFAULT_BROADLOOM_OPTIONS,
  DEFAULT_DOOR_WIDTH,
  DEFAULT_FLOOR_PREP,
  DEFAULT_HARD_FLOOR,
  DEFAULT_PRICES,
  DEFAULT_STEP,
  DEFAULT_UNDERLAY,
  VINYL_ROLL_WIDTHS,
} from './defaults';

// ---------------------------------------------------------------------------
// The file format
// ---------------------------------------------------------------------------

/** Bumped whenever a stored project can no longer be read by simply defaulting the new fields. */
export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectFile {
  schemaVersion: number;
  /** ISO timestamp written by the caller; the engine has no clock, so it writes null. */
  savedAt: string | null;
  project: Project;
}

export type ParsedProject = { project: Project; warnings: string[] };
export type ParseFailure = { error: string };
export type ParseResult = ParsedProject | ParseFailure;

/** A repaired file can produce a warning per field; past this many the rest are counted, not listed. */
export const MAX_WARNINGS = 200;

// ---- fallbacks used when a required value cannot be repaired ------------------------------------
export const FALLBACK_PROJECT_ID = 'project';
export const FALLBACK_PROJECT_NAME = 'Untitled project';
export const FALLBACK_ROOM_LENGTH: Mm = 4000;
export const FALLBACK_ROOM_WIDTH: Mm = 3000;
export const FALLBACK_PLAN_PIXELS = 1000;
export const FALLBACK_SUBFLOOR: Subfloor = { type: 'concrete', condition: 'good' };
/** A carpet-tile box (20 x 500 mm tiles = 5 m²); other pack products fall back to a laminate pack. */
export const FALLBACK_TILE_BOX_M2: M2 = ((CARPET_TILE_SIZE / 1000) ** 2) * CARPET_TILES_PER_BOX;
export const FALLBACK_PACK_M2: M2 = 2.2;

// ---------------------------------------------------------------------------
// The string unions of types.ts, as data (validation needs the members at run time)
// ---------------------------------------------------------------------------

export const COVERING_KINDS = ['carpet', 'sheet_vinyl', 'laminate', 'engineered_wood', 'lvt_click', 'lvt_glue', 'carpet_tiles'] as const;
export const SHAPE_KINDS = ['rectangle', 'l_shape', 'rectangle_with_features', 'polygon'] as const;
export const CUTOUT_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export const WALLS = ['top', 'right', 'bottom', 'left'] as const;
export const DOORWAY_TRANSITIONS = ['carpet', 'hard_floor', 'same_floor', 'external', 'none'] as const;
export const SUBFLOOR_TYPES = ['concrete', 'anhydrite', 'floorboards', 'chipboard', 'plywood', 'existing_tiles', 'existing_vinyl', 'asphalt'] as const;
export const SUBFLOOR_CONDITIONS = ['good', 'uneven', 'poor'] as const;
export const EXISTING_COVERINGS = ['none', 'carpet', 'vinyl', 'laminate', 'tiles', 'wood'] as const;
export const STEP_KINDS = ['straight', 'winder', 'bullnose', 'curtail'] as const;
export const STAIR_METHODS = ['waterfall', 'cap_and_band'] as const;
export const OPEN_SIDES = ['none', 'left', 'right', 'both'] as const;
export const BULLNOSE_SIDES = ['left', 'right', 'both'] as const;
export const LANDING_KINDS = ['quarter', 'half', 'top'] as const;
export const PILE_DIRECTIONS = ['auto', 'along_length', 'along_width'] as const;
export const SEAM_POLICIES = ['min_seams', 'min_waste', 'balanced'] as const;
export const LAY_PATTERNS = ['straight', 'diagonal', 'herringbone', 'chevron', 'random_stagger', 'brick'] as const;
export const DISPLAY_UNITS = ['metric', 'imperial'] as const;

/** Compile-time guard: extending a union in types.ts must extend the matching list above. */
type Exhaustive<U extends string, L extends readonly string[]> = Exclude<U, L[number]> extends never ? true : never;
const _unionsAreComplete: [
  Exhaustive<CoveringKind, typeof COVERING_KINDS>,
  Exhaustive<RoomShape['kind'], typeof SHAPE_KINDS>,
  Exhaustive<WallFeature['wall'], typeof WALLS>,
  Exhaustive<Doorway['transition'], typeof DOORWAY_TRANSITIONS>,
  Exhaustive<Subfloor['type'], typeof SUBFLOOR_TYPES>,
  Exhaustive<Subfloor['condition'], typeof SUBFLOOR_CONDITIONS>,
  Exhaustive<NonNullable<Subfloor['existingCovering']>, typeof EXISTING_COVERINGS>,
  Exhaustive<Step['kind'], typeof STEP_KINDS>,
  Exhaustive<Staircase['method'], typeof STAIR_METHODS>,
  Exhaustive<Staircase['openSides'], typeof OPEN_SIDES>,
  Exhaustive<NonNullable<Step['bullnoseSides']>, typeof BULLNOSE_SIDES>,
  Exhaustive<Landing['kind'], typeof LANDING_KINDS>,
  Exhaustive<BroadloomPlanningOptions['pileDirection'], typeof PILE_DIRECTIONS>,
  Exhaustive<BroadloomPlanningOptions['seamPolicy'], typeof SEAM_POLICIES>,
  Exhaustive<HardFloorOptions['layPattern'], typeof LAY_PATTERNS>,
  Exhaustive<Project['displayUnit'], typeof DISPLAY_UNITS>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
void _unionsAreComplete;

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** Collects repair messages, capped so a badly corrupted file cannot produce an endless list. */
export class WarningLog {
  private readonly messages: string[] = [];
  private overflow = 0;

  add(message: string): void {
    if (this.messages.length >= MAX_WARNINGS) {
      this.overflow += 1;
      return;
    }
    this.messages.push(message);
  }

  get count(): number {
    return this.messages.length + this.overflow;
  }

  list(): string[] {
    return this.overflow > 0 ? [...this.messages, `…and ${this.overflow} further repairs.`] : [...this.messages];
  }
}

// ---------------------------------------------------------------------------
// Primitive validation
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface NumSpec {
  /** Lowest acceptable value (default 0: lengths, areas and prices are never negative). */
  min?: number;
  max?: number;
  /** True when `min` itself is not acceptable (a roll width of 0 mm is not a roll). */
  exclusive?: boolean;
  integer?: boolean;
}

export const POSITIVE: NumSpec = { min: 0, exclusive: true };
export const NON_NEGATIVE: NumSpec = { min: 0 };
export const POSITIVE_INT: NumSpec = { min: 0, exclusive: true, integer: true };
export const NON_NEGATIVE_INT: NumSpec = { min: 0, integer: true };
/** Coordinates and wall-feature depths: any finite number, sign included. */
export const ANY_FINITE: NumSpec = { min: -Infinity };

/** The value if it is a finite number inside `spec`, else undefined. NaN and ±Infinity never pass. */
export function finiteNumber(value: unknown, spec: NumSpec = NON_NEGATIVE): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const min = spec.min ?? 0;
  if (spec.exclusive ? value <= min : value < min) return undefined;
  if (spec.max !== undefined && value > spec.max) return undefined;
  if (spec.integer && !Number.isInteger(value)) return undefined;
  return value;
}

/** A trimmed non-empty id. Numbers are accepted (some exporters number their rows) and stringified. */
export function idOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** A short, safe rendering of a rejected value for a warning message (never dumps a data URL). */
function show(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  return Array.isArray(value) ? 'a list' : 'an object';
}

function numberOr(value: unknown, spec: NumSpec, fallback: number, what: string, log: WarningLog, quietWhenAbsent = false): number {
  const ok = finiteNumber(value, spec);
  if (ok !== undefined) return ok;
  if (value !== undefined && value !== null) log.add(`${what}: ${show(value)} is not a usable measurement; ${fallback} was used.`);
  else if (!quietWhenAbsent) log.add(`${what} was missing; ${fallback} was used.`);
  return fallback;
}

function optionalNumber(value: unknown, spec: NumSpec, what: string, log: WarningLog): number | undefined {
  if (value === undefined || value === null) return undefined;
  const ok = finiteNumber(value, spec);
  if (ok === undefined) log.add(`${what}: ${show(value)} is not a usable measurement; it was left out.`);
  return ok;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T, what: string, log: WarningLog, quietWhenAbsent = false): T {
  const ok = oneOf(value, allowed);
  if (ok !== undefined) return ok;
  if (value !== undefined && value !== null) log.add(`${what}: ${show(value)} is not one of ${allowed.join(', ')}; "${fallback}" was used.`);
  else if (!quietWhenAbsent) log.add(`${what} was missing; "${fallback}" was used.`);
  return fallback;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], what: string, log: WarningLog): T | undefined {
  if (value === undefined || value === null) return undefined;
  const ok = oneOf(value, allowed);
  if (ok === undefined) log.add(`${what}: ${show(value)} is not one of ${allowed.join(', ')}; it was left out.`);
  return ok;
}

function stringOr(value: unknown, fallback: string, what: string, log: WarningLog, quietWhenAbsent = false): string {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (value !== undefined && value !== null) log.add(`${what}: ${show(value)} is not a name; "${fallback}" was used.`);
  else if (!quietWhenAbsent) log.add(`${what} was missing; "${fallback}" was used.`);
  return fallback;
}

function optionalString(value: unknown, what: string, log: WarningLog): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  log.add(`${what}: ${show(value)} is not text; it was left out.`);
  return undefined;
}

function optionalBoolean(value: unknown, what: string, log: WarningLog): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  log.add(`${what}: ${show(value)} is not true or false; it was left out.`);
  return undefined;
}

function booleanOr(value: unknown, fallback: boolean, what: string, log: WarningLog, quietWhenAbsent = true): boolean {
  if (typeof value === 'boolean') return value;
  if (value !== undefined && value !== null) log.add(`${what}: ${show(value)} is not true or false; ${fallback} was used.`);
  else if (!quietWhenAbsent) log.add(`${what} was missing; ${fallback} was used.`);
  return fallback;
}

/** Assign only when defined, so an absent optional field stays absent rather than becoming undefined. */
function setIf<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/** The objects of a list field; anything that is not an object is dropped with a warning. */
function recordsOf(value: unknown, what: string, log: WarningLog): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    log.add(value === undefined || value === null ? `${what} is missing; an empty list was used.` : `${what} is ${show(value)}, not a list; an empty list was used.`);
    return [];
  }
  const out: Record<string, unknown>[] = [];
  value.forEach((entry, i) => {
    if (isRecord(entry)) out.push(entry);
    else log.add(`${what} #${i + 1} is not an object; it was left out.`);
  });
  return out;
}

/** A list of finite numbers (e.g. alternative roll widths); invalid entries are dropped. */
function numberList(value: unknown, spec: NumSpec, what: string, log: WarningLog): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    log.add(`${what}: ${show(value)} is not a list of measurements; it was left out.`);
    return undefined;
  }
  const out: number[] = [];
  let dropped = 0;
  for (const v of value) {
    const n = finiteNumber(v, spec);
    if (n === undefined) dropped += 1;
    else out.push(n);
  }
  if (dropped > 0) log.add(`${what}: ${dropped} unusable value${dropped === 1 ? '' : 's'} left out.`);
  return out;
}

/** Points of a polygon or a traced pixel outline. Coordinates may be negative; they are positions. */
function pointList(value: unknown, what: string, log: WarningLog): Point[] {
  if (!Array.isArray(value)) {
    log.add(`${what}: ${show(value)} is not a list of points.`);
    return [];
  }
  const out: Point[] = [];
  let dropped = 0;
  for (const p of value) {
    const x = isRecord(p) ? finiteNumber(p.x, ANY_FINITE) : undefined;
    const y = isRecord(p) ? finiteNumber(p.y, ANY_FINITE) : undefined;
    if (x === undefined || y === undefined) dropped += 1;
    else out.push({ x, y });
  }
  if (dropped > 0) log.add(`${what}: ${dropped} point${dropped === 1 ? '' : 's'} had no usable coordinates and were left out.`);
  return out;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * Hands out unique ids for one collection and remembers where each id in the FILE ended up, so
 * references (a room's productId, a traced room's floorPlanId) can follow a rename.
 */
export class IdSpace {
  private readonly used = new Set<string>();
  private readonly mapping = new Map<string, string>();

  /** Claim `original`, suffixing it (`hall`, `hall-2`, `hall-3`) if it is already taken. */
  claim(original: string, remember = true): string {
    let id = original;
    if (this.used.has(id)) {
      let n = 2;
      while (this.used.has(`${original}-${n}`)) n += 1;
      id = `${original}-${n}`;
    }
    this.used.add(id);
    if (remember && !this.mapping.has(original)) this.mapping.set(original, id);
    return id;
  }

  /** Where a reference written as `original` should now point, if that id was in the file. */
  resolve(original: string): string | undefined {
    return this.mapping.get(original);
  }

  has(id: string): boolean {
    return this.used.has(id);
  }
}

/**
 * One id per entry: explicit ids are claimed first (in file order, so the first of a duplicated pair
 * keeps its id and references still resolve), then missing ones are synthesised as `room-3` by index.
 */
function assignIds(entries: Record<string, unknown>[], prefix: string, label: string, space: IdSpace, log: WarningLog): string[] {
  const written = entries.map((e) => idOf(e.id));
  const ids: string[] = new Array<string>(entries.length).fill('');
  written.forEach((original, i) => {
    if (original === undefined) return;
    const id = space.claim(original);
    if (id !== original) log.add(`${label} ${i + 1}: the id "${original}" is used twice; this one is now "${id}".`);
    ids[i] = id;
  });
  written.forEach((original, i) => {
    if (original !== undefined) return;
    const id = space.claim(`${prefix}-${i + 1}`, false);
    log.add(`${label} ${i + 1} had no id; "${id}" was used.`);
    ids[i] = id;
  });
  return ids;
}

// ---------------------------------------------------------------------------
// Option and price groups: merge the file's values over the trade defaults
// ---------------------------------------------------------------------------

type FieldSpec =
  | { kind: 'number'; spec?: NumSpec }
  | { kind: 'boolean' }
  | { kind: 'string' }
  | { kind: 'enum'; values: readonly string[] };

function validateField(value: unknown, spec: FieldSpec): unknown {
  switch (spec.kind) {
    case 'number':
      return finiteNumber(value, spec.spec ?? NON_NEGATIVE);
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'string':
      return typeof value === 'string' && value.trim() !== '' ? value : undefined;
    case 'enum':
      return oneOf(value, spec.values);
  }
}

/**
 * Copy every recognised key of `raw` over `defaults`. A key the file does not mention keeps the
 * default silently (that is how an older file loads); a key it mentions but gets wrong is reported
 * and the default is kept — or, for a key with no default, dropped.
 */
function mergeGroup<T extends object>(defaults: T, raw: unknown, specs: Record<string, FieldSpec>, what: string, log: WarningLog): T {
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  if (raw === undefined || raw === null) return out as T;
  if (!isRecord(raw)) {
    log.add(`${what}: ${show(raw)} is not a set of options; the defaults were used.`);
    return out as T;
  }
  for (const [key, spec] of Object.entries(specs)) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    const ok = validateField(value, spec);
    if (ok === undefined) {
      const fallback = (defaults as Record<string, unknown>)[key];
      log.add(`${what}.${key}: ${show(value)} is not usable; ${fallback === undefined ? 'it was left out' : `the default (${show(fallback)}) was kept`}.`);
      continue;
    }
    out[key] = ok;
  }
  return out as T;
}

/** Only the keys the file actually set — used for a room's per-room option overrides. */
function pickPartial<T extends object>(raw: unknown, specs: Record<string, FieldSpec>, what: string, log: WarningLog): Partial<T> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    log.add(`${what}: ${show(raw)} is not a set of options; it was left out.`);
    return undefined;
  }
  return mergeGroup({} as Partial<T>, raw, specs, what, log);
}

const BROADLOOM_SPECS: Record<string, FieldSpec> = {
  pileDirection: { kind: 'enum', values: PILE_DIRECTIONS },
  seamPolicy: { kind: 'enum', values: SEAM_POLICIES },
  lengthAllowance: { kind: 'number', spec: NON_NEGATIVE },
  widthAllowance: { kind: 'number', spec: NON_NEGATIVE },
  balancedThresholdM2: { kind: 'number', spec: NON_NEGATIVE },
  minCrossJoinStripLength: { kind: 'number', spec: NON_NEGATIVE },
  usableOffcutMin: { kind: 'number', spec: NON_NEGATIVE },
  minFillWidth: { kind: 'number', spec: NON_NEGATIVE },
  maxCrossJoinsPerFill: { kind: 'number', spec: NON_NEGATIVE_INT },
};

const HARD_FLOOR_SPECS: Record<string, FieldSpec> = {
  layPattern: { kind: 'enum', values: LAY_PATTERNS },
  wastage: { kind: 'number', spec: { min: 0, max: 5 } },
  expansionGap: { kind: 'number', spec: NON_NEGATIVE },
  useBeading: { kind: 'boolean' },
  beadingLength: { kind: 'number', spec: POSITIVE },
  underlayPackCoverageM2: { kind: 'number', spec: POSITIVE },
  underlayHasDpm: { kind: 'boolean' },
};

const UNDERLAY_SPECS: Record<string, FieldSpec> = {
  fit: { kind: 'boolean' },
  rollWidth: { kind: 'number', spec: POSITIVE },
  rollLength: { kind: 'number', spec: POSITIVE },
  thickness: { kind: 'number', spec: NON_NEGATIVE },
  tog: { kind: 'number', spec: NON_NEGATIVE },
  pricePerRoll: { kind: 'number', spec: NON_NEGATIVE },
  pricePerM2: { kind: 'number', spec: NON_NEGATIVE },
};

const ACCESSORY_SPECS: Record<string, FieldSpec> = {
  gripperLength: { kind: 'number', spec: POSITIVE },
  gripperPerPack: { kind: 'number', spec: POSITIVE_INT },
  gripperWastage: { kind: 'number', spec: { min: 0, max: 5 } },
  doorBarLength: { kind: 'number', spec: POSITIVE },
  doorBarLongLength: { kind: 'number', spec: POSITIVE },
  seamTapeRollLength: { kind: 'number', spec: POSITIVE },
  doubleSidedTapeRollLength: { kind: 'number', spec: POSITIVE },
  underlayTapeRollLength: { kind: 'number', spec: POSITIVE },
};

const FLOOR_PREP_SPECS: Record<string, FieldSpec> = {
  latexThickness: { kind: 'number', spec: POSITIVE },
  latexBagCoverageM2PerMm: { kind: 'number', spec: POSITIVE },
  latexWastage: { kind: 'number', spec: { min: 0, max: 5 } },
  primerCoverageM2PerLitre: { kind: 'number', spec: POSITIVE },
  primerCoats: { kind: 'number', spec: NON_NEGATIVE_INT },
  primerCanLitres: { kind: 'number', spec: POSITIVE },
  plySheetLength: { kind: 'number', spec: POSITIVE },
  plySheetWidth: { kind: 'number', spec: POSITIVE },
  plyWastage: { kind: 'number', spec: { min: 0, max: 5 } },
  plyScrewsPerSheet: { kind: 'number', spec: POSITIVE_INT },
  hardboardSheetLength: { kind: 'number', spec: POSITIVE },
  hardboardSheetWidth: { kind: 'number', spec: POSITIVE },
  liquidDpmCoverageM2PerKg: { kind: 'number', spec: POSITIVE },
  dpmSheetRollAreaM2: { kind: 'number', spec: POSITIVE },
  dpmOverlap: { kind: 'number', spec: { min: 0, max: 1 } },
};

function numericSpecs(defaults: Record<string, number>): Record<string, FieldSpec> {
  const specs: Record<string, FieldSpec> = {};
  for (const key of Object.keys(defaults)) specs[key] = { kind: 'number', spec: NON_NEGATIVE };
  return specs;
}

function repairOptions(raw: unknown, log: WarningLog): Project['options'] {
  if (raw === undefined || raw === null) log.add('The file has no options; the trade defaults were used.');
  const src = isRecord(raw) ? raw : undefined;
  if (raw !== undefined && raw !== null && !src) log.add(`The options are ${show(raw)}, not a set of options; the trade defaults were used.`);
  return {
    broadloom: mergeGroup({ ...DEFAULT_BROADLOOM_OPTIONS }, src?.broadloom, BROADLOOM_SPECS, 'options.broadloom', log),
    hardFloor: mergeGroup({ ...DEFAULT_HARD_FLOOR }, src?.hardFloor, HARD_FLOOR_SPECS, 'options.hardFloor', log),
    underlay: mergeGroup({ ...DEFAULT_UNDERLAY }, src?.underlay, UNDERLAY_SPECS, 'options.underlay', log),
    accessories: mergeGroup({ ...DEFAULT_ACCESSORIES }, src?.accessories, ACCESSORY_SPECS, 'options.accessories', log),
    floorPrep: mergeGroup({ ...DEFAULT_FLOOR_PREP }, src?.floorPrep, FLOOR_PREP_SPECS, 'options.floorPrep', log),
  };
}

function repairPrices(raw: unknown, log: WarningLog): PriceBook {
  if (raw === undefined || raw === null) log.add('The file has no price book; the default prices were used.');
  const src = isRecord(raw) ? raw : undefined;
  if (raw !== undefined && raw !== null && !src) log.add(`The prices are ${show(raw)}, not a price book; the default prices were used.`);
  const head = mergeGroup(
    { currency: DEFAULT_PRICES.currency, vatRate: DEFAULT_PRICES.vatRate, applyVat: DEFAULT_PRICES.applyVat },
    src,
    { currency: { kind: 'string' }, vatRate: { kind: 'number', spec: { min: 0, max: 1 } }, applyVat: { kind: 'boolean' } },
    'prices',
    log,
  );
  return {
    ...head,
    labour: mergeGroup({ ...DEFAULT_PRICES.labour }, src?.labour, numericSpecs(DEFAULT_PRICES.labour), 'prices.labour', log),
    materials: mergeGroup({ ...DEFAULT_PRICES.materials }, src?.materials, numericSpecs(DEFAULT_PRICES.materials), 'prices.materials', log),
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * What a stand-in product has to look like: an exact covering kind when the file said which, or
 * just the family when all we can tell is "it came off a roll".
 */
export type CoveringFamily = 'broadloom' | 'hard' | 'tiles';
export type ProductPreference = CoveringKind | CoveringFamily;

export function coveringFamily(kind: CoveringKind): CoveringFamily {
  if (isBroadloom(kind)) return 'broadloom';
  return kind === 'carpet_tiles' ? 'tiles' : 'hard';
}

function familyOf(preference: ProductPreference): CoveringFamily {
  return preference === 'broadloom' || preference === 'hard' || preference === 'tiles' ? preference : coveringFamily(preference);
}

/** The first product of the wanted kind, else of the same family, else simply the first product. */
export function pickProduct(products: Product[], wanted: ProductPreference | undefined): Product | undefined {
  if (products.length === 0) return undefined;
  if (wanted !== undefined) {
    const exact = products.find((p) => p.kind === wanted);
    if (exact) return exact;
    const family = familyOf(wanted);
    const related = products.find((p) => coveringFamily(p.kind) === family);
    if (related) return related;
  }
  return products[0];
}

/**
 * A product whose covering kind we cannot read is dropped, but its other fields still say roughly
 * what it was — a roll width means broadloom, a pack coverage means boards or tiles — which is
 * enough to point its rooms at a sensible stand-in.
 */
function guessFamily(e: Record<string, unknown>): CoveringFamily | undefined {
  if (finiteNumber(e.rollWidth, POSITIVE) !== undefined) return 'broadloom';
  const written = typeof e.kind === 'string' ? e.kind.toLowerCase() : '';
  if (written.includes('tile')) return 'tiles';
  if (finiteNumber(e.packCoverageM2, POSITIVE) !== undefined) return 'hard';
  return undefined;
}

interface ProductsResult {
  products: Product[];
  space: IdSpace;
  /** What each product in the FILE was made of, including the ones we had to drop. */
  filePreference: Map<string, ProductPreference>;
  fatal?: string;
}

function fallbackRollWidth(kind: 'carpet' | 'sheet_vinyl'): Mm {
  return kind === 'carpet' ? (CARPET_ROLL_WIDTHS[0] ?? 4000) : (VINYL_ROLL_WIDTHS[VINYL_ROLL_WIDTHS.length - 1] ?? 4000);
}

function repairProducts(raw: unknown, log: WarningLog): ProductsResult {
  const entries = recordsOf(raw, 'The product list', log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'product', 'Product', space, log);
  const filePreference = new Map<string, ProductPreference>();
  const products: Product[] = [];
  let droppedForKind = 0;

  entries.forEach((e, i) => {
    const id = ids[i] ?? `product-${i + 1}`;
    const name = stringOr(e.name, `Product ${i + 1}`, `Product ${i + 1}: the name`, log);
    const kind = oneOf(e.kind, COVERING_KINDS);
    const written = idOf(e.id);
    const preference = kind ?? guessFamily(e);
    if (preference !== undefined) filePreference.set(written ?? id, preference);
    if (kind === undefined) {
      log.add(`Product "${name}": ${show(e.kind)} is not a floor covering this tool knows; the product was left out.`);
      droppedForKind += 1;
      return;
    }
    const label = `Product "${name}"`;
    if (kind === 'carpet' || kind === 'sheet_vinyl') {
      const product: BroadloomProduct = {
        id,
        name,
        kind,
        rollWidth: numberOr(e.rollWidth, POSITIVE, fallbackRollWidth(kind), `${label}: the roll width`, log),
      };
      setIf(product, 'alternativeRollWidths', numberList(e.alternativeRollWidths, POSITIVE, `${label}: the alternative roll widths`, log));
      setIf(product, 'maxRollLength', optionalNumber(e.maxRollLength, POSITIVE, `${label}: the maximum roll length`, log));
      setIf(product, 'cutIncrement', optionalNumber(e.cutIncrement, POSITIVE, `${label}: the cut increment`, log));
      setIf(product, 'minCutLength', optionalNumber(e.minCutLength, NON_NEGATIVE, `${label}: the minimum cut length`, log));
      setIf(product, 'patternRepeatLength', optionalNumber(e.patternRepeatLength, NON_NEGATIVE, `${label}: the pattern repeat along the roll`, log));
      setIf(product, 'patternRepeatWidth', optionalNumber(e.patternRepeatWidth, NON_NEGATIVE, `${label}: the pattern repeat across the roll`, log));
      setIf(product, 'thickness', optionalNumber(e.thickness, NON_NEGATIVE, `${label}: the thickness`, log));
      setIf(product, 'pricePerM2', optionalNumber(e.pricePerM2, NON_NEGATIVE, `${label}: the price per m²`, log));
      products.push(product);
      return;
    }
    const product: PackProduct = {
      id,
      name,
      kind,
      packCoverageM2: numberOr(e.packCoverageM2, POSITIVE, kind === 'carpet_tiles' ? FALLBACK_TILE_BOX_M2 : FALLBACK_PACK_M2, `${label}: the coverage per pack`, log),
    };
    setIf(product, 'boardLength', optionalNumber(e.boardLength, POSITIVE, `${label}: the board length`, log));
    setIf(product, 'boardWidth', optionalNumber(e.boardWidth, POSITIVE, `${label}: the board width`, log));
    setIf(product, 'boardsPerPack', optionalNumber(e.boardsPerPack, POSITIVE_INT, `${label}: the boards per pack`, log));
    setIf(product, 'thickness', optionalNumber(e.thickness, NON_NEGATIVE, `${label}: the thickness`, log));
    setIf(product, 'pricePerPack', optionalNumber(e.pricePerPack, NON_NEGATIVE, `${label}: the price per pack`, log));
    setIf(product, 'pricePerM2', optionalNumber(e.pricePerM2, NON_NEGATIVE, `${label}: the price per m²`, log));
    products.push(product);
  });

  const result: ProductsResult = { products, space, filePreference };
  if (products.length === 0 && droppedForKind > 0) {
    result.fatal = 'None of the floor coverings in this file are of a kind this tool understands, so there is nothing to estimate.';
  }
  return result;
}

// ---------------------------------------------------------------------------
// References (rooms and staircases point at products and floor plans)
// ---------------------------------------------------------------------------

interface RefCtx {
  products: Product[];
  byId: Map<Id, Product>;
  productSpace: IdSpace;
  filePreference: Map<string, ProductPreference>;
  planIds: Set<string>;
  planSpace: IdSpace;
  log: WarningLog;
}

function resolveProduct(rawRef: unknown, prefer: ProductPreference | undefined, what: string, ctx: RefCtx): Id {
  const written = idOf(rawRef);
  if (written !== undefined) {
    const mapped = ctx.productSpace.resolve(written) ?? written;
    if (ctx.byId.has(mapped)) {
      if (mapped !== written) ctx.log.add(`${what}: the covering "${written}" was renamed to "${mapped}"; the reference now points at it.`);
      return mapped;
    }
  }
  const wanted = (written !== undefined ? ctx.filePreference.get(written) : undefined) ?? prefer;
  const replacement = pickProduct(ctx.products, wanted);
  if (!replacement) {
    ctx.log.add(
      written === undefined
        ? `${what}: no floor covering was chosen, and the file has none to choose from.`
        : `${what}: the floor covering "${written}" is not in this file, and there is no other to use.`,
    );
    return written ?? '';
  }
  ctx.log.add(
    written === undefined
      ? `${what}: no floor covering was chosen; "${replacement.name}" was used.`
      : `${what}: the floor covering "${written}" is not in this file; "${replacement.name}" was used instead.`,
  );
  return replacement.id;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function fallbackShape(): RoomShape {
  return { kind: 'rectangle', length: FALLBACK_ROOM_LENGTH, width: FALLBACK_ROOM_WIDTH };
}

function repairFeatures(raw: unknown, what: string, log: WarningLog): WallFeature[] {
  const entries = recordsOf(raw, `${what}: the wall features`, log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'feature', `${what}: wall feature`, space, log);
  const features: WallFeature[] = [];
  entries.forEach((e, i) => {
    const label = `${what}: wall feature ${i + 1}`;
    const width = finiteNumber(e.width, POSITIVE);
    const depth = finiteNumber(e.depth, ANY_FINITE);
    if (width === undefined || depth === undefined) {
      log.add(`${label} has no usable width or depth; it was left out.`);
      return;
    }
    const feature: WallFeature = {
      id: ids[i] ?? `feature-${i + 1}`,
      wall: enumOr(e.wall, WALLS, 'top', `${label}: the wall`, log),
      offset: numberOr(e.offset, NON_NEGATIVE, 0, `${label}: the offset along the wall`, log),
      width,
      depth,
    };
    setIf(feature, 'label', optionalString(e.label, `${label}: the label`, log));
    features.push(feature);
  });
  return features;
}

export function repairShape(raw: unknown, what: string, log: WarningLog): RoomShape {
  if (!isRecord(raw)) {
    log.add(`${what}: the shape is ${show(raw)}; a ${FALLBACK_ROOM_LENGTH / 1000} x ${FALLBACK_ROOM_WIDTH / 1000} m rectangle was used.`);
    return fallbackShape();
  }
  const kind = oneOf(raw.kind, SHAPE_KINDS);
  if (kind === undefined) {
    log.add(`${what}: ${show(raw.kind)} is not a room shape this tool knows; a ${FALLBACK_ROOM_LENGTH / 1000} x ${FALLBACK_ROOM_WIDTH / 1000} m rectangle was used.`);
    return fallbackShape();
  }
  const length = (): Mm => numberOr(raw.length, POSITIVE, FALLBACK_ROOM_LENGTH, `${what}: the length`, log);
  const width = (): Mm => numberOr(raw.width, POSITIVE, FALLBACK_ROOM_WIDTH, `${what}: the width`, log);
  switch (kind) {
    case 'rectangle':
      return { kind, length: length(), width: width() };
    case 'l_shape': {
      const L = length();
      const W = width();
      let cutoutLength = numberOr(raw.cutoutLength, NON_NEGATIVE, 0, `${what}: the cut-out length`, log);
      let cutoutWidth = numberOr(raw.cutoutWidth, NON_NEGATIVE, 0, `${what}: the cut-out width`, log);
      if (cutoutLength > L) {
        log.add(`${what}: the cut-out is longer than the room; it was trimmed to the room length.`);
        cutoutLength = L;
      }
      if (cutoutWidth > W) {
        log.add(`${what}: the cut-out is wider than the room; it was trimmed to the room width.`);
        cutoutWidth = W;
      }
      return { kind, length: L, width: W, cutoutLength, cutoutWidth, cutoutCorner: enumOr(raw.cutoutCorner, CUTOUT_CORNERS, 'bottom-right', `${what}: the cut-out corner`, log) };
    }
    case 'rectangle_with_features':
      return { kind, length: length(), width: width(), features: repairFeatures(raw.features, what, log) };
    case 'polygon': {
      const points: Polygon = pointList(raw.points, `${what}: the outline`, log);
      if (points.length < 3) {
        log.add(`${what}: the outline has fewer than three corners; a ${FALLBACK_ROOM_LENGTH / 1000} x ${FALLBACK_ROOM_WIDTH / 1000} m rectangle was used.`);
        return fallbackShape();
      }
      return { kind, points };
    }
  }
}

function repairDoorways(raw: unknown, what: string, log: WarningLog): Doorway[] {
  const entries = recordsOf(raw, `${what}: the doorways`, log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'door', `${what}: doorway`, space, log);
  return entries.map((e, i) => {
    const label = `${what}: doorway ${i + 1}`;
    const doorway: Doorway = {
      id: ids[i] ?? `door-${i + 1}`,
      edgeIndex: numberOr(e.edgeIndex, NON_NEGATIVE_INT, 0, `${label}: the wall it sits on`, log),
      offset: numberOr(e.offset, NON_NEGATIVE, 0, `${label}: the offset along the wall`, log),
      width: numberOr(e.width, POSITIVE, DEFAULT_DOOR_WIDTH, `${label}: the clear width`, log),
      transition: enumOr(e.transition, DOORWAY_TRANSITIONS, 'carpet', `${label}: what is on the other side`, log),
    };
    setIf(doorway, 'continuous', optionalBoolean(e.continuous, `${label}: the "carpet runs through" flag`, log));
    setIf(doorway, 'sharedOpeningId', optionalString(e.sharedOpeningId, `${label}: the shared opening it belongs to`, log));
    setIf(doorway, 'label', optionalString(e.label, `${label}: the label`, log));
    return doorway;
  });
}

export function repairSubfloor(raw: unknown, what: string, log: WarningLog): Subfloor {
  if (!isRecord(raw)) {
    log.add(`${what}: no subfloor was recorded; a sound concrete floor was assumed.`);
    return { ...FALLBACK_SUBFLOOR };
  }
  const subfloor: Subfloor = {
    type: enumOr(raw.type, SUBFLOOR_TYPES, FALLBACK_SUBFLOOR.type, `${what}: the subfloor`, log),
    condition: enumOr(raw.condition, SUBFLOOR_CONDITIONS, FALLBACK_SUBFLOOR.condition, `${what}: the subfloor condition`, log, true),
  };
  setIf(subfloor, 'underfloorHeating', optionalBoolean(raw.underfloorHeating, `${what}: the underfloor heating flag`, log));
  setIf(subfloor, 'dpmKnown', optionalBoolean(raw.dpmKnown, `${what}: the damp-proof membrane flag`, log));
  setIf(subfloor, 'existingCovering', optionalEnum(raw.existingCovering, EXISTING_COVERINGS, `${what}: the existing covering`, log));
  setIf(subfloor, 'existingGripper', optionalBoolean(raw.existingGripper, `${what}: the existing gripper flag`, log));
  return subfloor;
}

function repairSource(raw: unknown, what: string, ctx: RefCtx): Room['source'] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    ctx.log.add(`${what}: the link to the floor plan is ${show(raw)}; it was removed.`);
    return undefined;
  }
  const written = idOf(raw.floorPlanId);
  const mapped = written === undefined ? undefined : (ctx.planSpace.resolve(written) ?? written);
  if (mapped === undefined || !ctx.planIds.has(mapped)) {
    ctx.log.add(`${what}: it was traced from a floor plan that is not in this file; the link was removed.`);
    return undefined;
  }
  const pixelPolygon = pointList(raw.pixelPolygon, `${what}: the traced outline`, ctx.log);
  if (pixelPolygon.length < 3) {
    ctx.log.add(`${what}: the traced outline has fewer than three corners; the link to the floor plan was removed.`);
    return undefined;
  }
  if (written !== undefined && mapped !== written) ctx.log.add(`${what}: the floor plan "${written}" was renamed to "${mapped}"; the link now points at it.`);
  return { floorPlanId: mapped, pixelPolygon };
}

function repairRooms(raw: unknown, ctx: RefCtx): Room[] {
  const entries = recordsOf(raw, 'The room list', ctx.log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'room', 'Room', space, ctx.log);
  return entries.map((e, i) => {
    const id = ids[i] ?? `room-${i + 1}`;
    const name = stringOr(e.name, `Room ${i + 1}`, `Room ${i + 1}: the name`, ctx.log);
    const what = `Room "${name}"`;
    const room: Room = {
      id,
      name,
      shape: repairShape(e.shape, what, ctx.log),
      doorways: repairDoorways(e.doorways, what, ctx.log),
      productId: resolveProduct(e.productId, undefined, what, ctx),
      subfloor: repairSubfloor(e.subfloor, what, ctx.log),
    };
    setIf(room, 'planning', pickPartial<BroadloomPlanningOptions>(e.planning, BROADLOOM_SPECS, `${what}: the carpet planning overrides`, ctx.log));
    setIf(room, 'hardFloor', pickPartial<HardFloorOptions>(e.hardFloor, HARD_FLOOR_SPECS, `${what}: the hard floor overrides`, ctx.log));
    setIf(room, 'notes', optionalString(e.notes, `${what}: the notes`, ctx.log));
    setIf(room, 'source', repairSource(e.source, what, ctx));
    return room;
  });
}

// ---------------------------------------------------------------------------
// Staircases
// ---------------------------------------------------------------------------

function repairSteps(raw: unknown, what: string, log: WarningLog): Step[] {
  const entries = recordsOf(raw, `${what}: the steps`, log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'step', `${what}: step`, space, log);
  return entries.map((e, i) => {
    const label = `${what}: step ${i + 1}`;
    const step: Step = {
      id: ids[i] ?? `step-${i + 1}`,
      kind: enumOr(e.kind, STEP_KINDS, DEFAULT_STEP.kind, `${label}: the kind`, log),
      rise: numberOr(e.rise, POSITIVE, DEFAULT_STEP.rise, `${label}: the rise`, log),
      going: numberOr(e.going, POSITIVE, DEFAULT_STEP.going, `${label}: the going`, log),
      width: numberOr(e.width, POSITIVE, DEFAULT_STEP.width, `${label}: the width`, log),
    };
    setIf(step, 'goingNarrow', optionalNumber(e.goingNarrow, NON_NEGATIVE, `${label}: the narrow going`, log));
    setIf(step, 'bullnoseProjection', optionalNumber(e.bullnoseProjection, NON_NEGATIVE, `${label}: the bullnose projection`, log));
    setIf(step, 'bullnoseSides', optionalEnum(e.bullnoseSides, BULLNOSE_SIDES, `${label}: the bullnose sides`, log));
    return step;
  });
}

function repairLandings(raw: unknown, what: string, log: WarningLog): Landing[] {
  const entries = recordsOf(raw, `${what}: the landings`, log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'landing', `${what}: landing`, space, log);
  return entries.map((e, i) => {
    const label = `${what}: landing ${i + 1}`;
    return {
      id: ids[i] ?? `landing-${i + 1}`,
      kind: enumOr(e.kind, LANDING_KINDS, 'quarter', `${label}: the kind`, log),
      length: numberOr(e.length, POSITIVE, FALLBACK_ROOM_WIDTH, `${label}: the length`, log),
      width: numberOr(e.width, POSITIVE, DEFAULT_STEP.width, `${label}: the width`, log),
      afterStepIndex: numberOr(e.afterStepIndex, NON_NEGATIVE_INT, 0, `${label}: its place in the flight`, log),
    };
  });
}

function repairStaircases(raw: unknown, ctx: RefCtx): Staircase[] {
  const entries = recordsOf(raw, 'The staircase list', ctx.log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'stairs', 'Staircase', space, ctx.log);
  return entries.map((e, i) => {
    const id = ids[i] ?? `stairs-${i + 1}`;
    const name = stringOr(e.name, `Staircase ${i + 1}`, `Staircase ${i + 1}: the name`, ctx.log);
    const what = `Staircase "${name}"`;
    const staircase: Staircase = {
      id,
      name,
      productId: resolveProduct(e.productId, 'carpet', what, ctx),
      steps: repairSteps(e.steps, what, ctx.log),
      landings: repairLandings(e.landings, what, ctx.log),
      method: enumOr(e.method, STAIR_METHODS, 'cap_and_band', `${what}: the fitting method`, ctx.log),
      openSides: enumOr(e.openSides, OPEN_SIDES, 'none', `${what}: the open sides`, ctx.log),
    };
    if (isRecord(e.runner)) {
      const width = finiteNumber(e.runner.width, POSITIVE);
      if (width === undefined) ctx.log.add(`${what}: the runner has no usable width; it was fitted wall to wall instead.`);
      else staircase.runner = { width, stairRods: booleanOr(e.runner.stairRods, false, `${what}: the stair rods flag`, ctx.log) };
    } else if (e.runner !== undefined && e.runner !== null) {
      ctx.log.add(`${what}: the runner is ${show(e.runner)}; it was left out.`);
    }
    setIf(staircase, 'nosingOverhang', optionalNumber(e.nosingOverhang, NON_NEGATIVE, `${what}: the nosing overhang`, ctx.log));
    setIf(staircase, 'topRiserByLanding', optionalBoolean(e.topRiserByLanding, `${what}: the "landing covers the top riser" flag`, ctx.log));
    setIf(staircase, 'underlayRisers', optionalBoolean(e.underlayRisers, `${what}: the "underlay the risers too" flag`, ctx.log));
    if (e.subfloor !== undefined && e.subfloor !== null) staircase.subfloor = repairSubfloor(e.subfloor, what, ctx.log);
    setIf(staircase, 'notes', optionalString(e.notes, `${what}: the notes`, ctx.log));
    return staircase;
  });
}

// ---------------------------------------------------------------------------
// Floor plans
// ---------------------------------------------------------------------------

/** Only images embedded in the file itself are kept: a project file must never make us fetch a URL. */
export function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\//i.test(value.trim());
}

function repairFloorPlans(raw: unknown, log: WarningLog): { plans: FloorPlanDocument[]; space: IdSpace } {
  const entries = recordsOf(raw, 'The floor plan list', log);
  const space = new IdSpace();
  const ids = assignIds(entries, 'plan', 'Floor plan', space, log);
  const plans: FloorPlanDocument[] = [];
  entries.forEach((e, i) => {
    const name = stringOr(e.name, `Floor plan ${i + 1}`, `Floor plan ${i + 1}: the name`, log);
    const what = `Floor plan "${name}"`;
    if (!isImageDataUrl(e.imageDataUrl)) {
      log.add(`${what}: its image is not embedded in the file (${show(e.imageDataUrl)}); nothing is ever downloaded from a project file, so the plan was left out.`);
      return;
    }
    const plan: FloorPlanDocument = {
      id: ids[i] ?? `plan-${i + 1}`,
      name,
      imageDataUrl: e.imageDataUrl.trim(),
      widthPx: numberOr(e.widthPx, POSITIVE, FALLBACK_PLAN_PIXELS, `${what}: the image width`, log),
      heightPx: numberOr(e.heightPx, POSITIVE, FALLBACK_PLAN_PIXELS, `${what}: the image height`, log),
    };
    setIf(plan, 'mmPerPx', optionalNumber(e.mmPerPx, POSITIVE, `${what}: the scale`, log));
    if (isRecord(e.calibration)) {
      const a = isRecord(e.calibration.a) ? e.calibration.a : undefined;
      const b = isRecord(e.calibration.b) ? e.calibration.b : undefined;
      const ax = finiteNumber(a?.x, ANY_FINITE);
      const ay = finiteNumber(a?.y, ANY_FINITE);
      const bx = finiteNumber(b?.x, ANY_FINITE);
      const by = finiteNumber(b?.y, ANY_FINITE);
      const distance = finiteNumber(e.calibration.distance, POSITIVE);
      if (ax === undefined || ay === undefined || bx === undefined || by === undefined || distance === undefined) {
        log.add(`${what}: the scale calibration is incomplete; it was left out and the plan needs calibrating again.`);
      } else {
        plan.calibration = { a: { x: ax, y: ay }, b: { x: bx, y: by }, distance };
      }
    } else if (e.calibration !== undefined && e.calibration !== null) {
      log.add(`${what}: the scale calibration is ${show(e.calibration)}; it was left out.`);
    }
    plans.push(plan);
  });
  return { plans, space };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Pretty JSON for a `.flooring.json` file. `savedAt` is null: the engine has no clock. */
export function serializeProject(p: Project): string {
  const file: ProjectFile = { schemaVersion: PROJECT_SCHEMA_VERSION, savedAt: null, project: p };
  return JSON.stringify(file, null, 2);
}

function looksLikeProject(raw: Record<string, unknown>): boolean {
  return ['rooms', 'products', 'staircases', 'options', 'prices', 'floorPlans'].some((key) => key in raw);
}

function repairProject(body: Record<string, unknown>, log: WarningLog): Project | ParseFailure {
  const writtenId = idOf(body.id);
  if (writtenId === undefined) log.add(`The project has no id; "${FALLBACK_PROJECT_ID}" was used.`);
  const name = stringOr(body.name, FALLBACK_PROJECT_NAME, 'The project name', log);
  const displayUnit = enumOr(body.displayUnit, DISPLAY_UNITS, 'metric', 'The display unit', log, true);

  const productsResult = repairProducts(body.products, log);
  if (productsResult.fatal !== undefined) return { error: productsResult.fatal };
  const { plans, space: planSpace } = repairFloorPlans(body.floorPlans, log);

  const ctx: RefCtx = {
    products: productsResult.products,
    byId: new Map(productsResult.products.map((p) => [p.id, p])),
    productSpace: productsResult.space,
    filePreference: productsResult.filePreference,
    planIds: new Set(plans.map((p) => p.id)),
    planSpace,
    log,
  };

  const project: Project = {
    id: writtenId ?? FALLBACK_PROJECT_ID,
    name,
    displayUnit,
    products: productsResult.products,
    rooms: repairRooms(body.rooms, ctx),
    staircases: repairStaircases(body.staircases, ctx),
    floorPlans: plans,
    options: repairOptions(body.options, log),
    prices: repairPrices(body.prices, log),
  };
  setIf(project, 'customer', optionalString(body.customer, 'The customer', log));
  setIf(project, 'siteAddress', optionalString(body.siteAddress, 'The site address', log));
  setIf(project, 'quoteRef', optionalString(body.quoteRef, 'The quote reference', log));
  setIf(project, 'quoteDate', optionalString(body.quoteDate, 'The quote date', log));
  setIf(project, 'validFor', optionalString(body.validFor, 'How long the quote is valid', log));
  setIf(project, 'notes', optionalString(body.notes, 'The project notes', log));
  return project;
}

/**
 * Read a project file. Never throws; never fetches. Returns `{ error }` when the text cannot be a
 * project at all, otherwise the repaired project and a plain-English list of what was changed.
 *
 * Example: `parseProject('{oops')` -> `{ error: 'The file is not valid JSON: ...' }`.
 */
export function parseProject(json: string): ParseResult {
  if (typeof json !== 'string' || json.trim() === '') return { error: 'The file is empty.' };
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (e) {
    const detail = e instanceof Error && e.message ? `: ${e.message}` : '';
    return { error: `The file is not valid JSON${detail}` };
  }
  if (!isRecord(raw)) return { error: 'The file does not contain a project.' };

  const log = new WarningLog();
  let body: Record<string, unknown>;
  if (isRecord(raw.project)) {
    body = raw.project;
    const version = finiteNumber(raw.schemaVersion, { min: 0, exclusive: true });
    if (version === undefined) log.add(`The file does not say which version wrote it; it was read as version ${PROJECT_SCHEMA_VERSION}.`);
    else if (version > PROJECT_SCHEMA_VERSION) {
      log.add(`This file was written by a later version of the tool (file version ${version}, this tool reads ${PROJECT_SCHEMA_VERSION}); anything it does not recognise has been left out.`);
    }
  } else if ('project' in raw) {
    return { error: 'The file has a "project" entry, but it is not a project object.' };
  } else if (looksLikeProject(raw)) {
    body = raw;
    log.add('The file is a bare project with no version wrapper; it was read as one.');
  } else {
    return { error: 'The file does not look like a flooring project.' };
  }

  const repaired = repairProject(body, log);
  if ('error' in repaired) return repaired;
  return { project: repaired, warnings: log.list() };
}
