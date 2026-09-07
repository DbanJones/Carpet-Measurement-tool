import type { Point, Step } from '@engine/types';

export type StepPlan = NonNullable<Step['plan']>;
const radians = (degrees: number) => degrees * Math.PI / 180;

/** Keep the entire edited footprint inside the dimensions used by the cut planner. */
export function outlinedStep(step: Step, points: Point[], entry: [number, number], exit: [number, number], corners = step.outline?.corners): Step {
  const [a, b] = entry.map(index => points[index]!) as [Point, Point];
  const position = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const rawHeading = Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
  // Keep the walking direction continuous when a left turn crosses +180 degrees.
  const previousHeading = step.plan?.heading ?? rawHeading;
  const heading = previousHeading + ((rawHeading - previousHeading + 180) % 360 + 360) % 360 - 180;
  const angle = radians(heading);
  const local = points.map(point => ({ x: (point.x - position.x) * Math.sin(angle) - (point.y - position.y) * Math.cos(angle), y: (point.x - position.x) * Math.cos(angle) + (point.y - position.y) * Math.sin(angle) }));
  const width = Math.max(1, Math.ceil(Math.max(...local.map(p => p.x)) - Math.min(...local.map(p => p.x)) - 1e-7));
  const going = Math.max(1, Math.ceil(Math.max(...local.map(p => p.y)) - Math.min(...local.map(p => p.y)) - 1e-7));
  const next = { ...step, width, going, ...(step.kind === 'winder' ? { goingNarrow: going } : {}),
    plan: { ...position, heading, turn: step.plan?.turn ?? 0 }, outline: { points: local.map(p => ({ x: p.x / width, y: p.y / going })), entry, exit, ...(corners ? { corners } : {}) } };
  const geometry = measuredStepGeometry(next, next.plan);
  next.plan.turn = geometry.endHeading - geometry.heading;
  return next;
}

/** The same measured tread generates both its editable footprint and the raised 3D surface. */
export function measuredStepGeometry(step: Step, plan: StepPlan) {
  const angle = radians(plan.heading);
  // A drawn route can turn inside a straight tread. That sketch must not turn the measured
  // rectangle into an unmeasured wedge; only winders have radial footprints.
  const measuredTurn = step.kind === 'winder' && plan.turn ? Math.sign(plan.turn) * Math.min(170, Math.max(.01, (step.going - (step.goingNarrow ?? 0)) / Math.max(1, step.width) * 180 / Math.PI)) : 0;
  const turn = radians(measuredTurn);
  const width = Math.max(1, step.width), going = Math.max(1, step.going);
  const start = { x: plan.x, y: plan.y };
  const at = (across: number, along: number): Point => ({ x: start.x + Math.cos(angle) * along + Math.sin(angle) * across, y: start.y + Math.sin(angle) * along - Math.cos(angle) * across });
  if (step.outline) {
    const points = step.outline.points.map(point => at(point.x * width, point.y * going));
    const [a, b] = step.outline.exit.map(index => points[index]!) as [Point, Point];
    const end = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rawHeading = Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
    const target = plan.heading + (plan.turn ?? 0);
    const endHeading = target + ((rawHeading - target + 540) % 360) - 180;
    return { points, start, end, heading: plan.heading, endHeading, entry: step.outline.entry, exit: step.outline.exit, cornerIndices: step.outline.corners };
  }
  if (Math.abs(turn) < .0001) return { points: [at(-width / 2, 0), at(width / 2, 0), at(width / 2, going), at(-width / 2, going)], start, end: at(0, going), heading: plan.heading, endHeading: plan.heading, entry: [0, 1] as [number, number], exit: [3, 2] as [number, number] };
  const sign = Math.sign(turn);
  const inner = Math.max(0, step.goingNarrow ?? Math.max(0, going - width * Math.abs(turn))) / Math.abs(turn);
  const radius = inner + width / 2;
  const centre = at(-sign * radius, 0);
  const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
  const radial = (r: number, amount: number) => ({ x: centre.x + r * Math.cos(startAngle + turn * amount), y: centre.y + r * Math.sin(startAngle + turn * amount) });
  const count = Math.max(3, Math.ceil(Math.abs(measuredTurn) / 8));
  const outline = [...Array.from({ length: count + 1 }, (_, index) => radial(inner, index / count)), ...Array.from({ length: count + 1 }, (_, index) => radial(inner + width, 1 - index / count))];
  // A pointed winder has one inside vertex, rather than an arc of identical vertices.
  const points = outline.filter((point, index) => index === 0 || Math.hypot(point.x - outline[index - 1]!.x, point.y - outline[index - 1]!.y) > 1e-7);
  const innerEnd = inner < 1e-7 ? 0 : count;
  const outerEnd = innerEnd + 1, outerStart = points.length - 1;
  const entry: [number, number] = sign > 0 ? [0, outerStart] : [outerStart, 0];
  const exit: [number, number] = sign > 0 ? [innerEnd, outerEnd] : [outerEnd, innerEnd];
  return { points, start, end: radial(radius, 1), heading: plan.heading, endHeading: plan.heading + measuredTurn, entry, exit };
}
