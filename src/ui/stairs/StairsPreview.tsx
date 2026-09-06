/**
 * StairsPreview: a side elevation of the flight (risers and treads stepping up from bottom-left,
 * winders hatched, a bullnose/curtail step with a rounded bottom riser, landings as flat runs) and a
 * small plan view (treads as rectangles, winders as kites, bullnose ends rounded).
 *
 * Pure SVG. The drawing is fitted to a fixed pixel canvas so labels keep a readable size whatever
 * the stair's dimensions. Lengths come in as millimetres; labels use the project's display unit.
 */
import { useId } from 'react';
import type { Landing, Mm, Staircase, Step } from '@engine/types';
import { DEFAULT_BULLNOSE_PROJECTION, DEFAULT_CURTAIL_PROJECTION } from '@engine/stairs';
import { formatLength } from '@ui/components/inputs';

type Unit = 'metric' | 'imperial';

export type StairSegment = { kind: 'step'; step: Step; index: number } | { kind: 'landing'; landing: Landing };

/**
 * Steps and landings in walking order from the foot of the flight. Mirrors the engine's rule: a
 * landing sits after step `afterStepIndex` (0-based); below 0 is a landing at the foot, at or past
 * the last step is the top landing.
 */
export function stairSequence(steps: Step[], landings: Landing[]): StairSegment[] {
  const n = steps.length;
  const slotOf = (l: Landing) => (l.afterStepIndex < 0 ? -1 : Math.min(Math.floor(l.afterStepIndex), n - 1));
  const seq: StairSegment[] = [];
  for (const l of landings) if (slotOf(l) < 0) seq.push({ kind: 'landing', landing: l });
  steps.forEach((step, index) => {
    seq.push({ kind: 'step', step, index });
    for (const l of landings) if (slotOf(l) === index) seq.push({ kind: 'landing', landing: l });
  });
  return seq;
}

const pos = (v: Mm | undefined): Mm => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const isCurved = (s: Step) => s.kind === 'bullnose' || s.kind === 'curtail';
const projectionOf = (s: Step): Mm => pos(s.bullnoseProjection) || (s.kind === 'curtail' ? DEFAULT_CURTAIL_PROJECTION : DEFAULT_BULLNOSE_PROJECTION);
const f = (v: number) => v.toFixed(1);

function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#4c7a46" strokeWidth="1.5" />
    </pattern>
  );
}

