import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Staircase } from '@engine/types';
import { makeSteps } from '@store/projectStore';
import { StepDimensionsEditor } from './StepDimensionsEditor';
import { editableSteps } from './stepEditing';
import { stairDimensions } from './stairDimensions';

const stairs = (): Staircase => editableSteps({ id: 'stairs', name: 'Main stairs', productId: 'carpet', steps: makeSteps(5), landings: [], method: 'cap_and_band', openSides: 'none' });
afterEach(cleanup);
function Harness({ unit = 'metric', onChange = () => {} }: { unit?: 'metric' | 'imperial'; onChange?: (staircase: Staircase) => void }) {
  const [value, setValue] = useState(stairs());
  return <StepDimensionsEditor staircase={value} stepId={value.steps[2]!.id} unit={unit} defaultOpen onChange={next => { setValue(next); onChange(next); }} />;
}
const commit = (name: string, value: string) => { const input = screen.getByLabelText(name); fireEvent.change(input, { target: { value } }); fireEvent.blur(input); };

it('edits the selected physical side and refreshes its diagram and measurements', () => {
  const changed = vi.fn(); render(<Harness onChange={changed} />);
  expect(screen.getAllByRole('button', { name: /^Select side/ })).toHaveLength(4);
  commit('Exact tread side length', '1');
  const next = changed.mock.calls[0]![0] as Staircase;
  expect(stairDimensions(next, next.steps[2]!.id)!.sides[0]!.length).toBeCloseTo(1000);
  expect((screen.getByLabelText('Exact tread side length') as HTMLInputElement).value).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'Select side 2–3' }));
  expect((screen.getByLabelText('Tread side') as HTMLSelectElement).value).toBe('1');
});

it('supports keyboard corner selection, custom angles and one-click right angles', () => {
  render(<Harness />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Select corner 1' }), { key: 'Enter' });
  commit('Exact tread corner angle', '100');
  expect((screen.getByLabelText('Exact tread corner angle') as HTMLInputElement).value).toBe('100');
  fireEvent.click(screen.getByRole('button', { name: 'Set to 90°' }));
  expect((screen.getByLabelText('Exact tread corner angle') as HTMLInputElement).value).toBe('90');
});

it('rejects a collapsing coordinate edit with feedback and restores the real saved number', () => {
  const changed = vi.fn(); render(<Harness onChange={changed} />);
  fireEvent.click(screen.getByText('Point coordinates'));
  fireEvent.change(screen.getByLabelText('Tread outline point'), { target: { value: '1' } });
  const previous = (screen.getByLabelText('Exact tread point x') as HTMLInputElement).value;
  commit('Exact tread point x', '-0.43');
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toMatch(/cross|collapse/);
  expect((screen.getByLabelText('Exact tread point x') as HTMLInputElement).value).toBe(previous);
});

it('accepts explicit millimetres in imperial mode and makes controlled opening available to the context menu', () => {
  const changed = vi.fn(); render(<Harness unit="imperial" onChange={changed} />);
  commit('Exact tread side length', '900mm');
  expect(changed).toHaveBeenCalledOnce();
  cleanup(); const source = stairs();
  const { container, rerender } = render(<StepDimensionsEditor staircase={source} stepId={source.steps[0]!.id} unit="metric" onChange={() => {}} open={false} />);
  expect(container.querySelector('details')?.open).toBe(false);
  rerender(<StepDimensionsEditor staircase={source} stepId={source.steps[0]!.id} unit="metric" onChange={() => {}} open />);
  expect(container.querySelector('details')?.open).toBe(true);
});
