import type { Point, Staircase, StairLayout, Step } from '@engine/types';
import { drawingGeometry } from './stairDrawing';
import { measuredStepGeometry } from './stepGeometry';

export interface StairPlanPiece {
  id: string;
  kind: 'tread' | 'winder' | 'landing';
  points: Point[];
  label: string;
  stepIndex?: number;
  start?: Point;
  end?: Point;
  heading?: number;
  endHeading?: number;
  /** Raw arrival from the previous tread/landing, before this step's manual placement. */
  incoming?: Point;
  incomingHeading?: number;
  entry?: [number, number];
  exit?: [number, number];
  cornerIndices?: number[];
}

export const STAIR_SHAPES: { value: StairLayout['kind']; label: string; detail: string }[] = [
  { value: 'straight', label: 'Straight', detail: 'One flight' },
  { value: 'quarter_turn', label: 'Quarter turn', detail: 'L-shaped · 90°' },
  { value: 'half_turn', label: 'Half turn', detail: 'U-shaped · 180°' },
  { value: 'curved', label: 'Curved', detail: 'A sweeping flight' },
];

export function defaultStairLayout(staircase: Staircase): StairLayout {
  if (staircase.layout) return staircase.layout;
  const landing = staircase.landings.find((l) => l.kind !== 'top' && l.afterStepIndex < staircase.steps.length - 1);
  const firstWinder = staircase.steps.findIndex((s) => s.kind === 'winder');
  const winders = staircase.steps.filter((s) => s.kind === 'winder').length;
  return {
    kind: landing ? (landing.kind === 'half' ? 'half_turn' : 'quarter_turn') : winders ? 'quarter_turn' : 'straight',
    direction: 'right',
    turnStartIndex: landing ? landing.afterStepIndex + 1 : firstWinder >= 0 ? firstWinder : Math.floor(staircase.steps.length / 2),
    turnSteps: landing ? 0 : winders || Math.min(3, staircase.steps.length),
    curveAngle: 180,
    innerRadius: 300,
  };
}

