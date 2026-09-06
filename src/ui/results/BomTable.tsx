/**
 * Bill of materials table: lines grouped by category with subtotals, then materials / labour /
 * subtotal / VAT / total rows. Price columns disappear when nothing is priced.
 */
import { Fragment } from 'react';
import type { BomLine, Estimate, Project } from '@engine/types';
import { formatMoney } from '@ui/components/inputs';
import { BOM_CATEGORY_ORDER, categoryLabel, sortBomLines } from './csv';
import { subjectName } from './Warnings';

/** Quantities: whole numbers as-is, otherwise up to 2 decimals ("8.5", "12", "0.25"). */
export function formatQty(n: number | undefined, decimals = 2): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10 ** decimals) / 10 ** decimals);
}

export interface BomTableProps {
  lines: BomLine[];
  totals: Estimate['totals'];
  project: Project;
  /** Show the "Applies to" column (rooms / staircases). Default on. */
  showSubjects?: boolean;
}

export function BomTable({ lines, totals, project, showSubjects = true }: BomTableProps) {
  const currency = project.prices.currency;
  const priced = lines.some((l) => l.unitPrice !== undefined || l.total !== undefined);
  const sorted = sortBomLines(lines);
  const categories = BOM_CATEGORY_ORDER.filter((c) => sorted.some((l) => l.category === c)).concat(
    Array.from(new Set(sorted.map((l) => l.category).filter((c) => !BOM_CATEGORY_ORDER.includes(c)))),
  );
  const cols = 3 + (priced ? 2 : 0) + (showSubjects ? 1 : 0);
  const money = (v: number | undefined) => formatMoney(v, currency);

  if (lines.length === 0) {
    return <div className="empty">Nothing to order yet — add a room or staircase.</div>;
  }

  const applyVat = project.prices.applyVat;
  const vatPct = Math.round(project.prices.vatRate * 1000) / 10;

  return (
    <div className="table-scroll">
      <table className="data bom-table" data-testid="bom-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Quantity
            </th>
            <th scope="col">Unit</th>
            {priced ? (
              <>
                <th scope="col" className="num">
                  Unit price
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </>
            ) : null}
            {showSubjects ? <th scope="col">Applies to</th> : null}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => {
            const catLines = sorted.filter((l) => l.category === cat);
            const subtotal = catLines.reduce((s, l) => s + (l.total ?? 0), 0);
            const hasSubtotal = priced && catLines.some((l) => l.total !== undefined);
            return (
              <Fragment key={cat}>
                <tr className="bom-category">
                  <th scope="rowgroup" colSpan={cols}>
                    {categoryLabel(cat)}
                  </th>
                </tr>
                {catLines.map((l) => (
                  <tr key={l.id} className="bom-line" data-category={l.category}>
                    <td>
                      <div>{l.description}</div>
                      {l.notes ? <div className="muted small">{l.notes}</div> : null}
                    </td>
                    <td className="num">
                      {formatQty(l.quantity)}
                      {l.exactQuantity !== undefined && Math.abs(l.exactQuantity - l.quantity) > 1e-9 ? (
                        <div className="muted small bom-exact" title="Exact quantity before rounding up to whole units">
                          ({formatQty(l.exactQuantity, 2)})
                        </div>
                      ) : null}
                    </td>
                    <td>{l.unit}</td>
                    {priced ? (
                      <>
                        <td className="num">{l.unitPrice === undefined ? '—' : money(l.unitPrice)}</td>
                        <td className="num">{l.total === undefined ? '—' : money(l.total)}</td>
                      </>
                    ) : null}
                    {showSubjects ? (
                      <td className="muted small">{l.subjectIds.map((id) => subjectName(project, id) ?? id).join(', ')}</td>
                    ) : null}
                  </tr>
                ))}
                {hasSubtotal ? (
                  <tr className="bom-subtotal">
                    <td colSpan={cols - 2} className="muted">
                      {categoryLabel(cat)} subtotal
                    </td>
                    <td className="num">{money(subtotal)}</td>
                    {showSubjects ? <td /> : null}
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        {priced ? (
          <tfoot>
            {totals.materialsCost !== undefined ? <TotalRow label="Materials" value={money(totals.materialsCost)} cols={cols} trailing={showSubjects} /> : null}
            {totals.labourCost !== undefined ? <TotalRow label="Labour" value={money(totals.labourCost)} cols={cols} trailing={showSubjects} /> : null}
            {totals.subtotal !== undefined ? (
              <TotalRow label={applyVat ? 'Subtotal (ex VAT)' : 'Subtotal'} value={money(totals.subtotal)} cols={cols} trailing={showSubjects} />
            ) : null}
            {applyVat && totals.vat !== undefined ? <TotalRow label={`VAT at ${vatPct}%`} value={money(totals.vat)} cols={cols} trailing={showSubjects} /> : null}
            <TotalRow label={applyVat ? 'Total inc VAT' : 'Total (ex VAT)'} value={money(totals.total ?? totals.subtotal)} cols={cols} trailing={showSubjects} grand />
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** A totals row: label spanning the item columns, the value under "Total", an empty cell under "Applies to". */
function TotalRow({ label, value, cols, trailing, grand }: { label: string; value: string; cols: number; trailing: boolean; grand?: boolean }) {
  return (
    <tr className={grand ? 'total bom-grand-total' : 'bom-total'} data-testid={grand ? 'bom-grand-total' : undefined}>
      <td colSpan={cols - 1 - (trailing ? 1 : 0)} className="num">
        {label}
      </td>
      <td className="num">{value}</td>
      {trailing ? <td /> : null}
    </tr>
  );
}
