import { makeEmptyProject, makeSteps } from '@store/projectStore';
import type { Staircase } from '@engine/types';
import { parseProject, serializeProject } from '@engine/serialize';
import { isSimplePolygon } from '@engine/geometry';
import { changeStepKind, contiguousSelection, curveSteps, deleteSteps, editableSteps, insertStep, insertStepBefore, isStepRectangular, makeStepRectangular, measuredStairPreset, moveSteps, patchStepMeasurements, reconcileStepPlans, stairFlightDimensions, uLandingPreset } from './stepEditing';
import { stairPlanGeometry } from './stairLayout';
import { measuredStepGeometry } from './stepGeometry';
import { outlinesOverlap } from '../floorplan/outlineEditing';
import { reshapeStairOutline } from './stairOutlineEditing';

const flight = (): Staircase => ({ id: 'stairs', name: 'Test stairs', productId: makeEmptyProject().products[0]!.id, steps: makeSteps(13), landings: [], method: 'cap_and_band', openSides: 'none' });

function expectConnected(staircase: Staircase, turn = -180) {
  const pieces = stairPlanGeometry(staircase, { normalize: false }).pieces;
  expect(pieces.every(piece => isSimplePolygon(piece.points))).toBe(true);
  expect(pieces.at(-1)!.endHeading! - pieces[0]!.heading!).toBeCloseTo(turn, 6);
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    if (i) {
      const previous = pieces[i - 1]!;
      expect(piece.start!.x).toBeCloseTo(previous.end!.x, 5);
      expect(piece.start!.y).toBeCloseTo(previous.end!.y, 5);
      for (let side = 0; side < 2; side++) {
        const before = previous.points[previous.exit![side]!]!, after = piece.points[piece.entry![side]!]!;
        expect(after.x).toBeCloseTo(before.x, 5);
        expect(after.y).toBeCloseTo(before.y, 5);
      }
    }
    for (let j = i + 1; j < pieces.length; j++) expect(outlinesOverlap(piece.points, pieces[j]!.points)).toBe(false);
  }
}

function centreNinthWinder(direction: 'left' | 'right') {
  const initial = measuredStairPreset(flight(), { kind: 'half_turn', direction, turn: 'winders', turnSteps: 8, corner: 'square' });
  const staircase = insertStep(initial, initial.steps[5]!.id);
  const id = staircase.steps.find(step => !initial.steps.some(old => old.id === step.id))!.id;
  return { staircase, id };
}

