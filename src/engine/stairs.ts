/**
 * Staircase planner: turns a measured staircase into the cut pieces, net area, gripper, binding,
 * underlay pads, stair rods and nosings a fitter needs — for broadloom carpet (fully fitted or a
 * runner), sheet vinyl, or a pack-sold hard floor (laminate / LVT / wood / carpet tiles).
 *
 * Trade model (UK domestic stairs)
 * - Steps are listed from the BOTTOM up. Each step is one riser plus the tread ABOVE it. The TOP
 *   step's "tread" is the landing floor, so the top step has NO going: its carpet goes up the riser
 *   and over the landing nosing only (wrap = rise + nosing overhang).
 * - Every other step: the carpet runs UP the riser, OVER the nosing and BACK along the tread:
 *   wrapLength = rise + going + nosingOverhang. The pile runs DOWN the flight, so every piece is
 *   cut with its LENGTH along the roll (rise + going direction) and its WIDTH across the stair.
 * - 'cap_and_band': one piece per step, length = wrapLength + STEP_LENGTH_ALLOWANCE +
 *   CAP_AND_BAND_EXTRA, width = tread width + STEP_WIDTH_ALLOWANCE (tuck against closed strings)
 *   + OPEN_SIDE_WRAP per open string + a bullnose wrap per curved end.
 * - 'waterfall': one continuous piece down each straight run, length = Σ (wrapLength +
 *   STEP_LENGTH_ALLOWANCE) + RUNNER_END_ALLOWANCE. Winders and landings break the flight into runs;
 *   a fully fitted bullnose / curtail step is also cut on its own because the wrap round the curved
 *   end cannot be made from a continuous strip. Winders are always individual pieces.
 * - `topRiserByLanding`: the landing carpet runs over the top nosing and down the top riser; the
 *   stairs stop one riser short and ONE landing at the head of the flight gains rise + nosing + tuck.
 * - Underlay is a pad per TREAD (going + `PAD_NOSING_OVERLAP`), not a continuous strip down the
 *   flight; `underlayRisers` switches to the full-flight build-up.
 * - A runner is a strip of fixed width (no string or wrap allowances) bound on both edges, with a
 *   stair rod per step if wanted.
 *
 * Every constant that a fitter might dispute comes from defaults.ts or the options passed in; the
 * few that defaults.ts lacks are exported below with their rationale.
 *
 * This module is pure and deterministic: no I/O, no clock, no randomness. Lengths are mm; areas are
 * mm² internally and m² only where the result type says M2.
 */
import type { Mm, M2, Id, CutPiece, Warning, Staircase, Step, StepKind, Landing, Product, BroadloomPlanningOptions, UnderlayOptions, AccessoryOptions } from './types';
import { isBroadloom } from './types';
import { ceilToStep, mm2ToM2, roundTo } from './units';
import { polygonAreaMm2 } from './geometry';
import { validStairOutlinePoints, validStepOutline } from './stairOutlines';
import {
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
  PAD_NOSING_OVERLAP,
  STAIR_REGS,
  MAX_UNDERLAY_THICKNESS_ON_STAIRS,
} from './defaults';

// ---------------------------------------------------------------------------
// Local constants (not in defaults.ts — candidates to move there)
// ---------------------------------------------------------------------------

/**
 * Wastage on pack-sold products (laminate / LVT / wood / carpet tiles) fitted to stairs. Every tread
 * and riser is a separate cut-both-ways panel, so the 7% 'straight' room figure is far too low;
 * 15% (the diagonal-lay figure) is what fitters typically allow.
 */
export const STAIR_HARD_FLOOR_WASTAGE = 0.15;

/**
 * Projection assumed for a bullnose step whose projection was not measured. UK bullnose treads run
 * about 1000-1100 mm overall on an 860 mm flight, i.e. roughly 150 mm beyond the string each side
 * (range 100-250). The estimate warns whenever this assumption is used — measure it.
 */
export const DEFAULT_BULLNOSE_PROJECTION: Mm = 150;

/**
 * Projection assumed for an unmeasured curtail step. A single curtail is typically 1200 mm overall
 * on an 860 mm flight, so it sweeps about 340 mm past the string (range 300-400).
 */
export const DEFAULT_CURTAIL_PROJECTION: Mm = 340;

/** Tolerance when rounding gripper up to a whole millimetre, so 22360 x 1.1 = 24596.000000000004 does not become 24597. */
export const GRIPPER_ROUNDING_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StairPlanInput {
  staircase: Staircase;
  /** BroadloomProduct (carpet / sheet vinyl) or PackProduct (laminate / LVT / wood / carpet tiles with stair nosings). */
  product: Product;
  options: BroadloomPlanningOptions;
  underlay: UnderlayOptions;
  accessories: AccessoryOptions;
}

