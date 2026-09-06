/**
 * ResultsPanel: the estimate, in two shapes.
 *
 * - COMPACT (`<ResultsPanel />`, the sidebar column): the four figures a fitter quotes from — net
 *   floor area, materials, labour and the total — then one line per roll plan ("Hall carpet 4 m:
 *   6.3 lm, 5 cuts, 1 seam, 47.7% waste"), a line per pack product, the five most severe warnings
 *   and a button through to the full page.
 * - EXPANDED (`<ResultsPanel expanded />`, the Estimate tab): the same figures plus waste and rolls,
 *   every warning grouped by level, a cutting plan per broadloom product (diagram, cuts, offcuts and
 *   a roll-width comparison), a card per room and staircase, the priced bill of materials, and CSV
 *   / print export.
 *
 * All numbers come from `useEstimate()`, which never throws: an engine bug surfaces as an
 * `ENGINE_ERROR` warning in the list rather than a blank column.
 */
import { useProjectStore } from '@store/projectStore';
import { useEstimate, useRollWidthComparison } from '@store/useEstimate';
import type { BomLine, BroadloomProduct, CutPiece, Id, Product, Project, RollPlan } from '@engine/types';
import type { ProjectEstimate } from '@engine/estimate';
import { MM_PER_M, roundTo } from '@engine/units';
import { formatArea, formatLength, formatMoney } from '@ui/components/inputs';
import { BomTable } from './BomTable';
import { RollCutDiagram, formatPercent } from './RollCutDiagram';
import { RoomResults, StairResults } from './RoomResults';
import { Warnings, subjectName } from './Warnings';
import { downloadText, safeFileName, toCsv } from './csv';

type Unit = 'metric' | 'imperial';

/** BOM ids for a covering line are `bom:covering:<productId>` (see engine/estimate.ts). */
export const COVERING_LINE_PREFIX = 'bom:covering:';

export function isBroadloom(product: Product | undefined): product is BroadloomProduct {
  return product !== undefined && (product.kind === 'carpet' || product.kind === 'sheet_vinyl');
}

