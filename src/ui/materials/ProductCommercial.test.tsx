import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BroadloomProduct, PackProduct } from '@engine/types';
import { estimateProject } from '@engine/estimate';
import { useProjectStore, makeEmptyProject } from '@store/projectStore';
import { ProductEditor } from './ProductEditor';
import { SettingsPanel } from './SettingsPanel';

const state = () => useProjectStore.getState();
const blurValue = (label: string, value: string) => { const input = screen.getByLabelText(label); fireEvent.change(input, { target: { value } }); fireEvent.blur(input); };
beforeEach(() => useProjectStore.setState({ project: makeEmptyProject('Commercial UI'), selection: { kind: 'none' }, tab: 'materials', revision: 0 }));
afterEach(cleanup);

it('offers roll pricing up front and requires its length before the price is complete', () => {
  const product = state().project.products[0]!;
  state().addRoom({ productId: product.id, shape: { kind: 'rectangle', length: 5000, width: 3000 } });
  render(<ProductEditor productId={product.id} />);
  fireEvent.change(screen.getByLabelText('Product price basis'), { target: { value: 'per_roll' } });
  expect(screen.getByText('Enter the priced roll length to calculate the price.')).toBeTruthy();
  blurValue('Price per roll', '800');
  blurValue('Priced roll length', '10');
  expect(state().project.products[0]).toMatchObject({ priceBasis: 'per_roll', pricePerRoll: 800, pricedRollLength: 10000 });
  const e = estimateProject(state().project);
  expect(e.bom.find(l => l.category === 'floor_covering')).toMatchObject({ unit: 'roll', total: 800 });
  fireEvent.change(screen.getByLabelText('Roll charging method'), { target: { value: 'cut_length' } });
  expect(estimateProject(state().project).bom.find(l => l.category === 'floor_covering')!.total).toBeLessThan(800);
});

it('selects underlay with a carpet and can restore project defaults without losing other fields', () => {
  const product = state().project.products[0]!;
  render(<ProductEditor productId={product.id} />);
  fireEvent.change(screen.getByLabelText('Carpet underlay option'), { target: { value: 'pu8' } });
  expect((state().project.products[0] as BroadloomProduct).underlay).toMatchObject({ thickness: 8, pricePerRoll: 60, fit: true });
  expect((screen.getByLabelText('Carpet underlay option') as HTMLSelectElement).value).toBe('pu8');
  fireEvent.change(screen.getByLabelText('Carpet underlay option'), { target: { value: 'none' } });
  expect(screen.getByText('No new underlay will be ordered for this carpet.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Carpet underlay option'), { target: { value: 'inherit' } });
  expect((state().project.products[0] as BroadloomProduct).underlay).toBeUndefined();
  expect(state().project.products[0]!.pricePerM2).toBe(product.pricePerM2);
});

it('edits underlay prices directly and keeps the carpet supply charge independent', () => {
  const product = state().project.products[0]!;
  state().addRoom({ productId: product.id });
  const before = estimateProject(state().project).bom.find(line => line.category === 'floor_covering')!.total;
  render(<ProductEditor productId={product.id}/>);
  expect(screen.getByLabelText('Product underlay price per roll')).toBeTruthy();
  expect(screen.queryByLabelText('Product underlay thickness')).toBeNull();
  fireEvent.change(screen.getByLabelText('Product underlay price basis'), { target: { value: 'per_m2' } });
  blurValue('Product underlay price per m²', '6');
  const estimate = estimateProject(state().project);
  expect(estimate.bom.find(line => line.category === 'underlay')).toMatchObject({ unitPrice: 90.42 });
  expect(estimate.bom.find(line => line.category === 'floor_covering')!.total).toBe(before);
  fireEvent.change(screen.getByLabelText('Product underlay price basis'), { target: { value: 'per_roll' } });
  blurValue('Product underlay price per roll', '100');
  expect(estimateProject(state().project).bom.find(line => line.category === 'underlay')).toMatchObject({ unitPrice: 100 });
  expect(state().project.products[0]!.pricePerM2).toBe(product.pricePerM2);
});

it('makes herringbone and its area allowance directly selectable on LVT', () => {
  const id = state().addProduct({ name: 'Herringbone LVT', kind: 'lvt_click', packCoverageM2: 2, pricePerPack: 40 });
  state().addRoom({ productId: id, shape: { kind: 'rectangle', length: 4000, width: 5000 } });
  render(<ProductEditor productId={id} />);
  fireEvent.change(screen.getByLabelText('Product laying pattern'), { target: { value: 'herringbone' } });
  expect((screen.getByLabelText('Product cutting wastage') as HTMLInputElement).value).toBe('20');
  expect((state().project.products.find(p => p.id === id) as PackProduct).hardFloor?.layPattern).toBe('herringbone');
  expect(Object.values(estimateProject(state().project).details.hardFloorPlans)[0]!.grossAreaM2).toBe(24);
  blurValue('Product cutting wastage', '12');
  expect(Object.values(estimateProject(state().project).details.hardFloorPlans)[0]!.grossAreaM2).toBeCloseTo(22.4);
});

it('changes the actual labour charge when hourly pricing is selected, with details initially collapsed', () => {
  state().addRoom({ shape: { kind: 'rectangle', length: 6000, width: 4000 }, doorways: [], subfloor: { type: 'floorboards', condition: 'good' } });
  state().updatePrices({ labour: { ...state().project.prices.labour, minimumJobLabour: 0 } });
  render(<SettingsPanel />);
  expect(screen.queryByLabelText('Straight step minutes')).toBeNull();
  fireEvent.change(screen.getByLabelText('Labour pricing method'), { target: { value: 'hourly' } });
  blurValue('Hourly labour rate', '50');
  expect(estimateProject(state().project).totals.labourCost).toBe(165);
  fireEvent.click(screen.getByRole('button', { name: /How the hours are calculated/ }));
  expect(screen.getByText('24 m² ÷ 12 m²/hour')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Fitting speeds & stair time/ }));
  expect(screen.getByLabelText('Shaped step minutes')).toBeTruthy();
});
