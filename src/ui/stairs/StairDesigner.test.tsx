import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { makeEmptyProject, makeSteps, useProjectStore } from '@store/projectStore';
import type { Staircase } from '@engine/types';
import { StairsEditor } from './StairsEditor';
import { measuredStairPreset } from './stepEditing';
import { stairPlanGeometry } from './stairLayout';

function setup(partial?: Partial<Staircase>) {
  useProjectStore.setState({ project: makeEmptyProject('Drawing test'), selection: { kind: 'none' }, tab: 'rooms', revision: 0 });
  const id = useProjectStore.getState().addStaircase(partial);
  return { id, ...render(<StairsEditor staircaseId={id} />) };
}

const staircase = (id: string): Staircase => useProjectStore.getState().project.staircases.find(item => item.id === id)!;
const workspace = () => within(screen.getByRole('region', { name: 'Staircase drawing workspace' }));
const button = (name: string | RegExp) => workspace().getByRole('button', { name });
const plan = () => screen.getByRole('group', { name: 'Top-down staircase drawing' });
const routePoints = () => workspace().queryAllByRole('button', { name: /^Route point / });
function commit(label: string, value: string) {
  const input = workspace().getByLabelText(label, { exact: true });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function drawCurvedRoute() {
  fireEvent.click(button('Draw your own'));
  for (const direction of ['up', 'up', 'right', 'down']) fireEvent.click(button(`Extend route ${direction}`));
  for (const index of [1, 2]) {
    fireEvent.focus(routePoints()[index]!);
    fireEvent.click(button('Curved turn'));
  }
}

afterEach(cleanup);

describe('drawing-led stair designer', () => {
  it('opens actions for the right-clicked tread, inserts before it and supports undo', () => {
    const { id } = setup();
    const before = structuredClone(staircase(id));
    const target = button('Select step 4: straight in plan');
    fireEvent.contextMenu(target, { clientX: 400, clientY: 300 });
    expect(target.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Step 4 actions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert step before' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const after = staircase(id);
    expect(after.steps).toHaveLength(before.steps.length + 1);
    expect(after.steps[4]!.id).toBe(before.steps[3]!.id);
    expect(before.steps.some(step => step.id === after.steps[3]!.id)).toBe(false);
    fireEvent.click(button('Undo step edit'));
    expect(staircase(id)).toEqual(before);
  });

  it('preserves a selected group on right-click and opens the same actions from the keyboard', () => {
    const { id } = setup();
    fireEvent.click(button('Select step 2: straight in plan'));
    fireEvent.click(button('Select step 4: straight in plan'), { shiftKey: true });
    fireEvent.contextMenu(button('Select step 3: straight in plan'), { clientX: 300, clientY: 200 });
    expect(screen.getByRole('menu', { name: '3 selected steps' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Make rectangular' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete 3 steps' }));
    expect(staircase(id).steps).toHaveLength(10);
    fireEvent.keyDown(button('Select step 1: straight in plan'), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Step 1 actions' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('squares the middle U tread from the diagram and the step-type field without rotating the upper flight', () => {
    const baseId = useProjectStore.getState().addStaircase();
    const base = staircase(baseId);
    const { id } = setup(measuredStairPreset(base, { kind: 'half_turn', direction: 'right', turn: 'winders', turnSteps: 9, corner: 'square' }));
    const before = stairPlanGeometry(staircase(id), { normalize: false });
    const centreId = staircase(id).steps[6]!.id;
    fireEvent.click(button('Select step 7: winder in plan'));
    fireEvent.click(button('Make rectangular'));
    expect(staircase(id).steps.find(step => step.id === centreId)!.kind).toBe('straight');
    const after = stairPlanGeometry(staircase(id), { normalize: false });
    expect(after.pieces.at(-1)!.heading).toBeCloseTo(before.pieces.at(-1)!.heading!, 5);
    after.pieces.at(-1)!.points.forEach((point, index) => {
      const old = before.pieces.at(-1)!.points[index]!;
      expect(Math.hypot(point.x - old.x, point.y - old.y)).toBeLessThan(.01);
    });
    fireEvent.click(button('Undo step edit'));
    fireEvent.click(button('Select step 7: winder in plan'));
    fireEvent.change(workspace().getByLabelText('Selected step type'), { target: { value: 'straight' } });
    expect(staircase(id).steps.find(step => step.id === centreId)!.kind).toBe('straight');
    expect(stairPlanGeometry(staircase(id)).pieces.at(-1)!.heading).toBeCloseTo(before.pieces.at(-1)!.heading!, 5);
  });

  it('adds and deletes a winder from the contextual plan toolbar while preserving a U with no landing', () => {
    const baseId = useProjectStore.getState().addStaircase();
    const base = useProjectStore.getState().project.staircases.find(item => item.id === baseId)!;
    const { id } = setup(measuredStairPreset(base, { kind: 'half_turn', direction: 'right', turn: 'winders', turnSteps: 8, corner: 'square' }));
    const before = structuredClone(staircase(id));
    fireEvent.click(button('Select step 5: winder in plan'));
    const add = button('Add step after selection');
    expect(add.closest('.stair-plan-card')).toBeTruthy();
    expect(button('Add a flat landing after this step').closest('.stair-plan-card')).toBeTruthy();
    fireEvent.click(add);
    const added = staircase(id).steps.find(step => !before.steps.some(old => old.id === step.id))!;
    expect(staircase(id).steps).toHaveLength(14);
    expect(added.kind).toBe('winder');
    expect(button('Select step 6: winder in plan').getAttribute('aria-pressed')).toBe('true');
    expect(staircase(id).landings).toEqual([]);
    fireEvent.click(button('Delete selected steps'));
    expect(staircase(id).steps).toHaveLength(13);
    expect(staircase(id).steps.some(step => step.id === added.id)).toBe(false);
    const pieces = stairPlanGeometry(staircase(id)).pieces;
    expect(pieces.at(-1)!.endHeading! - pieces[0]!.heading!).toBeCloseTo(-180, 5);
    fireEvent.click(button('Undo step edit'));
    expect(staircase(id).steps).toHaveLength(14);
  });
  it('keeps a pending shape preview separate from saved-step editing', () => {
    const { id } = setup();
    const before = structuredClone(staircase(id));
    fireEvent.click(button('Start l-shaped drawing'));
    fireEvent.click(button('Select step 3: straight in plan'));
    expect(screen.queryByLabelText('Selected step measurements')).toBeNull();
    expect(staircase(id)).toEqual(before);
    fireEvent.click(button('Use staircase shape'));
    fireEvent.click(button('Select step 3: straight in plan'));
    expect(screen.getByLabelText('Selected step measurements')).toBeTruthy();
    expect(button('Step 3 corner 1')).toBeTruthy();
  });
  it('keeps a pending U preview synchronized with newly typed measurements', () => {
    const { id } = setup();
    fireEvent.click(button('Start u-shaped drawing'));
    const rise = screen.getByLabelText('Rise for all steps');
    fireEvent.change(rise, { target: { value: '185mm' } });
    fireEvent.blur(rise);
    expect(staircase(id).landings).toHaveLength(0);
    fireEvent.click(button('Use staircase shape'));
    expect(staircase(id).steps.every(step => step.rise === 185)).toBe(true);
    expect(staircase(id).landings[0]!.kind).toBe('half');
  });
  it('creates and edits a wrapping route with accessible controls and keyboard actions', () => {
    const { id } = setup();
    const before = structuredClone(staircase(id));
    expect(screen.getByRole('group', { name: /Side view of physical staircase: 13 risers/ })).toBeTruthy();
    fireEvent.click(button('Draw your own'));
    expect((button('Finish drawing') as HTMLButtonElement).disabled).toBe(true);
    for (const direction of ['up', 'up', 'right', 'down']) fireEvent.click(button(`Extend route ${direction}`));
    expect(routePoints()).toHaveLength(4);
    expect(staircase(id).drawing).toBeUndefined();

    const corner = button('Route point 2, corner');
    fireEvent.focus(corner);
    const initialX = corner.querySelector('.stair-node-dot')!.getAttribute('cx');
    fireEvent.keyDown(corner, { key: 'ArrowRight', shiftKey: true });
    expect(button('Route point 2, corner').querySelector('.stair-node-dot')!.getAttribute('cx')).not.toBe(initialX);
    fireEvent.click(button('Curved turn'));
    expect(button('Curved turn').getAttribute('aria-pressed')).toBe('true');
    expect(button('Route point 2, curved turn')).toBeTruthy();

    fireEvent.keyDown(button('Route point 2, curved turn'), { key: 'Delete' });
    expect(routePoints()).toHaveLength(3);
    fireEvent.keyDown(plan(), { key: 'z', ctrlKey: true });
    expect(routePoints()).toHaveLength(4);
    expect(button('Route point 2, curved turn')).toBeTruthy();
    fireEvent.keyDown(plan(), { key: 'Enter' });

    expect(routePoints()).toHaveLength(0);
    expect(staircase(id).drawing!.points).toHaveLength(4);
    expect(staircase(id).drawing!.points[1]!.curve).toBe(true);
    expect(staircase(id).steps).toEqual(before.steps);
    expect(staircase(id).landings).toEqual(before.landings);
    expect(screen.getByRole('status').textContent).toContain('Drawing saved');
  });

  it('previews a U-shaped flight and measured landing in both diagrams without applying until accepted', () => {
    const { id, container } = setup();
    const source = structuredClone(staircase(id));
    const stepId = source.steps.at(-1)!.id;
    const physicalPoints = () => container.querySelector(`[data-physical-piece="${stepId}"][data-physical-face="surface"]`)!.getAttribute('points');
    const oldSide = physicalPoints();
    const oldPlan = container.querySelector(`[data-plan-piece="${stepId}"] polygon`)!.getAttribute('points');

    fireEvent.click(button('Start u-shaped drawing'));
    expect(button('Use staircase shape')).toBeTruthy();
    expect(routePoints()).toHaveLength(0);
    expect(container.querySelectorAll('[data-plan-piece]')).toHaveLength(source.steps.length + 1);
    expect(physicalPoints()).not.toBe(oldSide);
    expect(container.querySelector(`[data-plan-piece="${stepId}"] polygon`)!.getAttribute('points')).not.toBe(oldPlan);
    expect(staircase(id)).toEqual(source);
    fireEvent.click(button('Cancel preset'));
    expect(physicalPoints()).toBe(oldSide);
    expect(staircase(id)).toEqual(source);
    expect(routePoints()).toHaveLength(0);
  });

  it('commits the drawn shape while retaining individual measurements, identities and fitting details', () => {
    const steps = makeSteps(13).map((step, index) => ({ ...step, rise: 180 + index, going: 220 + index, width: 850 + index }));
    const { id } = setup({ steps, method: 'waterfall', openSides: 'left', underlayRisers: true, nosingOverhang: 22, landings: [{ id: 'existing-top', kind: 'top', width: 1400, length: 1800, afterStepIndex: 12 }] });
    const before = structuredClone(staircase(id));
    drawCurvedRoute();
    fireEvent.click(button('Finish drawing'));
    const updated = staircase(id);
    expect(updated.drawing!.points.filter(point => point.curve)).toHaveLength(2);
    expect(updated.steps).toEqual(before.steps);
    expect(updated.landings).toEqual(before.landings);
    expect(updated.method).toBe(before.method);
    expect(updated.openSides).toBe(before.openSides);
    expect(updated.underlayRisers).toBe(before.underlayRisers);
    expect(updated.nosingOverhang).toBe(before.nosingOverhang);
    expect(new Set(updated.steps.map(step => step.id)).size).toBe(updated.steps.length);
  });

  it('links plan and physical selection and edits only the selected measured step', () => {
    const { id } = setup();
    const before = structuredClone(staircase(id));
    fireEvent.click(button('Select step 3: straight in plan'));
    expect(button(/^Step 3: straight, height/).getAttribute('aria-pressed')).toBe('true');
    commit('Selected step going', '0.28');
    expect(staircase(id).steps[2]!.going).toBe(280);
    expect(staircase(id).steps.filter((_, index) => index !== 2)).toEqual(before.steps.filter((_, index) => index !== 2));
    expect(staircase(id).steps.map(step => step.id)).toEqual(before.steps.map(step => step.id));

    fireEvent.keyDown(button(/^Step 5: straight, height/), { key: 'Enter' });
    expect(button('Select step 5: straight in plan').getAttribute('aria-pressed')).toBe('true');
    expect(button('Select step 3: straight in plan').getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(workspace().getByLabelText('Selected step type'), { target: { value: 'winder' } });
    commit('Selected step narrow depth', '95mm');
    expect(staircase(id).steps[4]).toMatchObject({ id: before.steps[4]!.id, kind: 'winder', goingNarrow: 95 });
    expect(staircase(id).steps[3]).toEqual(before.steps[3]);
    expect(staircase(id).steps[5]).toEqual(before.steps[5]);
  });

  it('adds an intermediate landing as a turn, reuses it and reserves top landings for the last step', () => {
    const { id } = setup();
    const stepsBefore = structuredClone(staircase(id).steps);
    fireEvent.click(button('Select step 4: straight in plan'));
    fireEvent.click(button('Add a flat landing after this step'));
    expect(staircase(id).landings).toHaveLength(1);
    const middle = staircase(id).landings[0]!;
    expect(middle).toMatchObject({ kind: 'quarter', afterStepIndex: 3, width: 860, length: 860 });
    commit('Selected landing length', '1.2');
    expect(staircase(id).landings[0]!.length).toBe(1200);

    fireEvent.click(button('Select step 4: straight in plan'));
    fireEvent.click(button('Edit landing after this step'));
    expect(staircase(id).landings).toHaveLength(1);
    expect(staircase(id).landings[0]!.id).toBe(middle.id);
    expect((workspace().getByLabelText('Selected landing length') as HTMLInputElement).value).toBe('1.2');

    fireEvent.click(button('Select step 13: straight in plan'));
    fireEvent.click(button('Add a flat landing after this step'));
    expect(staircase(id).landings).toHaveLength(2);
    expect(staircase(id).landings[1]).toMatchObject({ kind: 'top', afterStepIndex: 12 });
    expect(staircase(id).steps).toEqual(stepsBefore);
  });

  it('restores an unfinished route when the staircase editor is remounted', () => {
    const { id, unmount } = setup();
    fireEvent.click(button('Draw your own'));
    for (const direction of ['up', 'up', 'left']) fireEvent.click(button(`Extend route ${direction}`));
    fireEvent.focus(button('Route point 2, corner'));
    fireEvent.click(button('Curved turn'));
    const before = routePoints().map(point => point.getAttribute('aria-label'));
    const positions = () => routePoints().map(point => {
      const dot = point.querySelector('.stair-node-dot')!;
      return [dot.getAttribute('cx'), dot.getAttribute('cy')];
    });
    const beforePositions = positions();
    expect(staircase(id).drawing).toBeUndefined();
    unmount();
    render(<StairsEditor staircaseId={id} />);
    expect(routePoints().map(point => point.getAttribute('aria-label'))).toEqual(before);
    expect(positions()).toEqual(beforePositions);
    expect(button('Finish drawing')).toBeTruthy();
    expect(staircase(id).drawing).toBeUndefined();
    fireEvent.click(button('Finish drawing'));
    expect(staircase(id).drawing!.points).toHaveLength(3);
    expect(staircase(id).drawing!.points[1]!.curve).toBe(true);
  });

  it('keeps drafts separate when projects contain the same staircase identifier', () => {
    const { id } = setup();
    const originalProject = structuredClone(useProjectStore.getState().project);
    drawCurvedRoute();
    expect(routePoints()).toHaveLength(4);
    const secondProject = { ...structuredClone(originalProject), id: `${originalProject.id}-separate` };
    act(() => useProjectStore.setState({ project: secondProject }));
    expect(routePoints()).toHaveLength(0);
    expect(staircase(id).drawing).toBeUndefined();
    act(() => useProjectStore.setState({ project: originalProject }));
    expect(routePoints()).toHaveLength(4);
    fireEvent.click(button('Cancel drawing'));
  });
});
