import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useProjectStore, makeEmptyProject } from '@store/projectStore';
import type { BroadloomProduct, PackProduct } from '@engine/types';
import { DEFAULT_PRICES } from '@engine/defaults';
import { MaterialsPanel } from './MaterialsPanel';
import { ProductEditor, convertProductKind } from './ProductEditor';
import { PRODUCT_PRESETS, UNDERLAY_PRESETS, defaultProductForKind } from './presets';

function resetStore() {
  useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' }, tab: 'materials', revision: 0, newSpaceProductId: null });
}
const state = () => useProjectStore.getState();
const firstProduct = () => state().project.products[0]!;
/** LengthInput / NumberInput commit on blur. */
const typeAndBlur = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MaterialsPanel', () => {
  it.each([['Measure a room', 'rooms'], ['Measure stairs', 'staircases']] as const)('continues from a chosen product through %s', (action, collection) => {
    const id = state().addProduct({ name: 'Bedroom wool', kind: 'carpet', rollWidth: 5000, pricePerM2: 32 });
    state().select({ kind: 'product', id });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(state().project[collection]).toHaveLength(1);
    expect(state().project[collection][0]?.productId).toBe(id);
    expect(state().newSpaceProductId).toBe(id);
    expect(state().tab).toBe('rooms');
  });

  it('carries the selected product into the floor-plan workflow without adding a measured space', () => {
    const id = state().addProduct({ name: 'Plan carpet', kind: 'carpet', rollWidth: 5000 });
    state().select({ kind: 'product', id });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a floor plan' }));
    expect(state().newSpaceProductId).toBe(id);
    expect(state().tab).toBe('floorplan');
    expect(state().project.rooms).toHaveLength(0);
  });
  it('uses one named native button per product to open and close its editor', () => {
    render(<MaterialsPanel />);
    const list = screen.getByTestId('product-list');
    // A single product opens immediately so initial setup needs no extra Edit click.
    expect(screen.getByLabelText('Product name')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Close Carpet (4 m roll)' }));
    const productButton = within(list).getByRole('button', { name: 'Edit Carpet (4 m roll)' });
    expect(productButton.tagName).toBe('BUTTON');
    expect(productButton.getAttribute('aria-expanded')).toBe('false');
    expect(list.querySelectorAll('li[aria-selected]')).toHaveLength(0);
    productButton.focus();
    expect(document.activeElement).toBe(productButton);
    fireEvent.click(productButton);
    expect(state().selection).toEqual({ kind: 'product', id: firstProduct().id });
    const closeButton = within(list).getByRole('button', { name: 'Close Carpet (4 m roll)' });
    expect(closeButton.getAttribute('aria-expanded')).toBe('true');
    const editor = document.getElementById(closeButton.getAttribute('aria-controls')!);
    expect(editor).toBeTruthy();
    expect(within(editor!).getByLabelText('Product name')).toBeTruthy();
    fireEvent.click(closeButton);
    expect(screen.queryByLabelText('Product name')).toBeNull();
    expect(state().selection).toEqual({ kind: 'none' });
  });

  it('lists the products from the store with their supply and price', () => {
    render(<MaterialsPanel />);
    expect(screen.getByRole('heading', { name: 'Materials & options' })).toBeTruthy();
    const list = within(screen.getByTestId('product-list'));
    expect(list.getByText('Carpet (4 m roll)')).toBeTruthy();
    expect(list.getByText(/Carpet · 4\.00 m roll · £18\.00 per m²/)).toBeTruthy();
    // Project-wide fitting choices are available one level below the initial product setup.
    expect(screen.queryByRole('button', { name: /Broadloom planning/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Planning & fitting options/ }));
    expect(screen.getByRole('button', { name: /Broadloom planning/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Underlay$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Prices/ })).toBeTruthy();
  });

  it('adds a product from a preset and opens it for editing', () => {
    render(<MaterialsPanel />);
    fireEvent.change(screen.getByLabelText('Product preset'), { target: { value: 'laminate_8mm' } });
    expect(screen.getByText(/8 mm click laminate/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add product' }));
    const products = state().project.products;
    expect(products).toHaveLength(2);
    const added = products[1] as PackProduct;
    expect(added.kind).toBe('laminate');
    expect(added.packCoverageM2).toBe(2.22);
    expect(added.boardsPerPack).toBe(9);
    expect(state().selection).toEqual({ kind: 'product', id: added.id });
    expect((screen.getByLabelText('Product name') as HTMLInputElement).value).toBe('Laminate 8 mm click');
    expect((screen.getByLabelText('Pack coverage') as HTMLInputElement).value).toBe('2.22');
    fireEvent.click(screen.getByRole('button', { name: /Board & fitting details/ }));
    expect(screen.getByTestId('coverage-check').textContent).toMatch(/9 x 0\.247 m² = 2\.22 m² ✓/);
    expect(screen.getByTestId('price-per-m2').textContent).toBe('£9.91 per m²');
  });

  it('every preset builds a product of the right family', () => {
    for (const p of PRODUCT_PRESETS) {
      const draft = p.make();
      if ('rollWidth' in draft) {
        expect(draft.rollWidth).toBeGreaterThan(0);
        expect(draft.pricePerM2).toBeGreaterThan(0);
      } else {
        expect(draft.packCoverageM2).toBeGreaterThan(0);
        expect(draft.pricePerPack).toBeGreaterThan(0);
      }
    }
  });

  it('edits the selected product inline: name, roll width and alternative widths reach the store', () => {
    const id = firstProduct().id;
    state().select({ kind: 'product', id });
    render(<MaterialsPanel />);
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Wool twist' } });
    expect(firstProduct().name).toBe('Wool twist');

    fireEvent.change(screen.getByLabelText('Roll width'), { target: { value: '5000' } });
    let p = firstProduct() as BroadloomProduct;
    expect(p.rollWidth).toBe(5000);
    expect(p.alternativeRollWidths).toEqual([]); // 5 m was the alternative; it is now the main width

    fireEvent.click(screen.getByLabelText('4.00 m'));
    p = firstProduct() as BroadloomProduct;
    expect(p.alternativeRollWidths).toEqual([4000]);

    fireEvent.click(screen.getByRole('button', { name: /Supplier & fitting details/ }));
    fireEvent.change(screen.getByLabelText('Cut increment'), { target: { value: '500' } });
    expect((firstProduct() as BroadloomProduct).cutIncrement).toBe(500);

    typeAndBlur(screen.getByLabelText('Maximum roll length'), '25');
    expect((firstProduct() as BroadloomProduct).maxRollLength).toBe(25000);

    typeAndBlur(screen.getByLabelText('Price per square metre'), '22.5');
    expect(firstProduct().pricePerM2).toBe(22.5);
  });

  it('a custom roll width can be typed', () => {
    const id = firstProduct().id;
    state().select({ kind: 'product', id });
    render(<MaterialsPanel />);
    fireEvent.change(screen.getByLabelText('Roll width'), { target: { value: 'custom' } });
    typeAndBlur(screen.getByLabelText('Custom roll width'), '3.5');
    expect((firstProduct() as BroadloomProduct).rollWidth).toBe(3500);
    expect((screen.getByLabelText('Roll width') as HTMLSelectElement).value).toBe('custom');
  });

  it('changing the kind converts between roll and pack products', () => {
    const id = firstProduct().id;
    state().select({ kind: 'product', id });
    render(<MaterialsPanel />);
    fireEvent.change(screen.getByLabelText('Product kind'), { target: { value: 'laminate' } });
    let p = firstProduct();
    expect(p.kind).toBe('laminate');
    expect('rollWidth' in p).toBe(false);
    expect((p as PackProduct).packCoverageM2).toBe(2.22);
    expect(p.pricePerM2).toBe(18); // carried over
    expect((p as PackProduct).pricePerPack).toBe(39.96);
    expect(screen.getByLabelText('Pack coverage')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Product kind'), { target: { value: 'sheet_vinyl' } });
    p = firstProduct();
    expect(p.kind).toBe('sheet_vinyl');
    expect((p as BroadloomProduct).rollWidth).toBe(2000);
    expect('packCoverageM2' in p).toBe(false);
    expect(screen.getByLabelText('Roll width')).toBeTruthy();
  });

  it('convertProductKind keeps roll details between carpet and vinyl and swaps the kind defaults', () => {
    const carpet: BroadloomProduct = { id: 'x', ...defaultProductForKind('carpet'), pricePerM2: 30 };
    const vinyl = convertProductKind(carpet, 'sheet_vinyl') as BroadloomProduct;
    expect(vinyl.kind).toBe('sheet_vinyl');
    expect(vinyl.rollWidth).toBe(4000); // 4 m is a vinyl width too
    expect(vinyl.maxRollLength).toBe(20000);
    expect(vinyl.thickness).toBe(2.5);
    expect(vinyl.pricePerM2).toBe(30);
    const back = convertProductKind({ ...vinyl, rollWidth: 3000 }, 'carpet') as BroadloomProduct;
    expect(back.rollWidth).toBe(3000); // 3 m is in the "other" carpet widths
    expect(back.maxRollLength).toBe(30000);
    const tiles = convertProductKind({ id: 'y', ...defaultProductForKind('laminate') }, 'carpet_tiles') as PackProduct;
    expect(tiles.kind).toBe('carpet_tiles');
    expect(tiles.boardLength).toBe(1285); // pack -> pack keeps geometry for the user to edit
  });

  it('pack price edits keep price per m² in step', () => {
    const id = state().addProduct(defaultProductForKind('lvt_glue'));
    state().select({ kind: 'product', id });
    render(<MaterialsPanel />);
    typeAndBlur(screen.getByLabelText('Price per pack'), '100');
    const p = state().project.products.find((x) => x.id === id) as PackProduct;
    expect(p.pricePerPack).toBe(100);
    expect(p.pricePerM2).toBe(29.94);
    expect(screen.getByTestId('price-per-m2').textContent).toBe('£29.94 per m²');
  });

  it('deletes a product after confirmation and reassigns its rooms', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const second = state().addProduct(defaultProductForKind('carpet', 'Second'));
    const first = firstProduct().id;
    state().addRoom({ name: 'Hall', productId: first });
    state().select({ kind: 'product', id: first });
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/1 room using it will switch to "Second"/));
    expect(state().project.products.map((p) => p.id)).toEqual([second]);
    expect(state().project.rooms[0]!.productId).toBe(second);
    expect(state().selection).toEqual({ kind: 'none' });
  });

  it('writes broadloom planning and underlay options', () => {
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Planning & fitting options/ }));
    fireEvent.change(screen.getByLabelText('Seam policy'), { target: { value: 'min_seams' } });
    expect(state().project.options.broadloom.seamPolicy).toBe('min_seams');
    expect(screen.getByText(/Every fill is one full-length strip/)).toBeTruthy();
    expect((screen.getByLabelText('Balanced threshold') as HTMLInputElement).disabled).toBe(true);

    typeAndBlur(screen.getByLabelText('Length allowance'), '0.15');
    expect(state().project.options.broadloom.lengthAllowance).toBe(150);

    const heavy = UNDERLAY_PRESETS.find((p) => p.id === 'pu11_heavy')!;
    fireEvent.click(screen.getByRole('button', { name: heavy.label }));
    expect(state().project.options.underlay).toMatchObject({ thickness: 11, tog: 2.9, pricePerRoll: 95, fit: true });
    expect(screen.getByTestId('underlay-figures').textContent).toBe('15.07 m² per roll · £6.30 per m²');

    fireEvent.click(screen.getByLabelText('Fit underlay under carpet'));
    expect(state().project.options.underlay.fit).toBe(false);
    expect((screen.getByLabelText('Underlay tog') as HTMLInputElement).disabled).toBe(true);
  });

  it('writes accessory, floor prep and hard floor options (percentages stored as fractions)', () => {
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Planning & fitting options/ }));
    fireEvent.click(screen.getByRole('button', { name: /Accessories/ }));
    typeAndBlur(screen.getByLabelText('Gripper wastage'), '15');
    expect(state().project.options.accessories.gripperWastage).toBe(0.15);
    typeAndBlur(screen.getByLabelText('Gripper lengths per pack'), '100');
    expect(state().project.options.accessories.gripperPerPack).toBe(100);

    fireEvent.click(screen.getByRole('button', { name: /Floor preparation/ }));
    typeAndBlur(screen.getByLabelText('Latex thickness'), '5');
    expect(state().project.options.floorPrep.latexThickness).toBe(5);
    typeAndBlur(screen.getByLabelText('Ply sheet width'), '1.22');
    expect(state().project.options.floorPrep.plySheetWidth).toBe(1220);

    fireEvent.click(screen.getByRole('button', { name: /Hard floor defaults/ }));
    fireEvent.change(screen.getByLabelText('Lay pattern'), { target: { value: 'herringbone' } });
    expect(state().project.options.hardFloor.layPattern).toBe('herringbone');
    expect(state().project.options.hardFloor.wastage).toBeUndefined();
    expect((screen.getByLabelText('Hard floor wastage') as HTMLInputElement).value).toBe('20');
    typeAndBlur(screen.getByLabelText('Hard floor wastage'), '12');
    expect(state().project.options.hardFloor.wastage).toBe(0.12);
    fireEvent.click(screen.getByRole('button', { name: 'Use pattern figure' }));
    expect(state().project.options.hardFloor.wastage).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Expansion gap cover'), { target: { value: 'skirting' } });
    expect(state().project.options.hardFloor.useBeading).toBe(false);
  });

  it('edits prices and resets them to the defaults', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Prices/ }));
    typeAndBlur(screen.getByLabelText('VAT rate'), '5');
    expect(state().project.prices.vatRate).toBe(0.05);
    typeAndBlur(screen.getByLabelText('Carpet fitting rate'), '6.5');
    expect(state().project.prices.labour.carpetFittingPerM2).toBe(6.5);
    typeAndBlur(screen.getByLabelText('Gripper, pack price'), '13');
    expect(state().project.prices.materials.gripperPerPack).toBe(13);
    typeAndBlur(screen.getByLabelText('Minimum job charge rate'), '200');
    expect(state().project.prices.labour.minimumJobLabour).toBe(200);
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    expect(state().project.prices.currency).toBe('EUR');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(state().project.prices).toEqual(DEFAULT_PRICES);
  });

  it('honours the imperial display unit', () => {
    state().updateProject({ displayUnit: 'imperial' });
    state().select({ kind: 'product', id: firstProduct().id });
    render(<MaterialsPanel />);
    expect(within(screen.getByTestId('product-list')).getByText(/13' 1" roll/)).toBeTruthy();
    expect(screen.getByTestId('roll-width-figure').textContent).toBe(`13' 1"`);
    fireEvent.click(screen.getByRole('button', { name: /Supplier & fitting details/ }));
    typeAndBlur(screen.getByLabelText('Maximum roll length'), `100'`);
    expect((firstProduct() as BroadloomProduct).maxRollLength).toBe(30480);
  });
});

