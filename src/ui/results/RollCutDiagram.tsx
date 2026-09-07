/** Physical rolls, their cutting blanks, and the rooms or stairs those blanks will cover. */
import { useEffect, useId, useRef, useState } from 'react';
import type { CutPiece, RollPlan } from '@engine/types';
import { MM_PER_INCH } from '@engine/units';
import { formatArea, formatLength } from '@ui/components/inputs';
import { destinationColour, physicalRolls, pieceReference, type DisplayRoll, type RollDisplayProduct } from './rollDisplay';
import './roll-cut.css';

type Unit = 'metric' | 'imperial';
export interface RollCutDiagramProps {
  plan: RollPlan;
  product?: RollDisplayProduct;
  unit: Unit;
  rollHeightPx?: number;
  maxWidthPx?: number;
  className?: string;
  onOpenDestination?: (ownerId: string) => void;
}

const ROLE_LABELS: Record<CutPiece['role'], string> = {
  main: 'Main piece', fill: 'Fill piece', stair_step: 'Stair piece', stair_runner: 'Runner',
  landing: 'Landing', winder: 'Winder', other: 'Piece',
};
const fmt = (n: number) => String(Math.round(n * 10) / 10);
export const formatPercent = (fraction: number) => `${(Math.round(fraction * 1000) / 10).toFixed(1)}%`;

interface PieceEntry {
  piece: CutPiece | undefined;
  id: string;
  reference: string;
  cutIndex: number;
  width: number;
  length: number;
}

export function RollCutDiagram({ plan, product, unit, rollHeightPx = 210, maxWidthPx = 2400, className, onOpenDestination }: RollCutDiagramProps) {
  const figure = useRef<HTMLElement>(null);
  // Native closed details do not reliably print in every browser. Restore the reader's choices.
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    let printing = false;
    const before = () => {
      if (printing) return;
      printing = true;
      opened = Array.from(figure.current?.querySelectorAll<HTMLDetailsElement>('details:not([open])') ?? []);
      opened.forEach((detail) => { detail.open = true; });
    };
    const after = () => { opened.forEach((detail) => { detail.open = false; }); opened = []; printing = false; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);

  if (!plan.cuts.length || plan.rollWidth <= 0) {
    return <figure className={`roll-cut-figure ${className ?? ''}`} data-testid="roll-cut-diagram-empty"><p className="empty small">No cuts planned for {product?.name ?? 'this roll'}.</p></figure>;
  }

  const { rolls, assigned, unallocatedLength } = physicalRolls(plan, product);
  const totalCuts = plan.cuts.reduce((sum, cut) => sum + cut.length, 0);
  return (
    <figure ref={figure} className={`roll-cut-figure roll-destination-view ${className ?? ''}`} data-testid="roll-cut-diagram" data-product-id={plan.productId}>
      <p className="roll-reading-guide">Each coloured piece goes to the room or staircase named below. Select a piece to see its size and destination.</p>
      <p className="small muted">These are rectangular cutting blanks, including fitting allowances. Room shapes and seams are shown in the room plans.</p>
      {rolls.map((roll) => <PhysicalRoll key={roll.number} roll={roll} plan={plan} assigned={assigned} product={product} unit={unit} rollHeightPx={rollHeightPx} maxWidthPx={maxWidthPx} onOpenDestination={onOpenDestination} />)}
      <figcaption className="roll-order-summary">
        <strong>{formatLength(plan.orderLength, unit)} total to order · {formatLength(plan.rollWidth, unit)} wide</strong>
        <span>{plan.rollsRequired} roll{plan.rollsRequired === 1 ? '' : 's'} · {plan.cuts.length} cuts totalling {formatLength(totalCuts, unit)}</span>
        <span>{formatArea(plan.orderedAreaM2, unit)} ordered for {formatArea(plan.netAreaM2, unit)} net floor area · {formatPercent(plan.wasteFraction)} waste, including fitting allowances</span>
      </figcaption>
      {unallocatedLength > 1e-6 ? <p className="small warning">The supplier minimum adds {formatLength(unallocatedLength, unit)} to the order. Its allocation across these rolls needs confirmation.</p> : null}
      <p className="small muted roll-waste-explainer">Hatching shows material outside the cutting blanks. The difference from net floor area also includes trimming and allowances within the blanks.</p>
    </figure>
  );
}

