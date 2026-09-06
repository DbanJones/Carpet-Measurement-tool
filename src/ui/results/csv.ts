/**
 * CSV export of the bill of materials (RFC 4180 quoting, CRLF line endings) and a tiny
 * browser download helper. Pure functions so they can be unit tested without a DOM.
 */
import type { BomCategory, BomLine, Estimate } from '@engine/types';

export type CsvCell = string | number | boolean | null | undefined;

/** Quote a single field: wrap in double quotes when it contains a comma, quote, CR or LF; double any quotes. */
export function csvField(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells to a CSV document (CRLF line endings, trailing newline). */
export function rowsToCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}

/** Human labels for BOM categories, in the order they are listed. */
export const BOM_CATEGORY_ORDER: BomCategory[] = [
  'floor_covering',
  'underlay',
  'gripper',
  'door_bars',
  'floor_preparation',
  'adhesives_tapes',
  'trims',
  'stairs',
  'labour',
  'other',
];

export const BOM_CATEGORY_LABELS: Record<BomCategory, string> = {
  floor_covering: 'Floor coverings',
  underlay: 'Underlay',
  gripper: 'Gripper',
  door_bars: 'Door bars & thresholds',
  floor_preparation: 'Floor preparation',
  adhesives_tapes: 'Adhesives & tapes',
  trims: 'Trims & beading',
  stairs: 'Stairs',
  labour: 'Labour',
  other: 'Other',
};

export function categoryLabel(c: BomCategory): string {
  return BOM_CATEGORY_LABELS[c] ?? c;
}

/** Sort BOM lines by category order, keeping the engine's order inside a category. */
export function sortBomLines(lines: BomLine[]): BomLine[] {
  const rank = (c: BomCategory) => {
    const i = BOM_CATEGORY_ORDER.indexOf(c);
    return i === -1 ? BOM_CATEGORY_ORDER.length : i;
  };
  return lines.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l.category) - rank(b.l.category) || a.i - b.i).map((x) => x.l);
}

/** Round money to pence for the CSV (numbers stay numbers so spreadsheets can sum them). */
const money = (v: number | undefined): CsvCell => (v === undefined || !Number.isFinite(v) ? '' : Math.round(v * 100) / 100);
const qty = (v: number | undefined): CsvCell => (v === undefined || !Number.isFinite(v) ? '' : Math.round(v * 1000) / 1000);

export interface BomCsvOptions {
  /** Append the materials / labour / subtotal / VAT / total rows. */
  totals?: Estimate['totals'];
  /** Resolve subject ids (rooms, staircases) to names for the "Applies to" column. */
  subjectName?: (id: string) => string | undefined;
  currency?: string;
  /** Whether a VAT row is meaningful (project.prices.applyVat). */
  applyVat?: boolean;
  vatRate?: number;
}

export const BOM_CSV_HEADER = ['Category', 'Description', 'Quantity', 'Unit', 'Exact quantity', 'Unit price', 'Line total', 'Applies to', 'Notes'];

/**
 * The bill of materials as CSV: one row per line grouped by category, then the totals.
 * Example: `toCsv(estimate.bom, { totals: estimate.totals })`.
 */
export function toCsv(lines: BomLine[], options: BomCsvOptions = {}): string {
  const rows: CsvCell[][] = [BOM_CSV_HEADER];
  for (const l of sortBomLines(lines)) {
    const subjects = l.subjectIds.map((id) => options.subjectName?.(id) ?? id).join('; ');
    rows.push([categoryLabel(l.category), l.description, qty(l.quantity), l.unit, qty(l.exactQuantity), money(l.unitPrice), money(l.total), subjects, l.notes ?? '']);
  }
  const t = options.totals;
  if (t) {
    const cur = options.currency ? ` (${options.currency})` : '';
    const totalRow = (label: string, v: number | undefined) => {
      if (v === undefined) return;
      rows.push(['Totals', label + cur, '', '', '', '', money(v), '', '']);
    };
    totalRow('Materials', t.materialsCost);
    totalRow('Labour', t.labourCost);
    totalRow('Subtotal', t.subtotal);
    if (options.applyVat !== false && t.vat !== undefined) {
      totalRow(options.vatRate !== undefined ? `VAT at ${Math.round(options.vatRate * 1000) / 10}%` : 'VAT', t.vat);
    }
    totalRow(options.applyVat === false ? 'Total (ex VAT)' : 'Total', t.total ?? t.subtotal);
  }
  return rowsToCsv(rows);
}

/** Make a safe file name from a project name: "3-bed semi / v2" -> "3-bed_semi_v2". */
export function safeFileName(name: string, fallback = 'estimate'): string {
  const s = name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return s || fallback;
}

/**
 * Trigger a browser download of `text`. A UTF-8 byte-order mark is prepended so Excel reads "m²"
 * and "£" correctly. Returns false when the DOM/Blob APIs are unavailable (tests, SSR).
 */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): boolean {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
