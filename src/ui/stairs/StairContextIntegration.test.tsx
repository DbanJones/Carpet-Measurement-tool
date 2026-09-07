import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Staircase } from '@engine/types';
import { makeEmptyProject, useProjectStore } from '@store/projectStore';
import { StairDesigner } from './StairDesigner';
import { setLandingOutline } from './stairShapeEditing';

const stairs = (id: string) => useProjectStore.getState().project.staircases.find(staircase => staircase.id === id)!;
const plan = () => screen.getByRole('group', { name: 'Top-down staircase drawing' });
const step = (number: number) => within(plan()).getByRole('button', { name: `Select step ${number}: straight in plan` });
const menu = (name: string) => screen.getByRole('menuitem', { name });
const landingPiece = () => plan().querySelector<SVGGElement>('[data-plan-piece="middle-landing"]')!;
const originalScroll = HTMLElement.prototype.scrollIntoView;
const frames: FrameRequestCallback[] = [];
const flushFrames = () => act(() => { frames.splice(0).forEach(callback => callback(0)); });

function LiveDesigner({ id }: { id: string }) {
  const staircase = useProjectStore(state => state.project.staircases.find(item => item.id === id)!);
  return <StairDesigner staircase={staircase} unit="metric"/>;
}
function setup(partial?: Partial<Staircase>, customLanding = false) {
  useProjectStore.setState({ project: makeEmptyProject('Context actions'), selection: { kind: 'none' }, tab: 'rooms', revision: 0 });
  const id = useProjectStore.getState().addStaircase(partial);
  if (customLanding) useProjectStore.getState().updateStaircase(id, setLandingOutline(stairs(id), 'middle-landing', 'l_shape'));
  return { id, ...render(<LiveDesigner id={id}/>) };
}
const landingSetup = (custom = false) => setup({ landings: [{ id: 'middle-landing', kind: 'quarter', length: 900, width: 1000, afterStepIndex: 3 }] }, custom);

beforeEach(() => {
  frames.length = 0;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); HTMLElement.prototype.scrollIntoView = originalScroll; });

