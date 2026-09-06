/**
 * Staircase planner: turns a measured staircase into the cut pieces, net area, gripper, binding,
 * underlay pads, stair rods and nosings a fitter needs — for broadloom carpet (fully fitted or a
 * runner), sheet vinyl, or a pack-sold hard floor (laminate / LVT / wood / carpet tiles).
 *
 * Trade model (UK domestic stairs)
 * - Steps are listed from the BOTTOM up. Each step is one riser plus the tread ABOVE it. The top
 *   step's "tread" is the landing floor, but its going still counts because the carpet wraps over
 *   the landing nosing and down the top riser.
 * - The carpet on a step runs UP the riser, OVER the nosing and BACK along the tread ("wrap"):
 *   wrapLength = rise + going + nosingOverhang. The pile runs DOWN the flight, so every piece is
 *   cut with its LENGTH along the roll (rise + going direction) and its WIDTH across the stair.
 * - 'cap_and_band': one piece per step, length = wrapLength + STEP_LENGTH_ALLOWANCE (tuck under the
 *   nosing and into the crotch), width = tread width + STEP_WIDTH_ALLOWANCE (tuck against the strings)
 *   + OPEN_SIDE_WRAP per open string + a bullnose wrap per curved end.
 * - 'waterfall': one continuous piece down each straight run, length = Σ wrapLength +
 *   RUNNER_END_ALLOWANCE. Winders, bullnose/curtail steps and landings break the flight into runs.
 * - A runner is a strip of fixed width bound on both edges, held with stair rods if wanted.
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
import {
  DEFAULT_NOSING_OVERHANG,
  STEP_LENGTH_ALLOWANCE,
  STEP_WIDTH_ALLOWANCE,
  OPEN_SIDE_WRAP,
  BULLNOSE_WRAP_FACTOR,
  BULLNOSE_WRAP_TUCK,
  RUNNER_END_ALLOWANCE,
  RUNNER_DEFAULT_WIDTH,
  GRIPPER_PER_STEP,
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

/** Projection assumed for a bullnose step whose projection was not measured (typical UK: ~100 mm beyond the string). */
export const DEFAULT_BULLNOSE_PROJECTION: Mm = 100;

/** Projection assumed for a curtail step whose projection was not measured (a curtail sweeps further, ~200 mm). */
export const DEFAULT_CURTAIL_PROJECTION: Mm = 200;

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
  /** rise + going + nosing overhang: the carpet path over one step (mm). */
  wrapLength: Mm;
  /** Cut length (along the roll) of the piece this step is cut from — the whole run for a waterfall step. */
  pieceLength?: Mm;
  /** Cut width (across the roll) of the piece this step is cut from. */
  pieceWidth?: Mm;
  notes: string;
}

