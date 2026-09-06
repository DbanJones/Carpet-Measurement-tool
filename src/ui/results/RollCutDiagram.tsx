/**
 * RollCutDiagram: the roll laid out horizontally. The roll's WIDTH runs up the page (vertical axis
 * with a scale), each RollCut is a band along x labelled with its length, and the pieces sit inside
 * the band at their offset across the width. Offcuts (the spare width of a cut, and the tail
 * behind a piece shorter than its cut) are hatched. Drawn at a true aspect ratio: the total width
 * is capped and the figure scrolls horizontally in its container.
 */
import { useId } from 'react';
import type { BroadloomProduct, CutPiece, RollPlan } from '@engine/types';
import { formatArea, formatLength } from '@ui/components/inputs';

type Unit = 'metric' | 'imperial';

export interface RollCutDiagramProps {
  plan: RollPlan;
  product?: Pick<BroadloomProduct, 'name' | 'maxRollLength'>;
  unit: Unit;
  /** Height of the roll band in px (default 170). */
  rollHeightPx?: number;
  /** Cap on the drawn roll length in px before the scale is reduced (default 2400). */
  maxWidthPx?: number;
  className?: string;
}

const STAIR_ROLES: ReadonlySet<CutPiece['role']> = new Set(['stair_step', 'stair_runner', 'landing', 'winder']);