export function StairsPreview({ staircase, unit }: { staircase: Staircase; unit: Unit }) {
  const rawId = useId();
  const hatchId = `stairs-hatch-${rawId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  if (staircase.steps.length === 0) return <div className="empty small">Add a step to see the preview.</div>;
  return (
    <div className="stairs-preview">
      <figure className="stairs-figure stairs-figure-elevation">
        <Elevation staircase={staircase} unit={unit} hatchId={`${hatchId}-e`} />
        <figcaption className="small muted">Side elevation, foot of the flight at the left</figcaption>
      </figure>
      <figure className="stairs-figure stairs-figure-plan">
        <Plan staircase={staircase} hatchId={`${hatchId}-p`} />
        <figcaption className="small muted">Plan, bottom step at the bottom</figcaption>
      </figure>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side elevation
// ---------------------------------------------------------------------------

type ElevationItem =
  | { kind: 'step'; x0: Mm; x1: Mm; y0: Mm; y1: Mm; step: Step; index: number }
  | { kind: 'landing'; x0: Mm; x1: Mm; y: Mm; landing: Landing };

function Elevation({ staircase, unit, hatchId }: { staircase: Staircase; unit: Unit; hatchId: string }) {
  const seq = stairSequence(staircase.steps, staircase.landings);
  const items: ElevationItem[] = [];
  let x = 0;
  let y = 0;
  for (const seg of seq) {
    if (seg.kind === 'step') {
      const rise = pos(seg.step.rise);
      const going = pos(seg.step.going);
      items.push({ kind: 'step', x0: x, x1: x + going, y0: y, y1: y + rise, step: seg.step, index: seg.index });
      x += going;
      y += rise;
    } else {
      const len = pos(seg.landing.length);
      items.push({ kind: 'landing', x0: x, x1: x + len, y, landing: seg.landing });
      x += len;
    }
  }
  const totalRun = x;
  const totalRise = y;
  const hasLandings = staircase.landings.length > 0;

  // A bullnose/curtail bottom step bulges out in front of the flight.
  const first = staircase.steps[0];
  const bulge = first && isCurved(first) ? pos(first.rise) * 0.6 : 0;
  const minX = -bulge;
  const extentX = Math.max(totalRun + bulge, 1);
  const extentY = Math.max(totalRise, 1);

  const W = 440;
  const H = 260;
  const padL = 14;
  const padR = 34;
  const padT = 14;
  const padB = 32;
  const s = Math.min((W - padL - padR) / extentX, (H - padT - padB) / extentY);
  const px = (wx: Mm) => padL + (wx - minX) * s;
  const py = (wy: Mm) => H - padB - wy * s;
  const pt = (wx: Mm, wy: Mm) => `${f(px(wx))} ${f(py(wy))}`;

  const d: string[] = [`M ${pt(0, 0)}`];
  for (const it of items) {
    if (it.kind === 'landing') {
      d.push(`L ${pt(it.x1, it.y)}`);
      continue;
    }
    const { x0, x1, y0, y1 } = it;
    const rise = y1 - y0;
    const going = x1 - x0;
    if (isCurved(it.step) && it.index === 0) {
      // rounded bottom riser: the nose sweeps out in front of the flight
      const b = rise * 0.6;
      d.push(`C ${pt(x0 - b, y0)} ${pt(x0 - b, y1)} ${pt(x0, y1)}`, `L ${pt(x1, y1)}`);
    } else if (isCurved(it.step)) {
      // a curved step mid-flight: round the nosing instead
      const r = Math.min(rise, going) * 0.35;
      d.push(`L ${pt(x0, y1 - r)}`, `Q ${pt(x0, y1)} ${pt(x0 + r, y1)}`, `L ${pt(x1, y1)}`);
    } else {
      d.push(`L ${pt(x0, y1)}`, `L ${pt(x1, y1)}`);
    }
  }
  d.push(`L ${pt(totalRun, 0)}`, 'Z');

  const stepItems = items.filter((it): it is Extract<ElevationItem, { kind: 'step' }> => it.kind === 'step');
  const labelAll = stepItems.every((it) => (it.x1 - it.x0) * s >= 18);
  const lastIndex = staircase.steps.length - 1;
  const goingY = py(0) + 12;
  const riseX = px(totalRun) + 12;
  const midY = (py(0) + py(totalRise)) / 2;
  const runLabel = hasLandings ? 'Total run incl. landings' : 'Total going';

  return (
    <svg
      className="diagram stairs-elevation"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Side elevation: ${staircase.steps.length} risers, total rise ${formatLength(totalRise, unit)}, ${runLabel.toLowerCase()} ${formatLength(totalRun, unit)}`}
    >
      <defs>
        <Hatch id={hatchId} />
      </defs>
      <line className="stairs-floor" x1={px(minX) - 8} y1={py(0)} x2={px(totalRun) + 8} y2={py(0)} />
      <path className="stairs-mass" d={d.join(' ')} />
      {stepItems
        .filter((it) => it.step.kind === 'winder')
        .map((it) => (
          <rect key={it.step.id} className="stairs-winder" fill={`url(#${hatchId})`} x={px(it.x0)} y={py(it.y1)} width={(it.x1 - it.x0) * s} height={(it.y1 - it.y0) * s}>
            <title>{`Step ${it.index + 1}: winder`}</title>
          </rect>
        ))}
      {items
        .filter((it): it is Extract<ElevationItem, { kind: 'landing' }> => it.kind === 'landing')
        .map((it) => {
          const w = (it.x1 - it.x0) * s;
          return (
            <g key={it.landing.id}>
              <rect className="stairs-landing" x={px(it.x0)} y={py(it.y)} width={w} height={5} />
              {w >= 40 ? (
                <text className="label-muted" x={px((it.x0 + it.x1) / 2)} y={py(it.y) - 3} textAnchor="middle" fontSize={9}>
                  landing
                </text>
              ) : null}
            </g>
          );
        })}
      {stepItems
        .filter((it) => labelAll || it.index === 0 || it.index === lastIndex || it.step.kind !== 'straight')
        .map((it) => (
          <text key={it.step.id} x={px((it.x0 + it.x1) / 2)} y={py(it.y1) - 3} textAnchor="middle" fontSize={9}>
            {it.index + 1}
          </text>
        ))}
      {/* total going / run */}
      <line className="stairs-dim" x1={px(0)} y1={goingY} x2={px(totalRun)} y2={goingY} />
      <line className="stairs-dim" x1={px(0)} y1={goingY - 4} x2={px(0)} y2={goingY + 4} />
      <line className="stairs-dim" x1={px(totalRun)} y1={goingY - 4} x2={px(totalRun)} y2={goingY + 4} />
      <text className="stairs-dim-text" x={(px(0) + px(totalRun)) / 2} y={goingY + 12} textAnchor="middle">
        {runLabel} {formatLength(totalRun, unit)}
      </text>
      {/* total rise */}
      <line className="stairs-dim" x1={riseX} y1={py(0)} x2={riseX} y2={py(totalRise)} />
      <line className="stairs-dim" x1={riseX - 4} y1={py(0)} x2={riseX + 4} y2={py(0)} />
      <line className="stairs-dim" x1={riseX - 4} y1={py(totalRise)} x2={riseX + 4} y2={py(totalRise)} />
      <text className="stairs-dim-text" x={riseX + 12} y={midY} textAnchor="middle" transform={`rotate(-90 ${f(riseX + 12)} ${f(midY)})`}>
        Total rise {formatLength(totalRise, unit)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Plan view
// ---------------------------------------------------------------------------

interface PlanShape {
  key: string;
  kind: 'tread' | 'winder' | 'landing';
  /** World coordinates: x across the stair, y along it (0 at the foot). */
  points: [Mm, Mm][];
  label: string;
  index?: number;
  /** Bullnose / curtail ends that project beyond the strings. */
  ends: { side: 'left' | 'right'; x: Mm; proj: Mm; y0: Mm; y1: Mm }[];
}

function Plan({ staircase, hatchId }: { staircase: Staircase; hatchId: string }) {
  const seq = stairSequence(staircase.steps, staircase.landings);
  const shapes: PlanShape[] = [];
  let yL = 0;
  let yR = 0;
  let maxW = 0;
  let leftProj = 0;
  let rightProj = 0;
  for (const seg of seq) {
    if (seg.kind === 'landing') {
      const l = seg.landing;
      const len = pos(l.length);
      const w = pos(l.width);
      maxW = Math.max(maxW, w);
      const top = Math.max(yL, yR) + len;
      shapes.push({ key: l.id, kind: 'landing', points: [[0, yL], [w, yR], [w, top], [0, top]], label: `${l.kind} landing`, ends: [] });
      yL = top;
      yR = top;
      continue;
    }
    const st = seg.step;
    const w = pos(st.width);
    const g = pos(st.going);
    maxW = Math.max(maxW, w);
    if (st.kind === 'winder') {
      // kite: narrow end on the left (newel side), wide end on the right; consecutive kites share a diagonal edge
      const narrow = pos(st.goingNarrow) || g / 3;
      shapes.push({ key: st.id, kind: 'winder', points: [[0, yL], [w, yR], [w, yR + g], [0, yL + narrow]], label: `Step ${seg.index + 1}: winder`, index: seg.index, ends: [] });
      yL += narrow;
      yR += g;
      continue;
    }
    // straight / bullnose / curtail: the back edge squares up the flight again after any winders
    const top = Math.max(yL, yR) + g;
    const ends: PlanShape['ends'] = [];
    if (isCurved(st)) {
      const proj = projectionOf(st);
      const sides = st.kind === 'curtail' ? 'both' : (st.bullnoseSides ?? 'right');
      if (sides !== 'right') {
        ends.push({ side: 'left', x: 0, proj, y0: yL, y1: top });
        leftProj = Math.max(leftProj, proj);
      }
      if (sides !== 'left') {
        ends.push({ side: 'right', x: w, proj, y0: yR, y1: top });
        rightProj = Math.max(rightProj, proj);
      }
    }
    shapes.push({ key: st.id, kind: 'tread', points: [[0, yL], [w, yR], [w, top], [0, top]], label: `Step ${seg.index + 1}: ${st.kind}`, index: seg.index, ends });
    yL = top;
    yR = top;
  }
  const totalY = Math.max(yL, yR, 1);
  const minX = -leftProj;
  const extentX = Math.max(maxW + leftProj + rightProj, 1);

  const W = 150;
  const H = 260;
  const padX = 10;
  const padT = 10;
  const padB = 10;
  const s = Math.min((W - 2 * padX) / extentX, (H - padT - padB) / totalY);
  const px = (wx: Mm) => padX + (wx - minX) * s;
  const py = (wy: Mm) => H - padB - wy * s;
  const lastIndex = staircase.steps.length - 1;

  return (
    <svg className="diagram stairs-plan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Plan view: ${staircase.steps.length} treads`}>
      <defs>
        <Hatch id={hatchId} />
      </defs>
      {shapes.map((sh) => {
        const pts = sh.points.map(([wx, wy]) => `${f(px(wx))},${f(py(wy))}`).join(' ');
        const ys = sh.points.map((p) => p[1]);
        const hPx = (Math.max(...ys) - Math.min(...ys)) * s;
        const cx = px(sh.points.reduce((acc, p) => acc + p[0], 0) / sh.points.length);
        const cy = py(sh.points.reduce((acc, p) => acc + p[1], 0) / sh.points.length);
        const showNumber = sh.index !== undefined && (sh.index === 0 || sh.index === lastIndex) && hPx >= 9;
        return (
          <g key={sh.key}>
            {sh.ends.map((e) => {
              const rx = e.proj * s;
              const ry = ((e.y1 - e.y0) * s) / 2;
              const sweep = e.side === 'right' ? 0 : 1;
              return <path key={e.side} className="stairs-tread" d={`M ${f(px(e.x))} ${f(py(e.y0))} A ${f(rx)} ${f(ry)} 0 0 ${sweep} ${f(px(e.x))} ${f(py(e.y1))} Z`} />;
            })}
            <polygon className={sh.kind === 'landing' ? 'stairs-landing' : sh.kind === 'winder' ? 'stairs-winder' : 'stairs-tread'} fill={sh.kind === 'winder' ? `url(#${hatchId})` : undefined} points={pts}>
              <title>{sh.label}</title>
            </polygon>
            {showNumber ? (
              <text x={cx} y={cy + 3} textAnchor="middle" fontSize={9}>
                {(sh.index ?? 0) + 1}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
