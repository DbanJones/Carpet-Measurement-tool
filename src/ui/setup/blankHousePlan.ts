import type { FloorPlanDocument } from '@engine/types';

/** A real, embedded drawing sheet. One large square is 1 m, with 100 mm subdivisions. */
export function blankHousePlan(name = 'Ground floor sketch'): Omit<FloorPlanDocument, 'id'> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800" viewBox="0 0 1000 800"><defs><pattern id="small" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#e9edef" stroke-width=".35"/></pattern><pattern id="metre" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#small)"/><path d="M50 0H0V50" fill="none" stroke="#c7d3d8" stroke-width=".8"/></pattern></defs><rect width="1000" height="800" fill="#fafcfd"/><rect width="1000" height="800" fill="url(#metre)"/></svg>`;
  return { name, imageDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, widthPx: 1000, heightPx: 800, mmPerPx: 20, sketch: { gridMm: 1000 } };
}
