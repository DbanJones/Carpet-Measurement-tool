/**
 * ResultsPanel: compact (sidebar) and expanded (Estimate tab) rendering of a real estimate for the
 * sample house, the CSV / print exports, the empty project and an engine that throws.
 */
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { useProjectStore } from '@store/projectStore';
import { emptyProject, sampleProject } from '@engine/fixtures';
import { estimateProject } from '@engine/estimate';
import {
  ResultsPanel,
  bomCsv,
  bomCsvFileName,
  formatLm,
  overallWaste,
  packSummaries,
  rollPlanSummary,
  seamCount,
} from './ResultsPanel';

/** Flag read by the module mock below, so one test can make the engine throw. */
const engine = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('@engine/estimate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@engine/estimate')>();
  return {
    ...actual,
    estimateProject: (project: Parameters<typeof actual.estimateProject>[0]) => {
      if (engine.shouldThrow) throw new Error('packer exploded');
      return actual.estimateProject(project);
    },
  };
});

const state = () => useProjectStore.getState();
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  engine.shouldThrow = false;
  state().setProject(sampleProject());
  state().setTab('rooms');
});

afterEach(() => {
  cleanup();
  URL.createObjectURL = originalCreateObjectURL;
  // csv.ts revokes on a timer that can fire after the test has finished, so always leave a revoker behind
  URL.revokeObjectURL = typeof originalRevokeObjectURL === 'function' ? originalRevokeObjectURL : () => undefined;
  vi.restoreAllMocks();
});

/** Capture the Blobs handed to URL.createObjectURL (jsdom does not implement it). */
function stubObjectUrl(): Blob[] {
  const blobs: Blob[] = [];
  URL.createObjectURL = (obj: Blob | MediaSource): string => {
    if (obj instanceof Blob) blobs.push(obj);
    return 'blob:results-panel-test';
  };
  URL.revokeObjectURL = () => undefined;
  return blobs;
}

