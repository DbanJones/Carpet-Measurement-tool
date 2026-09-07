import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Step } from '@engine/types';
import type { StairPlanPiece } from './stairLayout';
import { measuredStepGeometry } from './stepGeometry';
import { minimumStepResize, resizeStepByVector, resizeStepDimension, stepResizeHandles } from './stepResizing';
import { StepResizeHandles } from './StepResizeHandles';

const tread = (heading = 90): Step => ({ id: 'tread', kind: 'straight', rise: 180, going: 250, width: 900, plan: { x: 100, y: 200, heading, turn: 0 } });
const piece = (step: Step): StairPlanPiece => ({ id: step.id, kind: step.kind === 'winder' ? 'winder' : 'tread', label: 'Step 1', stepIndex: 0, ...measuredStepGeometry(step, step.plan!) });
afterEach(cleanup);

describe('measured tread resize handles', () => {
  it('resizes symmetric width and forward depth in the tread frame at every heading', () => {
    for (const heading of [0, 90, 180, 225, 315]) {
      const step = tread(heading), snapshot = structuredClone(step), [width, depth] = stepResizeHandles(step, piece(step));
      expect(width!.sensitivity).toBeCloseTo(2);
      expect(depth!.sensitivity).toBeCloseTo(1);
      expect(resizeStepByVector(step, width!, { x: width!.direction.x * 50, y: width!.direction.y * 50 })).toEqual({ width: 1000 });
      expect(resizeStepByVector(step, depth!, { x: depth!.direction.x * 50, y: depth!.direction.y * 50 })).toEqual({ going: 300 });
      expect(resizeStepByVector(step, width!, { x: -width!.direction.y * 50, y: width!.direction.x * 50 })).toEqual({ width: 900 });
      expect(step).toEqual(snapshot);
    }
  });

  it('follows radial winder edge movement while editing width or the widest going only', () => {
    for (const turn of [-45, 45]) {
      const step: Step = { ...tread(30), kind: 'winder', going: 500, goingNarrow: 100, plan: { ...tread(30).plan!, turn } };
      const source = structuredClone(step), handles = stepResizeHandles(step, piece(step));
      for (const handle of handles) {
        const amended = { ...step, [handle.dimension]: step[handle.dimension] + 1 };
        const next = stepResizeHandles(amended, piece(amended)).find(item => item.dimension === handle.dimension)!;
        const delta = { x: next.position.x - handle.position.x, y: next.position.y - handle.position.y };
        expect(resizeStepByVector(step, handle, delta)).toEqual({ [handle.dimension]: step[handle.dimension] + 1 });
      }
      expect(step).toEqual(source);
    }
  });

  it('keeps dimensions positive and the widest going wider than its narrow edge', () => {
    const step = tread();
    expect(resizeStepDimension(step, 'width', -2000)).toEqual({ width: 10 });
    expect(resizeStepDimension(step, 'going', -2000)).toEqual({ going: 10 });
    const winder: Step = { ...step, kind: 'winder', goingNarrow: 120 };
    expect(minimumStepResize(winder, 'going')).toBe(121);
    expect(resizeStepDimension(winder, 'going', -2000)).toEqual({ going: 121 });
    expect(resizeStepDimension(step, 'width', Number.NaN)).toEqual({});
  });

  it('lets a custom winder shrink its cut depth without a radial narrow-edge restriction', () => {
    const step: Step = { ...tread(), kind: 'winder', goingNarrow: 250,
      outline: { points: [{ x: -.5, y: 0 }, { x: .5, y: 0 }, { x: .4, y: 1 }, { x: -.5, y: .7 }], entry: [0, 1], exit: [3, 2] } };
    const patch = resizeStepDimension(step, 'going', -100);
    expect(patch).toEqual({ going: 150 });
    const resized = { ...step, ...patch };
    expect(measuredStepGeometry(resized, resized.plan!).points).not.toEqual(measuredStepGeometry(step, step.plan!).points);
    expect(minimumStepResize(resized, 'going')).toBe(10);
  });

  it('provides labelled keyboard resize controls without moving the selected tread', () => {
    const step = tread(), onStart = vi.fn(), onPreview = vi.fn(), onCommit = vi.fn(), onCancel = vi.fn(), parentKeys = vi.fn();
    render(<svg onKeyDown={parentKeys}><StepResizeHandles piece={piece(step)} step={step} unit="metric" toScreen={p => ({ x: p.x / 10, y: 200 - p.y / 10 })} onStart={onStart} onPreview={onPreview} onCommit={onCommit} onCancel={onCancel} /></svg>);
    const width = screen.getByRole('slider', { name: 'Resize selected step width' });
    const depth = screen.getByRole('slider', { name: 'Resize selected step depth' });
    expect(width.getAttribute('aria-valuenow')).toBe('900');
    expect(depth.getAttribute('aria-valuenow')).toBe('250');
    fireEvent.keyDown(width, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith({ width: 910 });
    fireEvent.keyDown(depth, { key: 'ArrowDown', shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith({ going: 150 });
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(parentKeys).not.toHaveBeenCalled();
    expect(step.plan).toEqual({ x: 100, y: 200, heading: 90, turn: 0 });
  });
});