describe('ProductEditor (stand-alone)', () => {
  it('shows a friendly message when the product does not exist', () => {
    render(<ProductEditor productId="nope" />);
    expect(screen.getByText(/This product no longer exists/)).toBeTruthy();
  });

  it('renders as its own panel with a level-2 heading', () => {
    render(<ProductEditor productId={firstProduct().id} />);
    expect(screen.getByRole('heading', { level: 2, name: /Carpet \(4 m roll\)/ })).toBeTruthy();
    expect(screen.getByText('Not used by any room or staircase yet.')).toBeTruthy();
  });
});


describe('captions that used to be traps', () => {
  it('clicking "Also available in" does not add a roll width to the comparison', () => {
    // The caption was a <label> wrapping the checkboxes, so a click on it activated the first one:
    // a 2 m roll appeared in the roll-width comparison table with nothing to explain it.
    const id = state().addProduct({ name: 'Twist', kind: 'carpet', rollWidth: 4000, alternativeRollWidths: [] });
    render(<ProductEditor productId={id} />);
    const caption = screen.getByText('Also available in');
    expect(caption.closest('label')).toBeNull();
    fireEvent.click(caption);
    expect((state().project.products.find((p) => p.id === id) as BroadloomProduct).alternativeRollWidths ?? []).toEqual([]);
    // the checkboxes themselves still work
    fireEvent.click(screen.getByRole('group', { name: 'Also available in' }).querySelector('input[type=checkbox]')!);
    expect((state().project.products.find((p) => p.id === id) as BroadloomProduct).alternativeRollWidths!.length).toBe(1);
  });

  it('clicking "Presets" does not overwrite the underlay settings', () => {
    // `button` is a labelable element: the old <label> forwarded its activation to the first preset,
    // replacing roll width, roll length, thickness, tog and price in one click, with no undo.
    render(<MaterialsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Planning & fitting options/ }));
    const before = { ...state().project.options.underlay };
    const caption = screen.getByText('Presets');
    expect(caption.closest('label')).toBeNull();
    fireEvent.click(caption);
    expect(state().project.options.underlay).toEqual(before);
    // and the presets themselves still apply
    fireEvent.click(screen.getByRole('button', { name: UNDERLAY_PRESETS[0]!.label }));
    expect(state().project.options.underlay).toMatchObject(UNDERLAY_PRESETS[0]!.values);
  });
});
