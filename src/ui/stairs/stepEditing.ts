import type { Point, Staircase, StairLayout, Step } from '@engine/types';
import { newId } from '@store/ids';
import { stairPlanGeometry } from './stairLayout';
import { measuredStepGeometry, outlinedStep } from './stepGeometry';
import { DEFAULT_STEP } from '@engine/defaults';
import { MAX_RISERS } from './stairLimits';
import { mergeTreads, splitTread, treadSides } from './treadBoundaries';
import { reshapeStairOutline } from './stairOutlineEditing';

const normalAngle = (angle: number) => ((angle + 540) % 360) - 180;

/** Includes rectangular custom outlines with redundant points along a straight edge. */
export function isStepRectangular(staircase: Staircase, id: string): boolean {
  const step = staircase.steps.find(item => item.id === id);
  if (!step) return false;
  if (!step.plan) return !step.outline && step.kind !== 'winder';
  const piece = measuredStepGeometry(step, step.plan);
  if (Math.abs(normalAngle(piece.endHeading - piece.heading)) > .001) return false;
  const angle = piece.heading * Math.PI / 180;
  const [a, b] = piece.entry.map(index => piece.points[index]!) as [Point, Point];
  const halfWidth = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const depth = (piece.end.x - piece.start.x) * Math.cos(angle) + (piece.end.y - piece.start.y) * Math.sin(angle);
  if (depth <= 0 || halfWidth <= 0) return false;
  return piece.points.every(point => {
    const x = point.x - piece.start.x, y = point.y - piece.start.y;
    const across = x * Math.sin(angle) - y * Math.cos(angle), along = x * Math.cos(angle) + y * Math.sin(angle);
    return Math.abs(across) <= halfWidth + .001 && along >= -.001 && along <= depth + .001
      && (Math.abs(Math.abs(across) - halfWidth) < .001 || Math.abs(along) < .001 || Math.abs(along - depth) < .001);
  });
}

/** Square one measured tread while its neighbours absorb the changed shared boundaries. */
export function makeStepRectangular(staircase: Staircase, id: string): Staircase {
  const current = editableSteps(staircase), index = current.steps.findIndex(step => step.id === id);
  const step = current.steps[index];
  if (!step) return staircase;
  if (isStepRectangular(current, id)) return step.kind === 'straight' ? staircase : { ...current, steps: current.steps.map(item => item.id === id ? { ...item, kind: 'straight', goingNarrow: undefined, bullnoseProjection: undefined, bullnoseSides: undefined } : item) };
  const piece = measuredStepGeometry(step, step.plan!), sides = treadSides(piece);
  // A pointed tread has one shared inner corner. It cannot become a rectangle by moving
  // that corner alone without changing the other treads meeting at the same point.
  if (!sides || sides.some(side => side.length < 2)) return staircase;
  const heading = piece.heading + normalAngle(piece.endHeading - piece.heading) / 2;
  const angle = heading * Math.PI / 180, forward = { x: Math.cos(angle), y: Math.sin(angle) }, across = { x: Math.sin(angle), y: -Math.cos(angle) };
  const project = (point: Point, axis: Point) => point.x * axis.x + point.y * axis.y;
  const min = Math.min(...piece.points.map(point => project(point, across))), max = Math.max(...piece.points.map(point => project(point, across)));
  const centre = (project(piece.start, forward) + project(piece.end, forward)) / 2;
  const dimensions = stairFlightDimensions(current, index);
  const rectangle = (going: number) => {
    const points = piece.points.slice();
    sides.forEach((side, sideIndex) => {
      const lengths = side.slice(1).map((point, at) => Math.hypot(point.x - side[at]!.x, point.y - side[at]!.y));
      const total = lengths.reduce((sum, length) => sum + length, 0);
      let distance = 0;
      side.forEach((point, at) => {
        if (at) distance += lengths[at - 1]!;
        const along = centre + (distance / total - .5) * going, cross = sideIndex ? max : min;
        points[piece.points.indexOf(point)] = { x: forward.x * along + across.x * cross, y: forward.y * along + across.y * cross };
      });
    });
    return reshapeStairOutline(current, id, points);
  };
  let result = rectangle(dimensions.going);
  if (result === current) {
    // A narrow well may not fit a full standard tread without crossing the next winder.
    // Keep a useful margin at its neighbours' narrow ends rather than making a sliver.
    let low = 0, high = dimensions.going;
    for (let iteration = 0; iteration < 14; iteration++) {
      const middle = (low + high) / 2;
      if (rectangle(middle) === current) high = middle; else low = middle;
    }
    if (low * .8 < 100) return staircase;
    result = rectangle(low * .8);
  }
  if (result === current) return staircase;
  return { ...result, steps: result.steps.map(item => item.id === id ? { ...item, kind: 'straight', goingNarrow: undefined, bullnoseProjection: undefined, bullnoseSides: undefined } : item) };
}

