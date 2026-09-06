import { parseLength, toMm, fromMm, ceilToStep, formatFtIn, formatM, roundTo } from './units';

describe('parseLength', () => {
  it('parses metric with and without units', () => {
    expect(parseLength('4.2')).toBe(4200);
    expect(parseLength('4,2')).toBe(4200);
    expect(parseLength('420cm')).toBe(4200);
    expect(parseLength('4200 mm')).toBe(4200);
    expect(parseLength('3.5m')).toBe(3500);
    expect(parseLength('  2 ')).toBe(2000);
  });
  it('parses feet and inches', () => {
    expect(parseLength(`13'9"`)).toBe(Math.round(13 * 304.8 + 9 * 25.4));
    expect(parseLength('13 ft 9 in')).toBe(Math.round(13 * 304.8 + 9 * 25.4));
    expect(parseLength(`12'`)).toBe(Math.round(12 * 304.8));
    expect(parseLength('6 in')).toBe(Math.round(6 * 25.4));
    expect(parseLength('12', 'ft')).toBe(Math.round(12 * 304.8));
  });
  it('rejects rubbish', () => {
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('4.2.1')).toBeNull();
  });
});

describe('conversions and rounding', () => {
  it('round-trips units', () => {
    expect(toMm(1, 'ft')).toBeCloseTo(304.8);
    expect(fromMm(304.8, 'ft')).toBeCloseTo(1);
    expect(fromMm(1000, 'm')).toBe(1);
  });
  it('ceilToStep rounds up to the increment without float drift', () => {
    expect(ceilToStep(4210, 100)).toBe(4300);
    expect(ceilToStep(4200, 100)).toBe(4200);
    expect(ceilToStep(4200.0000001, 100)).toBe(4200);
    expect(ceilToStep(4201, 500)).toBe(4500);
    expect(ceilToStep(10, 0)).toBe(10);
  });
  it('formats', () => {
    expect(formatFtIn(3810)).toBe(`12' 6"`);
    expect(formatFtIn(304.8 * 12 - 1)).toBe(`12' 0"`);
    expect(formatM(4250)).toBe('4.25 m');
    expect(roundTo(1.005, 2)).toBeCloseTo(1.0, 2);
  });
});
