import { renderToStaticMarkup } from 'react-dom/server';
import type { Project } from '@engine/types';
import type { ProjectEstimate } from '@engine/estimate';
import { formatArea, formatMoney } from '@ui/components/inputs';
import { categoryLabel, BOM_CATEGORY_ORDER } from './csv';
import { estimateStatus } from './status';
import { destinationColour } from './rollDisplay';
import packStyles from './client-pack.css?raw';
import './client-pack.css';

export function costGroups(estimate: ProjectEstimate) {
  return BOM_CATEGORY_ORDER.flatMap(category => {
    const lines = estimate.bom.filter(line => line.category === category && !line.optional && !line.informational);
    return lines.length ? [{ category, label: categoryLabel(category), total: lines.reduce((sum, line) => sum + (line.total ?? 0), 0), missing: lines.filter(line => line.unitPrice === undefined && line.quantity > 0).length }] : [];
  });
}

/** Shareable client-facing scope and price; no internal activity rates or supplier order table. */
export function ClientPack({ project, estimate, includePlans = true }: { project: Project; estimate: ProjectEstimate; includePlans?: boolean }) {
  const status = estimateStatus(estimate);
  const money = (value?: number) => status.failed ? 'Unavailable' : formatMoney(value, project.prices.currency);
  const business = project.business;
  const optional = estimate.bom.filter(line => line.optional && !line.informational);
  return <article className="client-pack" data-testid="client-pack">
    <header className="client-pack-header">
      <div><div className="pack-eyebrow">{business?.name || 'Flooring proposal'}</div><h1>{project.name}</h1><p>{[business?.email, business?.phone, business?.website].filter(Boolean).join(' · ')}</p>{business?.address ? <p className="pack-multiline">{business.address}</p> : null}</div>
      <div className="pack-reference"><strong>{status.incomplete ? 'DRAFT · INCOMPLETE' : 'ESTIMATE'}</strong>{project.quoteRef ? <span>{project.quoteRef}</span> : null}{project.quoteDate ? <span>{project.quoteDate}</span> : null}{project.validFor ? <span>Valid for {project.validFor}</span> : null}</div>
    </header>
    <section className="pack-intro"><div><div className="pack-eyebrow">Prepared for</div><h2>{project.customer || 'Client details to be added'}</h2><p>{project.siteAddress || 'Site address to be confirmed'}</p></div><div className="pack-total"><span>{status.incomplete ? 'Partial estimate' : 'Your estimate'}{project.prices.applyVat ? ' including VAT' : ' · no VAT applied'}</span><strong>{money(project.prices.applyVat ? estimate.totals.total : estimate.totals.subtotal)}</strong></div></section>
    {status.incomplete ? <div className="pack-alert">{status.failed ? 'The estimate could not be calculated. No price is available.' : `This draft has ${status.errors.length} calculation errors and ${status.missingPrices.length} unpriced items. The amount excludes unresolved items and is not a complete quotation.`}</div> : null}
    <section><div className="pack-section-heading"><h2>Your flooring</h2><span>{project.rooms.length} rooms · {project.staircases.length} staircases · {status.failed ? 'Area unavailable' : formatArea(estimate.totals.netAreaM2, project.displayUnit)}</span></div>
      <table><thead><tr><th>Space</th><th>Finish</th><th>Measured scope</th></tr></thead><tbody>
        {project.rooms.map(room => {
          const product = project.products.find(item => item.id === room.productId);
          const pattern = product && 'packCoverageM2' in product ? room.hardFloor?.layPattern ?? product.hardFloor?.layPattern ?? project.options.hardFloor.layPattern : undefined;
          return <tr key={room.id}><th>{room.name}</th><td>{product?.name || 'Product to be selected'}{pattern ? <small>{pattern.replace(/_/g, ' ')}</small> : null}</td><td>{estimate.rooms[room.id] ? formatArea(estimate.rooms[room.id]!.netAreaM2, project.displayUnit) : 'Measurement incomplete'}</td></tr>;
        })}
        {project.staircases.map(stair => <tr key={stair.id}><th>{stair.name}</th><td>{project.products.find(item => item.id === stair.productId)?.name || 'Product to be selected'}<small>{stair.layout?.kind.replace(/_/g, ' ') || 'Staircase'} · {stair.method === 'waterfall' ? 'Waterfall' : 'Individual step pieces'}</small></td><td>{stair.steps.length} risers{stair.landings.length ? ` · ${stair.landings.length} landings` : ''}</td></tr>)}
      </tbody></table>
    </section>
    <section><h2>Price breakdown</h2><div className="pack-price-list">{costGroups(estimate).map(group => <div key={group.category}><span>{group.label}{group.missing ? <small>{group.missing} item(s) awaiting a price</small> : null}</span><strong>{money(group.total)}</strong></div>)}
      {project.prices.applyVat ? <><div className="pack-subtotal"><span>Subtotal</span><strong>{money(estimate.totals.subtotal)}</strong></div><div><span>VAT ({Math.round(project.prices.vatRate * 1000) / 10}%)</span><strong>{money(estimate.totals.vat)}</strong></div></> : null}
      <div className="pack-grand-total"><span>{status.incomplete ? 'Partial total' : 'Total'}</span><strong>{money(project.prices.applyVat ? estimate.totals.total : estimate.totals.subtotal)}</strong></div>
    </div></section>
    {optional.length ? <section><h2>Optional items</h2><p>Excluded from the estimate above. Prices shown before VAT.</p><ul>{optional.map(line => <li key={line.id}>{line.description} — {line.total === undefined ? 'Price to be confirmed' : money(line.total)}</li>)}</ul></section> : null}
    {includePlans ? project.floorPlans.filter(plan => project.rooms.some(room => room.source?.floorPlanId === plan.id) || project.staircases.some(stair => stair.source?.floorPlanId === plan.id)).map(plan => {
      const spaces = [...project.rooms, ...project.staircases].filter(space => space.source?.floorPlanId === plan.id);
      return <section className="pack-plan" key={plan.id}><h2>{plan.name}</h2><p>Numbered areas show the spaces included in this proposal.</p><svg viewBox={`0 0 ${plan.widthPx} ${plan.heightPx}`} role="img" aria-label={`Floor plan: ${plan.name}`}>
        <image href={/^data:image\/(?:png|jpeg|webp);base64,/i.test(plan.imageDataUrl) ? plan.imageDataUrl : ''} width={plan.widthPx} height={plan.heightPx} />
        {spaces.map((space, index) => {
          const polygon = space.source!.pixelPolygon;
          if (!polygon.length) return null;
          const x = polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length, y = polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length;
          const colour = destinationColour(space.id);
          return <g key={space.id}><polygon points={polygon.map(point => `${point.x},${point.y}`).join(' ')} fill={colour.fill} fillOpacity=".35" stroke={colour.stroke} strokeWidth={Math.max(2, plan.widthPx / 600)} /><circle cx={x} cy={y} r={plan.widthPx / 65} fill={colour.stroke} /><text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize={plan.widthPx / 60}>{index + 1}</text></g>;
        })}
      </svg><ol className="pack-plan-key">{spaces.map(space => <li key={space.id}>{space.name}</li>)}</ol><small>Illustrative plan. Confirm site measurements before ordering.</small></section>;
    }) : null}
    <section><h2>Assumptions & details</h2><p>Quantities include the fitting, cutting and wastage allowances in this estimate. Ordered quantities may exceed the measured floor area because materials are supplied in rolls or complete packs.</p>
      {estimate.rollPlans.map(plan => <p key={plan.productId}><strong>{project.products.find(product => product.id === plan.productId)?.name}:</strong> {formatArea(plan.netAreaM2, project.displayUnit)} measured; {formatArea(plan.orderedAreaM2, project.displayUnit)} to supply, including allowances and offcuts.</p>)}
      <p>Site measurements, subfloor condition, product availability and any work outside the listed scope require confirmation before the order is placed.</p>
      {estimate.warnings.filter(warning => warning.level !== 'info').length ? <div className="pack-review"><h3>Items to confirm</h3><ul>{estimate.warnings.filter(warning => warning.level !== 'info').map((warning, index) => <li key={index}>{warning.message}</li>)}</ul></div> : null}
      {project.notes?.trim() ? <p className="pack-multiline">{project.notes}</p> : null}
      {business?.terms?.trim() ? <p className="pack-multiline">{business.terms}</p> : null}
    </section>
    <footer>{business?.name || 'Flooring proposal'}{project.quoteRef ? ` · ${project.quoteRef}` : ''} · {project.name}</footer>
  </article>;
}

export function clientPackHtml(project: Project, estimate: ProjectEstimate, includePlans = true): string {
  const body = renderToStaticMarkup(<ClientPack project={project} estimate={estimate} includePlans={includePlans} />);
  const title = project.name.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — client pack</title><style>${packStyles}</style></head><body>${body}</body></html>`;
}