function PhysicalRoll({ roll, plan, assigned, product, unit, rollHeightPx, maxWidthPx, onOpenDestination }: {
  roll: DisplayRoll; plan: RollPlan; assigned: boolean; product: RollDisplayProduct | undefined; unit: Unit;
  rollHeightPx: number; maxWidthPx: number; onOpenDestination: ((id: string) => void) | undefined;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hatchId = `roll-hatch-${uid}`;
  const arrowId = `roll-arrow-${uid}`;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pieceById = new Map(plan.pieces.map((piece) => [piece.id, piece]));
  const entries: PieceEntry[] = roll.cuts.flatMap((cut) => cut.pieces.map((cp, index) => ({
    piece: pieceById.get(cp.pieceId), id: cp.pieceId, reference: pieceReference(cut.index, index), cutIndex: cut.index,
    width: cp.width, length: cp.length,
  })));
  const selected = entries.find((entry) => entry.id === selectedId);
  const activeOwner = selected?.piece?.ownerId ?? (entries.some((entry) => entry.piece?.ownerId === selectedOwner) ? selectedOwner : null);
  const destinations = Array.from(new Set(entries.map((entry) => entry.piece?.ownerId ?? entry.id))).map((ownerId) => {
    const pieces = entries.filter((entry) => (entry.piece?.ownerId ?? entry.id) === ownerId);
    return { ownerId, name: pieces[0]?.piece?.ownerName ?? 'Unknown destination', pieces, cuts: Array.from(new Set(pieces.map((entry) => entry.cutIndex + 1))) };
  });
  const selectPiece = (id: string, reveal = false) => {
    setSelectedId(id);
    setSelectedOwner(null);
    if (reveal) {
      Array.from(svg.current?.querySelectorAll<SVGGElement>('[data-piece-id]') ?? [])
        .find((element) => element.dataset.pieceId === id)?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  };
  const cutSize = (length: number) => unit === 'metric' ? formatLength(length, unit, 3) : `${(length / MM_PER_INCH).toFixed(2)} in`;
  const dims = (entry: PieceEntry) => `${cutSize(entry.length)} × ${cutSize(entry.width)}`;
  const entryName = (entry: PieceEntry) => `${entry.reference} · ${entry.piece?.ownerName ?? 'Unknown destination'} · ${entry.piece?.label ?? entry.id}`;
  const rollTitle = assigned ? `Roll ${roll.number}` : 'Combined cuts';
  const left = 48;
  const top = 48;
  const gap = 7;
  const padding = gap * Math.max(0, roll.cuts.length - 1);
  const tailLength = Math.max(0, roll.orderLength - roll.cutLength);
  const totalLength = Math.max(roll.orderLength, roll.cutLength);
  const scale = Math.max(0.001, Math.min(rollHeightPx / plan.rollWidth, (maxWidthPx - padding - left - 16) / totalLength));
  const rollH = plan.rollWidth * scale;
  const svgW = left + totalLength * scale + padding + 16;
  const svgH = top + rollH + 12;
  let nextX = left;
  const cutX = roll.cuts.map((cut) => { const value = nextX; nextX += cut.length * scale + gap; return value; });
  const tailX = left + roll.cutLength * scale + padding;

  return (
    <section className="physical-roll" data-testid="physical-roll" data-roll-number={roll.number} aria-label={`${rollTitle} for ${product?.name ?? 'roll goods'}`}>
      <header className="physical-roll-header">
        <div><h5>{rollTitle}</h5><span className="small muted">{roll.cuts.length} cut{roll.cuts.length === 1 ? '' : 's'} · {entries.length} pieces</span></div>
        <div className="physical-roll-order"><strong>{formatLength(roll.orderLength, unit)} to order</strong><span>{formatLength(plan.rollWidth, unit)} wide</span></div>
      </header>
      {!assigned ? <p className="small warning">Individual roll assignments are unavailable. This view shows all cuts together.</p> : null}
      {roll.exceedsMaximum ? <p className="small warning error" role="status">This allocation exceeds the supplier's maximum roll length. Resolve the planning errors before ordering.</p> : null}
      <div className="roll-cut-scroll" tabIndex={0} role="region" aria-label={`Scrollable cutting diagram: ${rollTitle}, ${product?.name ?? 'roll goods'}`}>
        <svg ref={svg} className="diagram roll-cut-diagram" width={fmt(svgW)} height={fmt(svgH)} style={{ width: svgW, height: svgH, maxWidth: 'none' }} viewBox={`0 0 ${fmt(svgW)} ${fmt(svgH)}`} role="group" aria-label={`${rollTitle}: ${formatLength(roll.orderLength, unit)} long by ${formatLength(plan.rollWidth, unit)} wide`}>
          <defs>
            <pattern id={hatchId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f6f6f4" /><line x1="0" y1="0" x2="0" y2="8" stroke="#b7bcb9" strokeWidth="2" /></pattern>
            <marker id={arrowId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#53645c" /></marker>
          </defs>
          <g aria-hidden="true" className="roll-axis">
            <line x1={left} y1="13" x2={Math.max(left + 24, svgW - 16)} y2="13" stroke="#53645c" markerEnd={`url(#${arrowId})`} />
            <text x={left + 5} y="10" className="roll-direction-label">{product?.kind === 'sheet_vinyl' ? 'Roll length →' : 'Roll length / pile →'}</text>
            <line x1={left - 10} y1={top} x2={left - 10} y2={top + rollH} stroke="#53645c" />
            <line x1={left - 14} y1={top} x2={left - 6} y2={top} stroke="#53645c" />
            <line x1={left - 14} y1={top + rollH} x2={left - 6} y2={top + rollH} stroke="#53645c" />
            <text transform={`translate(${left - 22} ${top + rollH / 2}) rotate(-90)`} textAnchor="middle" dominantBaseline="central">{formatLength(plan.rollWidth, unit)} wide</text>
          </g>
          {roll.cuts.map((cut, ci) => {
            const cx = cutX[ci]!;
            const cw = cut.length * scale;
            return <g key={cut.index} className="roll-cut" data-cut-index={cut.index}>
              <rect x={fmt(cx)} y={top} width={fmt(cw)} height={fmt(rollH)} fill={`url(#${hatchId})`} stroke="#66766e"><title>Cut {cut.index + 1}: {formatLength(cut.length, unit)} along the roll</title></rect>
              <text x={fmt(cx + cw / 2)} y={top - 8} textAnchor="middle" className="cut-label">{cw < 95 ? `Cut ${cut.index + 1}` : `Cut ${cut.index + 1} · ${formatLength(cut.length, unit)}`}</text>
              {cut.pieces.map((cp, pi) => {
                const piece = pieceById.get(cp.pieceId);
                const entry = entries.find((item) => item.id === cp.pieceId)!;
                const px = cx;
                const py = top + cp.x * scale;
                const pw = cp.length * scale;
                const ph = cp.width * scale;
                const colour = destinationColour(piece?.ownerId ?? cp.pieceId);
                const isSelected = selected?.id === cp.pieceId;
                const isActive = isSelected || (!selected && activeOwner === piece?.ownerId);
                const dimmed = !!(selected || activeOwner) && !isActive;
                const code = pieceReference(cut.index, pi);
                const lines = ph >= 57 ? 3 : ph >= 34 ? 2 : 1;
                const labelY = py + ph / 2 - (lines - 1) * 7;
                return <g key={cp.pieceId} className={`roll-piece${isActive ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}`} data-piece-id={cp.pieceId} data-owner-id={piece?.ownerId} data-role={piece?.role ?? 'unknown'} role="button" tabIndex={0} aria-pressed={isActive} aria-label={`${entryName(entry)}: ${dims(entry)}, length along roll by width across`} onClick={() => selectPiece(cp.pieceId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPiece(cp.pieceId); } }}>
                  <rect className="destination-piece" x={fmt(px)} y={fmt(py)} width={fmt(pw)} height={fmt(ph)} style={{ fill: colour.fill, stroke: isActive ? '#152d24' : colour.stroke }} strokeWidth={isActive ? 3 : 1}><title>{entryName(entry)}: {dims(entry)}</title></rect>
                  {pw >= 22 && ph >= 16 ? <text className="destination-piece-label" x={fmt(px + 5)} y={fmt(labelY)} dominantBaseline="central" pointerEvents="none">
                    <tspan fontWeight="700">{clip(pw >= 75 ? `${code} · ${piece?.ownerName ?? 'Piece'}` : code, (pw - 10) / 6.2)}</tspan>
                    {lines >= 2 ? <tspan x={fmt(px + 5)} dy="14">{clip(piece?.label ?? 'Piece', (pw - 10) / 6.2)}</tspan> : null}
                    {lines >= 3 ? <tspan x={fmt(px + 5)} dy="14">{clip(dims(entry), (pw - 10) / 6.2)}</tspan> : null}
                  </text> : null}
                </g>;
              })}
            </g>;
          })}
          {tailLength > 1e-6 ? <rect className="roll-order-tail" x={fmt(tailX)} y={top} width={fmt(tailLength * scale)} height={fmt(rollH)} fill={`url(#${hatchId})`} stroke="#7f8983" strokeDasharray="3 2"><title>Extra ordered length: {formatLength(tailLength, unit)}</title></rect> : null}
        </svg>
      </div>
      <div className="roll-diagram-key small muted"><span><i className="roll-hatch-swatch" aria-hidden="true" /> Offcuts / spare material</span><span>Length → · Width ↕</span>{tailLength > 1e-6 ? <span>{formatLength(tailLength, unit)} uncut material included in the order</span> : null}</div>
      <h6 className="roll-destination-heading">{entries.length ? 'Where these pieces go' : 'Uncut reserve'}</h6>
      <div className="roll-destinations" aria-label={`Destinations for ${rollTitle}`}>
        {destinations.map((destination) => {
          const colour = destinationColour(destination.ownerId);
          return <button type="button" key={destination.ownerId} className={`roll-destination${activeOwner === destination.ownerId ? ' is-selected' : ''}`} aria-label={`Highlight ${destination.name}: ${destination.pieces.length} piece${destination.pieces.length === 1 ? '' : 's'} from ${rollTitle}`} aria-pressed={activeOwner === destination.ownerId} onClick={() => {
            if (destination.pieces.length === 1) selectPiece(destination.pieces[0]!.id);
            else { setSelectedId(null); setSelectedOwner(destination.ownerId); }
          }}>
            <i className="destination-swatch" style={{ backgroundColor: colour.fill, borderColor: colour.stroke }} aria-hidden="true" />
            <span><strong>{destination.name}</strong><small>{destination.pieces.length} piece{destination.pieces.length === 1 ? '' : 's'} · Cut{destination.cuts.length === 1 ? '' : 's'} {destination.cuts.join(', ')}</small></span>
          </button>;
        })}
      </div>
      <div className="roll-selection" role="status" aria-live="polite">
        {selected ? <><strong>{entryName(selected)}</strong><span>{dims(selected)} · length along roll × width across · {selected.piece ? ROLE_LABELS[selected.piece.role] : 'Piece'}</span></>
          : activeOwner ? <><strong>{destinations.find((destination) => destination.ownerId === activeOwner)?.name}</strong><span>All pieces for this destination are highlighted. Select a piece for its dimensions.</span></>
          : <span className="muted">{entries.length ? 'Select a piece above, or choose a destination to highlight its pieces.' : 'This roll is included in the purchase as spare material. No pieces are assigned to it.'}</span>}
        {selected || activeOwner ? <div className="roll-selection-actions no-print">{activeOwner && onOpenDestination ? <button type="button" className="link" onClick={() => onOpenDestination(activeOwner)}>Open {selected?.piece?.ownerName ?? destinations.find((destination) => destination.ownerId === activeOwner)?.name}</button> : null}<button type="button" className="link" onClick={() => { setSelectedId(null); setSelectedOwner(null); }}>Show all pieces</button></div> : null}
      </div>
      <details className="roll-piece-details">
        <summary>Cut list &amp; dimensions <span className="muted">· {entries.length} pieces</span></summary>
        <div className="table-scroll"><table className="data cuts-table" aria-label={`Cuts for ${product?.name ?? 'roll goods'}, ${rollTitle}`}>
          <thead><tr><th scope="col">Cut</th><th scope="col">Piece → destination</th><th scope="col">Size: length × width</th></tr></thead>
          {roll.cuts.map((cut) => <tbody key={cut.index} data-testid="cut-row">
            {cut.pieces.map((cp, index) => {
              const entry = entries.find((item) => item.id === cp.pieceId)!;
              const colour = destinationColour(entry.piece?.ownerId ?? entry.id);
              return <tr key={cp.pieceId} className={selected?.id === cp.pieceId ? 'is-selected' : undefined}>
                {index === 0 ? <th scope="rowgroup" rowSpan={cut.pieces.length}>Cut {cut.index + 1}<small>{cutSize(cut.length)} long</small></th> : null}
                <td><button type="button" className="roll-piece-link" aria-pressed={selected?.id === cp.pieceId} onClick={() => selectPiece(cp.pieceId, true)}><i className="destination-swatch" style={{ backgroundColor: colour.fill, borderColor: colour.stroke }} aria-hidden="true" /><span><strong>{entry.reference} · {entry.piece?.ownerName ?? 'Unknown destination'}</strong><small>{entry.piece?.label ?? entry.id}</small></span></button></td>
                <td className="roll-piece-dimensions">{dims(entry)}</td>
              </tr>;
            })}
          </tbody>)}
        </table></div>
      </details>
    </section>
  );
}

function clip(value: string, maxChars: number): string {
  const limit = Math.max(2, Math.floor(maxChars));
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