export interface StairPlan {
  staircaseId: Id;
  stepCount: number;
  /**
   * Broadloom only. Every piece has a fixed orientation: `length` runs along the roll (pile runs
   * DOWN the stairs, i.e. along rise + going), `width` runs across the stair.
   * Roles: 'stair_step' (fully fitted step / waterfall run), 'stair_runner' (runner strip),
   * 'winder' (kite cut from a rectangle), 'landing'.
   */
  pieces: CutPiece[];
  /** Carpet / vinyl actually on treads + risers + landings (mm²), for waste reporting. */
  netAreaMm2: number;
  /** Gripper to fit, incl. `accessories.gripperWastage` (mm). Zero for vinyl and hard floors. */
  gripperLength: Mm;
  /** Linear mm of carpet edge to bind / whip: open-string wraps, or both runner edges plus its two ends. */
  bindingLength: Mm;
  underlayAreaM2: M2;
  /** One underlay pad per step (landings are cut from the roll, not pads). */
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
// Internal helpers
// ---------------------------------------------------------------------------

type Sides = 'none' | 'left' | 'right' | 'both';

/** Number of sides named by a side selector: none 0, left/right 1, both 2. */
export function sideCount(sides: Sides): number {
  return sides === 'both' ? 2 : sides === 'none' ? 0 : 1;
}

/** A sanitised step with the derived dimensions the planner needs. */
interface StepGeo {
  step: Step;
  index: number;
  kind: StepKind;
  rise: Mm;
  going: Mm;
  width: Mm;
  wrapLength: Mm;
  /** Width the covering actually spans: the tread width, or the runner width. */
  coverWidth: Mm;
  /** Cut width incl. tuck / wrap allowances (runner: the runner width, no allowances). */
  pieceWidth: Mm;
  /** Cut length when the step is cut as an individual piece. */
  pieceLength: Mm;
  /** Must be its own piece even in a waterfall (winders; bullnose / curtail when fully fitted). */
  individual: boolean;
  notes: string[];
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
 * overhang) and along the tread.
 *
 * Example: rise 190 + going 240 + nosing overhang 20 = 450 mm.
 * A winder's `going` is its maximum going (wide end), so the kite is cut from the longest path.
 */
export function stepWrapLength(step: Pick<Step, 'rise' | 'going'>, nosingOverhang: Mm): Mm {
  return nonNegative(step.rise) + nonNegative(step.going) + nonNegative(nosingOverhang);
}

/**
 * Extra cut width to wrap a bullnose / curtail end: the carpet follows the curved end round and is
 * tucked under, ≈ BULLNOSE_WRAP_FACTOR x projection + BULLNOSE_WRAP_TUCK per curved side.
 *
 * Example: bullnose projecting 150 mm on the right: 1.6 x 150 + 50 = 290 mm extra width.
 * A curtail step always curves on both sides: projection 200 -> 2 x (1.6 x 200 + 50) = 740 mm.
 * A bullnose with no side given is assumed to curve on ONE side (the usual balustrade side).
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

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Plan one staircase for one product.
 *
 * Worked example — 13 risers, 860 mm wide, rise 190, going 240, closed strings, carpet, cap and band:
 * - wrap per step = 190 + 240 + 20 = 450; piece = (450 + 50) x (860 + 50) = 500 x 910 mm, x13
 * - net area = 13 x 450 x 860 = 5 031 000 mm² (5.03 m²)
 * - gripper = 13 steps x 2 lengths x 860 mm x 1.05 wastage = 23 478 mm
 * - underlay = 13 pads of (190 + 240) x 860 = 4.8074 m²
 * As a waterfall the same flight is ONE piece 13 x 450 + 300 = 6150 x 910 mm.
 * As a 600 mm runner (waterfall) it is 6150 x 600 with 2 x 6150 + 2 x 600 = 13 500 mm of binding.
 * In laminate there are no pieces: 13 x 430 x 860 = 4.8074 m² net, x1.15 = 5.5285 m² gross, 13 nosings
 * totalling 11 180 mm.
 */
export function planStaircase(input: StairPlanInput): StairPlan {
  const { staircase, product, options, underlay, accessories } = input;
  const sid = staircase.id;
  const name = staircase.name;
  const steps = staircase.steps;
  const n = steps.length;
  const warnings: Warning[] = [];

  if (n === 0) {
    warnings.push({ level: 'error', code: 'NO_STEPS', message: `${name}: no steps entered — nothing to plan.`, subjectId: sid });
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

  const isCarpet = product.kind === 'carpet';
  const isVinyl = product.kind === 'sheet_vinyl';
  const isPack = !isBroadloom(product.kind);
  const nosingOverhang = nonNegative(staircase.nosingOverhang ?? DEFAULT_NOSING_OVERHANG);
  const openCount = sideCount(staircase.openSides);

  // ---- runner ----------------------------------------------------------------------------------
  let runnerWidth: Mm | null = null;
  if (staircase.runner) {
    if (!isCarpet) {
      warnings.push({ level: 'info', code: 'RUNNER_NOT_APPLICABLE', message: `${name}: a runner only applies to carpet; the ${product.kind.replace('_', ' ')} is planned fully fitted.`, subjectId: sid });
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

  // ---- per-step geometry -----------------------------------------------------------------------
  const invalid: string[] = [];
  const assumedProjection: string[] = [];
  const geos: StepGeo[] = steps.map((step, index) => {
    const rise = nonNegative(step.rise);
    const going = nonNegative(step.going);
    const width = nonNegative(step.width);
    if (rise === 0 || going === 0 || width === 0) invalid.push(`step ${index + 1}`);
    const wrapLength = stepWrapLength({ rise, going }, nosingOverhang);
    const notes: string[] = [];
    const fullyFitted = runnerWidth === null;
    const bullnose = fullyFitted ? bullnoseWrapExtra(step) : { extra: 0, sides: 0, projection: 0, assumed: false };
    if (bullnose.assumed && (step.kind === 'bullnose' || step.kind === 'curtail')) assumedProjection.push(`step ${index + 1} (${step.kind}: ${bullnose.projection} mm assumed)`);
    const coverWidth = runnerWidth ?? width;
    const pieceWidth = runnerWidth ?? roundTo(width + STEP_WIDTH_ALLOWANCE + openCount * OPEN_SIDE_WRAP + bullnose.extra, 0);
    const pieceLength = roundTo(wrapLength + STEP_LENGTH_ALLOWANCE, 0);
    const individual = step.kind === 'winder' || (fullyFitted && (step.kind === 'bullnose' || step.kind === 'curtail'));

    notes.push(`wrap ${wrapLength} = rise ${rise} + going ${going} + nosing ${nosingOverhang}`);
    if (step.kind === 'winder') {
      const narrow = nonNegative(step.goingNarrow);
      notes.push(`winder: kite cut from the bounding rectangle, going ${going} mm at the wide end${narrow > 0 ? `, ${narrow} mm at the narrow end` : ''}`);
    }
    if (bullnose.sides > 0) {
      notes.push(`${step.kind}: +${bullnose.extra} mm width to wrap ${bullnose.sides === 2 ? 'both curved ends' : 'the curved end'} (${bullnose.sides} x (${BULLNOSE_WRAP_FACTOR} x ${bullnose.projection} + ${BULLNOSE_WRAP_TUCK}))`);
    }
    if (fullyFitted && openCount > 0 && !isPack) {
      notes.push(`open ${staircase.openSides === 'both' ? 'strings' : `${staircase.openSides} string`}: +${OPEN_SIDE_WRAP} mm width per side, ${openCount} x ${wrapLength} mm edge bound`);
    }
    return { step, index, kind: step.kind, rise, going, width, wrapLength, coverWidth, pieceWidth, pieceLength, individual, notes };
  });

  if (invalid.length > 0) {
    warnings.push({ level: 'error', code: 'INVALID_STEP', message: `${name}: ${invalid.join(', ')} ${invalid.length === 1 ? 'has' : 'have'} a zero or missing rise, going or width — quantities for ${invalid.length === 1 ? 'it' : 'them'} are unreliable.`, subjectId: sid });
  }
  if (assumedProjection.length > 0) {
    warnings.push({ level: 'warning', code: 'BULLNOSE_PROJECTION_ASSUMED', message: `${name}: bullnose projection not measured for ${assumedProjection.join(', ')}; measure how far the curved end projects beyond the string.`, subjectId: sid });
  }

  // ---- building regulations sanity check (info only — old houses are often outside) -------------
  const regsIssues: string[] = [];
  for (const g of geos) {
    const reasons: string[] = [];
    if (g.rise > 0 && (g.rise < STAIR_REGS.minRise || g.rise > STAIR_REGS.maxRise)) reasons.push(`rise ${g.rise} mm`);
    if (g.kind !== 'winder' && g.going > 0) {
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

  // ---- landings ----------------------------------------------------------------------------------
  // A landing sits after step `afterStepIndex` (0-based). Out-of-range indices are clamped: below 0
  // is a landing at the foot of the flight, at/after the last step is the top landing.
  const landings = staircase.landings.map((l, k) => ({
    landing: l,
    k,
    slot: l.afterStepIndex < 0 ? -1 : Math.min(Math.floor(l.afterStepIndex), n - 1),
    length: nonNegative(l.length),
    width: nonNegative(l.width),
  }));

  // ---- quantities (independent of how the pieces are cut) ---------------------------------------
  let netAreaMm2 = 0;
  let padAreaMm2 = 0;
  let gripperRaw = 0;
  let openEdge = 0;
  let hardAreaMm2 = 0;
  let nosingLength = 0;
  for (const g of geos) {
    netAreaMm2 += g.wrapLength * g.coverWidth;
    padAreaMm2 += (g.rise + g.going) * g.coverWidth;
    // one length on the tread (back) and one on the riser (bottom); a winder's long back edge takes one more
    gripperRaw += (GRIPPER_PER_STEP + (g.kind === 'winder' ? 1 : 0)) * g.coverWidth;
    openEdge += openCount * g.wrapLength;
    hardAreaMm2 += (g.rise + g.going) * g.width;
    nosingLength += g.width;
  }
  for (const l of landings) {
    const cw = runnerWidth ?? l.width;
    netAreaMm2 += l.length * cw;
    padAreaMm2 += l.length * cw;
    // perimeter minus the edge where the flight arrives (gripper on the other three sides)
    gripperRaw += 2 * l.length + cw;
    hardAreaMm2 += l.length * l.width;
  }

  // ---- pieces (broadloom only) ------------------------------------------------------------------
  const pieces: CutPiece[] = [];
  const perStep: StairPlanStep[] = geos.map((g) => ({ stepId: g.step.id, kind: g.kind, wrapLength: g.wrapLength, notes: g.notes.join('; ') }));
  const splitReasons: string[] = [];
  const isRunner = runnerWidth !== null;
  const runnerLabel = isRunner ? 'Runner' : 'Waterfall';

  if (!isPack) {
    let runNo = 0;
    let run: StepGeo[] = [];
    const emitPiece = (piece: CutPiece) => pieces.push(piece);
    const flushRun = () => {
      if (run.length === 0) return;
      runNo += 1;
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const length = roundTo(run.reduce((s, g) => s + g.wrapLength, 0) + RUNNER_END_ALLOWANCE, 0);
      const width = Math.max(...run.map((g) => g.pieceWidth));
      const id = `${sid}:r${runNo}`;
      const label = run.length === 1 ? `${runnerLabel} run ${runNo} (step ${first.index + 1})` : `${runnerLabel} run ${runNo} (steps ${first.index + 1}–${last.index + 1})`;
      emitPiece({ id, ownerId: sid, ownerName: name, label, length, width, role: isRunner ? 'stair_runner' : 'stair_step' });
      for (const g of run) {
        const entry = perStep[g.index]!;
        entry.pieceLength = length;
        entry.pieceWidth = width;
        entry.notes = [...g.notes, `part of ${label.toLowerCase()}: piece ${id}, ${length} x ${width} mm`].join('; ');
      }
      run = [];
    };
    const emitSingle = (g: StepGeo, why: string) => {
      const id = `${sid}:s${g.index + 1}`;
      const kindTag = g.kind === 'straight' ? '' : ` (${g.kind})`;
      const label = `${isRunner ? 'Runner step' : 'Step'} ${g.index + 1}${kindTag}`;
      const role: CutPiece['role'] = g.kind === 'winder' ? 'winder' : isRunner ? 'stair_runner' : 'stair_step';
      emitPiece({ id, ownerId: sid, ownerName: name, label, length: g.pieceLength, width: g.pieceWidth, role });
      const entry = perStep[g.index]!;
      entry.pieceLength = g.pieceLength;
      entry.pieceWidth = g.pieceWidth;
      entry.notes = [...g.notes, `${why}: piece ${id}, ${g.pieceLength} x ${g.pieceWidth} mm`].join('; ');
    };
    const emitLanding = (l: (typeof landings)[number]) => {
      const id = `${sid}:l${l.k + 1}`;
      const length = roundTo(l.length + nonNegative(options.lengthAllowance), 0);
      const width = runnerWidth ?? roundTo(l.width + nonNegative(options.widthAllowance), 0);
      emitPiece({ id, ownerId: sid, ownerName: name, label: `${landingLabel(l.landing.kind)}${isRunner ? ' (runner)' : ''}`, length, width, role: 'landing' });
    };

    for (const l of landings) if (l.slot < 0) emitLanding(l);
    for (const g of geos) {
      if (staircase.method === 'cap_and_band') {
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
        if (staircase.method === 'waterfall' && g.index < n - 1) {
          for (const l of here) splitReasons.push(`${landingLabel(l.landing.kind).toLowerCase()} after step ${g.index + 1}`);
        }
        flushRun();
        for (const l of here) emitLanding(l);
      }
    }
    flushRun();

    if (staircase.method === 'waterfall' && splitReasons.length > 0) {
      warnings.push({
        level: 'info',
        code: 'WATERFALL_SPLIT',
        message: `${name}: the waterfall cannot run the whole flight in one piece — split into ${runNo} run${runNo === 1 ? '' : 's'} by ${splitReasons.join(', ')}.`,
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
    gripperLength = roundTo(gripperRaw * (1 + nonNegative(accessories.gripperWastage)), 0);
    if (isRunner) {
      // both long edges of every runner piece are bound, plus the two visible ends of the runner
      bindingLength = 2 * pieces.reduce((s, p) => s + p.length, 0) + 2 * (runnerWidth ?? 0);
      stairRods = staircase.runner?.stairRods ? n : 0;
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
      underlayPads = n;
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
    hardFloorGrossAreaM2 = hardFloorAreaM2 * (1 + STAIR_HARD_FLOOR_WASTAGE);
    const coverage = 'packCoverageM2' in product ? nonNegative(product.packCoverageM2) : 0;
    if (coverage > 0) hardFloorPacks = ceilToStep(hardFloorGrossAreaM2 / coverage, 1);
    for (const g of geos) {
      const entry = perStep[g.index]!;
      entry.notes = [...g.notes, `tread ${g.going} + riser ${g.rise} mm clad (${(g.rise + g.going) * g.width} mm²); ${g.width} mm stair nosing`].join('; ');
    }
    warnings.push({
      level: 'info',
      code: 'HARD_FLOOR_STAIRS_SPECIALIST',
      message: `${name}: ${product.kind.replace(/_/g, ' ')} on stairs is specialist work — each tread and riser is cut individually with a stair nosing on every step (${n} nosings, ${fmtM(nosingLength)}); ${(STAIR_HARD_FLOOR_WASTAGE * 100).toFixed(0)}% cutting waste allowed.`,
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