export interface StairPlanStep {
  stepId: Id;
  kind: StepKind;
  /** rise + going + nosing overhang (top step: rise + nosing overhang): the carpet path over one step (mm). */
  wrapLength: Mm;
  /** Cut length (along the roll) of the piece this step is cut from — the whole run for a waterfall step. Absent for hard floors and for a top riser carpeted by the landing. */
  pieceLength?: Mm;
  /** Cut width (across the roll) of the piece this step is cut from. */
  pieceWidth?: Mm;
  notes: string;
}

export interface StairPlan {
  staircaseId: Id;
  /** Number of steps (risers) measured on the staircase, including a top riser carpeted by the landing. */
  stepCount: number;
  /**
   * Broadloom only. Every piece has a fixed orientation: `length` runs along the roll (pile runs
   * DOWN the stairs, i.e. along rise + going), `width` runs across the stair.
   * Roles: 'stair_step' (fully fitted step / waterfall run), 'stair_runner' (runner strip),
   * 'winder' (kite cut from a rectangle), 'landing'.
   */
  pieces: CutPiece[];
  /** Carpet / vinyl actually on treads + risers + landings (mm², no allowances), for waste reporting. */
  netAreaMm2: number;
  /** Gripper to fit, incl. `accessories.gripperWastage` (mm). Zero for vinyl and hard floors. */
  gripperLength: Mm;
  /** Linear mm of carpet edge to bind / whip: open-string wraps, or both runner edges plus its two ends. */
  bindingLength: Mm;
  underlayAreaM2: M2;
  /** One underlay pad per step carpeted from the stairs (landings are cut from the roll, not pads). */
  underlayPads: number;
  /** Runners only: one rod per step when `runner.stairRods` is set. */
  stairRods: number;
  /** Hard floor and vinyl stairs: one nosing profile per step, and their total length. */
  nosings: number;
  nosingLength: Mm;
  /** Pack-sold products: net tread + riser (+ landing) area to be clad (m²). */
  hardFloorAreaM2?: M2;
  /** Pack-sold products: net area plus STAIR_HARD_FLOOR_WASTAGE (m²) — what to buy. */
  hardFloorGrossAreaM2?: M2;
  /** Pack-sold products: whole packs covering the gross area (when the product has a pack coverage). */
  hardFloorPacks?: number;
  perStep: StairPlanStep[];
  warnings: Warning[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Sides = 'none' | 'left' | 'right' | 'both';

/** Number of sides named by a side selector: none 0, left/right 1, both 2. */
export function sideCount(sides: Sides): number {
  return sides === 'both' ? 2 : sides === 'none' ? 0 : 1;
}

/** Round up to a whole millimetre, ignoring float drift below GRIPPER_ROUNDING_EPSILON (24596.000000000004 -> 24596). */
export function ceilMm(value: number): Mm {
  return Math.ceil(value - GRIPPER_ROUNDING_EPSILON);
}

function nonNegative(v: Mm | undefined): Mm {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function landingLabel(kind: Landing['kind']): string {
  return kind === 'half' ? 'Half landing' : kind === 'quarter' ? 'Quarter landing' : 'Top landing';
}

function fmtM(mm: Mm): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

/**
 * Wrap length of one step: the carpet goes up the riser, over the nosing (and back under its
 * overhang) and along the tread. The TOP step's tread is the landing floor, so it has no going:
 * the carpet only goes up the riser and over the landing nosing.
 *
 * Example: rise 200 + going 223 + nosing overhang 20 = 443 mm; the top step is 200 + 20 = 220 mm.
 * A winder's `going` is its maximum going (wide end), so the kite is cut from the longest path.
 */
export function stepWrapLength(step: Pick<Step, 'rise' | 'going'>, nosingOverhang: Mm, topStep = false): Mm {
  return nonNegative(step.rise) + (topStep ? 0 : nonNegative(step.going)) + nonNegative(nosingOverhang);
}

/**
 * Extra cut width to wrap a bullnose / curtail end: the carpet follows the curved end round and is
 * tucked under, ≈ BULLNOSE_WRAP_FACTOR x projection + BULLNOSE_WRAP_TUCK per curved side.
 *
 * Example: bullnose projecting 150 mm on the right: 1.6 x 150 + 50 = 290 mm extra width.
 * A curtail step always curves on both sides: projection 200 -> 2 x (1.6 x 200 + 50) = 740 mm.
 * A bullnose with no side given is assumed to curve on ONE side (the usual balustrade side); a
 * missing projection falls back to DEFAULT_BULLNOSE_PROJECTION / DEFAULT_CURTAIL_PROJECTION.
 */
export function bullnoseWrapExtra(step: Pick<Step, 'kind' | 'bullnoseProjection' | 'bullnoseSides'>): { extra: Mm; sides: number; projection: Mm; assumed: boolean } {
  if (step.kind !== 'bullnose' && step.kind !== 'curtail') return { extra: 0, sides: 0, projection: 0, assumed: false };
  const sides = step.kind === 'curtail' ? 2 : step.bullnoseSides ? sideCount(step.bullnoseSides) : 1;
  const measured = nonNegative(step.bullnoseProjection);
  const assumed = measured === 0;
  const projection = assumed ? (step.kind === 'curtail' ? DEFAULT_CURTAIL_PROJECTION : DEFAULT_BULLNOSE_PROJECTION) : measured;
  const perSide = BULLNOSE_WRAP_FACTOR * projection + BULLNOSE_WRAP_TUCK;
  return { extra: roundTo(perSide * sides, 0), sides, projection, assumed };
}

/** A sanitised step with the derived dimensions the planner needs. */
interface StepGeo {
  step: Step;
  index: number;
  kind: StepKind;
  isTop: boolean;
  /** False when the top riser is carpeted by the landing (`topRiserByLanding`). */
  onStairs: boolean;
  rise: Mm;
  going: Mm;
  width: Mm;
  wrapLength: Mm;
  /** rise + going (top step: rise) — the surface actually clad, without the nosing wrap. Drives the hard floor area. */
  cladLength: Mm;
  /** Length of this step's underlay pad: the tread plus the nosing overlap, or the whole clad length when the risers are padded too. Zero where there is no pad. */
  padLength: Mm;
  /** Width the covering actually spans: the tread width, or the runner width. */
  coverWidth: Mm;
  /** Cut width incl. tuck / wrap allowances (runner: the runner width, no allowances). */
  pieceWidth: Mm;
  /** Cut length when the step is cut as an individual piece (cap and band, winder, bullnose). */
  pieceLength: Mm;
  /** Must be its own piece even in a waterfall (winders; bullnose / curtail when fully fitted). */
  individual: boolean;
  /** Unused portion of a custom tread's cut rectangle. Zero for unshaped and top treads. */
  outlineAreaDifference: number;
  notes: string[];
}

interface LandingGeo {
  landing: Landing;
  k: number;
  /** Step index the landing follows (-1 = at the foot of the flight). */
  slot: number;
  /** Sits at the head of the flight: after the last step, or declared kind 'top'. */
  isTop: boolean;
  length: Mm;
  width: Mm;
}

function emptyPlan(sid: Id, warnings: Warning[]): StairPlan {
  return {
    staircaseId: sid,
    stepCount: 0,
    pieces: [],
    netAreaMm2: 0,
    gripperLength: 0,
    bindingLength: 0,
    underlayAreaM2: 0,
    underlayPads: 0,
    stairRods: 0,
    nosings: 0,
    nosingLength: 0,
    perStep: [],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Plan one staircase for one product.
 *
 * Worked example — 13 risers, 860 mm wide, rise 200, going 223, nosing 20, closed strings, carpet,
 * cap and band, 10% gripper wastage:
 * - wrap per step = 200 + 223 + 20 = 443; top step = 200 + 20 = 220
 * - piece = (443 + 30 + 75) x (860 + 100) = 548 x 960 mm for steps 1–12; top step 325 x 960
 * - net area = 12 x 443 x 860 + 220 x 860 = 4 760 960 mm² (4.76 m²)
 * - gripper = ceil((12 steps x 2 + top riser x 1) x 860 x 1.10) = 23 650 mm (the top step has no
 *   tread of its own, so only its riser foot is gripped)
 * - underlay = 12 tread pads of (223 going + 50 nosing overlap) x 860 = 2.81736 m², 12 pads. With
 *   `underlayRisers` it is the whole flight instead: 12 x 423 x 860 + 200 x 860 = 4.53736 m².
 * As a waterfall the same flight is ONE piece 12 x 473 + 250 + 300 = 6 226 x 960 mm.
 * As a 600 mm runner (waterfall) it is 6 226 x 600 with 2 x 6 226 + 2 x 600 = 13 652 mm of binding
 * and gripper ceil((12 x 2 + 1) x 600 x 1.10) = 16 500 mm.
 * In laminate there are no pieces: 4.53736 m² of tread and riser clad, x1.15 = 5.217964 m² gross,
 * 13 nosings totalling 11 180 mm.
 */
export function planStaircase(input: StairPlanInput): StairPlan {
  const { staircase, product, options, underlay, accessories } = input;
  const sid = staircase.id;
  const name = staircase.name;
  const steps = staircase.steps ?? [];
  const n = steps.length;
  const warnings: Warning[] = [];

  if (n === 0) {
    warnings.push({ level: 'error', code: 'NO_STEPS', message: `${name}: no steps entered — nothing to plan.`, subjectId: sid });
    return emptyPlan(sid, warnings);
  }

  const isCarpet = product.kind === 'carpet';
  const isVinyl = product.kind === 'sheet_vinyl';
  const isPack = !isBroadloom(product.kind);
  const method = staircase.method;
  const nosingOverhang = nonNegative(staircase.nosingOverhang ?? DEFAULT_NOSING_OVERHANG);
  const padRisers = staircase.underlayRisers === true;
  const padNosingOverlap = PAD_NOSING_OVERLAP;
  const openCount = sideCount(staircase.openSides);
  const lengthAllowance = nonNegative(options.lengthAllowance);
  const widthAllowance = nonNegative(options.widthAllowance);

  // ---- runner ----------------------------------------------------------------------------------
  let runnerWidth: Mm | null = null;
  if (staircase.runner) {
    if (!isCarpet) {
      warnings.push({ level: 'info', code: 'RUNNER_NOT_APPLICABLE', message: `${name}: a runner only applies to carpet; the ${product.kind.replace(/_/g, ' ')} is planned fully fitted.`, subjectId: sid });
    } else {
      const requested = nonNegative(staircase.runner.width);
      runnerWidth = requested > 0 ? requested : RUNNER_DEFAULT_WIDTH;
      if (requested === 0) {
        warnings.push({ level: 'info', code: 'RUNNER_WIDTH_DEFAULTED', message: `${name}: runner width not given — ${fmtM(RUNNER_DEFAULT_WIDTH)} assumed.`, subjectId: sid });
      }
      const rw = runnerWidth;
      if (steps.some((s) => rw > nonNegative(s.width))) {
        warnings.push({ level: 'warning', code: 'RUNNER_WIDER_THAN_STAIR', message: `${name}: the ${fmtM(rw)} runner is wider than at least one tread; check the widths.`, subjectId: sid });
      }
    }
  }
  const isRunner = runnerWidth !== null;
  const fullyFitted = !isRunner;

  // ---- landings ----------------------------------------------------------------------------------
  // A landing sits after step `afterStepIndex` (0-based). Out-of-range indices are clamped: below 0
  // is a landing at the foot of the flight, at/after the last step is the top landing.
  const landings: LandingGeo[] = (staircase.landings ?? []).map((l, k) => {
    const slot = l.afterStepIndex < 0 ? -1 : Math.min(Math.floor(l.afterStepIndex), n - 1);
    return { landing: l, k, slot, isTop: slot >= n - 1 || l.kind === 'top', length: nonNegative(l.length), width: nonNegative(l.width) };
  });

  // ---- top riser by landing ------------------------------------------------------------------------
  // Only a landing at the head of the flight can run over the top nosing and down the top riser.
  let topRiserByLanding = false;
  // Only ONE landing can run over the top nosing: the stair carpet stops one riser short once, so
  // if two landings both sat at the head the riser would be paid for twice. The last one wins.
  const riserLanding = staircase.topRiserByLanding === true ? landings.filter((l) => l.isTop).at(-1) : undefined;
  if (staircase.topRiserByLanding === true) {
    if (riserLanding) {
      topRiserByLanding = true;
      const atHead = landings.filter((l) => l.isTop);
      if (atHead.length > 1) {
        warnings.push({
          level: 'warning',
          code: 'MULTIPLE_TOP_LANDINGS',
          message: `${name}: ${atHead.length} landings sit at the head of the flight — only the ${landingLabel(riserLanding.landing.kind).toLowerCase()} carries the top riser; move the others to the step they follow.`,
          subjectId: sid,
        });
      }
    } else {
      warnings.push({
        level: 'info',
        code: 'TOP_RISER_BY_LANDING',
        message: `${name}: "top riser by landing" is set but there is no top landing to take it — the top riser stays with the stair carpet.`,
        subjectId: sid,
      });
    }
  }

  // ---- per-step geometry -----------------------------------------------------------------------
  const invalid: string[] = [];
  const assumedProjection: string[] = [];
  const invalidOutlines: string[] = [];
  const geos: StepGeo[] = steps.map((step, index) => {
    const isTop = index === n - 1;
    const rise = nonNegative(step.rise);
    const going = nonNegative(step.going);
    const width = nonNegative(step.width);
    if (rise === 0 || width === 0 || (going === 0 && !isTop)) invalid.push(`step ${index + 1}`);
    const wrapLength = stepWrapLength({ rise, going }, nosingOverhang, isTop);
    const cladLength = rise + (isTop ? 0 : going);
    // Pads go on the treads, wrapped over the nose; the top step has no tread (it is the landing).
    const padLength = padRisers ? cladLength : isTop ? 0 : going + padNosingOverlap;
    const onStairs = !(isTop && topRiserByLanding);
    const notes: string[] = [];
    const bullnose = fullyFitted ? bullnoseWrapExtra(step) : { extra: 0, sides: 0, projection: 0, assumed: false };
    if (bullnose.assumed) assumedProjection.push(`step ${index + 1} (${step.kind}: ${bullnose.projection} mm assumed)`);
    const coverWidth = runnerWidth ?? width;
    const pieceWidth = runnerWidth ?? roundTo(width + STEP_WIDTH_ALLOWANCE + openCount * OPEN_SIDE_WRAP + bullnose.extra, 0);
    const pieceLength = roundTo(wrapLength + STEP_LENGTH_ALLOWANCE + (method === 'cap_and_band' ? CAP_AND_BAND_EXTRA : 0), 0);
    const individual = step.kind === 'winder' || (fullyFitted && (step.kind === 'bullnose' || step.kind === 'curtail'));
    const customOutline = step.outline && validStepOutline(step.outline) ? step.outline : undefined;
    if (step.outline && !customOutline) invalidOutlines.push(`step ${index + 1}`);
    const outlineArea = customOutline ? Math.min(going * width, polygonAreaMm2(customOutline.points) * going * width) : going * width;
    const outlineAreaDifference = isTop ? 0 : going * width - outlineArea;

    notes.push(
      isTop
        ? `top step: wrap ${wrapLength} = rise ${rise} + nosing ${nosingOverhang} (the tread is the landing)`
        : `wrap ${wrapLength} = rise ${rise} + going ${going} + nosing ${nosingOverhang}`,
    );
    if (customOutline) {
      notes.push(`custom tread: ${roundTo(outlineArea, 0)} mm² footprint; cut from the ${going} x ${width} mm bounding rectangle`);
    } else if (step.kind === 'winder') {
      const narrow = nonNegative(step.goingNarrow);
      notes.push(`winder: kite cut from the bounding rectangle, going ${going} mm at the wide end${narrow > 0 ? `, ${narrow} mm at the narrow end` : ''}`);
    }
    if (bullnose.sides > 0) {
      notes.push(`${step.kind}: +${bullnose.extra} mm width to wrap ${bullnose.sides === 2 ? 'both curved ends' : 'the curved end'} (${bullnose.sides} x (${BULLNOSE_WRAP_FACTOR} x ${bullnose.projection} + ${BULLNOSE_WRAP_TUCK}))`);
    }
    if (fullyFitted && openCount > 0 && !isPack) {
      notes.push(`open ${staircase.openSides === 'both' ? 'strings' : `${staircase.openSides} string`}: +${OPEN_SIDE_WRAP} mm width per side, ${openCount} x ${wrapLength} mm edge bound`);
    }
    return { step, index, kind: step.kind, isTop, onStairs, rise, going, width, wrapLength, cladLength, padLength, coverWidth, pieceWidth, pieceLength, individual, outlineAreaDifference, notes };
  });

  if (invalid.length > 0) {
    warnings.push({ level: 'error', code: 'INVALID_STEP', message: `${name}: ${invalid.join(', ')} ${invalid.length === 1 ? 'has' : 'have'} a zero or missing rise, going or width — quantities for ${invalid.length === 1 ? 'it' : 'them'} are unreliable.`, subjectId: sid });
  }
  if (assumedProjection.length > 0) {
    warnings.push({ level: 'warning', code: 'BULLNOSE_PROJECTION_ASSUMED', message: `${name}: bullnose projection not measured for ${assumedProjection.join(', ')}; measure how far the curved end projects beyond the string.`, subjectId: sid });
  }
  for (const landing of landings) if (landing.landing.outline && !validStairOutlinePoints(landing.landing.outline)) invalidOutlines.push(`${landingLabel(landing.landing.kind).toLowerCase()} ${landing.k + 1}`);
  if (invalidOutlines.length) warnings.push({ level: 'warning', code: 'INVALID_STAIR_OUTLINE', message: `${name}: ${invalidOutlines.join(', ')} ${invalidOutlines.length === 1 ? 'has an invalid custom shape' : 'have invalid custom shapes'}; the measured bounding rectangles were used for quantities. Check the outlines.`, subjectId: sid });

  // ---- building regulations sanity check (info only — old houses are often outside) -------------
  const regsIssues: string[] = [];
  for (const g of geos) {
    const reasons: string[] = [];
    if (g.rise > 0 && (g.rise < STAIR_REGS.minRise || g.rise > STAIR_REGS.maxRise)) reasons.push(`rise ${g.rise} mm`);
    // A custom footprint's going is its cut bound, not a surveyed walking-line going.
    if (g.kind !== 'winder' && !g.step.outline && g.going > 0) {
      if (g.going < STAIR_REGS.minGoing || g.going > STAIR_REGS.maxGoing) reasons.push(`going ${g.going} mm`);
      const pitchDeg = (Math.atan2(g.rise, g.going) * 180) / Math.PI;
      if (pitchDeg > STAIR_REGS.maxPitchDeg + 1e-9) reasons.push(`pitch ${pitchDeg.toFixed(1)}°`);
    }
    if (reasons.length > 0) regsIssues.push(`step ${g.index + 1}: ${reasons.join(', ')}`);
  }
  if (regsIssues.length > 0) {
    warnings.push({
      level: 'info',
      code: 'STAIR_OUTSIDE_REGS',
      message: `${name}: outside Approved Document K limits for a private stair (rise ${STAIR_REGS.minRise}–${STAIR_REGS.maxRise} mm, going ${STAIR_REGS.minGoing}–${STAIR_REGS.maxGoing} mm, pitch ≤ ${STAIR_REGS.maxPitchDeg}°): ${regsIssues.join('; ')}. Common in older houses — double-check the measurements.`,
      subjectId: sid,
    });
  }

  // ---- quantities (independent of how the pieces are cut) ---------------------------------------
  const topGeo = geos[n - 1]!;
  let netAreaMm2 = 0;
  let padAreaMm2 = 0;
  let gripperRaw = 0;
  let padCount = 0;
  let openEdge = 0;
  let hardAreaMm2 = 0;
  let nosingLength = 0;
  let stairStepCount = 0; // steps carpeted from the stairs (pads, rods)
  for (const g of geos) {
    // the top riser is still carpeted, padded and bound when the landing takes it — it just moves to the landing below
    // Fully fitted custom treads use their surveyed footprint for net area. The cut and riser
    // remain conservative rectangles. A runner has no surveyed strip path, so retains its
    // full width × going allowance rather than taking a proportional share of a shaped tread.
    const unusedTread = isRunner ? 0 : g.outlineAreaDifference;
    netAreaMm2 += g.wrapLength * g.coverWidth - unusedTread;
    // Underlay is bought/cut as rectangular pads, including the existing nosing overlap.
    padAreaMm2 += g.padLength * g.coverWidth;
    if (g.onStairs && g.padLength > 0) padCount += 1;
    openEdge += openCount * g.wrapLength;
    hardAreaMm2 += g.cladLength * g.width - g.outlineAreaDifference;
    nosingLength += g.width;
    if (g.onStairs) {
      stairStepCount += 1;
      // one length on the tread (back) and one on the riser (bottom); a winder's long back edge takes
      // one more. The TOP step has no tread of its own (it is the landing), so only its riser foot.
      const lengthsHere = g.isTop ? 1 : GRIPPER_PER_STEP + (g.kind === 'winder' ? 1 : 0);
      gripperRaw += lengthsHere * g.coverWidth;
    } else {
      // landing carpet runs over the nosing: only the riser foot needs gripper
      gripperRaw += g.coverWidth;
    }
  }
  for (const l of landings) {
    const cw = runnerWidth ?? l.width;
    const outline = l.landing.outline;
    const footprintArea = outline && validStairOutlinePoints(outline) ? Math.min(l.length * l.width, polygonAreaMm2(outline) * l.length * l.width) : l.length * l.width;
    const coveredArea = isRunner ? l.length * cw : footprintArea;
    netAreaMm2 += coveredArea;
    padAreaMm2 += l.length * cw;
    // fully fitted: perimeter minus the edge where the flight arrives (gripper on the other three sides);
    // runner: the strip is fixed across at each end, like a step
    gripperRaw += isRunner ? GRIPPER_PER_STEP * cw : 2 * l.length + cw;
    hardAreaMm2 += footprintArea;
  }

  // ---- pieces (broadloom only) ------------------------------------------------------------------
  const pieces: CutPiece[] = [];
  const perStep: StairPlanStep[] = geos.map((g) => ({ stepId: g.step.id, kind: g.kind, wrapLength: g.wrapLength, notes: g.notes.join('; ') }));
  const splitReasons: string[] = [];
  const runnerLabel = isRunner ? 'Runner' : 'Waterfall';
  let stairPieceCount = 0;

  if (!isPack) {
    let runNo = 0;
    let run: StepGeo[] = [];
    const flushRun = () => {
      if (run.length === 0) return;
      runNo += 1;
      stairPieceCount += 1;
      const first = run[0]!;
      const last = run[run.length - 1]!;
      // Σ (wrap + tuck per step) + one end allowance for the run's top and bottom tuck-ins
      const length = roundTo(run.reduce((s, g) => s + g.wrapLength + STEP_LENGTH_ALLOWANCE, 0) + RUNNER_END_ALLOWANCE, 0);
      const width = Math.max(...run.map((g) => g.pieceWidth));
      const id = `${sid}:r${runNo}`;
      const label = run.length === 1 ? `${runnerLabel} run ${runNo} (step ${first.index + 1})` : `${runnerLabel} run ${runNo} (steps ${first.index + 1}–${last.index + 1})`;
      pieces.push({ id, ownerId: sid, ownerName: name, label, length, width, role: isRunner ? 'stair_runner' : 'stair_step' });
      for (const g of run) {
        const entry = perStep[g.index]!;
        entry.pieceLength = length;
        entry.pieceWidth = width;
        entry.notes = [...g.notes, `part of ${label.toLowerCase()}: piece ${id}, ${length} x ${width} mm`].join('; ');
      }
      run = [];
    };
    const emitSingle = (g: StepGeo, why: string) => {
      stairPieceCount += 1;
      const id = `${sid}:s${g.index + 1}`;
      const kindTag = g.kind === 'straight' ? '' : ` (${g.kind})`;
      const label = `${isRunner ? 'Runner step' : 'Step'} ${g.index + 1}${kindTag}`;
      const role: CutPiece['role'] = g.kind === 'winder' ? 'winder' : isRunner ? 'stair_runner' : 'stair_step';
      pieces.push({ id, ownerId: sid, ownerName: name, label, length: g.pieceLength, width: g.pieceWidth, role });
      const entry = perStep[g.index]!;
      entry.pieceLength = g.pieceLength;
      entry.pieceWidth = g.pieceWidth;
      entry.notes = [...g.notes, `${why}: piece ${id}, ${g.pieceLength} x ${g.pieceWidth} mm`].join('; ');
    };
    const emitLanding = (l: LandingGeo) => {
      const id = `${sid}:l${l.k + 1}`;
      const takesRiser = topRiserByLanding && l === riserLanding;
      // runs over the top nosing and down the top riser, then tucks at the riser foot
      const riserExtra = takesRiser ? topGeo.wrapLength + STEP_LENGTH_ALLOWANCE : 0;
      const length = roundTo(l.length + lengthAllowance + riserExtra, 0);
      const width = runnerWidth ?? roundTo(l.width + widthAllowance, 0);
      const label = `${landingLabel(l.landing.kind)}${isRunner ? ' (runner)' : ''}${takesRiser ? ' incl. top riser' : ''}`;
      pieces.push({ id, ownerId: sid, ownerName: name, label, length, width, role: 'landing' });
      if (takesRiser) {
        const entry = perStep[topGeo.index]!;
        entry.notes = [...topGeo.notes, `top riser carpeted by the landing: piece ${id}, +${riserExtra} mm on its length`].join('; ');
      }
    };

    for (const l of landings) if (l.slot < 0) emitLanding(l);
    for (const g of geos) {
      if (!g.onStairs) {
        flushRun(); // the stair carpet stops at the riser below
      } else if (method === 'cap_and_band') {
        emitSingle(g, g.kind === 'winder' ? 'individual winder piece' : 'cap and band piece');
      } else if (g.individual) {
        flushRun();
        emitSingle(g, `${g.kind} step cut individually`);
        splitReasons.push(`${g.kind} step ${g.index + 1}`);
      } else {
        run.push(g);
      }
      const here = landings.filter((l) => l.slot === g.index);
      if (here.length > 0) {
        if (method === 'waterfall' && g.index < n - 1) {
          for (const l of here) splitReasons.push(`${landingLabel(l.landing.kind).toLowerCase()} after step ${g.index + 1}`);
        }
        flushRun();
        for (const l of here) emitLanding(l);
      }
    }
    flushRun();

    if (method === 'waterfall' && splitReasons.length > 0) {
      warnings.push({
        level: 'info',
        code: 'WATERFALL_SPLIT',
        message: `${name}: the waterfall cannot run the whole flight in one piece — cut as ${stairPieceCount} piece${stairPieceCount === 1 ? '' : 's'} (${splitReasons.join(', ')}).`,
        subjectId: sid,
      });
    }
  }

  // ---- totals by product type -------------------------------------------------------------------
  let gripperLength = 0;
  let bindingLength = 0;
  let underlayAreaM2 = 0;
  let underlayPads = 0;
  let stairRods = 0;
  let nosings = 0;
  let hardFloorAreaM2: M2 | undefined;
  let hardFloorGrossAreaM2: M2 | undefined;
  let hardFloorPacks: number | undefined;

  if (isCarpet) {
    gripperLength = ceilMm(gripperRaw * (1 + nonNegative(accessories.gripperWastage)));
    if (isRunner) {
      // both long edges of every runner piece are bound, plus the two visible ends of the runner
      bindingLength = 2 * pieces.reduce((s, p) => s + p.length, 0) + 2 * (runnerWidth ?? 0);
      stairRods = staircase.runner?.stairRods ? stairStepCount : 0;
    } else {
      bindingLength = openEdge;
      if (openCount > 0) {
        warnings.push({
          level: 'info',
          code: 'OPEN_STRING_BINDING',
          message: `${name}: ${staircase.openSides === 'both' ? 'both strings are' : `the ${staircase.openSides} string is`} open — the carpet wraps ${OPEN_SIDE_WRAP} mm over the exposed edge of every step and the edge is bound/whipped (${fmtM(bindingLength)} of binding).`,
          subjectId: sid,
        });
      }
    }
    if (underlay.fit) {
      underlayAreaM2 = mm2ToM2(padAreaMm2);
      underlayPads = padCount;
      if (underlay.thickness > MAX_UNDERLAY_THICKNESS_ON_STAIRS) {
        warnings.push({
          level: 'warning',
          code: 'UNDERLAY_TOO_THICK_FOR_STAIRS',
          message: `${name}: ${underlay.thickness} mm underlay is thicker than the ${MAX_UNDERLAY_THICKNESS_ON_STAIRS} mm recommended on stairs — it wears at the nosings and will not tuck under the gripper; use a firmer, thinner stair underlay.`,
          subjectId: sid,
        });
      }
    }
  } else if (isVinyl) {
    // sheet vinyl on stairs is glued (no gripper or underlay) and every step needs a nosing profile
    nosings = n;
    warnings.push({
      level: 'info',
      code: 'VINYL_STAIRS_NOSINGS',
      message: `${name}: sheet vinyl on stairs is fully bonded with a stair nosing on every step (${n} nosings, ${fmtM(nosingLength)}); no gripper or underlay allowed.`,
      subjectId: sid,
    });
  } else {
    nosings = n;
    hardFloorAreaM2 = mm2ToM2(hardAreaMm2);
    const productWaste = 'packCoverageM2' in product ? product.hardFloor?.wastage : undefined;
    const stairWaste = productWaste !== undefined && Number.isFinite(productWaste) && productWaste >= 0 ? productWaste : STAIR_HARD_FLOOR_WASTAGE;
    hardFloorGrossAreaM2 = hardFloorAreaM2 * (1 + stairWaste);
    const coverage = 'packCoverageM2' in product ? nonNegative(product.packCoverageM2) : 0;
    if (coverage > 0) hardFloorPacks = ceilToStep(hardFloorGrossAreaM2 / coverage, 1);
    for (const g of geos) {
      const entry = perStep[g.index]!;
      entry.notes = [...g.notes, `${g.isTop ? `riser ${g.rise} mm` : `tread ${g.going} + riser ${g.rise} mm`} clad (${roundTo(g.cladLength * g.width - g.outlineAreaDifference, 0)} mm²); ${g.width} mm stair nosing`].join('; ');
    }
    warnings.push({
      level: 'info',
      code: 'HARD_FLOOR_STAIRS_SPECIALIST',
      message: `${name}: ${product.kind.replace(/_/g, ' ')} on stairs is specialist work — each tread and riser is cut individually with a stair nosing on every step (${n} nosings, ${fmtM(nosingLength)}); ${(stairWaste * 100).toFixed(0)}% cutting waste allowed${productWaste !== undefined ? ' from product settings' : ''}.`,
      subjectId: sid,
    });
  }

  return {
    staircaseId: sid,
    stepCount: n,
    pieces,
    netAreaMm2,
    gripperLength,
    bindingLength,
    underlayAreaM2,
    underlayPads,
    stairRods,
    nosings,
    nosingLength: nosings > 0 ? nosingLength : 0,
    ...(hardFloorAreaM2 !== undefined ? { hardFloorAreaM2, hardFloorGrossAreaM2, hardFloorPacks } : {}),
    perStep,
    warnings,
  };
}
