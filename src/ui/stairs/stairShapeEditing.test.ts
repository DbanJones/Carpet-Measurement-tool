import type { Point, Staircase } from '@engine/types';
import { makeEmptyProject, makeSteps } from '@store/projectStore';
import { parseProject, serializeProject } from '@engine/serialize';
import { isSimplePolygon } from '@engine/geometry';
import { curveSteps, editableSteps, measuredStairPreset, reconcileStepPlans } from './stepEditing';
import { stairPlanGeometry } from './stairLayout';
import { measuredStepGeometry } from './stepGeometry';
import { reshapeStairCorner, setLandingOutline, stairCornerHandles } from './stairShapeEditing';

const stairs = (): Staircase => ({ id: 'stairs', name: 'Main stairs', productId: makeEmptyProject().products[0]!.id, steps: makeSteps(13), landings: [], method: 'cap_and_band', openSides: 'none' });
const close = (a: Point, b: Point) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(.001);
const pieces = (staircase: Staircase) => stairPlanGeometry(staircase, { normalize: false }).pieces;

describe('connected staircase corner editing', () => {
  it('keeps legacy walking-route polygons in place on the first corner edit', () => {
    const before = { ...stairs(), drawing: { points: [{ x: 0, y: 0 }, { x: 0, y: 180 }, { x: 240, y: 180 }] } };
    const id = before.steps[2]!.id;
    const from = stairCornerHandles(before, id)[2]!;
    const moved = { x: from.x + 25, y: from.y + 15 };
    const after = reshapeStairCorner(before, id, 2, moved);
    expect(after).not.toBe(before);
    const original = pieces(before), updated = pieces(after);
    for (let index = 0; index < original.length; index++) original[index]!.points.forEach((point, corner) => {
      close(updated[index]!.points[corner]!, Math.hypot(point.x - from.x, point.y - from.y) < .05 ? moved : point);
    });
  });

  it('moves a shared tread corner once and preserves all other tread corners', () => {
    const before = editableSteps(stairs()), id = before.steps[3]!.id;
    const handles = stairCornerHandles(before, id), point = handles[2]!;
    const moved = { x: point.x + 80, y: point.y + 35 };
    const after = reshapeStairCorner(before, id, 2, moved);
    expect(after).not.toBe(before);
    const oldPieces = pieces(before), newPieces = pieces(after);
    for (let index = 0; index < oldPieces.length; index++) {
      oldPieces[index]!.points.forEach((old, corner) => close(newPieces[index]!.points[corner]!, Math.hypot(old.x - point.x, old.y - point.y) < .001 ? moved : old));
    }
    expect(after.steps[3]!.width).toBeGreaterThan(before.steps[3]!.width);
    expect(after.steps[3]!.going).toBeGreaterThan(before.steps[3]!.going);
    expect(after.steps.map(step => step.rise)).toEqual(before.steps.map(step => step.rise));
  });

  it('rejects crossed or collapsed treads as one atomic edit', () => {
    const before = editableSteps(stairs()), id = before.steps[3]!.id;
    const handles = stairCornerHandles(before, id);
    expect(reshapeStairCorner(before, id, 2, { x: (handles[0]!.x + handles[1]!.x) / 2, y: handles[0]!.y - 100 })).toBe(before);
    expect(reshapeStairCorner(before, id, 2, { x: NaN, y: 0 })).toBe(before);
  });

  it('keeps a custom tread and the upper flight connected after typed dimensions change', () => {
    const source = editableSteps(stairs()), id = source.steps[3]!.id, corner = stairCornerHandles(source, id)[2]!;
    const before = reshapeStairCorner(source, id, 2, { x: corner.x + 100, y: corner.y + 40 });
    const changed = { ...before, steps: before.steps.map(step => step.id === id ? { ...step, going: step.going + 70 } : step) };
    const after = reconcileStepPlans(before, changed);
    const geometry = measuredStepGeometry(after.steps[3]!, after.steps[3]!.plan!);
    close(geometry.end, after.steps[4]!.plan!);
    expect(pieces(after).every(piece => isSimplePolygon(piece.points))).toBe(true);
  });

  it.each(['left', 'right'] as const)('creates a measured, connected L with a square landing turning %s', direction => {
    const before = stairs(), after = measuredStairPreset(before, { kind: 'quarter_turn', direction });
    const geometry = pieces(after), landing = geometry.find(piece => piece.kind === 'landing')!;
    expect(after.steps).toEqual(before.steps);
    expect(after.landings).toHaveLength(1);
    expect(after.landings[0]).toMatchObject({ kind: 'quarter', length: 860, width: 860, afterStepIndex: 5 });
    const incoming = geometry.find(piece => piece.stepIndex === 5)!, outgoing = geometry.find(piece => piece.stepIndex === 6)!;
    close(incoming.end!, landing.start!); close(landing.end!, outgoing.start!);
    expect(outgoing.heading! - incoming.heading!).toBeCloseTo(direction === 'right' ? -90 : 90);
  });

  it('edits landing length, width and an L-shaped footprint while preserving the outgoing flight', () => {
    const base = editableSteps(measuredStairPreset(stairs(), { kind: 'quarter_turn', direction: 'right' }));
    const id = base.landings[0]!.id;
    const notched = setLandingOutline(base, id, 'l_shape');
    expect(stairCornerHandles(notched, id)).toHaveLength(6);
    const point = stairCornerHandles(notched, id)[2]!;
    const edited = reshapeStairCorner(notched, id, 2, { x: point.x + 120, y: point.y + 80 });
    expect(edited.landings[0]!.width).toBeGreaterThan(base.landings[0]!.width);
    expect(edited.landings[0]!.length).toBeGreaterThan(base.landings[0]!.length);
    const resized = reconcileStepPlans(edited, { ...edited, landings: edited.landings.map(landing => ({ ...landing, width: landing.width + 200, length: landing.length + 100 })) });
    const geometry = pieces(resized), landing = geometry.find(piece => piece.id === id)!;
    const outgoing = geometry.find(piece => piece.stepIndex === 6)!;
    close(landing.end!, outgoing.start!);
    expect(geometry.every(piece => isSimplePolygon(piece.points))).toBe(true);
    expect(setLandingOutline(resized, id, 'rectangle').landings[0]!.outline).toBeUndefined();
  });

  it.each(['left', 'right'] as const)('offers square outside corners on a connected curved run turning %s', direction => {
    const base = stairs(), ids = base.steps.slice(3, 6).map(step => step.id);
    const square = curveSteps(base, ids, direction === 'right' ? -90 : 90, 150, 'square');
    const curved = curveSteps(base, ids, direction === 'right' ? -90 : 90, 150, 'round');
    expect(square.steps.slice(3, 6).every(step => step.outline)).toBe(true);
    expect(pieces(square).every(piece => isSimplePolygon(piece.points))).toBe(true);
    expect(pieces(square).map(piece => piece.points)).not.toEqual(pieces(curved).map(piece => piece.points));
    const middle = square.steps[4]!;
    expect(stairCornerHandles(square, middle.id)).toHaveLength(6);
    const handles = stairCornerHandles(square, middle.id);
    const last = handles[5]!;
    const cornerEdited = reshapeStairCorner(square, middle.id, 5, { x: last.x + 5, y: last.y + 5 });
    expect(cornerEdited).not.toBe(square);
    expect(stairCornerHandles(cornerEdited, middle.id)).toHaveLength(6);
    for (let index = 3; index < square.steps.length - 1; index++) {
      const geometry = measuredStepGeometry(square.steps[index]!, square.steps[index]!.plan!);
      close(geometry.end, square.steps[index + 1]!.plan!);
    }
    square.steps.filter(step => step.outline).forEach(step => {
      const shape = step.outline!;
      expect(Math.max(...shape.points.map(p => p.x)) - Math.min(...shape.points.map(p => p.x))).toBeLessThanOrEqual(1.000001);
      expect(Math.max(...shape.points.map(p => p.y)) - Math.min(...shape.points.map(p => p.y))).toBeLessThanOrEqual(1.000001);
      expect(step.goingNarrow).toBe(step.going);
    });
  });

  it('round-trips custom tread and landing footprints and safely repairs malformed imported shapes', () => {
    const project = makeEmptyProject(), base = measuredStairPreset(stairs(), { kind: 'quarter_turn', direction: 'right' });
    let shaped = setLandingOutline(base, base.landings[0]!.id, 'l_shape');
    const id = shaped.steps[2]!.id, point = stairCornerHandles(shaped, id)[2]!;
    shaped = reshapeStairCorner(shaped, id, 2, { x: point.x + 40, y: point.y + 30 });
    shaped.productId = project.products[0]!.id;
    project.staircases = [shaped];
    const result = parseProject(serializeProject(project));
    if ('error' in result) throw new Error(result.error);
    expect(result.project.staircases[0]!.steps).toEqual(shaped.steps);
    expect(result.project.staircases[0]!.landings).toEqual(shaped.landings);
    const invalid = structuredClone(project);
    invalid.staircases[0]!.steps[2]!.outline!.exit = [500, 900];
    invalid.staircases[0]!.landings[0]!.outline![0]!.x = 400;
    const repaired = parseProject(JSON.stringify(invalid));
    if ('error' in repaired) throw new Error(repaired.error);
    expect(repaired.project.staircases[0]!.steps[2]!.outline).toBeUndefined();
    expect(repaired.project.staircases[0]!.landings[0]!.outline).toBeUndefined();
  });
});