/** A plan schematic following the actual steps and landing order; quantities never use this drawing. */
export function stairPlanGeometry(staircase: Staircase, options: {
  normalize?: boolean;
  resolvePlan?: (step: Step, incoming: Point, incomingHeading: number) => Step['plan'];
} = {}): { pieces: StairPlanPiece[]; route: Point[]; width: number; height: number } {
  if (staircase.drawing && !staircase.steps.some(step => step.plan)) return drawingGeometry(staircase);
  const layout = defaultStairLayout(staircase);
  const sign = layout.direction === 'left' ? 1 : -1;
  const turnAngle = layout.kind === 'curved' ? Math.min(330, Math.max(15, layout.curveAngle ?? 180)) : layout.kind === 'half_turn' ? 180 : 90;
  const winders = staircase.steps.map((step, index) => ({ step, index })).filter(({ step }) => step.kind === 'winder');
  const turningWinders = winders.filter(({ index }) => index >= layout.turnStartIndex && index < layout.turnStartIndex + layout.turnSteps);
  // An explicit zero denotes a turn made by a landing. Existing measured winders may remain in
  // the schedule, but must not add a second turn on top of that landing.
  const turnIds = new Set((layout.turnSteps === 0 ? [] : turningWinders.length ? turningWinders : winders).map(({ step }) => step.id));
  const pieces: StairPlanPiece[] = [];
  const route: Point[] = [{ x: 0, y: 0 }];
  let position: Point = { x: 0, y: 0 };
  let angle = Math.PI / 2;
  const point = (across: number, along: number): Point => ({
    x: position.x + Math.cos(angle) * along + Math.sin(angle) * across,
    y: position.y + Math.sin(angle) * along - Math.cos(angle) * across,
  });
  const rectangular = (width: number, length: number): Point[] => [point(-width / 2, 0), point(width / 2, 0), point(width / 2, length), point(-width / 2, length)];
  const landingAfter = (index: number) => {
    for (const landing of staircase.landings.filter((l) => Math.max(-1, Math.min(staircase.steps.length - 1, l.afterStepIndex)) === index)) {
      const width = Math.max(1, landing.width);
      const length = Math.max(1, landing.length);
      const nextAngle = landing.kind === 'top' ? 0 : sign * (landing.kind === 'half' ? Math.PI : Math.PI / 2);
      // A half landing spans both flights; the incoming flight occupies one half.
      const flightWidth = staircase.steps[Math.max(0, index)]?.width ?? width;
      const lateral = landing.kind === 'half' && nextAngle ? -sign * Math.max(0, width - flightWidth) / 2 : 0;
      const polygon = landing.outline ? landing.outline.map(p => point(p.x * width, p.y * length)) : [point(lateral - width / 2, 0), point(lateral + width / 2, 0), point(lateral + width / 2, length), point(lateral - width / 2, length)];
      const landingStart = { ...position }, landingHeading = angle * 180 / Math.PI;
      const exit: [number, number] = landing.outlineExit ?? (landing.kind === 'top' ? [3, 2] : landing.kind === 'half' ? [1, 0] : sign < 0 ? [2, 1] : [0, 3]);
      if (Math.abs(nextAngle) > Math.PI * .75) {
        route.push(point(lateral, length / 2));
        const outgoingWidth = staircase.steps[index + 1]?.width ?? flightWidth;
        const halfFlightWidths = (flightWidth + outgoingWidth) / 2;
        position = point(-sign * Math.max(halfFlightWidths, width - halfFlightWidths), 0);
      } else if (nextAngle) {
        route.push(point(lateral, length / 2));
        position = point(-sign * width / 2, length / 2);
      } else position = point(0, length);
      angle += nextAngle;
      if (landing.outline) {
        const [a, b] = exit.map(i => polygon[i]!) as [Point, Point];
        let amount = .5;
        if (landing.kind === 'half') {
          const outgoingWidth = staircase.steps[index + 1]?.width ?? flightWidth;
          amount = sign < 0 ? Math.min(.5, outgoingWidth / (2 * width)) : 1 - Math.min(.5, outgoingWidth / (2 * width));
        }
        position = { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount };
        angle = Math.atan2(b.x - a.x, a.y - b.y);
      }
      pieces.push({ id: landing.id, kind: 'landing', points: polygon, label: `${landing.kind} landing`, start: landingStart, end: { ...position }, heading: landingHeading, endHeading: angle * 180 / Math.PI, entry: [0, 1], exit });
      route.push({ ...position });
    }
  };
  landingAfter(-1);
  staircase.steps.forEach((step, index) => {
    const start = { ...position }, heading = angle * 180 / Math.PI;
    const plan = options.resolvePlan ? options.resolvePlan(step, start, heading) : step.plan;
    const width = Math.max(1, step.width);
    const going = Math.max(1, step.going);
    let points: Point[];
    let entry: [number, number] = [0, 1], exit: [number, number] = [3, 2];
    let cornerIndices: number[] | undefined;
    if (plan) {
      const measured = measuredStepGeometry(step, plan);
      if (index === 0 && route.length === 1) route[0] = { ...measured.start };
      else if (Math.hypot(route.at(-1)!.x - measured.start.x, route.at(-1)!.y - measured.start.y) > .001) route.push({ ...measured.start });
      points = measured.points;
      entry = measured.entry; exit = measured.exit;
      cornerIndices = measured.cornerIndices;
      position = measured.end;
      angle = measured.endHeading * Math.PI / 180;
    } else if (step.kind === 'winder' && layout.kind !== 'straight' && turnIds.has(step.id)) {
      const sweep = sign * turnAngle * Math.PI / 180 / Math.max(1, turnIds.size);
      const radius = (layout.kind === 'curved' ? Math.max(0, layout.innerRadius ?? 300) : 75) + width / 2;
      const centre = point(-sign * radius, 0);
      const start = Math.atan2(position.y - centre.y, position.x - centre.x);
      const at = (r: number, a: number): Point => ({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
      const subdivisions = Math.max(3, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
      points = [];
      for (let j = 0; j <= subdivisions; j++) points.push(at(Math.max(0, radius - width / 2), start + sweep * j / subdivisions));
      for (let j = subdivisions; j >= 0; j--) points.push(at(radius + width / 2, start + sweep * j / subdivisions));
      entry = sign > 0 ? [0, points.length - 1] : [points.length - 1, 0];
      exit = sign > 0 ? [subdivisions, subdivisions + 1] : [subdivisions + 1, subdivisions];
      position = at(radius, start + sweep);
      angle += sweep;
    } else {
      points = rectangular(width, going);
      position = point(0, going);
    }
    pieces.push({ id: step.id, kind: step.kind === 'winder' ? 'winder' : 'tread', points, label: `Step ${index + 1}: ${step.kind}`, stepIndex: index,
      start: plan ? { x: plan.x, y: plan.y } : start, end: { ...position }, heading: plan?.heading ?? heading, endHeading: angle * 180 / Math.PI,
      incoming: start, incomingHeading: heading });
    pieces[pieces.length - 1]!.entry = entry;
    pieces[pieces.length - 1]!.exit = exit;
    pieces[pieces.length - 1]!.cornerIndices = cornerIndices;
    route.push({ ...position });
    landingAfter(index);
  });
  const points = pieces.flatMap((piece) => piece.points);
  const minX = Math.min(0, ...points.map((p) => p.x));
  const minY = Math.min(0, ...points.map((p) => p.y));
  const maxX = Math.max(1, ...points.map((p) => p.x));
  const maxY = Math.max(1, ...points.map((p) => p.y));
  const shift = (p: Point) => options.normalize === false ? { ...p } : ({ x: p.x - minX, y: p.y - minY });
  return { pieces: pieces.map((piece) => ({ ...piece, points: piece.points.map(shift), ...(piece.start ? { start: shift(piece.start) } : {}), ...(piece.end ? { end: shift(piece.end) } : {}), ...(piece.incoming ? { incoming: shift(piece.incoming) } : {}) })), route: route.map(shift), width: maxX - minX, height: maxY - minY };
}

/** Only the explicitly selected treads change. IDs, rises and widths always survive. */
export function applyWinderLayout(staircase: Staircase, layout: StairLayout, going?: number, narrow?: number): Staircase {
  const steps: Step[] = staircase.steps.map((step, index) => {
    if (layout.kind === 'straight' || index < layout.turnStartIndex || index >= layout.turnStartIndex + layout.turnSteps) return step;
    return { ...step, kind: 'winder', going: going ?? step.going, goingNarrow: narrow ?? step.goingNarrow ?? 100 };
  });
  return { ...staircase, layout, steps };
}