/** Whole-staircase kind edits preserve shared edges instead of dropping a turning angle. */
export function changeStepKind(staircase: Staircase, id: string, kind: Step['kind']): Staircase {
  const step = staircase.steps.find(step => step.id === id);
  if (!step || step.kind === kind) return staircase;
  if (kind === 'winder' && step.plan) {
    const index = staircase.steps.findIndex(item => item.id === id), before = staircase.steps[index - 1], after = staircase.steps[index + 1];
    const beforeTurn = before?.plan?.turn ?? 0, afterTurn = after?.plan?.turn ?? 0;
    if (before?.kind === 'winder' && after?.kind === 'winder' && Math.sign(beforeTurn) === Math.sign(afterTurn) && beforeTurn) {
      // A rectangle inside an existing turn borrows angle from its neighbours. Reflowing the
      // whole departure flight here would add a second turn to an already correct U.
      const piece = measuredStepGeometry(step, step.plan), sides = treadSides(piece);
      if (!sides || sides.some(side => side.length < 2)) return staircase;
      const angle = step.plan.heading * Math.PI / 180, forward = { x: Math.cos(angle), y: Math.sin(angle) }, across = { x: Math.sin(angle), y: -Math.cos(angle) };
      const project = (point: Point, axis: Point) => point.x * axis.x + point.y * axis.y;
      const centre = (project(piece.start, forward) + project(piece.end, forward)) / 2;
      const turn = Math.min(30, Math.abs(beforeTurn), Math.abs(afterTurn)), inner = Math.min(100, step.going * .7);
      const outer = inner + 2 * step.width * Math.tan(turn * Math.PI / 360);
      const innerSide = beforeTurn > 0 ? 0 : 1;
      const points = piece.points.slice();
      sides.forEach((side, sideIndex) => {
        const going = sideIndex === innerSide ? inner : outer;
        side.forEach((point, at) => {
          const cross = project(point, across), along = centre + (at / (side.length - 1) - .5) * going;
          points[piece.points.indexOf(point)] = { x: forward.x * along + across.x * cross, y: forward.y * along + across.y * cross };
        });
      });
      const result = reshapeStairOutline(staircase, id, points);
      if (result === staircase) return staircase;
      return { ...result, steps: result.steps.map(item => item.id === id ? { ...item, kind: 'winder', goingNarrow: item.going } : item) };
    }
  }
  if ((kind === 'straight' || kind === 'bullnose' || kind === 'curtail') && (step.plan || step.outline)) {
    const rectangle = makeStepRectangular(staircase, id);
    if (rectangle === staircase && step.kind === 'winder') return staircase;
    return { ...rectangle, steps: rectangle.steps.map(item => item.id === id ? { ...item, kind,
      ...((kind === 'bullnose' || kind === 'curtail') ? { bullnoseProjection: step.bullnoseProjection, bullnoseSides: kind === 'curtail' ? 'both' : step.bullnoseSides ?? 'right' } : {}) } : item) };
  }
  // Legacy schedules do not need individual plans until their first geometric edit.
  const next: Step = { id, kind, rise: step.rise, width: step.width, going: step.going,
    ...(kind === 'winder' ? { goingNarrow: step.goingNarrow ?? 100 } : {}),
    ...((kind === 'bullnose' || kind === 'curtail') ? { bullnoseProjection: step.bullnoseProjection, bullnoseSides: kind === 'curtail' ? 'both' : step.bullnoseSides ?? 'right' } : {}),
    ...(step.plan ? { plan: { ...step.plan, turn: kind === 'winder' ? step.plan.turn || (staircase.layout?.direction === 'left' ? 30 : -30) : 0 } } : {}) };
  return reconcileStepPlans(staircase, { ...staircase, steps: staircase.steps.map(item => item.id === id ? next : item) });
}

