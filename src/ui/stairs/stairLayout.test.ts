import { describe, expect, it } from 'vitest';
import type { Staircase, StairLayout } from '@engine/types';
import { makeEmptyProject, makeSteps, useProjectStore } from '@store/projectStore';
import { parseProject, serializeProject } from '@engine/serialize';
import { applyWinderLayout, defaultStairLayout, stairPlanGeometry } from './stairLayout';

const flight = (): Staircase => ({ id: 'stairs', name: 'Main stairs', productId: 'carpet', steps: makeSteps(13), landings: [], method: 'cap_and_band', openSides: 'none' });
const corner = (kind: StairLayout['kind'] = 'quarter_turn', direction: StairLayout['direction'] = 'right'): StairLayout => ({ kind, direction, turnStartIndex: 5, turnSteps: 3, curveAngle: 180, innerRadius: 300 });

describe('staircase plan geometry and persistence', () => {
  it('draws a quarter turn with a right-going upper flight and mirrors it for left turns', () => {
    const source = flight();
    for (const direction of ['left', 'right'] as const) {
      const plan = stairPlanGeometry(applyWinderLayout(source, corner('quarter_turn', direction), 600, 100));
      const last = plan.route.at(-1)!; const previous = plan.route.at(-2)!;
      expect(Math.abs(last.y - previous.y)).toBeLessThan(.00001);
      expect(direction === 'right' ? last.x > previous.x : last.x < previous.x).toBe(true);
      expect(plan.pieces).toHaveLength(source.steps.length);
      expect(plan.pieces.filter((p) => p.kind === 'winder')).toHaveLength(3);
      expect(plan.width).toBeGreaterThan(860);
    }
  });

  it('returns the upper flight towards the bottom in a half turn', () => {
    const plan = stairPlanGeometry(applyWinderLayout(flight(), corner('half_turn'), 600, 100));
    const last = plan.route.at(-1)!; const previous = plan.route.at(-2)!;
    expect(last.y).toBeLessThan(previous.y);
    expect(last.x).toBeCloseTo(previous.x);
    expect(plan.width).toBeGreaterThan(1700);
  });

  it('curves a sequence of wedge treads and responds to sweep and inner radius', () => {
    const source = flight();
    const layout = { ...corner('curved'), turnStartIndex: 0, turnSteps: 13 };
    const curved = applyWinderLayout(source, layout, 520, 180);
    const plan = stairPlanGeometry(curved);
    expect(plan.pieces.every((p) => p.kind === 'winder' && p.points.length > 4)).toBe(true);
    const larger = stairPlanGeometry({ ...curved, layout: { ...layout, innerRadius: 900 } });
    expect(larger.width).toBeGreaterThan(plan.width);
    const quarter = stairPlanGeometry({ ...curved, layout: { ...layout, curveAngle: 90 } });
    expect(quarter.width).not.toBeCloseTo(plan.width);
    expect(curved.steps.map((s) => s.rise)).toEqual(source.steps.map((s) => s.rise));
  });

  it('turns at a quarter or half landing without inventing extra steps', () => {
    for (const kind of ['quarter', 'half'] as const) {
      const source = flight();
      source.landings = [{ id: 'landing', kind, afterStepIndex: 5, length: 900, width: kind === 'half' ? 1720 : 860 }];
      const plan = stairPlanGeometry(source);
      expect(plan.pieces).toHaveLength(14);
      expect(plan.pieces.filter((p) => p.kind === 'landing')).toHaveLength(1);
      const last = plan.route.at(-1)!; const previous = plan.route.at(-2)!;
      expect(kind === 'half' ? last.y < previous.y : last.x > previous.x).toBe(true);
    }
  });

  it('only updates the selected turning tread depths, retaining every step identity and other measurements', () => {
    const source = flight();
    source.steps[1] = { ...source.steps[1]!, going: 251, width: 910, rise: 197 };
    source.landings = [{ id: 'top', kind: 'top', afterStepIndex: 12, length: 1200, width: 1000 }];
    const result = applyWinderLayout(source, corner(), 625, 95);
    expect(result.steps.map((s) => s.id)).toEqual(source.steps.map((s) => s.id));
    expect(result.steps[1]).toEqual(source.steps[1]);
    expect(result.steps.slice(5, 8).every((s) => s.kind === 'winder' && s.going === 625 && s.goingNarrow === 95)).toBe(true);
    expect(result.landings).toEqual(source.landings);
    expect(source.steps.every((s) => s.kind === 'straight')).toBe(true);
    const keepDepths = applyWinderLayout(source, corner());
    expect(keepDepths.steps.map((s) => s.going)).toEqual(source.steps.map((s) => s.going));
  });

  it('infers existing turns from recorded winders and landing positions', () => {
    const source = applyWinderLayout(flight(), corner());
    delete source.layout;
    expect(defaultStairLayout(source)).toMatchObject({ kind: 'quarter_turn', turnStartIndex: 5, turnSteps: 3 });
    source.landings = [{ id: 'landing', kind: 'half', afterStepIndex: 6, length: 900, width: 1720 }];
    expect(defaultStairLayout(source)).toMatchObject({ kind: 'half_turn', turnStartIndex: 7, turnSteps: 0 });
  });

  it('duplicates all staircase measurements with fresh IDs and an unpositioned floor-plan copy', () => {
    useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' } });
    const source = applyWinderLayout(flight(), corner('curved'), 600, 100);
    source.landings = [{ id: 'top', kind: 'top', afterStepIndex: 12, length: 1200, width: 1000 }];
    source.source = { floorPlanId: 'plan', pixelPolygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }] };
    source.underlayRisers = true;
    const id = useProjectStore.getState().addStaircase(source);
    const duplicateId = useProjectStore.getState().duplicateStaircase(id);
    const [original, copy] = useProjectStore.getState().project.staircases;
    expect(copy!.id).toBe(duplicateId);
    expect(copy!.name).toBe('Main stairs (copy)');
    expect(copy!.source).toBeUndefined();
    expect(original!.source).toEqual(source.source);
    expect(copy!.layout).toEqual(source.layout);
    expect(copy!.underlayRisers).toBe(true);
    expect(copy!.steps.map(({ id: _id, ...step }) => step)).toEqual(source.steps.map(({ id: _id, ...step }) => step));
    const ids = [...original!.steps, ...original!.landings, ...copy!.steps, ...copy!.landings].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(useProjectStore.getState().selection).toEqual({ kind: 'staircase', id: duplicateId });
    expect(useProjectStore.getState().duplicateStaircase('missing')).toBeNull();
  });

  it('round-trips curved layout, traced footprint and a landing at the foot through project files', () => {
    const project = makeEmptyProject();
    project.floorPlans = [{ id: 'plan', name: 'Plan', imageDataUrl: 'data:image/png;base64,AAAA', widthPx: 100, heightPx: 100 }];
    const stairs = applyWinderLayout(flight(), corner('curved'), 600, 100);
    stairs.productId = project.products[0]!.id;
    stairs.source = { floorPlanId: 'plan', pixelPolygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    stairs.landings = [{ id: 'foot', kind: 'quarter', afterStepIndex: -1, length: 1000, width: 1000 }];
    project.staircases = [stairs];
    const parsed = parseProject(serializeProject(project));
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.project.staircases[0]).toEqual(stairs);
    expect(parsed.warnings).toEqual([]);
  });
});