/** jsdom's Blob has no `text()`; fall back to a FileReader. */
function readBlob(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const section = (productId: string): HTMLElement => {
  const found = screen.getAllByTestId('roll-plan-section').find((el) => el.getAttribute('data-product-id') === productId);
  if (!found) throw new Error(`no roll plan section for ${productId}`);
  return found;
};

describe('ResultsPanel (compact)', () => {
  it('shows the headline figures for the sample house', () => {
    render(<ResultsPanel />);
    expect(screen.getByTestId('kpi-net-area').textContent).toBe('84.04 m²');
    expect(screen.getByTestId('kpi-materials').textContent).toBe('£2,775.60');
    expect(screen.getByTestId('kpi-labour').textContent).toBe('£1,454.62');
    expect(screen.getByTestId('kpi-total').textContent).toBe('£5,076.26');
    expect(screen.getByText('Total inc VAT')).toBeTruthy();
    // the compact panel keeps the detail (waste, rolls) for the full page
    expect(screen.queryByTestId('kpi-waste')).toBeNull();
  });

  it('shows the subtotal instead of the VAT total when VAT is off', () => {
    const project = sampleProject();
    project.prices = { ...project.prices, applyVat: false };
    state().setProject(project);
    render(<ResultsPanel />);
    expect(screen.getByText('Subtotal (no VAT)')).toBeTruthy();
    expect(screen.getByTestId('kpi-total').textContent).toBe('£4,230.22');
  });

  it('lists one line per roll plan and one per pack product', () => {
    render(<ResultsPanel />);
    const rollLines = screen.getAllByTestId('compact-roll-line').map((li) => li.textContent ?? '');
    expect(rollLines).toHaveLength(4);
    const hall = rollLines.find((t) => t.includes('Hall, stairs & landing'));
    expect(hall).toMatch(/4\.00 m: 6\.3 lm, 5 cuts, 0 seams, 47\.7% waste/);

    const packLines = screen.getAllByTestId('compact-pack-line').map((li) => li.textContent ?? '');
    expect(packLines).toHaveLength(2);
    expect(packLines.some((t) => /^Oak effect laminate.*: 4 packs$/.test(t))).toBe(true);
    expect(packLines.some((t) => /: 2 packs$/.test(t))).toBe(true);
  });

  it('shows the five most severe warnings with a link to the rest', () => {
    render(<ResultsPanel />);
    const list = screen.getByRole('list', { name: 'Warnings' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    // the sample house raises 21 notes
    expect(screen.getByRole('button', { name: '16 more…' })).toBeTruthy();
  });

  it('switches to the Estimate tab from "Open full estimate"', () => {
    render(<ResultsPanel />);
    expect(state().tab).toBe('rooms');
    fireEvent.click(screen.getByRole('button', { name: 'Open full estimate' }));
    expect(state().tab).toBe('results');
  });
});

describe('ResultsPanel (expanded)', () => {
  it('adds waste and rolls to the figures and groups every warning', () => {
    render(<ResultsPanel expanded />);
    expect(screen.getByTestId('kpi-net-area').textContent).toBe('84.04 m²');
    expect(screen.getByTestId('kpi-total').textContent).toBe('£5,076.26');
    expect(screen.getByTestId('kpi-waste').textContent).toMatch(/^\d+\.\d%$/);
    expect(screen.getByTestId('kpi-rolls').textContent).toBe('4');

    const notes = screen.getByRole('list', { name: 'Notes' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(19);
    expect(within(notes).getAllByText(/existing gripper/).length).toBeGreaterThan(0);
    // two warning-level notes beside the information ones: the kitchen vinyl piece spans the full
    // 3 m roll width with no trim, and that same vinyl is planned with a seam to weld
    expect(screen.getAllByText(/less than 50 mm trim/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/cold-welded/).length).toBeGreaterThan(0);
  });

  it('draws a cutting plan, its cuts and its offcuts for every roll good', () => {
    render(<ResultsPanel expanded />);
    expect(screen.getAllByTestId('roll-cut-diagram')).toHaveLength(4);
    expect(screen.getAllByTestId('roll-plan-section')).toHaveLength(4);

    const hall = within(section('prod-carpet-hall'));
    expect(hall.getAllByTestId('cut-row')).toHaveLength(5);
    // cut rows name the pieces in them, with the room they belong to and their size
    const firstCut = hall.getAllByTestId('cut-row')[0]!;
    expect(firstCut.textContent).toMatch(/Hall|Landing|Stairs/);
    expect(firstCut.textContent).toMatch(/ × /);

    const offcuts = hall.getAllByTestId('offcut');
    expect(offcuts.length).toBeGreaterThan(0);
    expect(offcuts.filter((li) => li.getAttribute('data-usable') === 'true').length).toBe(2);
    expect(hall.getAllByText('Usable').length).toBe(2);
  });

  it('compares the 4 m and 5 m roll widths and flags the one using least material', () => {
    render(<ResultsPanel expanded />);
    const table = within(section('prod-carpet-hall')).getByTestId('compare-table');
    const rows = within(table).getAllByTestId('compare-row');
    expect(rows.map((r) => r.getAttribute('data-roll-width'))).toEqual(['4000', '5000']);
    expect(rows[0]!.textContent).toMatch(/4\.00 m/);
    expect(rows[1]!.textContent).toMatch(/5\.00 m/);
    // 4 m: 6.3 lm x 4 m = 25.20 m² ordered; 5 m: 6.0 lm x 5 m = 30.00 m²
    expect(rows[0]!.textContent).toMatch(/6\.3 lm/);
    expect(rows[0]!.textContent).toMatch(/25\.20 m²/);
    expect(rows[1]!.textContent).toMatch(/30\.00 m²/);
    expect(rows[0]!.getAttribute('data-best')).toBe('true');
    expect(rows[1]!.getAttribute('data-best')).toBe('false');
    expect(within(rows[0]!).getByText('Least material')).toBeTruthy();
    expect(within(rows[0]!).getByText('Current')).toBeTruthy();
  });

  it('renders a card per room and per staircase, and the bill of materials with its totals', () => {
    render(<ResultsPanel expanded />);
    expect(screen.getAllByTestId('room-result')).toHaveLength(8);
    expect(screen.getAllByTestId('stair-result')).toHaveLength(1);
    expect(within(screen.getAllByTestId('room-result')[0]!).getByTestId('room-net-area').textContent).toMatch(/m²$/);
    expect(within(screen.getAllByTestId('stair-result')[0]!).getByTestId('stair-steps').textContent).toBe('13');

    const bom = within(screen.getByTestId('bom-table'));
    expect(bom.getAllByText(/Carpet gripper, timber pin/).length).toBe(1);
    expect(bom.getAllByRole('row').length).toBeGreaterThan(40);
    expect(screen.getByTestId('bom-grand-total').textContent).toMatch(/£5,076\.26/);
  });

  it('downloads a non-empty CSV of the bill of materials', async () => {
    const blobs = stubObjectUrl();
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    render(<ResultsPanel expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Download BOM (CSV)' }));
    expect(blobs).toHaveLength(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.getAttribute('href')).toBe('blob:results-panel-test');
    expect(clicked[0]!.download).toBe('Example_3-bed_semi_full_re-floor-bill-of-materials.csv');
    // the anchor is removed again once clicked
    expect(clicked[0]!.isConnected).toBe(false);

    const text = await readBlob(blobs[0]!);
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain('Category,Description,Quantity,Unit');
    expect(text).toContain('Carpet gripper, timber pin');
    expect(text).toContain('Lounge');
    expect(text).toMatch(/Total \(GBP\),*/);
  });

  it('prints the page from the Print button', () => {
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true, writable: true });
    render(<ResultsPanel expanded />);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('ResultsPanel edge cases', () => {
  it('invites the user to add a room when the project is empty, in both modes', () => {
    state().setProject(emptyProject('proj-empty'));
    const { unmount } = render(<ResultsPanel />);
    expect(screen.getByTestId('results-empty').textContent).toMatch(/Add a room or staircase to see the estimate/);
    expect(screen.queryByTestId('bom-table')).toBeNull();
    unmount();

    render(<ResultsPanel expanded />);
    expect(screen.getByTestId('results-empty')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add a room' }));
    expect(state().project.rooms).toHaveLength(1);
    expect(state().tab).toBe('rooms');
  });

  it('surfaces an engine exception as an ENGINE_ERROR warning instead of crashing', () => {
    engine.shouldThrow = true;
    render(<ResultsPanel />);
    const list = screen.getByRole('list', { name: 'Warnings' });
    expect(within(list).getByText(/packer exploded/)).toBeTruthy();
    expect(list.querySelector('[data-code="ENGINE_ERROR"]')).toBeTruthy();
    expect(list.querySelector('[data-level="error"]')).toBeTruthy();
    // the panel still renders, with zeroed figures
    expect(screen.getByTestId('kpi-total').textContent).toBe('£0.00');
    expect(screen.getByTestId('kpi-net-area').textContent).toBe('0.00 m²');
    expect(screen.queryAllByTestId('compact-roll-line')).toHaveLength(0);
  });

  it('renders the full page too when the engine throws', () => {
    engine.shouldThrow = true;
    render(<ResultsPanel expanded />);
    expect(screen.getByTestId('results-panel')).toBeTruthy();
    expect(screen.queryAllByTestId('roll-cut-diagram')).toHaveLength(0);
    expect(screen.getByText(/Nothing to order yet/)).toBeTruthy();
    expect(screen.getAllByTestId('room-result')).toHaveLength(8);
    expect(screen.getByRole('list', { name: 'Errors' })).toBeTruthy();
  });
});

describe('ResultsPanel helpers', () => {
  const project = sampleProject();
  const estimate = estimateProject(project);

  it('formats a roll plan as one line', () => {
    const plan = estimate.rollPlans.find((p) => p.productId === 'prod-carpet-lounge')!;
    const product = project.products.find((p) => p.id === plan.productId);
    // the lounge comes out in ONE piece: the planner no longer seams a room for no saving
    expect(rollPlanSummary(plan, product, 'metric')).toBe('Lounge twist pile carpet (4 m) — 4.00 m: 5.4 lm, 1 cut, 0 seams, 17.0% waste');
    expect(seamCount(plan)).toBe(0);
    expect(formatLm(6300)).toBe('6.3 lm');
    expect(formatLm(6000)).toBe('6 lm');
  });

  it('names pack products from the product list, not the BOM description', () => {
    const packs = packSummaries(estimate, project);
    expect(packs.map((p) => p.productId)).toEqual(['prod-laminate-oak', 'prod-lvt-bathroom']);
    expect(packs[0]!.name).toBe('Oak effect laminate 8 mm, 1285 x 192 mm');
    expect(packs[0]!.quantity).toBe(4);
    expect(packs[0]!.unit).toBe('pack');
  });

  it('reports waste across every roll good, and none when there are no roll goods', () => {
    const waste = overallWaste(estimate.rollPlans)!;
    expect(waste).toBeGreaterThan(0);
    expect(waste).toBeLessThan(1);
    expect(overallWaste([])).toBeUndefined();
  });

  it('exports the bill of materials with room names and totals', () => {
    const csv = bomCsv(estimate, project);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Category,Description,Quantity,Unit,Exact quantity,Unit price,Line total,Applies to,Notes');
    expect(lines.length).toBe(estimate.bom.length + 6); // header + lines + materials/labour/subtotal/VAT/total
    expect(csv).toContain('Bedroom 1');
    expect(csv).toContain('Total (GBP)');
  });
});


describe('the printed quote', () => {
  it('carries the customer, site and date once they are entered, and the notes under the BOM', () => {
    const project = sampleProject();
    project.customer = 'Mrs A Patel';
    project.siteAddress = '12 Elm Road, Sheffield';
    project.quoteRef = 'Q-2026-014';
    project.quoteDate = '2026-04-20';
    project.notes = 'Price holds for 30 days. Furniture moved by the customer.';
    state().setProject(project);
    render(<ResultsPanel expanded />);
    const header = screen.getByTestId('quote-header');
    expect(header.textContent).toContain('Mrs A Patel');
    expect(header.textContent).toContain('12 Elm Road, Sheffield');
    expect(header.textContent).toContain('Q-2026-014');
    expect(header.textContent).toContain('2026-04-20');
    // once under the bill of materials as terms, and once in the editable field
    expect(screen.getAllByText(/Price holds for 30 days/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Notes and terms' })).toBeTruthy();
  });

  it('shows no quote header at all until something is entered', () => {
    render(<ResultsPanel expanded />);
    expect(screen.queryByTestId('quote-header')).toBeNull();
    // the editor is there to fill in, and does not print
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'Mr B Jones' } });
    expect(state().project.customer).toBe('Mr B Jones');
    expect(screen.getByTestId('quote-header').textContent).toContain('Mr B Jones');
  });

  it('keys the cutting plan so the printed diagram can be read without the tooltips', () => {
    render(<ResultsPanel expanded />);
    const legends = screen.getAllByText('Main piece');
    expect(legends.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fill piece').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Stairs / landing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Offcut').length).toBeGreaterThan(0);
  });

  it('does not call a laminate room\'s perimeter a gripper perimeter', () => {
    render(<ResultsPanel expanded />);
    // the box room is laminate: it gets no gripper at all
    expect(screen.getAllByText('Fixing / beading perimeter').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Gripper perimeter').length).toBeGreaterThan(0); // the carpet rooms
  });
});