export type StepMeasurementPatch = Partial<Pick<Step, 'rise' | 'width' | 'going' | 'goingNarrow' | 'bullnoseProjection' | 'bullnoseSides'>>;
/** Resize a custom footprint atomically; shared edges remain the same edge in both treads. */
export function patchStepMeasurements(staircase: Staircase, id: string, patch: StepMeasurementPatch): Staircase {
  const step = staircase.steps.find(step => step.id === id);
  if (!step || Object.entries(patch).some(([key, value]) => key !== 'bullnoseSides' && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key === 'width' || key === 'going' || key === 'rise') && value <= 0))) return staircase;
  if (!step.outline || !step.plan || patch.width === undefined && patch.going === undefined) {
    return reconcileStepPlans(staircase, { ...staircase, steps: staircase.steps.map(item => item.id === id ? { ...item, ...patch } : item) });
  }
  const piece = measuredStepGeometry(step, step.plan), angle = step.plan.heading * Math.PI / 180;
  const widthRatio = (patch.width ?? step.width) / step.width, goingRatio = (patch.going ?? step.going) / step.going;
  const points = piece.points.map(point => {
    const x = point.x - step.plan!.x, y = point.y - step.plan!.y;
    const across = (x * Math.sin(angle) - y * Math.cos(angle)) * widthRatio;
    const along = (x * Math.cos(angle) + y * Math.sin(angle)) * goingRatio;
    return { x: step.plan!.x + Math.sin(angle) * across + Math.cos(angle) * along, y: step.plan!.y - Math.cos(angle) * across + Math.sin(angle) * along };
  });
  const result = reshapeStairOutline(staircase, id, points);
  if (result === staircase && (widthRatio !== 1 || goingRatio !== 1)) return staircase;
  return { ...result, steps: result.steps.map(item => item.id === id ? { ...item, ...patch } : item) };
}

/** A winder's cut bounding box is wider than its flight. Do not copy that box into new treads. */
export function stairFlightDimensions(staircase: Staircase, index: number): { width: number; going: number } {
  const selected = staircase.steps[index] ?? staircase.steps[0];
  if (!selected) return { width: DEFAULT_STEP.width, going: DEFAULT_STEP.going };
  const straight = staircase.steps.map((step, i) => ({ step, distance: Math.abs(index - i) }))
    .filter(({ step }) => step.kind === 'straight' && !step.outline).sort((a, b) => a.distance - b.distance)[0]?.step;
  if (straight) return { width: selected.kind === 'straight' && !selected.outline ? selected.width : straight.width, going: straight.going };
  const first = staircase.steps[0]!;
  const piece = stairPlanGeometry(staircase, { normalize: false }).pieces.find(piece => piece.id === first.id);
  const [a, b] = (piece?.entry ?? []).map(i => piece!.points[i]!);
  return { width: a && b ? Math.round(Math.hypot(b.x - a.x, b.y - a.y)) : first.width, going: DEFAULT_STEP.going };
}

export function editableSteps(staircase: Staircase): Staircase {
  if (staircase.steps.every(step => step.plan)) return staircase;
  const geometry = stairPlanGeometry(staircase, { normalize: false });
  return { ...staircase, drawing: undefined, steps: staircase.steps.map(step => {
    const piece = geometry.pieces.find(piece => piece.id === step.id)!;
    const start = piece.start ?? piece.points[0]!;
    const heading = piece.heading ?? 90;
    const turn = normalAngle((piece.endHeading ?? heading) - heading);
    const plan = { x: start.x, y: start.y,
      heading: step.kind === 'winder' ? heading : heading + turn / 2,
      turn: step.kind === 'winder' ? turn : 0 };
    const measured = measuredStepGeometry(step, plan);
    plan.turn = measured.endHeading - measured.heading;
    return { ...step, plan };
  }) };
}

/**
 * Keep the upper flight connected when measurements, landings or the step count change.
 * Each existing step keeps its manual offset and relative heading from the incoming flight.
 * Explicit placement edits (dragging, rotating or a group curve) already carry their own new
 * positions and pass through unchanged. New/reset presets without plans use normal layout.
 */
