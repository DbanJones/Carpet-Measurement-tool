import { describe, expect, it } from 'vitest';
import type { Staircase, StairDrawing } from '@engine/types';
import { estimateProject } from '@engine/estimate';
import { isSimplePolygon } from '@engine/geometry';
import { parseProject, serializeProject } from '@engine/serialize';
import { makeEmptyProject, makeSteps, useProjectStore } from '@store/projectStore';
import { defaultDrawing, drawingGeometry, drawingClearanceWarning, validateDrawing } from './stairDrawing';
import { stairPlanGeometry } from './stairLayout';

const flight = (): Staircase => ({ id: 'stairs', name: 'Main stairs', productId: 'carpet', steps: makeSteps(13), landings: [], method: 'cap_and_band', openSides: 'none' });
const wrap: StairDrawing = { points: [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 130, y: 200 }, { x: 130, y: 20 }, { x: 300, y: 20 }] };
const routeLength = (route: Array<{ x: number; y: number }>): number => route.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - route[index]!.x, point.y - route[index]!.y), 0);

describe('drawn staircase directions', () => {
  it('accepts separated returning flights and multiple turns, rejecting crossings and retraced segments', () => {
    expect(validateDrawing(wrap.points)).toBeNull();
    expect(validateDrawing([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }])).toMatch(/crosses/);
    expect(validateDrawing([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 25, y: 0 }])).toMatch(/double back/);
    expect(validateDrawing([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 0, y: 0 }])).toMatch(/crosses/);
    expect(validateDrawing([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toMatch(/top of each other/);
    expect(validateDrawing([{ x: 0, y: 0 }])).toMatch(/two points/);
    expect(validateDrawing([{ x: 0, y: 0 }, { x: Number.NaN, y: 20 }])).toMatch(/finite/);
    expect(validateDrawing(Array.from({ length: 17 }, (_, x) => ({ x, y: 0 })))).toMatch(/16/);
  });

  it('places every measured tread along a multiple-turn route without changing any quantities', () => {
    const stairs = flight();
    stairs.steps[6] = { ...stairs.steps[6]!, kind: 'winder', going: 560, goingNarrow: 100 };
    stairs.landings = [{ id: 'landing', kind: 'quarter', width: 860, length: 940, afterStepIndex: 4 }];
    const project = makeEmptyProject();
    stairs.productId = project.products[0]!.id;
    project.staircases = [stairs];
    const before = estimateProject(project);
    const snapshot = structuredClone(stairs);
    const plan = drawingGeometry(stairs, wrap);
    expect(stairs).toEqual(snapshot);
    expect(plan.pieces.map((piece) => piece.id)).toEqual([...stairs.steps.slice(0, 5).map((step) => step.id), 'landing', ...stairs.steps.slice(5).map((step) => step.id)]);
    expect(plan.pieces.filter((piece) => piece.kind === 'winder')).toHaveLength(1);
    expect(routeLength(plan.route)).toBeCloseTo(stairs.steps.reduce((sum, step) => sum + (step.kind === 'winder' ? (step.going + step.goingNarrow!) / 2 : step.going), 0) + 940, 5);
    project.staircases = [{ ...stairs, drawing: wrap }];
    expect(estimateProject(project)).toEqual(before);
    expect(stairPlanGeometry(project.staircases[0]!)).toEqual(plan);
  });

  it('keeps equal-width tread boundaries coincident through corners and curves', () => {
    for (const curve of [false, true]) {
      const drawing = { points: wrap.points.map((point) => ({ ...point, curve })) };
      const plan = drawingGeometry(flight(), drawing);
      for (let i = 1; i < plan.pieces.length; i++) {
        const previous = plan.pieces[i - 1]!.points, current = plan.pieces[i]!.points;
        expect(previous[previous.length / 2 - 1]).toEqual(current[0]);
        expect(previous[previous.length / 2]).toEqual(current.at(-1));
      }
    }
  });

  it('fans inside tread edges around sharp and rounded corners without bow-tie polygons', () => {
    const routes = [
      [{ x: 200, y: 60 }, { x: 200, y: 280 }, { x: 400, y: 280 }, { x: 400, y: 60 }],
      [{ x: 220, y: 60 }, { x: 220, y: 280 }, { x: 430, y: 280 }],
      [{ x: 160, y: 60 }, { x: 160, y: 310, curve: true }, { x: 420, y: 310, curve: true }, { x: 420, y: 90 }],
    ];
    for (const points of routes) {
      const plan = drawingGeometry(flight(), { points });
      expect(plan.pieces.filter(piece => !isSimplePolygon(piece.points)).map(piece => piece.label)).toEqual([]);
      expect(plan.pieces).toHaveLength(13);
      expect(drawingClearanceWarning(flight(), { points })).toBeNull();
    }
  });

  it('warns about tight returning flights without preventing a valid schematic from being saved', () => {
    const drawing = { points: [{ x: 200, y: 60 }, { x: 200, y: 280 }, { x: 230, y: 280 }, { x: 230, y: 60 }] };
    expect(validateDrawing(drawing.points)).toBeNull();
    expect(drawingClearanceWarning(flight(), drawing)).toMatch(/closer together/);
    expect(drawingClearanceWarning({ ...flight(), steps: flight().steps.map(step => ({ ...step, width: 150 })) }, drawing)).toBeNull();
  });

  it('rounds selected bends and gives a reversible coordinate transform for stable dragging', () => {
    const stairs = flight();
    const angular = drawingGeometry(stairs, wrap);
    const curved = drawingGeometry(stairs, { points: wrap.points.map((point) => ({ ...point, curve: true })) });
    expect(curved.route.length).toBeGreaterThan(angular.route.length + 30);
    expect(curved.pieces.some((piece) => piece.points.length > 4)).toBe(true);
    const { scale, offsetX, offsetY } = curved.drawingTransform;
    expect(curved.route[0]).toEqual({ x: wrap.points[0]!.x * scale + offsetX, y: wrap.points[0]!.y * scale + offsetY });
    expect(curved.route.at(-1)!.x).toBeCloseTo(wrap.points.at(-1)!.x * scale + offsetX);
    expect(curved.route.at(-1)!.y).toBeCloseTo(wrap.points.at(-1)!.y * scale + offsetY);
    expect(routeLength(curved.route)).toBeCloseTo(stairs.steps.reduce((sum, step) => sum + step.going, 0), 5);
  });

  it('handles empty measurements, invalid drawings and acute turns with finite, bounded geometry', () => {
    const stairs = flight();
    const acute = { points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 1, y: 0 }] };
    const cases: Array<[Staircase, StairDrawing]> = [[stairs, acute], [{ ...stairs, steps: [] }, wrap], [stairs, { points: [{ x: 0, y: 0 }] }], [stairs, { points: [{ x: NaN, y: 0 }, { x: 0, y: 10 }] }]];
    for (const [source, drawing] of cases) {
      const plan = drawingGeometry(source, drawing);
      expect(Number.isFinite(plan.width) && plan.width > 0).toBe(true);
      expect(Number.isFinite(plan.height) && plan.height > 0).toBe(true);
      expect(plan.pieces.flatMap((piece) => piece.points).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      expect(plan.width).toBeLessThan(10000);
      expect(plan.height).toBeLessThan(10000);
    }
  });

  it('seeds valid editable directions for legacy layouts and returns an independent copy', () => {
    for (const kind of ['straight', 'quarter_turn', 'half_turn', 'curved'] as const) {
      for (const direction of ['left', 'right'] as const) {
        const stairs = { ...flight(), layout: { kind, direction, turnStartIndex: 5, turnSteps: 3, curveAngle: 270 } };
        expect(validateDrawing(defaultDrawing(stairs).points)).toBeNull();
      }
    }
    const stairs = { ...flight(), drawing: structuredClone(wrap) };
    const seeded = defaultDrawing(stairs);
    seeded.points[0]!.x = 55;
    expect(stairs.drawing.points[0]!.x).toBe(0);
  });

  it('persists drawings through project exports and independent staircase duplication', () => {
    const project = makeEmptyProject();
    const stairs = { ...flight(), productId: project.products[0]!.id, drawing: { points: wrap.points.map((point) => ({ ...point, curve: true })) } };
    project.staircases = [stairs];
    const parsed = parseProject(serializeProject(project));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.project.staircases[0]!.drawing).toEqual(stairs.drawing);
    expect(parsed.warnings).toEqual([]);
    useProjectStore.setState({ project: makeEmptyProject(), selection: { kind: 'none' } });
    const id = useProjectStore.getState().addStaircase(stairs);
    useProjectStore.getState().duplicateStaircase(id);
    const [original, copy] = useProjectStore.getState().project.staircases;
    expect(copy!.drawing).toEqual(original!.drawing);
    expect(copy!.drawing).not.toBe(original!.drawing);
    expect(copy!.drawing!.points[0]).not.toBe(original!.drawing!.points[0]);
  });

  it('drops malformed, oversized and self-crossing imported drawings while retaining measured steps', () => {
    for (const drawing of [{ points: Array.from({ length: 17 }, (_, x) => ({ x, y: 0 })) }, { points: [{ x: 1, y: 2 }, { x: 'bad', y: 3 }] }, { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }] }]) {
      const project = makeEmptyProject();
      const stairs = { ...flight(), productId: project.products[0]!.id };
      const parsed = parseProject(JSON.stringify({ ...project, staircases: [{ ...stairs, drawing }] }));
      if ('error' in parsed) throw new Error(parsed.error);
      expect(parsed.project.staircases[0]!.drawing).toBeUndefined();
      expect(parsed.project.staircases[0]!.steps).toEqual(stairs.steps);
      expect(parsed.warnings.some((warning) => warning.includes('direction drawing'))).toBe(true);
    }
  });
});
