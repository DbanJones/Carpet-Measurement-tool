import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StairCornerHandles } from './StairCornerHandles';

afterEach(cleanup);

it('edits only the focused corner with precise keyboard increments and keeps the event local', () => {
  const onStart = vi.fn(), onCommit = vi.fn(), parentKey = vi.fn();
  render(<svg onKeyDown={parentKey}><StairCornerHandles points={[{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 250 }, { x: 0, y: 250 }]} toScreen={point => ({ x: point.x / 2, y: point.y / 2 })} label="Step 3" onStart={onStart} onPreview={vi.fn()} onCommit={onCommit} onCancel={vi.fn()}/></svg>);
  const corner = screen.getByRole('button', { name: 'Step 3 corner 3' });
  fireEvent.focus(corner);
  expect(corner.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(corner, { key: 'ArrowRight' });
  expect(onCommit).toHaveBeenLastCalledWith(2, { x: 910, y: 250 });
  fireEvent.keyDown(corner, { key: 'ArrowUp', shiftKey: true });
  expect(onCommit).toHaveBeenLastCalledWith(2, { x: 900, y: 350 });
  expect(onStart).toHaveBeenCalledTimes(2);
  expect(parentKey).not.toHaveBeenCalled();
});

it('renders every landing corner as a separate accessible handle', () => {
  const points = [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 600 }, { x: 800, y: 600 }, { x: 800, y: 1200 }, { x: 0, y: 1200 }];
  render(<svg><StairCornerHandles points={points} toScreen={point => point} label="Landing" onStart={vi.fn()} onPreview={vi.fn()} onCommit={vi.fn()} onCancel={vi.fn()}/></svg>);
  expect(screen.getAllByRole('button', { name: /^Landing corner/ })).toHaveLength(6);
});