export function reconcileStepPlans(before: Staircase, after: Staircase): Staircase {
  if (!before.steps.some(step => step.plan) || !after.steps.some(step => step.plan)) return after;
  const previous = new Map(before.steps.map(step => [step.id, step]));
  const samePlan = (a: Step['plan'], b: Step['plan']) => a?.x === b?.x && a?.y === b?.y && a?.heading === b?.heading;
  // An existing step's coordinates changing is an intentional diagram edit, not a size edit.
  if (after.steps.some(step => previous.has(step.id) && !samePlan(previous.get(step.id)!.plan, step.plan))) return after;

  const oldPieces = new Map(stairPlanGeometry(before, { normalize: false }).pieces.map(piece => [piece.id, piece]));
  const plans = new Map<string, NonNullable<Step['plan']>>();
  stairPlanGeometry(after, { normalize: false, resolvePlan: (step, incoming, incomingHeading) => {
    const old = oldPieces.get(step.id);
    const oldStep = previous.get(step.id);
    let plan: NonNullable<Step['plan']>;
    if (old?.incoming && old.start && oldStep?.plan) {
      const change = (incomingHeading - old.incomingHeading!) * Math.PI / 180;
      const x = old.start.x - old.incoming.x, y = old.start.y - old.incoming.y;
      plan = { ...step.plan!, x: incoming.x + x * Math.cos(change) - y * Math.sin(change), y: incoming.y + x * Math.sin(change) + y * Math.cos(change), heading: oldStep.plan.heading + change * 180 / Math.PI };
    } else {
      // Appending a step uses the incoming surface, including any landing after the old last one.
      plan = { x: incoming.x, y: incoming.y, heading: incomingHeading, turn: step.plan?.turn ?? 0 };
    }
    const measured = measuredStepGeometry(step, plan);
    plan.turn = measured.endHeading - measured.heading;
    plans.set(step.id, plan);
    return plan;
  } });
  return { ...after, steps: after.steps.map(step => ({ ...step, plan: plans.get(step.id)! })) };
}

/** Translation only changes placement; measured dimensions and cut quantities remain intact. */
export function moveSteps(staircase: Staircase, ids: string[], delta: Point): Staircase {
  const current = editableSteps(staircase), selected = new Set(ids);
  return { ...current, steps: current.steps.map(step => selected.has(step.id) ? { ...step, plan: { ...step.plan!, x: Math.round(step.plan!.x + delta.x), y: Math.round(step.plan!.y + delta.y) } } : step) };
}

export function contiguousSelection(staircase: Staircase, ids: string[]): boolean {
  const indices = staircase.steps.flatMap((step, index) => ids.includes(step.id) ? [index] : []);
  return !!indices.length && indices.at(-1)! - indices[0]! + 1 === indices.length
    && !staircase.landings.some(landing => landing.afterStepIndex >= indices[0]! && landing.afterStepIndex < indices.at(-1)!);
}

/** Bend a consecutive run with true radial treads and continue the upper flight from its end. */
export function curveSteps(staircase: Staircase, ids: string[], sweep: number, innerRadius = 150, corner: 'round' | 'square' = 'round'): Staircase {
  if (!contiguousSelection(staircase, ids)) return staircase;
  const current = editableSteps(staircase);
  const indices = current.steps.flatMap((step, index) => ids.includes(step.id) ? [index] : []);
  const first = indices[0]!, last = indices.at(-1)!;
  const turn = Math.max(-170, Math.min(170, sweep / indices.length));
  let position = { x: current.steps[first]!.plan!.x, y: current.steps[first]!.plan!.y };
  let heading = current.steps[first]!.plan!.heading;
  const oldEnd = measuredStepGeometry(current.steps[last]!, current.steps[last]!.plan!);
  const widths = current.steps.map((step, index) => step.outline ? stairFlightDimensions(current, index).width : step.width);
  const squareWidth = Math.max(...widths.slice(first, last + 1));
  const startRadians = heading * Math.PI / 180;
  const turnSign = Math.sign(turn);
  const squareCentre = { x: position.x - Math.sin(startRadians) * turnSign * (innerRadius + squareWidth / 2), y: position.y + Math.cos(startRadians) * turnSign * (innerRadius + squareWidth / 2) };
  const squareStart = Math.atan2(position.y - squareCentre.y, position.x - squareCentre.x);
  const steps = current.steps.map((step, index): Step => {
    if (index < first || index > last) return step;
    const curved = Math.abs(turn) > .01;
    const radians = Math.abs(turn) * Math.PI / 180;
    const { outline: _outline, ...original } = step;
    const base = { ...original, width: widths[index]! };
    if (curved && corner === 'square') {
      const from = (index - first) * turn * Math.PI / 180, to = from + turn * Math.PI / 180;
      // Ray intersections with one common square make the outside corner a true right angle,
      // including a vertex where a tread crosses the square's diagonal.
      const offsets = [from, to];
      for (let k = -8; k <= 8; k++) {
        const diagonal = Math.PI / 4 + k * Math.PI / 2;
        if (diagonal > Math.min(from, to) + 1e-8 && diagonal < Math.max(from, to) - 1e-8) offsets.push(diagonal);
      }
      offsets.sort((a, b) => turn > 0 ? a - b : b - a);
      const radial = (radius: number, offset: number) => {
        const length = radius / Math.max(Math.abs(Math.cos(offset)), Math.abs(Math.sin(offset)));
        return { x: squareCentre.x + length * Math.cos(squareStart + offset), y: squareCentre.y + length * Math.sin(squareStart + offset) };
      };
      const inside = innerRadius === 0 ? [squareCentre] : offsets.map(offset => radial(innerRadius, offset));
      const points = [...inside, ...offsets.slice().reverse().map(offset => radial(innerRadius + squareWidth, offset))];
      const innerEnd = inside.length - 1, outerEnd = inside.length, outerStart = points.length - 1;
      const entry: [number, number] = turnSign > 0 ? [0, outerStart] : [outerStart, 0];
      const exit: [number, number] = turnSign > 0 ? [innerEnd, outerEnd] : [outerEnd, innerEnd];
      const next = outlinedStep({ ...base, kind: 'winder', plan: { ...position, heading, turn } }, points, entry, exit);
      const geometry = measuredStepGeometry(next, next.plan!);
      position = geometry.end; heading = geometry.endHeading;
      return next;
    }
    const next: Step = { ...base, kind: curved ? 'winder' : 'straight',
      // Preserve derived precision: rounding every tread's two arcs changes the total turn.
      ...(curved ? { going: (innerRadius + base.width) * radians, goingNarrow: innerRadius * radians } : { going: stairFlightDimensions(current, index).going }),
      plan: { ...position, heading, turn } };
    const geometry = measuredStepGeometry(next, next.plan!);
    next.plan!.turn = geometry.endHeading - geometry.heading;
    position = geometry.end; heading = geometry.endHeading;
    return next;
  });
  const rotation = (heading - oldEnd.endHeading) * Math.PI / 180;
  for (let index = last + 1; index < steps.length; index++) {
    const step = steps[index]!, plan = step.plan!;
    const x = plan.x - oldEnd.end.x, y = plan.y - oldEnd.end.y;
    steps[index] = { ...step, plan: { ...plan, x: position.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: position.y + x * Math.sin(rotation) + y * Math.cos(rotation), heading: plan.heading + rotation * 180 / Math.PI } };
  }
  return { ...current, steps };
}

