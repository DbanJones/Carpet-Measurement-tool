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
import { useEffect, useState } from 'react';
import { useProjectStore } from '@store/projectStore';
import { useEstimate, useRollWidthComparison } from '@store/useEstimate';
import type { BomLine, BroadloomProduct, Id, Product, Project, RollPlan } from '@engine/types';
import type { ProjectEstimate } from '@engine/estimate';
import { MM_PER_M, roundTo } from '@engine/units';
import { Field, formatArea, formatLength, formatMoney } from '@ui/components/inputs';
import { BomTable } from './BomTable';
import { RollCutDiagram, formatPercent } from './RollCutDiagram';
import { RoomResults, StairResults } from './RoomResults';
import { Warnings, subjectName } from './Warnings';
import { downloadText, rowsToCsv, safeFileName, toCsv } from './csv';
import { estimateStatus } from './status';
import { ClientPack, clientPackHtml, costGroups } from './ClientPack';
import './results.css';

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
    // the recommended spare pack is not part of what covers the floor: it is offered separately
    .filter((l: BomLine) => l.category === 'floor_covering' && (l.unit === 'pack' || l.unit === 'box') && !l.id.endsWith(':spare'))
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
  const status = estimateStatus(estimate);
  const csv = toCsv(estimate.bom, {
    totals: status.failed ? undefined : estimate.totals,
    subjectName: (id) => subjectName(project, id),
    currency: project.prices.currency,
    applyVat: project.prices.applyVat,
    vatRate: project.prices.vatRate,
  });
  if (!status.incomplete) return csv;
  const message = status.failed ? 'Estimate unavailable. Resolve the calculation error before quoting.'
    : `Partial estimate: ${status.errors.length} errors; ${status.missingPrices.length} items without prices excluded from totals. Review before quoting.`;
  return csv + rowsToCsv([['Status', 'Estimate incomplete', '', '', '', '', '', '', message]]);
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
  const status = estimateStatus(estimate);
  const money = (value: number | undefined) => status.failed ? '—' : formatMoney(value, currency);

  return (
    // The figures change as the user types a width; a screen-reader user has no other way to know.
    <div className="kpis" data-testid="results-kpis" aria-live="polite">
      <Kpi label="Net floor area" value={status.failed ? '—' : formatArea(totals.netAreaM2, unit)} testId="kpi-net-area" />
      <Kpi label="Materials" value={money(totals.materialsCost)} testId="kpi-materials" />
      <Kpi label="Labour" value={money(totals.labourCost)} testId="kpi-labour" />
      <Kpi
        label={status.incomplete ? `Partial total${applyVat ? ' inc VAT' : ' (no VAT)'}` : applyVat ? 'Total inc VAT' : 'Subtotal (no VAT)'}
        value={money(applyVat ? totals.total : totals.subtotal)}
        testId="kpi-total"
      />
      {expanded && waste !== undefined ? <Kpi label="Waste on roll goods" value={formatPercent(waste)} testId="kpi-waste" /> : null}
      {expanded && estimate.rollPlans.length > 0 ? <Kpi label="Rolls required" value={String(rolls)} testId="kpi-rolls" /> : null}
    </div>
  );
}

