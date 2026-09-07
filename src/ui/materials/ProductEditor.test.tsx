import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BroadloomProduct, PackProduct } from '@engine/types';
import { makeEmptyProject, useProjectStore } from '@store/projectStore';
import { ProductEditor } from './ProductEditor';
import { defaultProductForKind } from './presets';

const state = () => useProjectStore.getState();
const product = () => state().project.products[0]!;
const change = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

beforeEach(() => {
  useProjectStore.setState({ project: makeEmptyProject('Product details'), selection: { kind: 'none' }, tab: 'materials', revision: 0 });
});
afterEach(cleanup);

describe('ProductEditor progressive details', () => {
  it('starts with name, covering, roll width and price while retaining alternative widths', () => {
    const before = structuredClone(product());
    render(<ProductEditor productId={product().id} />);
    expect(screen.getByLabelText('Product name')).toBeTruthy();
    expect(screen.getByLabelText('Product kind')).toBeTruthy();
    expect(screen.getByLabelText('Roll width')).toBeTruthy();
    expect(screen.getByLabelText('Price per square metre')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Also available in' })).toBeTruthy();
    expect(screen.queryByLabelText('Maximum roll length')).toBeNull();
    expect(screen.queryByLabelText('Pattern repeat length')).toBeNull();
    expect(screen.getByRole('button', { name: 'Supplier & fitting details' }).getAttribute('aria-expanded')).toBe('false');
    expect(product()).toEqual(before);
  });

  it('summarises current supplier constraints and preserves them when details are closed', () => {
    state().updateProduct(product().id, { maxRollLength: 25000, cutIncrement: 250, minCutLength: 1500, thickness: 12 });
    render(<ProductEditor productId={product().id} />);
    expect(screen.getByText('Up to 25.00 m per roll · 250 mm cut increments · 1.50 m minimum cut · 12 mm thick')).toBeTruthy();
    const details = screen.getByRole('button', { name: 'Supplier & fitting details' });
    fireEvent.click(details);
    expect((screen.getByLabelText('Cut increment') as HTMLSelectElement).value).toBe('250');
    change('Maximum roll length', '35');
    change('Minimum cut length', '0');
    fireEvent.click(details);
    expect(screen.queryByLabelText('Maximum roll length')).toBeNull();
    expect(product()).toMatchObject({ maxRollLength: 35000, cutIncrement: 250, minCutLength: 0, thickness: 12 });
    expect(screen.getByText('Up to 35.00 m per roll · 250 mm cut increments · No minimum cut · 12 mm thick')).toBeTruthy();
    fireEvent.click(details);
    expect((screen.getByLabelText('Maximum roll length') as HTMLInputElement).value).toBe('35');
  });

  it('makes inherited defaults explicit for a product without supplier constraints', () => {
    state().updateProject({ products: [{ id: 'plain', name: 'Plain', kind: 'sheet_vinyl', rollWidth: 2000 }] });
    render(<ProductEditor productId="plain" />);
    expect(screen.getByText('No roll length limit set · 100 mm cut increments · No minimum cut · 2.5 mm thick (default)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Supplier & fitting details' }));
    expect((screen.getByLabelText('Thickness') as HTMLInputElement).value).toBe('2.5');
    expect((product() as BroadloomProduct).thickness).toBeUndefined();
  });

  it('opens pattern details for patterned products and retains the active summary when closed', () => {
    state().updateProduct(product().id, { patternRepeatLength: 500, patternRepeatWidth: 250 });
    render(<ProductEditor productId={product().id} />);
    const pattern = screen.getByRole('button', { name: 'Pattern matching' });
    expect(pattern.getAttribute('aria-expanded')).toBe('true');
    change('Pattern repeat length', '0.6');
    fireEvent.click(pattern);
    expect(screen.queryByLabelText('Pattern repeat length')).toBeNull();
    expect(screen.getByText('0.60 m along the roll · 0.25 m across. Matching allowances are included.')).toBeTruthy();
    expect(product()).toMatchObject({ patternRepeatLength: 600, patternRepeatWidth: 250 });
  });

  it('puts pack coverage and price first and preserves board geometry through detail edits', () => {
    state().updateProject({ products: [{ id: 'pack', ...defaultProductForKind('laminate') }] });
    render(<ProductEditor productId="pack" />);
    expect(screen.getByLabelText('Pack coverage')).toBeTruthy();
    expect(screen.getByLabelText('Price per pack')).toBeTruthy();
    expect(screen.queryByLabelText('Board length')).toBeNull();
    const before = product() as PackProduct;
    change('Price per pack', '44.4');
    expect(product()).toMatchObject({ pricePerM2: 20, pricePerPack: 44.4, boardLength: before.boardLength, boardWidth: before.boardWidth });
    const details = screen.getByRole('button', { name: 'Board & fitting details' });
    fireEvent.click(details);
    change('Board length', '1.3');
    fireEvent.click(details);
    expect((product() as PackProduct).boardLength).toBe(1300);
  });

  it('keeps a coverage mismatch visible while optional tile fields are closed', () => {
    state().updateProject({ products: [{ id: 'tiles', ...defaultProductForKind('carpet_tiles'), packCoverageM2: 7 }] });
    render(<ProductEditor productId="tiles" />);
    expect(screen.getByRole('button', { name: 'Tile & fitting details' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Board length')).toBeNull();
    expect(screen.getByText(/the estimate uses the entered coverage of 7.00 m²/)).toBeTruthy();
  });
});