describe('stair context actions in the drawing workspace', () => {
  it('targets a right-clicked landing independently from the previously selected step and squares only that landing', () => {
    const { id } = landingSetup(true);
    const before = structuredClone(stairs(id));
    fireEvent.click(step(1));
    fireEvent.contextMenu(landingPiece(), { clientX: 420, clientY: 230 });
    expect(screen.getByRole('menu', { name: 'Landing actions' })).toBeTruthy();
    expect(landingPiece().getAttribute('aria-pressed')).toBe('true');
    expect(step(1).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('menuitem', { name: 'Insert step before' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Insert step after' })).toBeNull();
    fireEvent.click(menu('Make rectangular'));
    expect(stairs(id).landings[0]!.outline).toBeUndefined();
    expect(stairs(id).landings[0]).toMatchObject({ id: 'middle-landing', length: before.landings[0]!.length, width: before.landings[0]!.width });
    expect(stairs(id).steps.map(step => step.id)).toEqual(before.steps.map(step => step.id));
    fireEvent.click(screen.getByRole('button', { name: 'Undo step edit' }));
    expect(stairs(id)).toEqual(before);
  });

  it('offers a touch-accessible Actions button for a landing and moves directly to its dimensions', () => {
    const { id } = landingSetup();
    fireEvent.click(landingPiece());
    const actions = screen.getByRole('button', { name: 'Open stair actions' });
    expect(actions.getAttribute('aria-haspopup')).toBe('menu');
    expect(actions.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(actions);
    expect(actions.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Landing actions' })).toBeTruthy();
    fireEvent.click(menu('Edit dimensions'));
    flushFrames();
    const length = screen.getByLabelText('Selected landing length');
    expect(document.activeElement).toBe(length);
    fireEvent.change(length, { target: { value: '1.2' } }); fireEvent.blur(length);
    expect(stairs(id).landings[0]!.length).toBe(1200);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(actions.getAttribute('aria-expanded')).toBe('false');
  });

  it('deletes only the selected landing and can restore it through the menu without altering tread count', () => {
    const { id } = landingSetup();
    const before = structuredClone(stairs(id));
    fireEvent.contextMenu(landingPiece());
    fireEvent.click(menu('Delete landing'));
    expect(stairs(id).landings).toEqual([]);
    expect(stairs(id).steps.map(step => step.id)).toEqual(before.steps.map(step => step.id));
    fireEvent.contextMenu(plan());
    fireEvent.click(menu('Undo step edit'));
    expect(stairs(id)).toEqual(before);
  });

  it('uses the newly targeted tread when adding a landing and opens the existing landing on repetition', () => {
    const { id } = setup();
    fireEvent.click(step(7));
    fireEvent.contextMenu(step(2));
    fireEvent.click(menu('Add landing after step'));
    expect(stairs(id).landings).toHaveLength(1);
    expect(stairs(id).landings[0]).toMatchObject({ afterStepIndex: 1, kind: 'quarter' });
    const landingId = stairs(id).landings[0]!.id;
    expect(plan().querySelector(`[data-plan-piece="${landingId}"]`)?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.contextMenu(step(2));
    fireEvent.click(menu('Edit landing after step'));
    expect(stairs(id).landings).toHaveLength(1);
    expect(plan().querySelector(`[data-plan-piece="${landingId}"]`)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('supports inserting after a selected tread from the touch Actions button without requiring right-click', () => {
    const { id } = setup();
    const before = structuredClone(stairs(id));
    fireEvent.click(step(3));
    fireEvent.click(screen.getByRole('button', { name: 'Open stair actions' }));
    fireEvent.click(menu('Insert step after'));
    expect(stairs(id).steps).toHaveLength(before.steps.length + 1);
    expect(stairs(id).steps[2]!.id).toBe(before.steps[2]!.id);
    expect(stairs(id).steps[4]!.id).toBe(before.steps[3]!.id);
    expect(before.steps.some(step => step.id === stairs(id).steps[3]!.id)).toBe(false);
    expect(step(4).getAttribute('aria-pressed')).toBe('true');
  });

  it('provides a keyboard context menu on a focused landing and restores that landing after Escape', () => {
    landingSetup();
    const landing = landingPiece(); landing.focus();
    fireEvent.keyDown(landing, { key: 'ContextMenu' });
    expect(screen.getByRole('menu', { name: 'Landing actions' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(document.activeElement).toBe(landing);
    expect(landing.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps landing selection exclusive and makes group actions available without right-click', () => {
    landingSetup();
    fireEvent.click(step(1));
    fireEvent.click(step(2), { ctrlKey: true });
    fireEvent.click(landingPiece(), { ctrlKey: true });
    expect(landingPiece().getAttribute('aria-pressed')).toBe('true');
    expect(step(1).getAttribute('aria-pressed')).toBe('false');
    expect(step(2).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(step(1), { ctrlKey: true });
    expect(landingPiece().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(step(2), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open stair actions' }));
    expect(screen.getByRole('menu', { name: '2 selected steps' })).toBeTruthy();
    expect(menu('Delete 2 steps')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Delete landing' })).toBeNull();
  });

  it('focuses a corner immediately when choosing Edit corners from the Actions menu', () => {
    landingSetup();
    fireEvent.click(landingPiece());
    fireEvent.click(screen.getByRole('button', { name: 'Open stair actions' }));
    fireEvent.click(menu('Edit corners')); flushFrames();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Landing corner 1' }));
  });

  it('opens the exact side editor and focuses its measurement from a tread dimensions action', () => {
    setup();
    fireEvent.click(step(3));
    fireEvent.click(screen.getByRole('button', { name: 'Open stair actions' }));
    fireEvent.click(menu('Edit dimensions')); flushFrames();
    const exactLength = screen.getByLabelText('Exact tread side length');
    expect(exactLength.closest('details')?.open).toBe(true);
    expect(document.activeElement).toBe(exactLength);
  });
});
