import type { Point, Step } from './types';
import { isSimplePolygon, polygonAreaMm2 } from './geometry';

/** Imported custom footprints must fit within their measured cut rectangle. */
export function validStairOutlinePoints(value: unknown, exactCount?: number): value is Point[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64 || exactCount !== undefined && value.length !== exactCount) return false;
  if (!value.every(point => point && typeof point === 'object' && ['x', 'y'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key]) && Math.abs(point[key]) <= 16))) return false;
  const points = value as Point[];
  if (Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) > 1.00001 || Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) > 1.00001) return false;
  return isSimplePolygon(points) && polygonAreaMm2(points) > 1e-8;
}

export function validStepOutline(value: unknown): value is NonNullable<Step['outline']> {
  if (!value || typeof value !== 'object') return false;
  const shape = value as NonNullable<Step['outline']>;
  if (!validStairOutlinePoints(shape.points)) return false;
  if (shape.corners !== undefined && (!Array.isArray(shape.corners) || shape.corners.length > shape.points.length || new Set(shape.corners).size !== shape.corners.length || !shape.corners.every(index => Number.isInteger(index) && index >= 0 && index < shape.points.length))) return false;
  return [shape.entry, shape.exit].every(edge => Array.isArray(edge) && edge.length === 2 && edge[0] !== edge[1] && edge.every(index => Number.isInteger(index) && index >= 0 && index < shape.points.length));
}