type WinderRun = { first: number; last: number; sweep: number; radius: number; corner: 'round' | 'square'; width: number };
/** Recognise a connected, evenly divided turn; individually reshaped treads keep their measured outlines. */
function winderRun(staircase: Staircase, index: number): WinderRun | undefined {
  const step = staircase.steps[index];
  if (step?.kind !== 'winder' || !step.plan?.turn) return;
  const sign = Math.sign(step.plan.turn);
  const fits = (at: number) => staircase.steps[at]?.kind === 'winder' && Math.sign(staircase.steps[at]?.plan?.turn ?? 0) === sign;
  const landingAfter = (at: number) => staircase.landings.some(landing => landing.afterStepIndex === at);
  let first = index, last = index;
  while (first > 0 && fits(first - 1) && !landingAfter(first - 1)) first--;
  while (last + 1 < staircase.steps.length && fits(last + 1) && !landingAfter(last)) last++;
  if (last === first) return;
  const pieces = staircase.steps.slice(first, last + 1).map(step => measuredStepGeometry(step, step.plan!));
  const turns = pieces.map(piece => piece.endHeading - piece.heading);
  if (turns.some(turn => Math.abs(turn - turns[0]!) > 1)) return;
  if (pieces.some((piece, i) => i > 0 && Math.hypot(piece.start.x - pieces[i - 1]!.end.x, piece.start.y - pieces[i - 1]!.end.y) > 1)) return;
  const piece = pieces[0]!;
  const [a, b] = piece.entry.map(i => piece.points[i]!) as [Point, Point];
  const [c, d] = piece.exit.map(i => piece.points[i]!) as [Point, Point];
  const dx = b.x - a.x, dy = b.y - a.y, ex = d.x - c.x, ey = d.y - c.y;
  const cross = dx * ey - dy * ex;
  if (Math.abs(cross) < .01) return;
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / cross;
  const centre = { x: a.x + t * dx, y: a.y + t * dy };
  const radius = Math.min(...piece.points.map(point => Math.hypot(point.x - centre.x, point.y - centre.y)));
  const corner = staircase.steps[first]!.outline ? 'square' : 'round', width = Math.hypot(dx, dy);
  const axis = Math.atan2(piece.start.y - centre.y, piece.start.x - centre.x);
  // Equal angles alone do not make an unedited preset: retain surveyed notches and corner
  // changes instead of silently replacing them when adding a tread elsewhere in the turn.
  if (pieces.some(piece => piece.points.some(point => {
    const x = point.x - centre.x, y = point.y - centre.y;
    const boundary = corner === 'round' ? Math.hypot(x, y)
      : Math.max(Math.abs(x * Math.cos(axis) + y * Math.sin(axis)), Math.abs(-x * Math.sin(axis) + y * Math.cos(axis)));
    return Math.min(Math.abs(boundary - radius), Math.abs(boundary - radius - width)) > .1;
  }))) return;
  return { first, last, sweep: turns.reduce((a, b) => a + b, 0), radius, corner, width };
}

