import { csvField, rowsToCsv, toCsv, sortBomLines, safeFileName, BOM_CSV_HEADER } from './csv';
import type { BomLine } from '@engine/types';

const line = (partial: Partial<BomLine> & Pick<BomLine, 'id' | 'category' | 'description'>): BomLine => ({
  quantity: 1,
  unit: 'each',
  subjectIds: [],
  ...partial,
});

describe('csvField', () => {
  it('leaves plain values alone', () => {
    expect(csvField('Carpet')).toBe('Carpet');
    expect(csvField(12.5)).toBe('12.5');
    expect(csvField(0)).toBe('0');
    expect(csvField(true)).toBe('true');
  });
  it('renders null/undefined/non-finite numbers as empty', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(NaN)).toBe('');
    expect(csvField(Infinity)).toBe('');
  });
  it('quotes commas, quotes and newlines, doubling embedded quotes', () => {
    expect(csvField('Hall, landing')).toBe('"Hall, landing"');
    expect(csvField('4 m "Twist" carpet')).toBe('"4 m ""Twist"" carpet"');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('rowsToCsv', () => {
  it('joins with commas and CRLF, and ends with a newline', () => {
    expect(rowsToCsv([['a', 'b'], [1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
    expect(rowsToCsv([])).toBe('');
  });
});

describe('toCsv (bill of materials)', () => {
  it('writes a header, one row per line in category order, and totals', () => {
    const lines: BomLine[] = [
      line({ id: 'l2', category: 'labour', description: 'Carpet fitting', quantity: 20, unit: 'm²', unitPrice: 5, total: 100, subjectIds: ['room-1'] }),
      line({ id: 'l1', category: 'floor_covering', description: 'Carpet "Lounge", 4 m roll', quantity: 8.5, unit: 'm', exactQuantity: 8.4321, unitPrice: 72, total: 612, subjectIds: ['room-1', 'room-2'], notes: 'Pile: along length' }),
    ];
    const csv = toCsv(lines, {
      totals: { netAreaM2: 30, materialsCost: 612, labourCost: 100, subtotal: 712, vat: 142.4, total: 854.4 },
      subjectName: (id) => ({ 'room-1': 'Lounge', 'room-2': 'Hall, landing' })[id],
      currency: 'GBP',
      applyVat: true,
      vatRate: 0.2,
    });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe(BOM_CSV_HEADER.join(','));
    // floor covering sorts before labour regardless of input order; quotes and commas are escaped
    expect(rows[1]).toBe('Floor coverings,"Carpet ""Lounge"", 4 m roll",8.5,m,8.432,72,612,"Lounge; Hall, landing",Pile: along length');
    expect(rows[2]).toBe('Labour,Carpet fitting,20,m²,,5,100,Lounge,');
    expect(rows[3]).toBe('Totals,Materials (GBP),,,,,612,,');
    expect(rows[4]).toBe('Totals,Labour (GBP),,,,,100,,');
    expect(rows[5]).toBe('Totals,Subtotal (GBP),,,,,712,,');
    expect(rows[6]).toBe('Totals,VAT at 20% (GBP),,,,,142.4,,');
    expect(rows[7]).toBe('Totals,Total (GBP),,,,,854.4,,');
    expect(rows[8]).toBe('');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('omits VAT and labels the total ex VAT when VAT is not applied', () => {
    const csv = toCsv([line({ id: 'a', category: 'other', description: 'x', total: 10 })], {
      totals: { netAreaM2: 1, subtotal: 10, total: 10 },
      applyVat: false,
    });
    expect(csv).not.toMatch(/VAT at/);
    expect(csv).toMatch(/Totals,Total \(ex VAT\),,,,,10,,/);
  });

  it('works without totals or names', () => {
    const csv = toCsv([line({ id: 'a', category: 'gripper', description: 'Gripper', quantity: 12, unit: 'length', subjectIds: ['r1'] })]);
    expect(csv.split('\r\n')).toEqual([BOM_CSV_HEADER.join(','), 'Gripper,Gripper,12,length,,,,r1,', '']);
  });
});

describe('helpers', () => {
  it('sortBomLines is stable inside a category and unknown categories go last', () => {
    const lines = [
      line({ id: '1', category: 'other', description: 'o' }),
      line({ id: '2', category: 'underlay', description: 'u1' }),
      line({ id: '3', category: 'underlay', description: 'u2' }),
      line({ id: '4', category: 'floor_covering', description: 'f' }),
    ];
    expect(sortBomLines(lines).map((l) => l.id)).toEqual(['4', '2', '3', '1']);
  });
  it('safeFileName strips awkward characters', () => {
    expect(safeFileName('3-bed semi / v2')).toBe('3-bed_semi_v2');
    expect(safeFileName('   ')).toBe('estimate');
  });
});
