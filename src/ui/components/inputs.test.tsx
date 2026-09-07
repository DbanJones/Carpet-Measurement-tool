/**
 * The shared inputs. Two of the app's worst bugs lived here: a length field that rewrote the stored
 * measurement every time it was read in imperial mode, and a `Field` wrapper whose <label> forwarded
 * a click on the caption to the first control inside it.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Checkbox, Field, FieldGroup, LengthInput, Section } from './inputs';

afterEach(cleanup);

function Harness({ unit, initial = 4000, min = 0 }: { unit: 'metric' | 'imperial'; initial?: number; min?: number }) {
  const [mm, setMm] = useState(initial);
  const [writes, setWrites] = useState(0);
  return (
    <>
      <LengthInput
        value={mm}
        unit={unit}
        min={min}
        ariaLabel="Length"
        onChange={(v) => {
          setMm(v);
          setWrites((n) => n + 1);
        }}
      />
      <output data-testid="mm">{mm}</output>
      <output data-testid="writes">{writes}</output>
    </>
  );
}

describe('LengthInput', () => {
  it.each(['metric', 'imperial'] as const)('accepts signed coordinates only when their minimum permits them (%s)', unit => {
    const { unmount } = render(<Harness unit={unit} min={-1000} />);
    const input = screen.getByLabelText('Length');
    fireEvent.change(input, { target: { value: '-430mm' } }); fireEvent.blur(input);
    expect(screen.getByTestId('mm').textContent).toBe('-430');
    expect((input as HTMLInputElement).value.startsWith('-')).toBe(true);
    fireEvent.blur(input);
    expect(screen.getByTestId('writes').textContent).toBe('1');
    fireEvent.change(input, { target: { value: '-2m' } }); fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/at least/);
    expect(screen.getByTestId('mm').textContent).toBe('-430');
    unmount();
    render(<Harness unit={unit} />);
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '-430mm' } }); fireEvent.blur(screen.getByLabelText('Length'));
    expect(screen.getByTestId('writes').textContent).toBe('0');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('explains the active unit and restores an invalid draft with Escape', () => {
    render(<Harness unit="imperial" />);
    const input = screen.getByLabelText('Length');
    const descriptionId = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(descriptionId)?.textContent).toMatch(/feet and inches/);
    expect(input.getAttribute('inputmode')).toBe('text');
    fireEvent.change(input, { target: { value: 'not a length' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe(`13' 1"`);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByTestId('mm').textContent).toBe('4000');
    expect(screen.getByTestId('writes').textContent).toBe('0');
  });

  it('does not change the measurement when the field is only read', () => {
    // 4000 mm displays as 13' 1" and used to come back as 3988 mm: tabbing through a room's length
    // and width in imperial mode silently shrank both and re-ran the estimate.
    render(<Harness unit="imperial" />);
    const input = screen.getByLabelText('Length');
    expect((input as HTMLInputElement).value).toBe(`13' 1"`);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(screen.getByTestId('mm').textContent).toBe('4000');
    expect(screen.getByTestId('writes').textContent).toBe('0');
  });

  it('still commits a real edit', () => {
    render(<Harness unit="metric" />);
    const input = screen.getByLabelText('Length');
    fireEvent.change(input, { target: { value: '4.25' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('mm').textContent).toBe('4250');
  });

  it('says why an entry was rejected instead of leaving a red box and the old value', () => {
    render(<Harness unit="metric" min={1000} />);
    const input = screen.getByLabelText('Length');
    fireEvent.change(input, { target: { value: 'about 4.2' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/Enter a length like/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByTestId('mm').textContent).toBe('4000');

    fireEvent.change(input, { target: { value: '0.5' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toMatch(/at least 1 m/);
  });
});

describe('Section', () => {
  it('preserves a supplied heading without nesting it inside another heading', () => {
    const { container } = render(<Section title={<h2>Staircase</h2>}>Flight details</Section>);
    expect(screen.getByRole('heading', { level: 2, name: 'Staircase' })).toBeTruthy();
    expect(container.querySelector('h3')).toBeNull();
  });

  it('keeps its summary visible and connects the disclosure to its content', () => {
    render(<Section title="Preparation" description="Concrete, uneven" collapsible defaultOpen={false}><input aria-label="Condition" /></Section>);
    const toggle = screen.getByRole('button', { name: 'Preparation' });
    expect(screen.getByRole('heading', { name: 'Preparation', level: 3 })).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const content = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(content.hidden).toBe(true);
    expect(screen.getByText('Concrete, uneven')).toBeTruthy();
    expect(screen.queryByLabelText('Condition')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content.hidden).toBe(false);
    expect(screen.getByLabelText('Condition')).toBeTruthy();
  });
});

describe('Field and FieldGroup', () => {
  it('a Field caption focuses its single control', () => {
    render(
      <Field label="Room length">
        <input aria-label="the input" />
      </Field>,
    );
    expect(screen.getByText('Room length').closest('label')).toBeTruthy();
  });

  it('a FieldGroup caption is not a label, so clicking it cannot tick the first checkbox', () => {
    let ticked = false;
    render(
      <FieldGroup label="Also available in">
        <span>
          <Checkbox checked={false} label="2.00 m" onChange={() => (ticked = true)} />
          <Checkbox checked={false} label="5.00 m" onChange={() => (ticked = true)} />
        </span>
      </FieldGroup>,
    );
    const caption = screen.getByText('Also available in');
    expect(caption.closest('label')).toBeNull();
    fireEvent.click(caption);
    expect(ticked).toBe(false);
    // the group is still named for assistive technology
    const group = screen.getByRole('group', { name: 'Also available in' });
    expect(group).toBeTruthy();
  });
});
