import { cleanup, render, screen } from '@testing-library/react';
import type { PlanReading } from '@engine/types';
import { PlanDimensionCheck } from './PlanDimensionCheck';

afterEach(cleanup);
const reading: PlanReading = { source: 'ocr', text: '4m x 3m', lines: [{ text: '4m x 3m', x: 100, y: 100, width: 70, height: 20, confidence: 95 }] };
const polygon = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];

it('presents printed and measured lengths with a readable explanation, updating as the outline changes', () => {
  const { rerender } = render(<PlanDimensionCheck reading={reading} polygon={polygon} mmPerPx={10}/>);
  expect(screen.getByText('Dimensions look consistent')).toBeTruthy();
  expect(screen.getByText('4.00 m × 3.00 m')).toBeTruthy();
  rerender(<PlanDimensionCheck reading={reading} polygon={polygon} mmPerPx={12}/>);
  expect(screen.getByText('Check these dimensions')).toBeTruthy();
  expect(screen.getByText(/largest difference is about 20%/)).toBeTruthy();
  rerender(<PlanDimensionCheck reading={reading} polygon={polygon}/>);
  expect(screen.getByText('Printed dimensions found')).toBeTruthy();
  expect(screen.getByText(/Set the scale/)).toBeTruthy();
});

it('does not clutter the room editor when no paired dimensions belong to this room', () => {
  const { container } = render(<PlanDimensionCheck reading={undefined} polygon={polygon} mmPerPx={10}/>);
  expect(container.textContent).toBe('');
});

it('flags a likely missing decimal or missing units without inventing a corrected measurement', () => {
  const unclear: PlanReading = { ...reading, lines: [{ ...reading.lines[0]!, text: '435mx3.10m' }] };
  render(<PlanDimensionCheck reading={unclear} polygon={polygon} mmPerPx={10}/>);
  expect(screen.getByText('Printed measurement needs checking')).toBeTruthy();
  expect(screen.getByText('435mx3.10m')).toBeTruthy();
  expect(screen.queryByText('4.35 m × 3.10 m')).toBeNull();
});