function EstimateStatus({ estimate }: { estimate: ProjectEstimate }) {
  const setTab = useProjectStore((s) => s.setTab);
  const select = useProjectStore((s) => s.select);
  const products = useProjectStore((s) => s.project.products);
  const status = estimateStatus(estimate);
  if (!status.incomplete) return null;
  return (
    <div className={`estimate-status warning${status.failed || status.errors.length ? ' error' : ''}`} role="status">
      <strong>{status.failed ? 'Estimate unavailable' : 'Estimate incomplete'}</strong>
      {status.failed ? <p>Check the calculation error below. Figures are unavailable until it is resolved.</p> : (
        <>
          {status.errors.length > 0 ? <p>Resolve the errors below. The amount shown covers only the items calculated so far.</p> : null}
          {status.missingPrices.length > 0 ? (
            <>
              <p>{plural(status.missingPrices.length, 'item')} {status.missingPrices.length === 1 ? 'has' : 'have'} no price and {status.missingPrices.length === 1 ? 'is' : 'are'} excluded from the total.</p>
              <details><summary>See items without prices</summary><ul>{status.missingPrices.map((line) => <li key={line.id}>{line.description}</li>)}</ul></details>
              <button type="button" className="link no-print" onClick={() => {
                const product = products.find((p) => status.missingPrices.some((line) => line.id === `${COVERING_LINE_PREFIX}${p.id}`));
                if (product) select({ kind: 'product', id: product.id });
                setTab('materials');
              }}>Add missing prices</button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One broadloom product: cutting diagram, the cuts, the offcuts and the roll-width comparison. */
function RollPlanSection({ plan, project, unit }: { plan: RollPlan; project: Project; unit: Unit }) {
  const updateProduct = useProjectStore((s) => s.updateProduct);
  const { select, setTab } = useProjectStore();
  const product = project.products.find((p) => p.id === plan.productId);
  const name = product?.name ?? 'Roll goods';
  const comparison = useRollWidthComparison(plan.productId);

  const bestIndex = comparison.reduce((best, row, i) => row.warnings.some((warning) => warning.level === 'error')
    ? best : row.orderedAreaM2 < (comparison[best]?.orderedAreaM2 ?? Infinity) - 1e-9 ? i : best, -1);

  return (
    <section className="roll-plan-section" data-testid="roll-plan-section" data-product-id={plan.productId}>
      <h4>{name}</h4>
      <p className="muted small roll-plan-summary" data-testid="roll-plan-summary">
        {rollPlanSummary(plan, product, unit)}
      </p>

      <RollCutDiagram plan={plan} product={isBroadloom(product) ? product : undefined} unit={unit} onOpenDestination={(ownerId) => {
        if (project.rooms.some((room) => room.id === ownerId)) select({ kind: 'room', id: ownerId });
        else if (project.staircases.some((stair) => stair.id === ownerId)) select({ kind: 'staircase', id: ownerId });
        else return;
        setTab('rooms');
      }} />

      <details className="roll-detail" data-print-expand><summary>Offcut inventory · {plan.offcuts.length} pieces</summary>
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

      </details>
      {comparison.length > 1 ? (
        <details className="roll-detail"><summary>Compare roll widths · {formatLength(plan.rollWidth, unit)} selected</summary>
          <p className="small muted">Includes standard widths for this flooring type. Confirm your supplier offers the chosen width before ordering.</p>
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
                  <th scope="col" className="no-print">Choose</th>
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
                    <td className="no-print">
                      <button
                        type="button"
                        disabled={row.rollWidth === plan.rollWidth || row.warnings.some((warning) => warning.level === 'error')}
                        aria-label={`Use ${formatLength(row.rollWidth, unit)} roll for ${name}`}
                        onClick={() => {
                          if (!isBroadloom(product)) return;
                          updateProduct(product.id, {
                            rollWidth: row.rollWidth,
                            alternativeRollWidths: Array.from(new Set([product.rollWidth, ...(product.alternativeRollWidths ?? [])])).filter((width) => width !== row.rollWidth),
                          });
                        }}
                      >{row.rollWidth === plan.rollWidth ? 'Selected' : 'Use width'}</button>
                      {row.warnings.some((warning) => warning.level === 'error') ? (
                        <details className="small"><summary>Planning errors</summary><ul>{row.warnings.filter((warning) => warning.level === 'error').map((warning, index) => <li key={index}>{warning.message}</li>)}</ul></details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Choosing a width updates this product in every room and staircase. Compare seams as well as material used.</p>
        </details>
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
  const [view, setView] = useState<'overview' | 'cuts' | 'spaces' | 'costs' | 'client'>('overview');
  const [includePlans, setIncludePlans] = useState(true);
  useEffect(() => {
    if (!expanded) return;
    let previous: [HTMLDetailsElement, boolean][] = [];
    const before = () => {
      if (previous.length) return;
      previous = [...document.querySelectorAll<HTMLDetailsElement>('.results-expanded details[data-print-expand]')].map((el) => [el, el.open]);
      previous.forEach(([el]) => { el.open = true; });
    };
    const after = () => { previous.forEach(([el, open]) => { el.open = open; }); previous = []; };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { after(); window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, [expanded]);
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
        <EstimateStatus estimate={estimate} />
        <div className="row results-actions no-print">
          <button type="button" className="primary" onClick={() => setTab('results')}>
            Open full estimate
          </button>
        </div>

        {estimate.rollPlans.length > 0 || packs.length > 0 ? (
          <details className="compact-coverings">
          <summary>Floor coverings ({estimate.rollPlans.length + packs.length} products)</summary>
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
          </details>
        ) : (
          <p className="muted small">No floor covering planned yet — check every room has a product.</p>
        )}

        <Warnings
          warnings={estimate.warnings}
          project={project}
          max={2}
          emptyText="No warnings."
          onShowMore={() => setTab('results')}
        />
      </div>
    );
  }

  const rooms = project.rooms;
  const staircases = project.staircases;

  return (
    <div className={`results-panel results-expanded estimate-workspace${view === 'client' ? ' printing-client-pack' : ''}`} data-testid="results-panel">
      <header className="estimate-workspace-header no-print">
        <div><div className="eyebrow">REVIEW & SHARE</div><h2>{project.name}</h2><p className="muted">{project.customer || 'Your project estimate'}{project.quoteRef ? ` · ${project.quoteRef}` : ''}</p></div>
        <button type="button" className="primary" onClick={() => setView('client')}>Prepare client pack</button>
      </header>
      <nav className="estimate-nav no-print" aria-label="Estimate sections">
        {([['overview', 'Overview'], ['cuts', 'Cutting plans'], ['spaces', `Rooms & stairs (${rooms.length + staircases.length})`], ['costs', 'Order list & costs'], ['client', 'Client pack']] as const).map(([key, label]) =>
          <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>{label}</button>)}
      </nav>
      <section className="panel results-summary estimate-section" id="estimate-summary" hidden={view !== 'overview'}>
        <QuoteDetails project={project} />
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
        <div className="estimate-hours-strip"><div><strong>{estimateStatus(estimate).failed ? '—' : estimate.details.labourHours.totalHours.toFixed(1)} person-hours</strong><span>Estimated labour effort, including site allowance</span></div><button type="button" className="link no-print" onClick={() => setTab('settings')}>Adjust labour assumptions →</button></div>
        <EstimateStatus estimate={estimate} />
        <div className="estimate-overview-grid no-print">
          <div><h3>Where the cost goes</h3><div className="cost-bars">{costGroups(estimate).map(group => <div className="cost-bar-row" key={group.category}><div><span>{group.label}</span><strong>{estimateStatus(estimate).failed ? '—' : formatMoney(group.total, project.prices.currency)}</strong></div><div className="cost-bar-track"><span style={{ width: `${Math.max(0, Math.min(100, group.total / (estimate.totals.subtotal || 1) * 100))}%` }} /></div></div>)}</div><button type="button" className="link" onClick={() => setView('costs')}>View quantities & prices →</button></div>
          <div className="estimate-next-steps"><h3>Ready to share?</h3><p>Check the spaces and cutting plans, then add your customer details and prepare the client pack.</p><button type="button" onClick={() => setView('spaces')}>Review {rooms.length + staircases.length} spaces</button><button type="button" onClick={() => setView('cuts')}>Review cutting plans</button><button type="button" className="primary" onClick={() => setView('client')}>Build client pack →</button></div>
        </div>
        {estimate.rollPlans.length > 0 ? <p className="small muted estimate-help">Net area is the surface to cover. Ordered area includes fitting allowances and offcuts. Waste is the share of the ordered roll area outside the net area; some offcuts may be reusable.</p> : null}
        <h3>Checks &amp; assumptions</h3>
        <Warnings warnings={estimate.warnings} project={project} grouped emptyText="Nothing to flag — the estimate is clean." />
      </section>

      {estimate.rollPlans.length > 0 ? (
        <section className="panel results-coverings estimate-section" id="estimate-cutting" hidden={view !== 'cuts'}>
          <h3>Floor coverings</h3>
          {estimate.rollPlans.map((plan) => (
            <RollPlanSection key={plan.productId} plan={plan} project={project} unit={unit} />
          ))}
        </section>
      ) : null}
      {!estimate.rollPlans.length && view === 'cuts' ? <section className="panel no-print"><h3>Cutting plans</h3><p>No roll goods are planned for this project. Pack flooring quantities are in Order list & costs.</p><button type="button" onClick={() => setView('costs')}>View order list</button></section> : null}

      {rooms.length > 0 ? (
        <section className="results-rooms estimate-section" id="estimate-rooms" hidden={view !== 'spaces'}>
          <h3 className="results-group-heading">Rooms</h3>
          {rooms.map((room) => (
            <RoomResults key={room.id} room={room} summary={estimate.rooms[room.id]} estimate={estimate} project={project} />
          ))}
        </section>
      ) : null}

      {staircases.length > 0 ? (
        <section className="results-stairs estimate-section" id="estimate-stairs" hidden={view !== 'spaces'}>
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

      <section className="panel results-bom estimate-section" id="estimate-bom" hidden={view !== 'costs'}>
        <div className="results-head"><div><div className="eyebrow">ORDER & FIT</div><h2>Quantities & costs</h2></div><button type="button" className="no-print" onClick={() => setTab('settings')}>Pricing settings</button></div>
        <details className="labour-calculation" data-print-expand><summary>Estimated time · {estimate.details.labourHours.totalHours.toFixed(1)} person-hours</summary><p className="small muted">Area ÷ fitting speed, plus stair and preparation time, setup and the site allowance. Drying and acclimatisation are excluded. {estimate.details.labourHours.mode === 'hourly' ? 'Priced using your hourly rate.' : 'For planning; labour is charged at your unit rates.'}</p><div className="table-scroll"><table className="data"><thead><tr><th>Activity</th><th>Assumption</th><th>Hours</th></tr></thead><tbody>{estimate.details.labourHours.lines.map(line => <tr key={line.id}><td>{line.description}{line.optional ? ' (optional, excluded)' : ''}</td><td>{line.calculation}</td><td>{line.hours.toFixed(2)}</td></tr>)}</tbody></table></div></details>
        <h3>Bill of materials</h3>
        <BomTable lines={estimate.bom} totals={estimate.totals} project={project} incomplete={estimateStatus(estimate).incomplete} />
        {project.notes?.trim() ? (
          <div className="quote-notes">
            <h4>Notes and terms</h4>
            <p>{project.notes}</p>
          </div>
        ) : null}
      </section>
      {view === 'client' ? <section className="estimate-client-section">
        <div className="panel client-pack-controls no-print"><div className="results-head"><div><h3>Client pack</h3><p className="muted small">A clean proposal with scope, price, plans and your terms.</p></div><div className="row"><button type="button" onClick={() => downloadText(`${safeFileName(project.name)}-client-pack.html`, clientPackHtml(project, estimate, includePlans), 'text/html;charset=utf-8')}>Download client pack</button><button type="button" className="primary" onClick={() => window.print()}>Print / save PDF</button></div></div><QuoteDetails project={project} /><div className="row"><label className="row small"><input type="checkbox" checked={includePlans} onChange={event => setIncludePlans(event.target.checked)} />Include annotated floor plans</label><button type="button" className="link" onClick={() => setTab('settings')}>Business details & terms →</button></div><p className="small muted">Download creates a standalone HTML file with embedded plans. Use Print / save PDF for a PDF copy.</p></div>
        <ClientPack project={project} estimate={estimate} includePlans={includePlans} />
      </section> : null}
    </div>
  );
}

/**
 * Who the quote is for and when. A printed estimate headed with only whatever was typed in the
 * project-name box, and carrying no date, is not something a customer can hold anyone to.
 * The fields are editable here and printed as a block above the figures.
 */
function QuoteDetails({ project }: { project: Project }) {
  const updateProject = useProjectStore((s) => s.updateProject);
  const filled = [project.customer, project.siteAddress, project.quoteRef, project.quoteDate].some((v) => v?.trim());
  return (
    <>
      {filled ? (
        <dl className="quote-header" data-testid="quote-header">
          {project.customer?.trim() ? (
            <div>
              <dt>Customer</dt>
              <dd>{project.customer}</dd>
            </div>
          ) : null}
          {project.siteAddress?.trim() ? (
            <div>
              <dt>Site</dt>
              <dd>{project.siteAddress}</dd>
            </div>
          ) : null}
          {project.quoteRef?.trim() ? (
            <div>
              <dt>Quote ref</dt>
              <dd>{project.quoteRef}</dd>
            </div>
          ) : null}
          {project.quoteDate?.trim() ? (
            <div>
              <dt>Date</dt>
              <dd>{project.quoteDate}</dd>
            </div>
          ) : null}
          {project.validFor?.trim() ? (
            <div>
              <dt>Valid for</dt>
              <dd>{project.validFor}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <details className="quote-details no-print">
        <summary>Quote details (customer, site, reference, date)</summary>
        <div className="grid-2">
          <Field label="Customer">
            <input type="text" value={project.customer ?? ''} aria-label="Customer" onChange={(e) => updateProject({ customer: e.target.value })} />
          </Field>
          <Field label="Site address">
            <input type="text" value={project.siteAddress ?? ''} aria-label="Site address" onChange={(e) => updateProject({ siteAddress: e.target.value })} />
          </Field>
          <Field label="Quote reference">
            <input type="text" value={project.quoteRef ?? ''} aria-label="Quote reference" onChange={(e) => updateProject({ quoteRef: e.target.value })} />
          </Field>
          <Field label="Date" hint="Printed at the head of the estimate.">
            <span className="row">
              <input type="date" value={project.quoteDate ?? ''} aria-label="Quote date" onChange={(e) => updateProject({ quoteDate: e.target.value })} />
              <button type="button" className="link" onClick={() => updateProject({ quoteDate: new Date().toISOString().slice(0, 10) })}>
                Today
              </button>
            </span>
          </Field>
          <Field label="Valid for" hint="How long the price holds, e.g. 30 days.">
            <input type="text" value={project.validFor ?? ''} aria-label="Valid for" onChange={(e) => updateProject({ validFor: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes and terms" hint="Included in the estimate and client pack.">
          <textarea rows={3} value={project.notes ?? ''} aria-label="Notes and terms" onChange={(e) => updateProject({ notes: e.target.value })} />
        </Field>
      </details>
    </>
  );
}
