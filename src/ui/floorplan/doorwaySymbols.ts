import type { Px } from './tracing';

export interface DetectedDoorway {
  a: Px;
  b: Px;
  evidence: 'swing-arc' | 'door-leaf';
  confidence: 'high' | 'medium';
  hinge?: Px;
  leafEnd?: Px;
  /** True when the suggested room floor reaches this straight threshold. */
  floorIncluded?: boolean;
  floorWarning?: string;
}

export interface DoorwayRaster {
  width: number;
  height: number;
  /** Original, unclosed ink mask; retain fine strokes before wall cleanup. */
  ink: Uint8Array;
  mmPerPx?: number;
}

interface Fit { doorway: DetectedDoorway; score: number }

/**
 * Qualify supported wall openings from conventional door symbols. A closure alone is never
 * evidence of a door. Tests inspect a radial leaf and the curved ink/clear space either side
 * of a quarter-circle, instead of interpreting a rectangular gap or window bars as a door.
 * All work is confined to at most 32 openings, with a fixed number of samples per fit.
 */
export function recognizeDoorwaySymbols(raster: DoorwayRaster, gaps: Array<{ a: Px; b: Px }>): DetectedDoorway[] {
  const { width, height, ink, mmPerPx } = raster;
  if (ink.length !== width * height || width < 3 || height < 3) return [];
  const pixel = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;
  const near = (point: Px, radius = 1) => {
    const x = Math.round(point.x), y = Math.round(point.y);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (pixel(x + dx, y + dy)) return true;
    return false;
  };
  const along = (origin: Px, u: Px, distance: number, normal: Px, offset = 0): Px => ({
    x: origin.x + u.x * distance + normal.x * offset,
    y: origin.y + u.y * distance + normal.y * offset,
  });
  const fitted: Fit[] = [];
  for (const gap of gaps.slice(0, 32)) {
    const length = Math.hypot(gap.b.x - gap.a.x, gap.b.y - gap.a.y);
    if (!Number.isFinite(length) || length < 10 || length > 145 || (mmPerPx && (length * mmPerPx < 350 || length * mmPerPx > 1400))) continue;
    if (Math.abs(gap.b.x - gap.a.x) > 0.5 && Math.abs(gap.b.y - gap.a.y) > 0.5) continue;
    const u = { x: (gap.b.x - gap.a.x) / length, y: (gap.b.y - gap.a.y) / length };
    const normal = { x: -u.y, y: u.x };
    const tolerance = length >= 70 ? 2 : 1;
    const clearance = Math.max(4, length * 0.10);
    const shift = Math.min(6, Math.max(2, Math.round(length * 0.1)));
    const wallFaceShift = Math.min(8, Math.max(4, Math.round(length * 0.1)));
    let best: Fit | undefined;
    for (const atEnd of [false, true]) for (const side of [-1, 1]) {
      const endpoint = atEnd ? gap.b : gap.a;
      const toward = atEnd ? -1 : 1;
      const leafDirection = { x: normal.x * side, y: normal.y * side };
      for (const tangential of [-shift, -2, 0, 2, shift]) for (const outward of [-wallFaceShift, -wallFaceShift / 2, 0, wallFaceShift / 2, wallFaceShift]) {
        const hinge = along(endpoint, u, tangential * toward, normal, outward);
        for (const adjustment of [-1, 1]) for (const leafRatio of [1, 0.8, 1.2]) {
          const radius = length - tangential + adjustment;
          const leafRadius = radius * leafRatio;
          let leafHits = 0, leafClear = 0;
          // Avoid the wall at the hinge and the curved arc at the leaf's tip.
          for (let i = 0; i < 12; i++) {
            const point = along(hinge, leafDirection, leafRadius * (0.17 + i * 0.06), u);
            if (near(point, tolerance)) leafHits++;
            if (!near(along(point, u, clearance, normal))) leafClear++;
            if (!near(along(point, u, -clearance, normal))) leafClear++;
          }
          if (leafHits < 10) continue;
          let arcHits = 0, arcClear = 0;
          const quarters = [0, 0, 0];
          for (let i = 0; i < 12; i++) {
            const angle = (12 + i * 6) * Math.PI / 180;
            const arcAt = (r: number) => along(hinge, u, Math.cos(angle) * r * toward, normal, Math.sin(angle) * r * side * leafRatio);
            if (near(arcAt(radius), tolerance)) { arcHits++; quarters[Math.floor(i / 4)]!++; }
            if (!near(arcAt(radius - clearance))) arcClear++;
            if (!near(arcAt(radius + clearance))) arcClear++;
          }
          const leafEnd = along(hinge, leafDirection, leafRadius, u);
          if (arcHits >= 9 && arcClear >= 17 && quarters.every(hits => hits >= 2)) {
            const score = 100 + arcHits * 3 + arcClear + leafHits;
            if (!best || score > best.score) best = { score, doorway: {
              a: { ...gap.a }, b: { ...gap.b }, hinge, leafEnd, evidence: 'swing-arc', confidence: 'high',
            } };
            continue;
          }
          // A leaf without an arc needs to be thin, stop at the opening's width and have no
          // perpendicular furniture frame at its tip. Wall jambs/window crossbars fail here.
          if (leafRatio !== 1 || leafHits < 11 || leafClear < 21 || arcHits >= 5) continue;
          let continuation = 0, frame = 0, tipHits = 0;
          for (let i = 0; i < 5; i++) {
            if (near(along(hinge, leafDirection, radius * (1.12 + i * 0.07), u), tolerance)) continuation++;
            if (near(along(leafEnd, u, toward * radius * (0.2 + i * 0.12), normal), Math.max(3, tolerance + 2))) frame++;
            if (near(along(hinge, leafDirection, radius * (0.85 + i * 0.025), u), tolerance)) tipHits++;
          }
          if (continuation > 0 || frame > 1 || tipHits < 4) continue;
          const score = leafHits * 2 + leafClear + tipHits;
          if (!best || score > best.score) best = { score, doorway: {
            a: { ...gap.a }, b: { ...gap.b }, hinge, leafEnd, evidence: 'door-leaf', confidence: 'medium',
          } };
        }
      }
    }
    if (!best) continue;
    const middle = (door: DetectedDoorway) => ({ x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 });
    const centre = middle(best.doorway);
    const duplicate = fitted.findIndex(other => {
      const otherCentre = middle(other.doorway);
      return Math.hypot(centre.x - otherCentre.x, centre.y - otherCentre.y) < Math.max(6, length * 0.08)
        && Math.abs(Math.hypot(other.doorway.b.x - other.doorway.a.x, other.doorway.b.y - other.doorway.a.y) - length) < 6;
    });
    if (duplicate < 0) fitted.push(best);
    else if (best.score > fitted[duplicate]!.score) fitted[duplicate] = best;
  }
  return fitted.map(fit => fit.doorway);
}
