import type { Point, Staircase } from '@engine/types';
import { stairPlanGeometry, type StairPlanPiece } from './stairLayout';

export type StairView = 'side' | 'front' | '3d';
/** Camera azimuth and elevation in degrees; independent of the measured staircase. */
export interface StairOrbit { yaw: number; pitch: number }
export const DEFAULT_STAIR_ORBIT: StairOrbit = { yaw: -45, pitch: 60 };
export function normaliseStairOrbit(orbit: StairOrbit): StairOrbit {
  return { yaw: ((orbit.yaw % 360) + 540) % 360 - 180, pitch: Math.max(-89, Math.min(89, orbit.pitch)) };
}
export interface RaisedPoint extends Point { z: number }
export interface PhysicalSurface extends StairPlanPiece {
  elevation: number;
  lowerElevation: number;
  centre: RaisedPoint;
}
export interface PhysicalFace {
  id: string;
  pieceId: string;
  kind: 'surface' | 'edge' | 'underside';
  points: RaisedPoint[];
  depth: number;
  shade: number;
}

export interface StairLabelCandidate extends Point {
  id: string;
  text: string;
  selected?: boolean;
  end?: 'start' | 'top' | 'both';
}

export interface StairScreenLabel extends Point {
  text: string;
  /** Label centre moved away from its tread to avoid another label. */
  leader: boolean;
}

/** Keep identification readable when multiple flights project into the same small area. */
export function layoutStairLabels(candidates: StairLabelCandidate[], showOtherLabels: boolean): Map<string, StairScreenLabel> {
  const result = new Map<string, StairScreenLabel>();
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  const priority = (candidate: StairLabelCandidate) => candidate.selected ? 0 : candidate.end ? 1 : 2;
  const ordered = [...candidates].sort((a, b) => priority(a) - priority(b));
  for (const candidate of ordered) {
    const required = !!candidate.selected || !!candidate.end;
    if (!required && !showOtherLabels) continue;
    const text = candidate.end ? `${candidate.text} · ${candidate.end === 'start' ? 'Start' : candidate.end === 'top' ? 'Top' : 'Start / Top'}` : candidate.text;
    const width = text.length * 6 + 6; const height = 15;
    const offsets = candidate.end === 'start' ? [[0, 22], [-40, 0], [40, 0], [0, -24]] : candidate.end ? [[40, 0], [40, -24], [0, -26], [-40, 0], [0, 26]] : [[0, 0]];
    if (required) offsets.push([0, -42], [0, 42], [-58, -24], [58, 24], [-58, 24], [58, -24]);
    let placed: StairScreenLabel | undefined;
    for (const offset of offsets) {
      const x = Math.max(15 + width / 2, Math.min(352 - width / 2, candidate.x + offset[0]!));
      const y = Math.max(20, Math.min(299, candidate.y + offset[1]!));
      if (occupied.some(other => Math.abs(other.x - x) < (other.width + width) / 2 + 8 && Math.abs(other.y - y) < (other.height + height) / 2 + 5)) continue;
      placed = { x, y, text, leader: Math.hypot(x - candidate.x, y - candidate.y) > 10 };
      break;
    }
    if (!placed && required) placed = { x: 35 + width / 2, y: 20 + occupied.filter(other => other.x < 130).length * 23, text, leader: true };
    if (!placed) continue;
    occupied.push({ x: placed.x, y: placed.y, width, height });
    result.set(candidate.id, placed);
  }
  return result;
}

const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Elevate the plan itself: a returning upper flight stays above its drawn footprint. */
export function raisedStairSurfaces(staircase: Staircase): { surfaces: PhysicalSurface[]; totalRise: number } {
  const levels: number[] = [];
  let height = 0;
  for (const step of staircase.steps) { height += positive(step.rise); levels.push(height); }
  const surfaces = stairPlanGeometry(staircase).pieces.map((piece): PhysicalSurface => {
    const landing = piece.kind === 'landing' ? staircase.landings.find((item) => item.id === piece.id) : undefined;
    const index = piece.stepIndex ?? (landing ? Math.min(staircase.steps.length - 1, Math.floor(landing.afterStepIndex)) : -1);
    const elevation = index < 0 ? 0 : levels[index] ?? height;
    // Only the local riser is drawn. Extending every tread down to the floor would hide
    // the lower flight of a returning staircase and suggest a solid support structure.
    const lowerElevation = piece.kind === 'landing' ? elevation : (levels[index - 1] ?? 0);
    const centre = { x: 0, y: 0, z: elevation };
    for (const point of piece.points) { centre.x += point.x / piece.points.length; centre.y += point.y / piece.points.length; }
    return { ...piece, elevation, lowerElevation, centre };
  });
  return { surfaces, totalRise: height };
}

