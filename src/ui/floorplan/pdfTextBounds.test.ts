import { describe, expect, it } from 'vitest';
import { pdfTextBounds } from './pdf';

describe('PDF label placement', () => {
  it('places upright labels above their baseline in raster coordinates', () => {
    expect(pdfTextBounds([20, 0, 0, -20, 100, 250], 120)).toEqual({ x: 100, y: 230, width: 120, height: 20 });
  });
  it('rotates label bounds with a quarter-turn PDF page', () => {
    expect(pdfTextBounds([0, 20, 20, 0, 100, 250], 120)).toEqual({ x: 100, y: 250, width: 20, height: 120 });
  });
  it('normalizes reversed text to positive bounds for spatial room-name suggestions', () => {
    expect(pdfTextBounds([-20, 0, 0, 20, 100, 250], 120)).toEqual({ x: -20, y: 250, width: 120, height: 20 });
  });
});