describe('individual staircase objects', () => {
  it.each(['left', 'right'] as const)('makes the middle ninth winder rectangular in a square %s U without skewing either flight', direction => {
    const { staircase, id } = centreNinthWinder(direction), index = staircase.steps.findIndex(step => step.id === id);
    const original = stairPlanGeometry(staircase, { normalize: false });
    const result = changeStepKind(staircase, id, 'straight');
    expect(result).not.toBe(staircase);
    expect(result.steps).toHaveLength(14);
    expect(result.landings).toEqual([]);
    const step = result.steps[index]!, target = measuredStepGeometry(step, step.plan!);
    expect(step.kind).toBe('straight');
    expect(step.going).toBeGreaterThanOrEqual(100);
    expect(step.going).toBeLessThanOrEqual(223);
    expect(step.width).toBe(860);
    expect(target.endHeading - target.heading).toBeCloseTo(0, 8);
    expect(target.points).toHaveLength(4);
    target.points.forEach((point, at) => {
      const next = target.points[(at + 1) % 4]!;
      expect(Math.min(Math.abs(point.x - next.x), Math.abs(point.y - next.y))).toBeLessThan(.00001);
    });
    const edited = stairPlanGeometry(result, { normalize: false });
    original.pieces.forEach((piece, at) => {
      if (Math.abs(at - index) <= 1) return;
      const after = edited.pieces.find(other => other.id === piece.id)!;
      piece.points.forEach((point, corner) => {
        expect(after.points[corner]!.x).toBeCloseTo(point.x, 5);
        expect(after.points[corner]!.y).toBeCloseTo(point.y, 5);
      });
    });
    expectConnected(result, direction === 'right' ? -180 : 180);
    expect(isStepRectangular(result, id)).toBe(true);
    expect(makeStepRectangular(result, id)).toBe(result);
  });

  it.each(['left', 'right'] as const)('preserves the central rectangle and full %s U through mixed-tread insertions and deletions', direction => {
    const { staircase, id } = centreNinthWinder(direction), result = makeStepRectangular(staircase, id);
    const rectangle = result.steps.find(step => step.id === id)!;
    const neighbours = [result.steps[5]!.id, result.steps[7]!.id];
    for (const neighbour of neighbours) {
      const inserted = insertStep(result, neighbour);
      const addedId = inserted.steps.find(step => !result.steps.some(old => old.id === step.id))!.id;
      expect(inserted.steps.find(step => step.id === id)).toEqual(rectangle);
      expect(inserted.steps).toHaveLength(result.steps.length + 1);
      const deleted = deleteSteps(inserted, [addedId]);
      expect(deleted.steps).toHaveLength(result.steps.length);
      expect(deleted.steps.find(step => step.id === id)).toEqual(rectangle);
      for (const stairs of [inserted, deleted]) expectConnected(stairs, direction === 'right' ? -180 : 180);
    }
    const withoutRectangle = deleteSteps(result, [id]);
    expect(withoutRectangle.steps.some(step => step.id === id)).toBe(false);
    expect(withoutRectangle.steps).toHaveLength(result.steps.length - 1);
    expectConnected(withoutRectangle, direction === 'right' ? -180 : 180);
    const splitAgain = insertStep(withoutRectangle, withoutRectangle.steps[5]!.id);
    expectConnected(splitAgain, direction === 'right' ? -180 : 180);
  });

  it('inserts before the first tread without moving the existing staircase and preserves landing attachments', () => {
    const source = editableSteps(flight());
    source.landings = [{ id: 'top', kind: 'top', afterStepIndex: 12, width: 860, length: 1000 }];
    const result = insertStepBefore(source, source.steps[0]!.id);
    expect(result.steps.slice(1)).toEqual(source.steps);
    expect(result.landings[0]!.afterStepIndex).toBe(13);
    const end = measuredStepGeometry(result.steps[0]!, result.steps[0]!.plan!).end;
    expect(end.x).toBeCloseTo(source.steps[0]!.plan!.x, 5);
    expect(end.y).toBeCloseTo(source.steps[0]!.plan!.y, 5);
    expect(deleteSteps(result, [result.steps[0]!.id]).steps).toEqual(source.steps);
  });

  it('inserts before a selected winder within a mixed turn while retaining that tread identity and total rotation', () => {
    const { staircase, id } = centreNinthWinder('right'), source = makeStepRectangular(staircase, id), target = source.steps[7]!.id;
    const result = insertStepBefore(source, target), inserted = result.steps[7]!;
    expect(source.steps.some(step => step.id === inserted.id)).toBe(false);
    expect(result.steps[8]!.id).toBe(target);
    expect(result.steps.find(step => step.id === id)).toEqual(source.steps.find(step => step.id === id));
    expectConnected(result);
  });

  it('restores the shape after inserting and deleting a standard tread beside the central rectangle', () => {
    const { staircase, id } = centreNinthWinder('right'), source = makeStepRectangular(staircase, id);
    const inserted = insertStep(source, id), added = inserted.steps.find(step => !source.steps.some(old => old.id === step.id))!;
    expect(added).toMatchObject({ kind: 'straight', width: 860, going: 223 });
    expectConnected(inserted);
    const restored = deleteSteps(inserted, [added.id]);
    expectConnected(restored);
    expect(restored.steps.find(step => step.id === id)).toEqual(source.steps.find(step => step.id === id));
    const original = stairPlanGeometry(source, { normalize: false }), result = stairPlanGeometry(restored, { normalize: false });
    original.pieces.forEach((piece, index) => piece.points.forEach((point, corner) => {
      expect(result.pieces[index]!.points[corner]!.x).toBeCloseTo(point.x, 5);
      expect(result.pieces[index]!.points[corner]!.y).toBeCloseTo(point.y, 5);
    }));
  });

  it('resizes an outlined rectangle through shared corners and keeps the departure flight unchanged', () => {
    const { staircase, id } = centreNinthWinder('right'), source = makeStepRectangular(staircase, id);
    const target = source.steps.find(step => step.id === id)!;
    const resized = patchStepMeasurements(source, id, { going: target.going - 10, rise: 185 });
    expect(resized).not.toBe(source);
    expect(resized.steps.find(step => step.id === id)).toMatchObject({ going: target.going - 10, rise: 185 });
    expect(resized.steps.at(-1)!.plan!.heading).toBeCloseTo(source.steps.at(-1)!.plan!.heading, 6);
    expectConnected(resized);
    expect(patchStepMeasurements(source, id, { going: 0 })).toBe(source);
    expect(patchStepMeasurements(source, id, { width: NaN })).toBe(source);
  });

  it.each(['left', 'right'] as const)('can change the central rectangle back into a winder without adding rotation to the %s U', direction => {
    const { staircase, id } = centreNinthWinder(direction), source = makeStepRectangular(staircase, id);
    const result = changeStepKind(source, id, 'winder');
    expect(result).not.toBe(source);
    const target = result.steps.find(step => step.id === id)!;
    expect(target.kind).toBe('winder');
    expect(Math.abs(target.plan!.turn!)).toBeGreaterThan(1);
    expectConnected(result, direction === 'right' ? -180 : 180);
    expect(result.steps.at(-1)!.plan!.heading).toBeCloseTo(source.steps.at(-1)!.plan!.heading, 6);
  });

  it('retains lightweight schedule editing until an unplanned flight needs a shape edit', () => {
    const source = flight(), result = changeStepKind(source, source.steps[3]!.id, 'winder');
    expect(result.steps[3]).toMatchObject({ kind: 'winder', goingNarrow: 100 });
    expect(result.steps.every(step => !step.plan)).toBe(true);
    expect(result.steps[4]).toBe(source.steps[4]);
  });

  it('preserves a surveyed outside corner when inserting elsewhere in an equal-angle turn', () => {
    const source = measuredStairPreset(flight(), { kind: 'half_turn', direction: 'right', turn: 'winders', turnSteps: 9, corner: 'square' });
    const target = source.steps[4]!, piece = measuredStepGeometry(target, target.plan!);
    const additional = piece.points.map((point, index) => ({ point, index })).filter(({ index }) => !piece.entry.includes(index) && !piece.exit.includes(index));
    const corner = additional.sort((a, b) => b.point.y - a.point.y)[0]!;
    const surveyed = reshapeStairOutline(source, target.id, piece.points.map((point, index) => index === corner.index ? { ...point, y: point.y + 20 } : point));
    expect(surveyed).not.toBe(source);
    const inserted = insertStep(surveyed, surveyed.steps[7]!.id);
    expect(inserted.steps).toHaveLength(surveyed.steps.length + 1);
    expect(inserted.steps.find(step => step.id === target.id)).toEqual(surveyed.steps.find(step => step.id === target.id));
    expectConnected(inserted);
  });

  it('rejects deleting the whole turn when the remaining footprint would be one folded-back tread', () => {
    const { staircase, id } = centreNinthWinder('right'), source = makeStepRectangular(staircase, id);
    const turnIds = source.steps.slice(2, 11).map(step => step.id);
    expect(deleteSteps(source, turnIds)).toBe(source);
    expectConnected(source);
  });

  it.each(['round', 'square'] as const)('keeps an eight-winder 180 degree %s U connected without a landing when adding or deleting a step', corner => {
    const source = measuredStairPreset(flight(), { kind: 'half_turn', direction: 'right', turn: 'winders', turnSteps: 8, corner });
    const original = stairPlanGeometry(source, { normalize: false });
    const added = insertStep(source, source.steps[5]!.id);
    const newId = added.steps.find(step => !source.steps.some(old => old.id === step.id))!.id;
    const deleted = deleteSteps(added, [newId]);
    for (const [stairs, count] of [[source, 8], [added, 9], [deleted, 8]] as const) {
      expect(stairs.landings).toEqual([]);
      expect(stairs.steps.filter(step => step.kind === 'winder')).toHaveLength(count);
      const geometry = stairPlanGeometry(stairs, { normalize: false });
      expect(geometry.pieces.every(piece => isSimplePolygon(piece.points))).toBe(true);
      for (let index = 1; index < geometry.pieces.length; index++) {
        const before = geometry.pieces[index - 1]!, after = geometry.pieces[index]!;
        expect(Math.hypot(before.end!.x - after.start!.x, before.end!.y - after.start!.y)).toBeLessThan(.01);
      }
      expect(Math.abs(geometry.pieces.at(-1)!.endHeading! - geometry.pieces[0]!.heading!)).toBeCloseTo(180, 0);
      expect(Math.abs(geometry.width - original.width)).toBeLessThan(15);
      expect(Math.abs(geometry.height - original.height)).toBeLessThan(15);
    }
  });

  it('does not inflate the flight width after applying a square U preset repeatedly', () => {
    const options = { kind: 'half_turn', direction: 'right', turn: 'winders', turnSteps: 8, corner: 'square' } as const;
    let stairs = measuredStairPreset({ ...flight(), steps: makeSteps(8) }, options);
    const original = stairPlanGeometry(stairs);
    for (let pass = 0; pass < 3; pass++) stairs = measuredStairPreset(stairs, options);
    expect(stairFlightDimensions(stairs, 4).width).toBe(860);
    expect(stairPlanGeometry(stairs).width).toBeCloseTo(original.width, 5);
    expect(stairPlanGeometry(stairs).height).toBeCloseTo(original.height, 5);
    expect(stairs.steps).toHaveLength(8);
    expect(stairs.landings).toEqual([]);
  });

  it('removes the first or last winder without moving the incoming flight or leaving a gap before the upper flight', () => {
    const original = measuredStairPreset(flight(), { kind: 'half_turn', direction: 'right', turn: 'winders', turnSteps: 8, corner: 'square' });
    const winders = original.steps.filter(step => step.kind === 'winder');
    for (const id of [winders[0]!.id, winders.at(-1)!.id]) {
      const result = deleteSteps(original, [id]);
      const pieces = stairPlanGeometry(result, { normalize: false }).pieces;
      expect(result.steps[0]!.plan).toEqual(original.steps[0]!.plan);
      expect(pieces.at(-1)!.endHeading).toBeCloseTo(-90, 5);
      for (let index = 1; index < pieces.length; index++) expect(Math.hypot(pieces[index]!.start!.x - pieces[index - 1]!.end!.x, pieces[index]!.start!.y - pieces[index - 1]!.end!.y)).toBeLessThan(.01);
    }
  });
  it('moves only the selected treads, preserving all measured dimensions and identities', () => {
    const source = flight(), prepared = editableSteps(source), ids = source.steps.slice(2, 6).map(step => step.id);
    const moved = moveSteps(source, ids, { x: 200, y: -100 });
    moved.steps.forEach((step, index) => {
      const { plan, ...dimensions } = step;
      expect(dimensions).toEqual(source.steps[index]);
      expect(plan!.x).toBeCloseTo(prepared.steps[index]!.plan!.x + (ids.includes(step.id) ? 200 : 0));
      expect(plan!.y).toBeCloseTo(prepared.steps[index]!.plan!.y + (ids.includes(step.id) ? -100 : 0));
    });
  });

  it('anchors the walking line to the actual first tread after individual placement', () => {
    const source = flight(), moved = moveSteps(source, [source.steps[0]!.id], { x: 250, y: 100 });
    const geometry = stairPlanGeometry(moved);
    expect(geometry.route[0]).toEqual(geometry.pieces.find(piece => piece.stepIndex === 0)!.start);
  });

  it('curves four consecutive steps into a connected turn and continues the upper flight', () => {
    const source = flight(), ids = source.steps.slice(3, 7).map(step => step.id);
    const curved = curveSteps(source, ids, -90, 150);
    expect(curved.steps.filter(step => step.kind === 'winder')).toHaveLength(4);
    expect(curved.steps.map(step => step.id)).toEqual(source.steps.map(step => step.id));
    expect(curved.steps.map(step => step.rise)).toEqual(source.steps.map(step => step.rise));
    for (let index = 3; index <= 6; index++) {
      const step = curved.steps[index]!;
      expect(step.plan!.turn).toBeCloseTo(-22.5, 0);
      expect(step.going).toBeGreaterThan(step.goingNarrow!);
      const geometry = measuredStepGeometry(step, step.plan!);
      expect(step.plan!.turn).toBeCloseTo(geometry.endHeading - geometry.heading, 8);
      expect(isSimplePolygon(geometry.points)).toBe(true);
      expect(curved.steps[index + 1]!.plan!.x).toBeCloseTo(geometry.end.x, 5);
      expect(curved.steps[index + 1]!.plan!.y).toBeCloseTo(geometry.end.y, 5);
    }
    expect(contiguousSelection(source, [source.steps[0]!.id, source.steps[3]!.id])).toBe(false);
  });

  it('recomputes a curved footprint from changes to wide and narrow dimensions', () => {
    const source = flight(), curved = curveSteps(source, [source.steps[2]!.id], -45);
    const step = curved.steps[2]!, before = measuredStepGeometry(step, step.plan!);
    expect(measuredStepGeometry({ ...step, going: step.going + 100 }, step.plan!).points).not.toEqual(before.points);
    expect(measuredStepGeometry({ ...step, goingNarrow: step.goingNarrow! + 50 }, step.plan!).points).not.toEqual(before.points);
  });

  it('keeps landing positions attached when inserting and deleting selected steps', () => {
    const source = flight(); source.landings = [{ id: 'landing', kind: 'top', length: 1000, width: 860, afterStepIndex: 12 }];
    const inserted = insertStep(source, source.steps[3]!.id);
    expect(inserted.steps).toHaveLength(14);
    expect(inserted.landings[0]!.afterStepIndex).toBe(13);
    expect(new Set(inserted.steps.map(step => step.id)).size).toBe(14);
    const deleted = deleteSteps(inserted, inserted.steps.slice(2, 5).map(step => step.id));
    expect(deleted.steps).toHaveLength(11);
    expect(deleted.landings[0]!.afterStepIndex).toBe(10);
    expect(deleteSteps(deleted, deleted.steps.map(step => step.id))).toBe(deleted);
  });

  it('creates a clean U with a rectangular half landing and separated parallel flights', () => {
    const source = flight(), stairs = uLandingPreset(source), plan = stairPlanGeometry(stairs);
    expect(stairs.steps).toEqual(source.steps);
    expect(stairs.landings[0]).toMatchObject({ kind: 'half', width: 1820, length: 860, afterStepIndex: 5 });
    expect(plan.pieces.every(piece => isSimplePolygon(piece.points))).toBe(true);
    const first = plan.pieces.find(piece => piece.stepIndex === 0)!, returning = plan.pieces.find(piece => piece.stepIndex === 6)!;
    expect(Math.abs(returning.heading! - first.heading!)).toBeCloseTo(180);
    expect(Math.abs(returning.start!.x - first.start!.x)).toBeCloseTo(960);
    expect(uLandingPreset(stairs).landings).toHaveLength(1);
  });

  it('persists individual geometry and rejects malformed imported positions without losing measurements', () => {
    const project = makeEmptyProject(), source = flight(); source.productId = project.products[0]!.id;
    project.staircases = [curveSteps(source, source.steps.slice(2, 6).map(step => step.id), 90)];
    const parsed = parseProject(serializeProject(project));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.project.staircases[0]!.steps).toEqual(project.staircases[0]!.steps);
    const invalid = structuredClone(project); invalid.staircases[0]!.steps[0]!.plan!.x = NaN;
    const repaired = parseProject(JSON.stringify(invalid));
    if ('error' in repaired) throw new Error(repaired.error);
    expect(repaired.project.staircases[0]!.steps[0]!.plan).toBeUndefined();
    expect(repaired.project.staircases[0]!.steps[0]!.rise).toBe(source.steps[0]!.rise);
  });

  it('replaces an existing curved route and intermediate landings with one clean U while preserving measured steps', () => {
    const source = flight();
    const curved = curveSteps(source, source.steps.slice(2, 6).map(step => step.id), -90);
    curved.landings = [
      { id: 'old-turn', kind: 'quarter', length: 800, width: 860, afterStepIndex: 8 },
      { id: 'top', kind: 'top', length: 1000, width: 860, afterStepIndex: 12 },
    ];
    const result = uLandingPreset(curved);
    expect(result.landings.map(landing => landing.id)).not.toContain('old-turn');
    expect(result.landings.filter(landing => landing.kind !== 'top')).toHaveLength(1);
    expect(result.landings.find(landing => landing.id === 'top')).toEqual(curved.landings[1]);
    expect(result.steps).toEqual(curved.steps.map(({ plan: _plan, ...step }) => step));
    const geometry = stairPlanGeometry(result);
    const treads = geometry.pieces.filter(piece => piece.stepIndex !== undefined);
    expect(treads.every(piece => piece.points.length === 4)).toBe(true);
    expect(treads.every(piece => Math.abs(piece.endHeading! - piece.heading!) < 1e-8)).toBe(true);
    expect(treads[6]!.heading! - treads[0]!.heading!).toBeCloseTo(-180);
  });

  it('reflows the upper flight after a typed going edit and preserves deliberately displaced steps', () => {
    const source = flight();
    const before = moveSteps(source, [source.steps[5]!.id], { x: 120, y: -80 });
    const after = { ...before, steps: before.steps.map((step, index) => index === 2 ? { ...step, going: step.going + 100 } : step) };
    const result = reconcileStepPlans(before, after);
    result.steps.forEach((step, index) => {
      expect(step.plan!.x).toBeCloseTo(before.steps[index]!.plan!.x);
      expect(step.plan!.y).toBeCloseTo(before.steps[index]!.plan!.y + (index > 2 ? 100 : 0));
    });
    expect(result.steps[2]!.going).toBe(before.steps[2]!.going + 100);
  });

  it('reflows the upper flight and updates the shown turn after curved wide/narrow/width edits', () => {
    const source = flight();
    const before = curveSteps(source, source.steps.slice(2, 6).map(step => step.id), -90);
    const after = { ...before, steps: before.steps.map((step, index) => index === 3 ? { ...step, going: step.going + 80, goingNarrow: step.goingNarrow! + 20, width: step.width + 40 } : step) };
    const result = reconcileStepPlans(before, after);
    for (let index = 2; index < result.steps.length - 1; index++) {
      const step = result.steps[index]!, next = result.steps[index + 1]!;
      const geometry = measuredStepGeometry(step, step.plan!);
      expect(next.plan!.x).toBeCloseTo(geometry.end.x, 5);
      expect(next.plan!.y).toBeCloseTo(geometry.end.y, 5);
      expect(next.plan!.heading).toBeCloseTo(geometry.endHeading, 5);
      expect(step.plan!.turn).toBeCloseTo(geometry.endHeading - geometry.heading, 8);
    }
  });

  it('connects planned flights when adding, resizing and deleting a quarter landing', () => {
    const before = editableSteps({ ...flight(), layout: { kind: 'straight', direction: 'right', turnStartIndex: 0, turnSteps: 0 } });
    const landing = { id: 'turn', kind: 'quarter' as const, length: 1000, width: 860, afterStepIndex: 3 };
    const added = reconcileStepPlans(before, { ...before, landings: [landing] });
    expect(added.steps[4]!.plan!.heading - before.steps[4]!.plan!.heading).toBeCloseTo(-90);
    const resized = reconcileStepPlans(added, { ...added, landings: [{ ...landing, length: 1400, width: 1060 }] });
    expect(resized.steps[4]!.plan!.x - added.steps[4]!.plan!.x).toBeCloseTo(100);
    expect(resized.steps[4]!.plan!.y - added.steps[4]!.plan!.y).toBeCloseTo(200);
    const removed = reconcileStepPlans(resized, { ...resized, landings: [] });
    removed.steps.forEach((step, index) => {
      expect(step.plan!.x).toBeCloseTo(before.steps[index]!.plan!.x, 5);
      expect(step.plan!.y).toBeCloseTo(before.steps[index]!.plan!.y, 5);
      expect(step.plan!.heading).toBeCloseTo(before.steps[index]!.plan!.heading, 5);
    });
  });

  it('rotates a manual offset with its flight when a turning landing changes', () => {
    const source = flight();
    const before = moveSteps(source, [source.steps[5]!.id], { x: 120, y: -80 });
    const after = reconcileStepPlans(before, { ...before, landings: [{ id: 'turn', kind: 'quarter', width: 860, length: 1000, afterStepIndex: 3 }] });
    const pieces = stairPlanGeometry(after, { normalize: false }).pieces;
    const shifted = pieces.find(piece => piece.id === source.steps[5]!.id)!;
    expect(shifted.start!.x - shifted.incoming!.x).toBeCloseTo(-80);
    expect(shifted.start!.y - shifted.incoming!.y).toBeCloseTo(-120);
  });

  it('fits unequal-width U flights within their half landing and follows later width edits', () => {
    const source = flight(); source.steps[6] = { ...source.steps[6]!, width: 1100 };
    const before = editableSteps(uLandingPreset(source));
    const after = reconcileStepPlans(before, { ...before, steps: before.steps.map((step, index) => index === 6 ? { ...step, width: 1300 } : step) });
    for (const stairs of [before, after]) {
      const pieces = stairPlanGeometry(stairs).pieces;
      const landing = pieces.find(piece => piece.kind === 'landing')!;
      const returning = pieces.find(piece => piece.stepIndex === 6)!;
      expect(Math.max(...returning.points.map(point => point.x))).toBeCloseTo(Math.max(...landing.points.map(point => point.x)), 5);
    }
  });

  it('keeps planned steps connected when inserting, appending and deleting steps', () => {
    const before = editableSteps(flight());
    const inserted = insertStep(before, before.steps[3]!.id);
    const added = reconcileStepPlans(inserted, { ...inserted, steps: [...inserted.steps, ...makeSteps(1)] });
    const deleted = deleteSteps(added, [added.steps[3]!.id, added.steps[4]!.id]);
    for (const result of [inserted, added, deleted]) for (let index = 0; index < result.steps.length - 1; index++) {
      const geometry = measuredStepGeometry(result.steps[index]!, result.steps[index]!.plan!);
      expect(result.steps[index + 1]!.plan!.x).toBeCloseTo(geometry.end.x, 5);
      expect(result.steps[index + 1]!.plan!.y).toBeCloseTo(geometry.end.y, 5);
    }
  });

  it('does not reinterpret intentional diagram translations or group curves as dimension edits', () => {
    const before = editableSteps(flight());
    const moved = moveSteps(before, [before.steps[3]!.id], { x: 170, y: 60 });
    expect(reconcileStepPlans(before, moved)).toBe(moved);
    const curved = curveSteps(before, before.steps.slice(2, 6).map(step => step.id), -90);
    expect(reconcileStepPlans(before, curved)).toBe(curved);
  });

  it('keeps drawn straight treads rectangular and measured when switching to individual editing', () => {
    const before = { ...flight(), drawing: { points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 180, y: 100 }] } };
    const result = editableSteps(before);
    expect(result.steps.map(({ plan: _plan, ...step }) => step)).toEqual(before.steps);
    for (const step of result.steps) {
      const geometry = measuredStepGeometry(step, step.plan!);
      expect(geometry.points).toHaveLength(4);
      expect(Math.hypot(geometry.points[1]!.x - geometry.points[0]!.x, geometry.points[1]!.y - geometry.points[0]!.y)).toBeCloseTo(step.width);
      expect(Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)).toBeCloseTo(step.going);
      expect(step.plan!.turn).toBe(0);
    }
  });

  it('produces a simple polygon for a pointed winder with zero inside radius', () => {
    const source = flight(), result = curveSteps(source, source.steps.slice(2, 6).map(step => step.id), -90, 0);
    for (const step of result.steps.slice(2, 6)) {
      const geometry = measuredStepGeometry(step, step.plan!);
      expect(isSimplePolygon(geometry.points)).toBe(true);
      expect(new Set(geometry.points.map(point => `${point.x},${point.y}`)).size).toBe(geometry.points.length);
    }
  });
});