export function pieceClass(role: CutPiece['role'] | undefined): string {
  if (role === 'fill') return 'piece fill';
  if (role && STAIR_ROLES.has(role)) return 'piece stair';
  return 'piece';
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
/** Waste as a percentage with one decimal ("34.6%"). */
export const formatPercent = (fraction: number) => `${(Math.round(fraction * 1000) / 10).toFixed(1)}%`;

const LEFT_AXIS = 46; // px reserved for the width scale
const TOP_LABELS = 22; // px reserved for the cut labels
const BOTTOM = 8;
const CUT_GAP = 6; // px between cuts

export function RollCutDiagram({ plan, product, unit, rollHeightPx = 170, maxWidthPx = 2400, className }: RollCutDiagramProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hatchId = `hatch-${uid}`;
  const pieceById = new Map<string, CutPiece>(plan.pieces.map((p) => [p.id, p]));
  const cuts = plan.cuts;
  const totalLength = cuts.reduce((s, c) => s + c.length, 0);
  const title = product?.name ? `${product.name} — ${formatLength(plan.rollWidth, unit)} roll` : `${formatLength(plan.rollWidth, unit)} roll`;

  if (cuts.length === 0 || plan.rollWidth <= 0) {
    return (
      <figure className={`roll-cut-figure ${className ?? ''}`} data-testid="roll-cut-diagram-empty">
        <div className="empty small">No cuts planned for {title}.</div>
      </figure>
    );
  }

  // Uniform scale (true aspect ratio): sized from the roll height, then shrunk if the roll runs too long.
  let scale = rollHeightPx / plan.rollWidth;
  const gapsPx = CUT_GAP * (cuts.length - 1);
  if (totalLength * scale + gapsPx > maxWidthPx) scale = Math.max((maxWidthPx - gapsPx) / totalLength, 0.001);
  const rollH = plan.rollWidth * scale;
  const svgW = LEFT_AXIS + totalLength * scale + gapsPx + 8;
  const svgH = TOP_LABELS + rollH + BOTTOM;
  const y0 = TOP_LABELS;

  // x position of each cut
  const cutX: number[] = [];
  let x = LEFT_AXIS;
  for (const c of cuts) {
    cutX.push(x);
    x += c.length * scale + CUT_GAP;
  }

  const caption =
    `${formatLength(plan.orderLength, unit)} to order` +
    (plan.rollsRequired > 1 ? ` across ${plan.rollsRequired} rolls` : plan.rollsRequired === 1 ? ' (1 roll)' : '') +
    ` · ${cuts.length} cut${cuts.length === 1 ? '' : 's'} totalling ${formatLength(totalLength, unit)}` +
    ` · ordered ${formatArea(plan.orderedAreaM2, unit)} for ${formatArea(plan.netAreaM2, unit)} net · waste ${formatPercent(plan.wasteFraction)}`;

  return (
    <figure className={`roll-cut-figure ${className ?? ''}`} data-testid="roll-cut-diagram" data-product-id={plan.productId}>
      <div className="roll-cut-scroll">
        <svg
          className="diagram roll-cut-diagram"
          width={fmt(svgW)}
          height={fmt(svgH)}
          viewBox={`0 0 ${fmt(svgW)} ${fmt(svgH)}`}
          role="img"
          aria-label={`Cutting plan for ${title}: ${caption}`}
        >
          <defs>
            <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="8" stroke="#b5b5b5" strokeWidth="1.5" />
            </pattern>
          </defs>

          {/* width scale on the left */}
          <g className="roll-axis" aria-hidden="true">
            <line x1={LEFT_AXIS - 10} y1={y0} x2={LEFT_AXIS - 10} y2={y0 + rollH} stroke="#555" />
            <line x1={LEFT_AXIS - 14} y1={y0} x2={LEFT_AXIS - 6} y2={y0} stroke="#555" />
            <line x1={LEFT_AXIS - 14} y1={y0 + rollH} x2={LEFT_AXIS - 6} y2={y0 + rollH} stroke="#555" />
            <text
              className="label-muted"
              transform={`translate(${LEFT_AXIS - 18} ${y0 + rollH / 2}) rotate(-90)`}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {formatLength(plan.rollWidth, unit)} wide
            </text>
          </g>

          {cuts.map((cut, ci) => {
            const cx = cutX[ci]!;
            const cw = cut.length * scale;
            return (
              <g key={cut.index} className="roll-cut" data-cut-index={cut.index}>
                {/* the band of roll taken by this cut */}
                <rect x={fmt(cx)} y={fmt(y0)} width={fmt(cw)} height={fmt(rollH)} fill="#fff" stroke="#333" strokeWidth={1} />
                <text x={fmt(cx + cw / 2)} y={y0 - 7} textAnchor="middle" className="cut-label">
                  {cw < 44 ? `${cut.index + 1}` : `Cut ${cut.index + 1}: ${formatLength(cut.length, unit)}`}
                </text>

                {/* spare width of the cut */}
                {cut.offcut && cut.offcut.width > 0 ? (
                  <g className="roll-offcut">
                    <rect className="offcut" x={fmt(cx)} y={fmt(y0 + (plan.rollWidth - cut.offcut.width) * scale)} width={fmt(cw)} height={fmt(cut.offcut.width * scale)}>
                      <title>{`Offcut: ${formatLength(cut.offcut.width, unit)} × ${formatLength(cut.offcut.length, unit)}`}</title>
                    </rect>
                    <rect
                      className="offcut-hatch"
                      x={fmt(cx)}
                      y={fmt(y0 + (plan.rollWidth - cut.offcut.width) * scale)}
                      width={fmt(cw)}
                      height={fmt(cut.offcut.width * scale)}
                      fill={`url(#${hatchId})`}
                      pointerEvents="none"
                    />
                  </g>
                ) : null}

                {cut.pieces.map((cp) => {
                  const piece = pieceById.get(cp.pieceId);
                  const px = cx;
                  const py = y0 + cp.x * scale;
                  const pw = cp.length * scale;
                  const ph = cp.width * scale;
                  const tail = cut.length - cp.length;
                  const owner = piece?.ownerName ?? '';
                  const label = piece?.label ?? cp.pieceId;
                  const dims = `${formatLength(cp.length, unit)} × ${formatLength(cp.width, unit)}`;
                  const full = `${owner ? `${owner} — ` : ''}${label}: ${dims} (length along the roll × width across)`;
                  const showLabel = pw >= 56 && ph >= 16;
                  const twoLines = showLabel && ph >= 30;
                  const cls = pieceClass(piece?.role);
                  return (
                    <g key={cp.pieceId} className="roll-piece" data-piece-id={cp.pieceId} data-role={piece?.role ?? 'unknown'}>
                      <rect className={cls} x={fmt(px)} y={fmt(py)} width={fmt(pw)} height={fmt(ph)}>
                        <title>{full}</title>
                      </rect>
                      {tail > 1e-6 ? (
                        <g className="roll-offcut">
                          <rect className="offcut" x={fmt(px + pw)} y={fmt(py)} width={fmt(tail * scale)} height={fmt(ph)}>
                            <title>{`Offcut: ${formatLength(cp.width, unit)} × ${formatLength(tail, unit)}`}</title>
                          </rect>
                          <rect className="offcut-hatch" x={fmt(px + pw)} y={fmt(py)} width={fmt(tail * scale)} height={fmt(ph)} fill={`url(#${hatchId})`} pointerEvents="none" />
                        </g>
                      ) : null}
                      {showLabel ? (
                        <text className="piece-label" x={fmt(px + 4)} y={fmt(py + (twoLines ? ph / 2 - 6 : ph / 2))} dominantBaseline="central" pointerEvents="none">
                          <tspan>{clip(owner ? `${owner} · ${label}` : label, pw / 6.5)}</tspan>
                          {twoLines ? (
                            <tspan x={fmt(px + 4)} dy="13" className="label-muted">
                              {clip(dims, pw / 6.5)}
                            </tspan>
                          ) : null}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="small muted">{caption}</figcaption>
      {/* The four fills carry meaning and the tooltips do not print, so the printed cutting plan
          needs a key: main and fill are two tans about 1.2:1 apart, and small pieces get no label. */}
      <ul className="roll-cut-legend">
        <li>
          <span className="swatch" aria-hidden="true" /> Main piece
        </li>
        <li>
          <span className="swatch fill" aria-hidden="true" /> Fill piece
        </li>
        <li>
          <span className="swatch stair" aria-hidden="true" /> Stairs / landing
        </li>
        <li>
          <span className="swatch offcut" aria-hidden="true" /> Offcut
        </li>
      </ul>
    </figure>
  );
}

/** Trim a label to roughly `maxChars` characters with an ellipsis. */
function clip(s: string, maxChars: number): string {
  const n = Math.max(3, Math.floor(maxChars));
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
