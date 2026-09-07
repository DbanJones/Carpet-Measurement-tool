import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeEmptyProject, useProjectStore } from '@store/projectStore';
import { parseProject, serializeProject } from '@engine/serialize';
import { estimateProject } from '@engine/estimate';
import type { BroadloomProduct } from '@engine/types';
import { GuidedSetup, GuidedSetupProgress, startGuidedSetup, useGuidedSetup } from './GuidedSetup';
import { blankHousePlan } from './blankHousePlan';

const state = () => useProjectStore.getState();
beforeEach(() => { useProjectStore.setState({ project: makeEmptyProject('House'), tab: 'rooms', selection: { kind: 'none' }, newSpaceProductId: null }); useGuidedSetup.setState({ projectId: '', active: false, stage: 0, path: 'sketch', productDraft: undefined }); startGuidedSetup(); });
afterEach(cleanup);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const value = (label: string, text: string) => { const input = screen.getByLabelText(label); fireEvent.change(input, { target: { value: text } }); fireEvent.blur(input); };

describe('guided project setup', () => {
  it('keeps an invalid roll size visible instead of saving the previous value', () => {
    render(<GuidedSetup/>);
    const width = screen.getByLabelText('Guide roll width'); fireEvent.change(width, { target: { value: 'unknown' } }); fireEvent.blur(width);
    click('Use this flooring');
    expect(useGuidedSetup.getState().stage).toBe(0);
    expect(width.getAttribute('aria-invalid')).toBe('true');
  });
  it('stages product changes and commits them only at the flooring step', () => {
    const original = structuredClone(state().project);
    render(<GuidedSetup/>);
    fireEvent.change(screen.getByLabelText('Guide product name'), { target: { value: 'Natural wool' } });
    const width = screen.getByLabelText('Guide roll width'); fireEvent.change(width, { target: { value: '5' } }); fireEvent.blur(width);
    expect(state().project).toEqual(original);
    click('Use this flooring');
    expect(state().project.products[0]).toMatchObject({ name: 'Natural wool', rollWidth: 5000 });
    expect(state().newSpaceProductId).toBe(original.products[0]!.id);
    expect(screen.getByText('How would you like to measure?')).toBeTruthy();
  });

  it('starts a hard-floor-only job directly from the unused starter product', () => {
    const id = state().project.products[0]!.id;
    render(<GuidedSetup/>);
    fireEvent.change(screen.getByLabelText('Guide flooring type'), { target: { value: 'laminate' } });
    value('Guide product name', 'Oak throughout');
    expect(screen.queryByLabelText('Guide underlay price per roll')).toBeNull();
    click('Use this flooring');
    expect(state().project.products).toHaveLength(1);
    expect(state().project.products[0]).toMatchObject({ id, kind: 'laminate', name: 'Oak throughout' });
    click(/Enter room measurements/);
    expect(state().project.rooms[0]!.productId).toBe(id);
  });

  it('adds a drawing sheet without replacing existing rooms, products or plans', () => {
    const room = state().addRoom({ name: 'Existing room' });
    const oldPlan = state().addFloorPlan(blankHousePlan('First floor'));
    state().select({ kind: 'none' }); state().setTab('rooms');
    render(<GuidedSetup/>); click('Use this flooring'); click(/Draw a house without a plan/);
    expect(state().project.rooms.map(room => room.id)).toEqual([room]);
    expect(state().project.floorPlans).toHaveLength(2);
    expect(state().project.floorPlans[0]!.id).toBe(oldPlan);
    expect(state().project.floorPlans[1]).toMatchObject({ mmPerPx: 20, sketch: { gridMm: 1000 } });
    expect(state().tab).toBe('floorplan');
    expect(useGuidedSetup.getState().stage).toBe(2);
    act(() => { state().setTab('rooms'); state().select({ kind: 'none' }); });
    click('Draw another room');
    expect(state().tab).toBe('floorplan');
    expect(state().project.rooms.map(room => room.id)).toEqual([room]);
  });

  it('offers a return from measuring and continues to the estimate', () => {
    const view = render(<GuidedSetup/>); click('Use this flooring'); click(/Enter room measurements/);
    expect(state().project.rooms).toHaveLength(1);
    view.unmount(); render(<><GuidedSetupProgress/><GuidedSetup/></>);
    click('Back to guide'); expect(state().selection).toEqual({ kind: 'none' });
    click('Review my job'); click('Open estimate & client pack');
    expect(state().tab).toBe('results');
  });

  it('keeps a product draft when temporarily closing and reopening the guide', () => {
    const view = render(<GuidedSetup/>);
    fireEvent.change(screen.getByLabelText('Guide product name'), { target: { value: 'Draft only' } });
    click('Close guide'); view.unmount(); startGuidedSetup(); render(<GuidedSetup/>);
    expect((screen.getByLabelText('Guide product name') as HTMLInputElement).value).toBe('Draft only');
    expect(state().project.products[0]!.name).not.toBe('Draft only');
  });

  it('sets a separate underlay m² price without changing carpet price or inherited project defaults', () => {
    const defaults = structuredClone(state().project.options.underlay);
    render(<GuidedSetup/>);
    value('Guide price per m²', '25');
    fireEvent.change(screen.getByLabelText('Guide underlay price basis'), { target: { value: 'per_m2' } });
    value('Guide underlay price per m²', '5');
    expect(state().project.products[0]!.pricePerM2).not.toBe(25);
    click('Use this flooring');
    expect(state().project.products[0]).toMatchObject({ pricePerM2: 25, underlay: { fit: true, pricePerM2: 5 } });
    expect((state().project.products[0] as BroadloomProduct).underlay?.pricePerRoll).toBeUndefined();
    expect(state().project.options.underlay).toEqual(defaults);
    let roomId = ''; act(() => { roomId = state().addRoom(); });
    const estimate = estimateProject(state().project);
    expect(estimate.bom.find(line => line.category === 'underlay' && line.subjectIds.includes(roomId))).toMatchObject({ unit: 'roll', unitPrice: 75.35 });
    const carpet = estimate.bom.find(line => line.category === 'floor_covering')!;
    expect(carpet.unitPrice).toBe(100); // 4m carpet roll × £25/m², independent of the £5 underlay.
    const parsed = parseProject(serializeProject(state().project));
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(estimateProject(parsed.project).bom.find(line => line.category === 'underlay')?.unitPrice).toBe(75.35);
  });

  it('keeps multiple named flooring drafts across editing, closing and returning to the guide', () => {
    const original = structuredClone(state().project.products);
    const view = render(<GuidedSetup/>);
    value('Guide product name', 'Wool carpet'); value('Guide price per m²', '22');
    value('Guide underlay price per roll', '90');
    click('Add another flooring');
    fireEvent.change(screen.getByLabelText('Guide flooring type'), { target: { value: 'laminate' } });
    value('Guide product name', 'Oak laminate'); value('Guide pack coverage', '2'); value('Guide price per pack', '48');
    const oakId = useGuidedSetup.getState().flooringDrafts!.find(product => product.name === 'Oak laminate')!.id;
    click('Edit Wool carpet');
    expect((screen.getByLabelText('Guide price per m²') as HTMLInputElement).value).toBe('22');
    expect((screen.getByLabelText('Guide underlay price per roll') as HTMLInputElement).value).toBe('90');
    click('Edit Oak laminate');
    expect((screen.getByLabelText('Guide price per pack') as HTMLInputElement).value).toBe('48');
    fireEvent.change(screen.getByLabelText('Guide default flooring'), { target: { value: oakId } });
    click('Close guide'); view.unmount(); startGuidedSetup(); render(<GuidedSetup/>);
    expect(screen.getByRole('button', { name: 'Edit Wool carpet' })).toBeTruthy();
    expect((screen.getByLabelText('Guide price per pack') as HTMLInputElement).value).toBe('48');
    expect(state().project.products).toEqual(original);
    click('Continue with 2 flooring products');
    expect(state().project.products).toHaveLength(2);
    expect(state().project.products.find(product => product.id === oakId)).toMatchObject({ kind: 'laminate', packCoverageM2: 2, pricePerPack: 48 });
    expect(state().newSpaceProductId).toBe(oakId);
    click(/Enter room measurements/);
    expect(state().project.rooms[0]!.productId).toBe(oakId);
    const woolId = state().project.products.find(product => product.name === 'Wool carpet')!.id;
    fireEvent.change(screen.getByLabelText('Guide room flooring'), { target: { value: woolId } });
    click('Add room');
    expect(state().project.rooms[1]!.productId).toBe(woolId);
    const estimate = estimateProject(state().project);
    expect(estimate.bom.find(line => line.category === 'floor_covering' && line.subjectIds.includes(state().project.rooms[0]!.id))?.unitPrice).toBe(48);
    expect(estimate.bom.find(line => line.category === 'underlay' && line.subjectIds.includes(state().project.rooms[1]!.id))?.unitPrice).toBe(90);
  });

  it('removes a staged product with undo and does not delete saved products until continuing', () => {
    render(<GuidedSetup/>);
    click('Add another flooring'); value('Guide product name', 'Kitchen vinyl');
    click('Remove Kitchen vinyl');
    expect(screen.queryByRole('button', { name: 'Edit Kitchen vinyl' })).toBeNull();
    expect(state().project.products).toHaveLength(1);
    click('Undo removal');
    expect(screen.getByRole('button', { name: 'Edit Kitchen vinyl' })).toBeTruthy();
    click('Continue with 2 flooring products');
    expect(state().project.products).toHaveLength(2);
  });

  it('requires an explicit replacement before removing flooring already used by a room', () => {
    const originalId = state().project.products[0]!.id;
    const roomId = state().addRoom({ productId: originalId });
    const replacement = state().addProduct({ name: 'Oak replacement', kind: 'laminate', packCoverageM2: 2, pricePerPack: 48 });
    startGuidedSetup(); render(<GuidedSetup/>);
    click(`Remove ${state().project.products[0]!.name}`);
    expect(screen.getByLabelText('Guide replacement flooring')).toBeTruthy();
    click('Replace and remove');
    expect(state().project.rooms.find(room => room.id === roomId)!.productId).toBe(originalId);
    click('Use this flooring');
    expect(state().project.products.map(product => product.id)).toEqual([replacement]);
    expect(state().project.rooms.find(room => room.id === roomId)!.productId).toBe(replacement);
  });

  it('retains saved underlay prices when temporarily reusing existing underlay', () => {
    render(<GuidedSetup/>);
    value('Guide underlay price per roll', '84');
    fireEvent.click(screen.getByLabelText('Include underlay'));
    expect(screen.queryByLabelText('Guide underlay price per roll')).toBeNull();
    fireEvent.click(screen.getByLabelText('Include underlay'));
    expect((screen.getByLabelText('Guide underlay price per roll') as HTMLInputElement).value).toBe('84');
  });

  it('undoes a chained removal back to its previous replacement and product order', () => {
    const first = state().project.products[0]!;
    const roomId = state().addRoom({ productId: first.id });
    const second = state().addProduct({ name: 'Second carpet', kind: 'carpet', rollWidth: 4000, pricePerM2: 20 });
    state().addProduct({ name: 'Third carpet', kind: 'carpet', rollWidth: 4000, pricePerM2: 30 });
    startGuidedSetup(); render(<GuidedSetup/>);
    click(`Remove ${first.name}`); click('Replace and remove');
    click('Remove Second carpet'); click('Replace and remove');
    click('Undo removal');
    expect(useGuidedSetup.getState().flooringDrafts!.map(product => product.name)).toEqual(['Second carpet', 'Third carpet']);
    click('Continue with 2 flooring products');
    expect(state().project.rooms.find(room => room.id === roomId)!.productId).toBe(second);
  });

  it('round-trips the scaled drawing sheet in a project file', () => {
    state().addFloorPlan(blankHousePlan());
    const parsed = parseProject(serializeProject(state().project));
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.project.floorPlans[0]).toMatchObject({ mmPerPx: 20, sketch: { gridMm: 1000 }, widthPx: 1000, heightPx: 800 });
    expect(decodeURIComponent(parsed.project.floorPlans[0]!.imageDataUrl)).toContain('patternUnits="userSpaceOnUse"');
  });
});