/** Redistribute an existing turn after changing its count, anchored to the same incoming flight. */
function resizeWinderRun(before: Staircase, after: Staircase, run: WinderRun, ids: string[]): Staircase {
  const start = before.steps[run.first]!.plan!;
  const oldLast = before.steps[run.last]!;
  const oldEnd = measuredStepGeometry(oldLast, oldLast.plan!);
  const firstId = ids[0]!;
  const prepared = { ...after, steps: after.steps.map(step => ids.includes(step.id)
    ? { ...step, width: run.width, outline: undefined, ...(step.id === firstId ? { plan: { ...start } } : {}) } : step) };
  const curved = curveSteps(prepared, ids, run.sweep, run.radius, run.corner);
  const lastIndex = curved.steps.findIndex(step => step.id === ids.at(-1));
  const endStep = curved.steps[lastIndex]!;
  const end = measuredStepGeometry(endStep, endStep.plan!);
  const angle = (end.endHeading - oldEnd.endHeading) * Math.PI / 180;
  const steps = curved.steps.map((step, index) => {
    if (index <= lastIndex) return step;
    const old = after.steps[index]!.plan!;
    const x = old.x - oldEnd.end.x, y = old.y - oldEnd.end.y;
    return { ...step, plan: { ...old, x: end.end.x + x * Math.cos(angle) - y * Math.sin(angle), y: end.end.y + x * Math.sin(angle) + y * Math.cos(angle), heading: old.heading + angle * 180 / Math.PI } };
  });
  return { ...curved, steps, ...(curved.layout ? { layout: { ...curved.layout, turnStartIndex: steps.findIndex(step => step.id === firstId), turnSteps: ids.length } } : {}) };
}

export function insertStep(staircase: Staircase, afterId: string): Staircase {
  if (staircase.steps.length >= MAX_RISERS) return staircase;
  const current = editableSteps(staircase);
  const index = current.steps.findIndex(step => step.id === afterId);
  const source = current.steps[index];
  if (!source) return staircase;
  const run = winderRun(current, index);
  if (run) {
    const added = { ...source, id: newId('step') };
    const steps = [...current.steps.slice(0, index + 1), added, ...current.steps.slice(index + 1)];
    const after = { ...current, steps, landings: current.landings.map(landing => landing.afterStepIndex >= index ? { ...landing, afterStepIndex: landing.afterStepIndex + 1 } : landing) };
    return resizeWinderRun(current, after, run, steps.slice(run.first, run.last + 2).map(step => step.id));
  }
  // Unequal or individually edited turning treads cannot be regenerated from one radius.
  // Divide their measured footprint, retaining the square walls and neighbouring rectangles.
  if (source.kind === 'winder') {
    const divided = splitTread(source, newId('step'));
    if (!divided) return staircase;
    return { ...current, steps: [...current.steps.slice(0, index), ...divided, ...current.steps.slice(index + 1)],
      landings: current.landings.map(landing => landing.afterStepIndex >= index ? { ...landing, afterStepIndex: landing.afterStepIndex + 1 } : landing) };
  }
  const end = measuredStepGeometry(source, source.plan!);
  const dimensions = stairFlightDimensions(current, index);
  const step: Step = { id: newId('step'), kind: 'straight', rise: source.rise, going: source.kind === 'straight' && !source.outline ? source.going : dimensions.going, width: dimensions.width, plan: { ...end.end, heading: end.endHeading, turn: 0 } };
  const inserted = measuredStepGeometry(step, step.plan!);
  const delta = { x: inserted.end.x - end.end.x, y: inserted.end.y - end.end.y };
  const shifted = current.steps.map((item, i) => i > index ? { ...item, plan: { ...item.plan!, x: item.plan!.x + delta.x, y: item.plan!.y + delta.y } } : item);
  return { ...current, steps: [...shifted.slice(0, index + 1), step, ...shifted.slice(index + 1)], landings: current.landings.map(landing => landing.afterStepIndex >= index ? { ...landing, afterStepIndex: landing.afterStepIndex + 1 } : landing) };
}

