import { describe, expect, it } from 'vitest';
import { outlinesOverlap, snapToOutline } from './outlineEditing';
const rect = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
describe('room boundary editing', () => {
  it('allows disjoint rooms, shared walls and shared corners', () => {
    const room = rect(0, 0, 100, 100);
    expect(outlinesOverlap(room, rect(101, 0, 100, 100))).toBe(false);
    expect(outlinesOverlap(room, rect(100, 10, 100, 50))).toBe(false);
    expect(outlinesOverlap(room, rect(100, 100, 100, 100))).toBe(false);
  });
  it('rejects containment, identical rooms and crossing strips without interior vertices', () => {
    const room = rect(0, 0, 100, 100);
    expect(outlinesOverlap(room, rect(20, 20, 30, 30))).toBe(true);
    expect(outlinesOverlap(room, [...room].reverse())).toBe(true);
    expect(outlinesOverlap(rect(0, 40, 100, 20), rect(40, 0, 20, 100))).toBe(true);
    expect(outlinesOverlap(room, rect(99.9, 10, 30, 20))).toBe(true);
  });
  it('handles concave outlines and diagonal intersections', () => {
    const l = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }];
    expect(outlinesOverlap(l, rect(40, 40, 40, 40))).toBe(false);
    expect(outlinesOverlap(l, rect(20, 40, 40, 40))).toBe(true);
    expect(outlinesOverlap([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }], rect(40, 50, 20, 20))).toBe(true);
  });
  it('snaps to existing corners and walls only within the chosen tolerance', () => {
    const polygons = [rect(0, 0, 100, 100)];
    expect(snapToOutline({ x: 102, y: 2 }, polygons, 5)).toEqual({ x: 100, y: 0 });
    expect(snapToOutline({ x: 102, y: 60 }, polygons, 5)).toEqual({ x: 100, y: 60 });
    expect(snapToOutline({ x: 120, y: 60 }, polygons, 5)).toEqual({ x: 120, y: 60 });
  });
});