/** Linear metres off the roll, the unit broadloom is ordered and priced in: "6.3 lm". */
export function formatLm(mm: number): string {
  return `${roundTo(mm / MM_PER_M, 2)} lm`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every seam the plan makes, across all of its rooms. */
export function seamCount(plan: RollPlan): number {
  return Object.values(plan.seamsByRoom).reduce((sum, seams) => sum + seams.length, 0);
}

/**
 * The one-line summary of a cutting plan:
 * "Hall, stairs & landing carpet — 4.00 m: 6.3 lm, 5 cuts, 1 seam, 47.7% waste".
 */
export function rollPlanSummary(plan: RollPlan, product: Product | undefined, unit: Unit): string {
  const name = product?.name ?? 'Roll goods';
  const parts = [formatLm(plan.orderLength), plural(plan.cuts.length, 'cut'), plural(seamCount(plan), 'seam'), `${formatPercent(plan.wasteFraction)} waste`];
  return `${name} — ${formatLength(plan.rollWidth, unit)}: ${parts.join(', ')}`;
}

export interface PackSummary {
  lineId: Id;
  productId: Id | undefined;
  name: string;
  quantity: number;
  unit: string;
}

/** Pack-sold coverings (laminate, LVT, tiles) from the BOM: "Oak effect laminate: 4 packs". */
export function packSummaries(estimate: ProjectEstimate, project: Project): PackSummary[] {
  return estimate.bom
    .filter((l: BomLine) => l.category === 'floor_covering' && l.unit !== 'lm')
    .map((l) => {
      const productId = l.id.startsWith(COVERING_LINE_PREFIX) ? l.id.slice(COVERING_LINE_PREFIX.length) : undefined;
      const product = productId ? project.products.find((p) => p.id === productId) : undefined;
      return {
        lineId: l.id,
        productId,
        name: product?.name ?? l.description,
        quantity: l.quantity,
        unit: l.unit,
      };
    });
}

/** Waste across all roll goods: (ordered − net) / ordered, or undefined when nothing is off a roll. */
export function overallWaste(plans: RollPlan[]): number | undefined {
  const ordered = plans.reduce((s, p) => s + p.orderedAreaM2, 0);
  const net = plans.reduce((s, p) => s + p.netAreaM2, 0);
  if (!(ordered > 0)) return undefined;
  return (ordered - net) / ordered;
}

/** The bill of materials as a CSV document, with room names and the project's totals. */
export function bomCsv(estimate: ProjectEstimate, project: Project): string {
  return toCsv(estimate.bom, {
    totals: estimate.totals,
    subjectName: (id) => subjectName(project, id),
    currency: project.prices.currency,
    applyVat: project.prices.applyVat,
    vatRate: project.prices.vatRate,
  });
}

/** File name for the CSV export: "3-bed_semi-bill-of-materials.csv". */
export function bomCsvFileName(project: Project): string {
  return `${safeFileName(project.name, 'estimate')}-bill-of-materials.csv`;
}

// ---------------------------------------------------------------------------
// Pieces of the panel
// ---------------------------------------------------------------------------

function Kpi({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="kpi">
      <div className="value" data-testid={testId}>
        {value}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}

function SummaryKpis({ estimate, project, expanded }: { estimate: ProjectEstimate; project: Project; expanded?: boolean }) {
  const unit: Unit = project.displayUnit;
  const currency = project.prices.currency;
  const applyVat = project.prices.applyVat;
  const totals = estimate.totals;
  const waste = overallWaste(estimate.rollPlans);
  const rolls = estimate.rollPlans.reduce((s, p) => s + p.rollsRequired, 0);

  return (
    <div className="kpis" data-testid="results-kpis">
      <Kpi label="Net floor area" value={formatArea(totals.netAreaM2, unit)} testId="kpi-net-area" />
      <Kpi label="Materials" value={formatMoney(totals.materialsCost, currency)} testId="kpi-materials" />
      <Kpi label="Labour" value={formatMoney(totals.labourCost, currency)} testId="kpi-labour" />
      <Kpi
        label={applyVat ? 'Total inc VAT' : 'Subtotal (no VAT)'}
        value={formatMoney(applyVat ? totals.total : totals.subtotal, currency)}
        testId="kpi-total"
      />
      {expanded && waste !== undefined ? <Kpi label="Waste on roll goods" value={formatPercent(waste)} testId="kpi-waste" /> : null}
      {expanded && estimate.rollPlans.length > 0 ? <Kpi label="Rolls required" value={String(rolls)} testId="kpi-rolls" /> : null}
    </div>
  );
}

/** One broadloom product: cutting diagram, the cuts, the offcuts and the roll-width comparison. */
function RollPlanSection({ plan, project, unit }: { plan: RollPlan; project: Project; unit: Unit }) {
  const product = project.products.find((p) => p.id === plan.productId);
  const name = product?.name ?? 'Roll goods';
  const comparison = useRollWidthComparison(plan.productId);
  const pieceById = new Map<Id, CutPiece>(plan.pieces.map((p) => [p.id, p]));
  const bestIndex = comparison.reduce((best, row, i) => (row.orderedAreaM2 < (comparison[best]?.orderedAreaM2 ?? Infinity) - 1e-9 ? i : best), 0);

  return (
    <section className="roll-plan-section" data-testid="roll-plan-section" data-product-id={plan.productId}>
      <h4>{name}</h4>
      <p className="muted small roll-plan-summary" data-testid="roll-plan-summary">
        {rollPlanSummary(plan, product, unit)}
      </p>

      <RollCutDiagram plan={plan} product={isBroadloom(product) ? product : undefined} unit={unit} />

      <div className="table-scroll">
        <table className="data cuts-table" aria-label={`Cuts for ${name}`}>
          <thead>
            <tr>
              <th scope="col">Cut</th>
              <th scope="col" className="num">
                Length
              </th>
              <th scope="col">Pieces (length along the roll × width across)</th>
            </tr>
          </thead>
          <tbody>
            {plan.cuts.map((cut) => (
              <tr key={cut.index} data-testid="cut-row">
                <th scope="row">{cut.index + 1}</th>
                <td className="num">{formatLength(cut.length, unit)}</td>
                <td>
                  <ul className="plain cut-pieces">
                    {cut.pieces.map((cp) => {
                      const piece = pieceById.get(cp.pieceId);
                      return (
                        <li key={cp.pieceId}>
                          {piece?.ownerName ? <b>{piece.ownerName}</b> : null} {piece?.label ?? cp.pieceId}{' '}
                          <span className="muted">
                            {formatLength(cp.length, unit)} × {formatLength(cp.width, unit)}
                          </span>
                        </li>
                      );
                    })}
                    {cut.pieces.length === 0 ? <li className="muted">no pieces</li> : null}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h5>Offcuts</h5>
      {plan.offcuts.length === 0 ? (
        <p className="muted small">No offcuts from this plan.</p>
      ) : (
        <ul className="plain offcut-list" aria-label={`Offcuts from ${name}`}>
          {plan.offcuts.map((o, i) => (
            <li key={`${o.fromCutIndex}-${i}`} data-testid="offcut" data-usable={o.usable ? 'true' : 'false'}>
              {formatLength(o.width, unit)} × {formatLength(o.length, unit)}{' '}
              <span className="muted small">
                ({formatArea(o.areaM2, unit)}, from cut {o.fromCutIndex + 1})
              </span>{' '}
              {o.usable ? <span className="badge ok">Usable</span> : <span className="badge">Too small to reuse</span>}
            </li>
          ))}
        </ul>
      )}

      {comparison.length > 1 ? (
        <>
          <h5>Compare roll widths</h5>
          <div className="table-scroll">
            <table className="data compare-table" data-testid="compare-table" aria-label={`Roll width comparison for ${name}`}>
              <thead>
                <tr>
                  <th scope="col">Roll width</th>
                  <th scope="col" className="num">
                    To order
                  </th>
                  <th scope="col" className="num">
                    Ordered area
                  </th>
                  <th scope="col" className="num">
                    Waste
                  </th>
                  <th scope="col" className="num">
                    Seams
                  </th>
                  <th scope="col" className="num">
                    Rolls
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, i) => (
                  <tr
                    key={row.rollWidth}
                    className={i === bestIndex ? 'compare-best' : undefined}
                    data-testid="compare-row"
                    data-roll-width={row.rollWidth}
                    data-best={i === bestIndex ? 'true' : 'false'}
                  >
                    <th scope="row">
                      {formatLength(row.rollWidth, unit)}
                      {row.rollWidth === plan.rollWidth ? <span className="badge">Current</span> : null}
                      {i === bestIndex ? <span className="badge ok">Least material</span> : null}
                    </th>
                    <td className="num">{formatLm(row.orderLength)}</td>
                    <td className="num">{formatArea(row.orderedAreaM2, unit)}</td>
                    <td className="num">{formatPercent(row.wasteFraction)}</td>
                    <td className="num">{row.seams}</td>
                    <td className="num">{row.rollsRequired}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Shown when there is nothing to estimate yet. */
function EmptyEstimate({ expanded }: { expanded?: boolean }) {
  const addRoom = useProjectStore((s) => s.addRoom);
  const addStaircase = useProjectStore((s) => s.addStaircase);
  const setTab = useProjectStore((s) => s.setTab);
  const start = (add: () => void) => {
    add();
    setTab('rooms');
  };
  return (
    <div className={expanded ? 'panel results-panel results-expanded' : 'results-panel results-compact'} data-testid="results-panel">
      <h2>Estimate</h2>
      <div className="empty" data-testid="results-empty">
        Add a room or staircase to see the estimate.
      </div>
      <div className="row results-empty-actions no-print">
        <button type="button" className="primary" onClick={() => start(addRoom)}>
          + Add a room
        </button>
        <button type="button" onClick={() => start(addStaircase)}>
          + Add stairs
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function ResultsPanel({ expanded }: { expanded?: boolean }) {
  const project = useProjectStore((s) => s.project);
  const setTab = useProjectStore((s) => s.setTab);
  const estimate = useEstimate();
  const unit: Unit = project.displayUnit;

  if (project.rooms.length === 0 && project.staircases.length === 0) {
    return <EmptyEstimate expanded={expanded} />;
  }

  const packs = packSummaries(estimate, project);

  if (!expanded) {
    return (
      <div className="results-panel results-compact" data-testid="results-panel">
        <h2>Estimate</h2>
        <SummaryKpis estimate={estimate} project={project} />

        {estimate.rollPlans.length > 0 || packs.length > 0 ? (
          <ul className="plain results-lines" aria-label="Floor coverings">
            {estimate.rollPlans.map((plan) => (
              <li key={plan.productId} data-testid="compact-roll-line">
                {rollPlanSummary(plan, project.products.find((p) => p.id === plan.productId), unit)}
              </li>
            ))}
            {packs.map((p) => (
              <li key={p.lineId} data-testid="compact-pack-line">
                {p.name}: {plural(p.quantity, p.unit, p.unit === 'box' ? 'boxes' : `${p.unit}s`)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No floor covering planned yet — check every room has a product.</p>
        )}

        <Warnings
          warnings={estimate.warnings}
          project={project}
          max={5}
          emptyText="No warnings."
          onShowMore={() => setTab('results')}
        />

        <div className="row results-actions no-print">
          <button type="button" className="primary" onClick={() => setTab('results')}>
            Open full estimate
          </button>
        </div>
      </div>
    );
  }

  const rooms = project.rooms;
  const staircases = project.staircases;

  return (
    <div className="results-panel results-expanded" data-testid="results-panel">
      <section className="panel results-summary">
        <header className="results-head">
          <h2>Estimate — {project.name}</h2>
          <div className="row no-print results-actions">
            <button type="button" onClick={() => downloadText(bomCsvFileName(project), bomCsv(estimate, project))}>
              Download BOM (CSV)
            </button>
            <button type="button" onClick={() => typeof window !== 'undefined' && typeof window.print === 'function' && window.print()}>
              Print
            </button>
          </div>
        </header>
        <SummaryKpis estimate={estimate} project={project} expanded />
        <h3>Warnings</h3>
        <Warnings warnings={estimate.warnings} project={project} grouped emptyText="Nothing to flag — the estimate is clean." />
      </section>

      {estimate.rollPlans.length > 0 ? (
        <section className="panel results-coverings">
          <h3>Floor coverings</h3>
          {estimate.rollPlans.map((plan) => (
            <RollPlanSection key={plan.productId} plan={plan} project={project} unit={unit} />
          ))}
        </section>
      ) : null}

      {rooms.length > 0 ? (
        <section className="results-rooms">
          <h3 className="results-group-heading">Rooms</h3>
          {rooms.map((room) => (
            <RoomResults key={room.id} room={room} summary={estimate.rooms[room.id]} estimate={estimate} project={project} />
          ))}
        </section>
      ) : null}

      {staircases.length > 0 ? (
        <section className="results-stairs">
          <h3 className="results-group-heading">Stairs</h3>
          {staircases.map((staircase) => (
            <StairResults
              key={staircase.id}
              staircase={staircase}
              summary={estimate.staircases[staircase.id]}
              estimate={estimate}
              project={project}
            />
          ))}
        </section>
      ) : null}

      <section className="panel results-bom">
        <h3>Bill of materials</h3>
        <BomTable lines={estimate.bom} totals={estimate.totals} project={project} />
      </section>
    </div>
  );
}
