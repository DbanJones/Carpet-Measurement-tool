import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useProjectStore, makeEmptyProject, makeSteps } from '@store/projectStore';
import type { Staircase } from '@engine/types';
import { StairsEditor, stepRegsIssues, flightPitchDeg, formatStairDim, withKind } from './StairsEditor';
import { stairSequence } from './StairsPreview';

function setup(partial?: Partial<Staircase>) {
  useProjectStore.setState({ project: makeEmptyProject('Test house'), selection: { kind: 'none' }, tab: 'rooms', revision: 0 });
  const id = useProjectStore.getState().addStaircase(partial);
  const utils = render(<StairsEditor staircaseId={id} />);
  return { id, ...utils };
}

const stairs = (id: string): Staircase => {
  const s = useProjectStore.getState().project.staircases.find((x) => x.id === id);
  if (!s) throw new Error('staircase missing');
  return s;
};

/** Type into a text/number input and commit it the way a user would (blur). */
function commit(el: HTMLElement, value: string) {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
}

describe('StairsEditor', () => {
  afterEach(cleanup);

  it('renders the basics, the steps table, the preview and the totals from the store', () => {
    const { id, container } = setup();
    const s = stairs(id);
    expect(s.steps.length).toBe(13);
    expect((screen.getByLabelText('Staircase name') as HTMLInputElement).value).toBe('Stairs');
    expect((screen.getByLabelText('Number of risers') as HTMLInputElement).value).toBe('13');
    expect(screen.getAllByLabelText(/^Step \d+ kind$/).length).toBe(13);
    // carpet product is selected and listed first
    const productSelect = screen.getByLabelText('Product') as HTMLSelectElement;
    expect(productSelect.value).toBe(s.productId);
    // preview: elevation + plan
    expect(screen.getByRole('img', { name: /Side elevation: 13 risers/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Plan view: 13 treads/ })).toBeTruthy();
    // totals: 13 x 200 rise, 13 x 223 going, summary sentence
    expect(screen.getByText('2.60 m')).toBeTruthy();
    expect(screen.getByText('2.90 m')).toBeTruthy();
    expect(screen.getByTestId('stairs-summary').textContent).toBe('13 risers, 860 mm wide, cap & band');
    // default flight: 200/223 = 41.9°, inside the 42° limit, so no warnings
    expect(container.querySelectorAll('.badge.warn').length).toBe(0);
  });

  it('changing the number of risers adds steps at the end (copying the last step) or removes from the top', () => {
    const { id } = setup();
    const before = stairs(id).steps;
    const last = before[before.length - 1]!;
    act(() => useProjectStore.getState().updateStaircase(id, (s) => ({ ...s, steps: s.steps.map((st, i) => (i === s.steps.length - 1 ? { ...st, rise: 190, width: 900 } : st)) })));

    commit(screen.getByLabelText('Number of risers'), '15');
    const grown = stairs(id).steps;
    expect(grown.length).toBe(15);
    // existing steps kept (same ids, same order)
    expect(grown.slice(0, 13).map((s) => s.id)).toEqual(before.map((s) => s.id));
    // new steps copy the last step's dimensions and are straight
    expect(grown[13]).toMatchObject({ kind: 'straight', rise: 190, going: last.going, width: 900 });
    expect(grown[14]).toMatchObject({ kind: 'straight', rise: 190, width: 900 });
    expect(grown[13]!.id).not.toBe(grown[14]!.id);

    commit(screen.getByLabelText('Number of risers'), '10');
    const shrunk = stairs(id).steps;
    expect(shrunk.length).toBe(10);
    expect(shrunk.map((s) => s.id)).toEqual(before.slice(0, 10).map((s) => s.id));
  });

  it('"apply to all steps" sets a dimension on every step and the nosing overhang on the staircase', () => {
    const { id } = setup();
    commit(screen.getByLabelText('Rise for all steps'), '0.19');
    expect(stairs(id).steps.every((s) => s.rise === 190)).toBe(true);
    commit(screen.getByLabelText('Width for all steps'), '900mm');
    expect(stairs(id).steps.every((s) => s.width === 900)).toBe(true);
    commit(screen.getByLabelText('Nosing overhang'), '25mm');
    expect(stairs(id).nosingOverhang).toBe(25);
  });

  it('edits a single step, inserts a winder above it and deletes a step, keeping landings attached', () => {
    const { id } = setup({ steps: makeSteps(4), landings: [{ id: 'l1', kind: 'quarter', length: 900, width: 860, afterStepIndex: 2 }] });
    commit(screen.getByLabelText('Step 2 going'), '0.25');
    expect(stairs(id).steps[1]!.going).toBe(250);

    fireEvent.click(screen.getByLabelText('Insert winder above step 2'));
    const after = stairs(id);
    expect(after.steps.length).toBe(5);
    expect(after.steps[2]).toMatchObject({ kind: 'winder', rise: 200, going: 250, width: 860, goingNarrow: 100 });
    // the landing that was after step 3 (index 2) now follows the shifted step
    expect(after.landings[0]!.afterStepIndex).toBe(3);
    // winder-only column appears and its going label says (max)
    expect(screen.getByLabelText('Step 3 going (max)')).toBeTruthy();
    expect(screen.getByLabelText('Step 3 narrow going')).toBeTruthy();
    expect(screen.getByTestId('stairs-summary').textContent).toContain('1 winder');

    fireEvent.click(screen.getByLabelText('Delete step 1'));
    const deleted = stairs(id);
    expect(deleted.steps.length).toBe(4);
    expect(deleted.steps[1]!.kind).toBe('winder');
    expect(deleted.landings[0]!.afterStepIndex).toBe(2);
  });

  it('changing a step kind to bullnose shows the projection/sides inputs', () => {
    const { id } = setup({ steps: makeSteps(3) });
    fireEvent.change(screen.getByLabelText('Step 1 kind'), { target: { value: 'bullnose' } });
    expect(stairs(id).steps[0]).toMatchObject({ kind: 'bullnose', bullnoseSides: 'right' });
    commit(screen.getByLabelText('Step 1 bullnose projection'), '120mm');
    expect(stairs(id).steps[0]!.bullnoseProjection).toBe(120);
    fireEvent.change(screen.getByLabelText('Step 1 bullnose sides'), { target: { value: 'both' } });
    expect(stairs(id).steps[0]!.bullnoseSides).toBe('both');
    expect(screen.getByTestId('stairs-summary').textContent).toContain('1 bullnose');
  });

  it('flags steps outside Approved Document K limits and a flight steeper than 42°', () => {
    const { id, container } = setup({ steps: makeSteps(3, { kind: 'straight', rise: 250, going: 210, width: 860 }) });
    const badges = container.querySelectorAll('.badge.warn');
    // three step badges plus the flight pitch badge in the section header
    expect(badges.length).toBe(4);
    const stepBadge = badges[1]!;
    expect(stepBadge.textContent).toContain('rise');
    expect(stepBadge.textContent).toContain('going');
    expect(stepBadge.textContent).toContain('pitch');
    expect(stepBadge.getAttribute('title')).toContain('rise 250 mm is outside 150–220 mm');
    expect(screen.getByText(/Pitch 50\.0° — steeper than 42°/)).toBeTruthy();

    // fix the rise: going (210 < 220) and pitch (200/210 = 43.6°) remain flagged
    commit(screen.getByLabelText('Rise for all steps'), '0.2');
    expect(stairs(id).steps[0]!.rise).toBe(200);
    expect(container.querySelectorAll('.badge.warn').length).toBe(4);
    expect(container.querySelectorAll('.badge.warn')[1]!.textContent).toBe('⚠ going, pitch');
    // fix the going too: 200/230 = 41.0°, everything inside the limits
    commit(screen.getByLabelText('Going for all steps'), '0.23');
    expect(container.querySelectorAll('.badge.warn').length).toBe(0);
    expect(container.querySelectorAll('.badge.ok').length).toBe(3);
    expect(screen.getByText(/Pitch 41\.0°/)).toBeTruthy();
  });

  it('switches method, open sides, runner and subfloor through the store', () => {
    const { id } = setup();
    fireEvent.change(screen.getByLabelText('Fitting method'), { target: { value: 'waterfall' } });
    expect(stairs(id).method).toBe('waterfall');
    expect(screen.getByText(/One piece flows down the flight/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Open sides'), { target: { value: 'left' } });
    expect(stairs(id).openSides).toBe('left');

    fireEvent.click(screen.getByLabelText(/Fit as a runner/));
    expect(stairs(id).runner).toEqual({ width: 600, stairRods: false });
    commit(screen.getByLabelText('Runner width'), '0.686');
    fireEvent.click(screen.getByLabelText(/Stair rods/));
    expect(stairs(id).runner).toEqual({ width: 686, stairRods: true });
    expect(screen.getByTestId('stairs-summary').textContent).toBe('13 risers, 860 mm wide, waterfall, 686 mm runner with stair rods, left string open');
    fireEvent.click(screen.getByLabelText(/Fit as a runner/));
    expect(stairs(id).runner).toBeUndefined();

    fireEvent.change(screen.getByLabelText('Subfloor type'), { target: { value: 'plywood' } });
    expect(stairs(id).subfloor).toEqual({ type: 'plywood', condition: 'good' });
    fireEvent.change(screen.getByLabelText('Subfloor condition'), { target: { value: 'uneven' } });
    expect(stairs(id).subfloor).toEqual({ type: 'plywood', condition: 'uneven' });
    fireEvent.change(screen.getByLabelText('Subfloor type'), { target: { value: 'unset' } });
    expect(stairs(id).subfloor).toBeUndefined();
  });

  it('adds, edits and removes landings', () => {
    const { id } = setup({ steps: makeSteps(5) });
    fireEvent.click(screen.getByText('+ Add landing'));
    expect(stairs(id).landings).toHaveLength(1);
    expect(stairs(id).landings[0]).toMatchObject({ kind: 'top', length: 1000, width: 860, afterStepIndex: 4 });

    fireEvent.change(screen.getByLabelText('Landing 1 type'), { target: { value: 'half' } });
    fireEvent.change(screen.getByLabelText('Landing 1 position'), { target: { value: '1' } });
    commit(screen.getByLabelText('Landing 1 length'), '1.2');
    const l = stairs(id).landings[0]!;
    expect(l).toMatchObject({ kind: 'half', length: 1200, afterStepIndex: 1 });
    expect(screen.getByRole('img', { name: /total run incl\. landings/ })).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove landing 1'));
    expect(stairs(id).landings).toHaveLength(0);
  });

  it('shows a note when a hard floor is chosen and honours imperial display units', () => {
    const { id } = setup();
    let lamId = '';
    act(() => {
      lamId = useProjectStore.getState().addProduct({ name: 'Oak laminate', kind: 'laminate', packCoverageM2: 2.2 });
    });
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: lamId } });
    expect(stairs(id).productId).toBe(lamId);
    expect(screen.getByText(/needs a stair nosing profile on every step/)).toBeTruthy();

    act(() => useProjectStore.getState().updateProject({ displayUnit: 'imperial' }));
    expect((screen.getByLabelText('Step 1 rise') as HTMLInputElement).value).toBe(`0' 8"`);
    expect(screen.getByTestId('stairs-summary').textContent).toContain(`2' 10" wide`);
  });

  it('deletes the staircase after confirmation', () => {
    const { id } = setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('Delete staircase'));
    expect(useProjectStore.getState().project.staircases.find((s) => s.id === id)).toBeUndefined();
    expect(screen.getByText(/no longer exists/)).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe('stairs helpers', () => {
  it('stepRegsIssues checks rise, going and pitch (winders skip going/pitch)', () => {
    expect(stepRegsIssues({ id: 'a', kind: 'straight', rise: 200, going: 223, width: 860 })).toEqual([]);
    expect(stepRegsIssues({ id: 'a', kind: 'straight', rise: 230, going: 210, width: 860 }).map((i) => i.code)).toEqual(['rise', 'going', 'pitch']);
    expect(stepRegsIssues({ id: 'a', kind: 'winder', rise: 200, going: 500, width: 860 })).toEqual([]);
    expect(stepRegsIssues({ id: 'a', kind: 'straight', rise: 0, going: 0, width: 860 })).toEqual([]);
  });

  it('flightPitchDeg ignores winders', () => {
    const pitch = flightPitchDeg([
      { id: 'a', kind: 'straight', rise: 200, going: 200, width: 860 },
      { id: 'b', kind: 'winder', rise: 200, going: 600, width: 860 },
    ]);
    expect(pitch).toBeCloseTo(45, 5);
    expect(flightPitchDeg([])).toBeNull();
  });

  it('formatStairDim reads in mm / inches below a metre / a foot', () => {
    expect(formatStairDim(860, 'metric')).toBe('860 mm');
    expect(formatStairDim(2600, 'metric')).toBe('2.60 m');
    expect(formatStairDim(200, 'imperial')).toBe('7.9"');
    expect(formatStairDim(2600, 'imperial')).toBe(`8' 6"`);
  });

  it('withKind carries dimensions and resets kind-specific fields', () => {
    const w = withKind({ id: 'a', kind: 'straight', rise: 200, going: 223, width: 860 }, 'winder');
    expect(w).toEqual({ id: 'a', kind: 'winder', rise: 200, going: 223, width: 860, goingNarrow: 100 });
    const c = withKind({ ...w, bullnoseProjection: 150 }, 'curtail');
    expect(c).toEqual({ id: 'a', kind: 'curtail', rise: 200, going: 223, width: 860, bullnoseProjection: 150, bullnoseSides: 'both' });
    expect(withKind(c, 'straight')).toEqual({ id: 'a', kind: 'straight', rise: 200, going: 223, width: 860 });
  });

  it('stairSequence places landings after their step, clamping out-of-range indices', () => {
    const steps = makeSteps(3);
    const seq = stairSequence(steps, [
      { id: 'foot', kind: 'quarter', length: 900, width: 860, afterStepIndex: -1 },
      { id: 'mid', kind: 'half', length: 900, width: 860, afterStepIndex: 0 },
      { id: 'top', kind: 'top', length: 900, width: 860, afterStepIndex: 99 },
    ]);
    expect(seq.map((s) => (s.kind === 'step' ? `s${s.index}` : s.landing.id))).toEqual(['foot', 's0', 'mid', 's1', 's2', 'top']);
  });
});