/** Insert at the selected position, including before the first tread. */
export function insertStepBefore(staircase: Staircase, beforeId: string): Staircase {
  if (staircase.steps.length >= MAX_RISERS) return staircase;
  const index = staircase.steps.findIndex(step => step.id === beforeId);
  if (index < 0) return staircase;
  if (index > 0) {
    // Within a turn the selected footprint, rather than an unrelated previous flight, is split.
    if (staircase.steps[index]!.kind === 'winder') {
      const result = insertStep(staircase, beforeId);
      if (result === staircase) return staircase;
      const newId = result.steps.find(step => !staircase.steps.some(old => old.id === step.id))!.id;
      return { ...result, steps: result.steps.map(step => step.id === beforeId ? { ...step, id: newId } : step.id === newId ? { ...step, id: beforeId } : step) };
    }
    return insertStep(staircase, staircase.steps[index - 1]!.id);
  }
  const current = editableSteps(staircase), first = current.steps[0]!;
  if (first.kind === 'winder') {
    const result = insertStep(current, first.id);
    if (result === current) return staircase;
    const id = result.steps.find(step => !current.steps.some(old => old.id === step.id))!.id;
    return { ...result, steps: result.steps.map(step => step.id === first.id ? { ...step, id } : step.id === id ? { ...step, id: first.id } : step) };
  }
  const dimensions = stairFlightDimensions(current, 0), angle = first.plan!.heading * Math.PI / 180;
  const added: Step = { id: newId('step'), kind: 'straight', rise: first.rise, ...dimensions,
    plan: { x: first.plan!.x - Math.cos(angle) * dimensions.going, y: first.plan!.y - Math.sin(angle) * dimensions.going, heading: first.plan!.heading, turn: 0 } };
  return { ...current, steps: [added, ...current.steps], landings: current.landings.map(landing => ({ ...landing, afterStepIndex: landing.afterStepIndex + 1 })) };
}

export function deleteSteps(staircase: Staircase, ids: string[]): Staircase {
  const selected = new Set(ids);
  const steps = staircase.steps.filter(step => !selected.has(step.id));
  if (!steps.length || steps.length === staircase.steps.length) return staircase;
  const landings = staircase.landings.map(landing => ({ ...landing, afterStepIndex: staircase.steps.slice(0, landing.afterStepIndex + 1).filter(step => !selected.has(step.id)).length - 1 }));
  const current = editableSteps(staircase);
  const winders = current.steps.filter(step => step.kind === 'winder' && Math.abs(step.plan?.turn ?? 0) > .01);
  if (winders.length && winders.every(step => selected.has(step.id))) return staircase;
  const run = winderRun(current, current.steps.findIndex(step => selected.has(step.id)));
  if (run && ids.every(id => current.steps.slice(run.first, run.last + 1).some(step => step.id === id))) {
    const remaining = current.steps.slice(run.first, run.last + 1).filter(step => !selected.has(step.id)).map(step => step.id);
    if (remaining.length > 1) return resizeWinderRun(current, { ...current, steps: current.steps.filter(step => !selected.has(step.id)), landings }, run, remaining);
  }
  const firstWinder = current.steps.findIndex(step => step.kind === 'winder');
  const lastWinder = current.steps.reduce((last, step, index) => step.kind === 'winder' ? index : last, -1);
  const selectedInTurn = current.steps.some((step, index) => selected.has(step.id) && index >= firstWinder && index <= lastWinder);
  if (firstWinder >= 0 && selectedInTurn) {
    // Remove internal risers while keeping the surveyed footprint. This also handles an
    // intervening rectangular tread, unequal winding angles and a previously split tread.
    let result = current;
    for (const id of current.steps.filter(step => selected.has(step.id)).map(step => step.id)) {
      const index = result.steps.findIndex(step => step.id === id), target = result.steps[index]!;
      const inTurn = target.kind === 'winder' || !!target.outline && result.steps.slice(0, index).some(step => step.kind === 'winder') && result.steps.slice(index + 1).some(step => step.kind === 'winder');
      if (!inTurn) {
        const after = { ...result, steps: result.steps.filter(step => step.id !== id), landings: result.landings.map(landing => landing.afterStepIndex >= index ? { ...landing, afterStepIndex: landing.afterStepIndex - 1 } : landing) };
        result = reconcileStepPlans(result, after);
        continue;
      }
      const neighbours = [index - 1, index + 1].filter(at => at >= 0 && at < result.steps.length
        && !result.landings.some(landing => landing.afterStepIndex === Math.min(at, index)))
        .sort((a, b) => Number(result.steps[b]!.kind === 'winder') - Number(result.steps[a]!.kind === 'winder') || Number(selected.has(result.steps[a]!.id)) - Number(selected.has(result.steps[b]!.id)));
      let merged: Step | undefined, neighbour = -1;
      for (const at of neighbours) {
        const survivor = result.steps[at]!;
        merged = mergeTreads(result.steps[Math.min(at, index)]!, result.steps[Math.max(at, index)]!, { ...survivor, kind: 'winder' });
        if (merged) { neighbour = at; break; }
      }
      if (!merged || neighbour < 0) return staircase;
      result = { ...result, steps: result.steps.flatMap((step, at) => at === index ? [] : at === neighbour ? [merged!] : [step]),
        landings: result.landings.map(landing => landing.afterStepIndex >= index ? { ...landing, afterStepIndex: landing.afterStepIndex - 1 } : landing) };
    }
    return result;
  }
  return reconcileStepPlans(staircase, { ...staircase, steps, landings });
}

