import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StairPlanContextMenu, type StairPlanMenuItem } from './StairPlanContextMenu';

const items: StairPlanMenuItem[] = [
  { id: 'rectangle', label: 'Make rectangular' },
  { id: 'corners', label: 'Edit corners', disabled: true },
  { id: 'dimensions', label: 'Edit dimensions' },
  { id: 'delete', label: 'Delete selected', danger: true, separatorBefore: true },
  { id: 'undo', label: 'Undo', disabled: true, shortcut: 'Ctrl Z' },
];
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const action = (name: string) => screen.getByRole('menuitem', { name });

function Harness({ onAction = vi.fn(), onClose = vi.fn() }: { onAction?: (id: string) => void; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return <div><button onClick={() => setOpen(true)}>Step 3</button><input aria-label="Another field"/>
    {open ? <StairPlanContextMenu x={40} y={60} label="Step 3 actions" items={items} onAction={onAction} onClose={() => { onClose(); setOpen(false); }}/>: null}
  </div>;
}
function openHarness(props?: Parameters<typeof Harness>[0]) {
  const view = render(<Harness {...props}/>);
  const trigger = screen.getByRole('button', { name: 'Step 3' });
  trigger.focus(); fireEvent.click(trigger);
  return { ...view, trigger };
}

describe('stair plan context menu', () => {
  it('uses a body portal and focuses the first available action, returning focus on Escape', () => {
    const { container, trigger } = openHarness();
    const menu = screen.getByRole('menu', { name: 'Step 3 actions' });
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    expect(document.activeElement).toBe(action('Make rectangular'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('navigates and wraps with arrow keys, Home and End while skipping disabled actions', () => {
    openHarness();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(action('Edit dimensions'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(action('Delete selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(action('Make rectangular'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(action('Delete selected'));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(action('Make rectangular'));
    fireEvent.keyDown(document.activeElement!, { key: 'e' });
    expect(document.activeElement).toBe(action('Edit dimensions'));
  });

  it('closes before dispatching an action, lets the new editor receive focus, and ignores disabled actions', () => {
    const calls: string[] = [];
    openHarness({ onClose: () => calls.push('close'), onAction: id => { calls.push(id); screen.getByLabelText('Another field').focus(); } });
    fireEvent.click(action('Edit corners'));
    expect(calls).toEqual([]);
    fireEvent.click(action('Edit dimensions'));
    expect(calls).toEqual(['close', 'dimensions']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Another field'));
  });

  it('dismisses on an outside pointer press without taking focus away from its destination', () => {
    const closed = vi.fn(); openHarness({ onClose: closed });
    const field = screen.getByLabelText('Another field');
    field.focus(); fireEvent.pointerDown(field);
    expect(closed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('keeps menu scrolling available, but closes when the surrounding diagram scrolls', () => {
    const { trigger } = openHarness();
    fireEvent.scroll(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('clamps a menu opened near viewport edges and repositions it after a resize', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 360, right: 250, height: 360, width: 250, toJSON() {} });
    render(<StairPlanContextMenu x={window.innerWidth + 50} y={window.innerHeight + 50} label="Selected steps" items={items} onAction={vi.fn()} onClose={vi.fn()}/>);
    const menu = screen.getByRole('menu');
    expect(menu.style.left).toBe(`${window.innerWidth - 258}px`);
    expect(menu.style.top).toBe(`${window.innerHeight - 368}px`);
    const oldWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    fireEvent(window, new Event('resize'));
    expect(menu.style.left).toBe('62px');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth });
  });

  it('limits height in a short viewport and safely handles offscreen or nonfinite coordinates', () => {
    const oldHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 220 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: 600, right: 250, height: 600, width: 250, toJSON() {} });
    render(<StairPlanContextMenu x={Number.NaN} y={-100} label="Landing" items={items} onAction={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByRole('menu').style.left).toBe('8px');
    expect(screen.getByRole('menu').style.top).toBe('8px');
    expect(screen.getByRole('menu').style.maxHeight).toBe('204px');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: oldHeight });
  });

  it('supports an SVG trigger, closes with Tab, and can focus a menu with no available actions', () => {
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    target.setAttribute('tabindex', '0'); document.body.append(target);
    const focus = vi.spyOn(target, 'focus');
    const closed = vi.fn();
    const view = render(<StairPlanContextMenu x={10} y={10} label="Unavailable actions" items={[{ id: 'undo', label: 'Undo', disabled: true }]} returnFocusTo={target} onAction={vi.fn()} onClose={closed}/>);
    expect(document.activeElement).toBe(screen.getByRole('menu'));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(closed).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    view.unmount(); target.remove();
  });

  it('keeps portal pointer events and editing shortcuts out of the underlying diagram', () => {
    const diagramPointer = vi.fn(), diagramKeys = vi.fn(), selectedAction = vi.fn();
    render(<div onPointerDown={diagramPointer} onKeyDown={diagramKeys}>
      <StairPlanContextMenu x={10} y={10} label="Step actions" items={items} onAction={selectedAction} onClose={vi.fn()}/>
    </div>);
    fireEvent.pointerDown(action('Edit dimensions'));
    fireEvent.keyDown(action('Edit dimensions'), { key: 'Delete' });
    expect(diagramPointer).not.toHaveBeenCalled();
    expect(diagramKeys).not.toHaveBeenCalled();
    expect(selectedAction).not.toHaveBeenCalled();
  });
});