/** Side looks along +x, front looks along -y; 3D uses an elevated orthographic camera. */
export function projectStairPoint(point: RaisedPoint, view: StairView, orbit: StairOrbit = DEFAULT_STAIR_ORBIT): Point {
  if (view === 'side') return { x: point.y, y: -point.z };
  if (view === 'front') return { x: point.x, y: -point.z };
  const { yaw, pitch } = normaliseStairOrbit(orbit);
  const azimuth = yaw * Math.PI / 180, elevation = pitch * Math.PI / 180;
  return { x: -point.x * Math.sin(azimuth) + point.y * Math.cos(azimuth),
    y: (point.x * Math.cos(azimuth) + point.y * Math.sin(azimuth)) * Math.sin(elevation) - point.z * Math.cos(elevation) };
}

function camera(view: StairView, orbit: StairOrbit = DEFAULT_STAIR_ORBIT): RaisedPoint {
  if (view === 'side') return { x: 1, y: 0, z: 0 };
  if (view === 'front') return { x: 0, y: -1, z: 0 };
  const { yaw, pitch } = normaliseStairOrbit(orbit);
  const azimuth = yaw * Math.PI / 180, elevation = pitch * Math.PI / 180;
  return { x: Math.cos(azimuth) * Math.cos(elevation), y: Math.sin(azimuth) * Math.cos(elevation), z: Math.sin(elevation) };
}

/** Visible local edge faces and tread tops, painted from farthest to nearest. */
export function physicalStairFaces(surfaces: PhysicalSurface[], view: StairView, orbit: StairOrbit = DEFAULT_STAIR_ORBIT): PhysicalFace[] {
  const eye = camera(view, orbit);
  const depth = (points: RaisedPoint[]) => points.reduce((sum, p) => sum + p.x * eye.x + p.y * eye.y + p.z * eye.z, 0) / points.length;
  const faces: PhysicalFace[] = [];
  for (const surface of surfaces) {
    const top = surface.points.map((point) => ({ ...point, z: surface.elevation }));
    if (eye.z >= 0) faces.push({ id: `${surface.id}-top`, pieceId: surface.id, kind: 'surface', points: top, depth: depth(top), shade: 1 });
    else {
      const bottom = surface.points.map(point => ({ ...point, z: surface.lowerElevation }));
      faces.push({ id: `${surface.id}-bottom`, pieceId: surface.id, kind: 'underside', points: bottom, depth: depth(bottom), shade: .7 });
    }
    if (surface.lowerElevation === surface.elevation) continue;
    const signedArea = surface.points.reduce((sum, point, index, points) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point.x * next.y - next.x * point.y;
    }, 0);
    const orientation = signedArea < 0 ? -1 : 1;
    for (let index = 0; index < top.length; index++) {
      const a = top[index]!; const b = top[(index + 1) % top.length]!;
      const nx = (b.y - a.y) * orientation; const ny = (a.x - b.x) * orientation;
      if (nx * eye.x + ny * eye.y <= 0.000001) continue;
      const points = [a, b, { ...b, z: surface.lowerElevation }, { ...a, z: surface.lowerElevation }];
      const length = Math.hypot(nx, ny) || 1;
      faces.push({ id: `${surface.id}-edge-${index}`, pieceId: surface.id, kind: 'edge', points, depth: depth(points), shade: .65 + .18 * Math.abs(nx / length) });
    }
  }
  return faces.sort((a, b) => a.depth - b.depth || (a.kind === 'surface' ? 1 : -1));
}

/** Test the camera ray against other faces before placing ordinary tread labels. */
export function isStairPointVisible(point: RaisedPoint, pieceId: string, faces: PhysicalFace[], view: StairView, orbit: StairOrbit = DEFAULT_STAIR_ORBIT): boolean {
  const projected = projectStairPoint(point, view, orbit), eye = camera(view, orbit);
  for (const face of faces) {
    if (face.pieceId === pieceId || face.points.length < 3) continue;
    const polygon = face.points.map(p => projectStairPoint(p, view, orbit));
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!, b = polygon[j]!;
      if ((a.y > projected.y) !== (b.y > projected.y) && projected.x < (b.x - a.x) * (projected.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (!inside) continue;
    const a = face.points[0]!;
    for (let index = 1; index < face.points.length - 1; index++) {
      const b = face.points[index]!, c = face.points[index + 1]!;
      const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const normal = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
      const facing = normal.x * eye.x + normal.y * eye.y + normal.z * eye.z;
      if (Math.abs(facing) < 1e-8) continue;
      const distance = (normal.x * (a.x - point.x) + normal.y * (a.y - point.y) + normal.z * (a.z - point.z)) / facing;
      if (distance > .01) return false;
      break;
    }
  }
  return true;
}