export function uLandingPreset(staircase: Staircase): Staircase {
  const turnStartIndex = Math.max(1, Math.floor(staircase.steps.length / 2));
  const width = Math.max(1, ...staircase.steps.map(step => step.width));
  const existing = staircase.landings.find(landing => landing.kind !== 'top' && landing.afterStepIndex === turnStartIndex - 1);
  const landing = { id: existing?.id ?? newId('landing'), kind: 'half' as const, length: width, width: width * 2 + 100, afterStepIndex: turnStartIndex - 1 };
  return { ...staircase, drawing: undefined, steps: staircase.steps.map(({ plan: _plan, outline: _outline, ...step }) => step),
    layout: { kind: 'half_turn', direction: 'right', turnStartIndex, turnSteps: 0 },
    landings: [...staircase.landings.filter(item => item.kind === 'top'), landing] };
}

export interface StairPresetOptions {
  kind: StairLayout['kind'];
  direction: 'left' | 'right';
  turn?: 'landing' | 'winders';
  corner?: 'round' | 'square';
  turnStartIndex?: number;
  turnSteps?: number;
  curveAngle?: number;
  innerRadius?: number;
}

/** Measured starters: balanced flights with an actual landing, or explicitly measured turning treads. */
export function measuredStairPreset(staircase: Staircase, options: StairPresetOptions): Staircase {
  if (!staircase.steps.length) return staircase;
  const count = staircase.steps.length;
  const common = stairFlightDimensions(staircase, 0);
  const steps = staircase.steps.map(({ plan: _plan, outline: _outline, goingNarrow: _narrow, ...step }) => ({ ...step, kind: 'straight' as const, width: _outline ? common.width : step.width, going: step.kind === 'winder' ? common.going : step.going }));
  const width = Math.max(...steps.map(step => step.width));
  const start = Math.max(1, Math.min(count - 1, options.turnStartIndex ?? Math.floor(count / 2)));
  const top = staircase.landings.filter(landing => landing.kind === 'top');
  const base: Staircase = { ...staircase, drawing: undefined, steps, landings: top, layout: { kind: options.kind, direction: options.direction, turnStartIndex: start, turnSteps: 0, curveAngle: options.curveAngle ?? 90, innerRadius: options.innerRadius ?? 150 } };
  if (options.kind === 'straight' || count < 2) return { ...base, layout: { ...base.layout!, kind: 'straight' } };
  if (options.kind !== 'curved' && options.turn !== 'winders') {
    const old = staircase.landings.find(landing => landing.kind !== 'top' && landing.afterStepIndex === start - 1);
    return { ...base, landings: [...top, { id: old?.id ?? newId('landing'), kind: options.kind === 'half_turn' ? 'half' : 'quarter', length: width, width: options.kind === 'half_turn' ? 2 * width + 100 : width, afterStepIndex: start - 1 }] };
  }
  const turnCount = Math.max(1, Math.min(count, options.turnSteps ?? (options.kind === 'half_turn' ? 6 : options.kind === 'curved' ? Math.min(6, count) : 3)));
  const first = Math.max(0, Math.min(count - turnCount, options.turnStartIndex ?? Math.floor((count - turnCount) / 2)));
  const angle = options.kind === 'half_turn' ? 180 : options.kind === 'curved' ? options.curveAngle ?? 90 : 90;
  const curved = curveSteps(base, steps.slice(first, first + turnCount).map(step => step.id), (options.direction === 'left' ? 1 : -1) * angle, options.innerRadius ?? 150, options.corner ?? 'round');
  return { ...curved, layout: { ...base.layout!, turnStartIndex: first, turnSteps: turnCount } };
}
