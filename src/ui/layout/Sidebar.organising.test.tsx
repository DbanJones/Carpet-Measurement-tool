import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { makeEmptyProject, STORAGE_KEY, useProjectStore } from '@store/projectStore';

const state = () => useProjectStore.getState();
beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({ project: makeEmptyProject(), revision: 0, tab: 'rooms', selection: { kind: 'none' }, newSpaceProductId: null });
});
afterEach(cleanup);
const listNames = (label: string) => [...screen.getByRole('list', { name: label }).querySelectorAll('.list-row-name')].map(node => node.textContent);

describe('organising from the sidebar', () => {
  it('offers crisp action buttons and renames and reorders floor plans while preserving their scale', () => {
    const first = state().addFloorPlan({ name: 'Ground floor', imageDataUrl: 'data:image/png;base64,AA==', widthPx: 100, heightPx: 100, mmPerPx: 20 });
    state().addFloorPlan({ name: 'Upper floor', imageDataUrl: 'data:image/png;base64,AA==', widthPx: 100, heightPx: 100 });
    render(<Sidebar/>);
    const action = screen.getByRole('button', { name: 'Floor plan 1 actions' });
    expect(action.querySelectorAll('svg circle')).toHaveLength(3);
    fireEvent.click(action);
    fireEvent.click(screen.getByRole('button', { name: 'Rename floor plan' }));
    fireEvent.change(screen.getByLabelText('Floor plan name'), { target: { value: 'Ground floor survey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(state().project.floorPlans[0]).toMatchObject({ id: first, name: 'Ground floor survey', mmPerPx: 20 });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder floor plan 2' }), { key: 'ArrowUp' });
    expect(listNames('Floor plans')).toEqual(['Upper floor', 'Ground floor survey']);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).project.floorPlans[1].id).toBe(first);
  });

  it('retains measured rooms and stairs when deleting their floor plan and clears only its associations', () => {
    const removed = state().addFloorPlan({ name: 'Old survey', imageDataUrl: 'data:image/png;base64,AA==', widthPx: 100, heightPx: 100 });
    const keep = state().addFloorPlan({ name: 'Keep survey', imageDataUrl: 'data:image/png;base64,AA==', widthPx: 100, heightPx: 100 });
    const pixelPolygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    state().addRoom({ source: { floorPlanId: removed, pixelPolygon } });
    state().addRoom({ source: { floorPlanId: keep, pixelPolygon } });
    state().addStaircase({ source: { floorPlanId: removed, pixelPolygon } });
    state().select({ kind: 'floorplan', id: removed });
    const before = structuredClone(state().project);
    render(<Sidebar/>);
    fireEvent.click(screen.getByRole('button', { name: 'Floor plan 1 actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete floor plan' }));
    expect(screen.getByText(/Rooms, stairs and their measurements stay/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
    expect(state().project.rooms).toHaveLength(2);
    expect(state().project.rooms[0]!.shape).toEqual(before.rooms[0]!.shape);
    expect(state().project.rooms[0]!.source).toBeUndefined();
    expect(state().project.rooms[1]!.source).toEqual(before.rooms[1]!.source);
    expect(state().project.staircases[0]!.steps).toEqual(before.staircases[0]!.steps);
    expect(state().project.staircases[0]!.source).toBeUndefined();
    expect(state().selection).toEqual({ kind: 'none' });
    expect(listNames('Floor plans')).toEqual(['Keep survey']);
  });

  it('moves a selected room with the keyboard while keeping its editor open and saves the order', () => {
    const first = state().addRoom({ name: 'Lounge' }); state().addRoom({ name: 'Kitchen' }); state().addRoom({ name: 'Hall' });
    state().select({ kind: 'room', id: first }); render(<Sidebar />);
    const handle = screen.getByRole('button', { name: 'Reorder room 1' }); handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(listNames('Rooms')).toEqual(['Kitchen', 'Lounge', 'Hall']);
    expect(state().selection).toEqual({ kind: 'room', id: first });
    expect(document.activeElement).toBe(handle);
    expect(screen.getByRole('button', { name: /Lounge/ }).getAttribute('aria-current')).toBe('true');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).project.rooms[1].id).toBe(first);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(listNames('Rooms')).toEqual(['Lounge', 'Kitchen', 'Hall']);
  });

  it('supports separate ordering of stairs and products from their row actions', () => {
    state().addStaircase({ name: 'Main stairs' }); state().addStaircase({ name: 'Loft stairs' });
    state().addProduct({ name: 'Wool', kind: 'carpet', rollWidth: 5000 }); render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Staircase 2 actions' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Actions for Loft stairs' })).getByRole('button', { name: /Move up/ }));
    expect(listNames('Stairs')).toEqual(['Loft stairs', 'Main stairs']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder product 2' }), { key: 'ArrowUp' });
    expect(listNames('Products')).toEqual(['Wool', 'Carpet (4 m roll)']);
    expect(listNames('Rooms')).toEqual([]);
  });

  it('allows cancellation before deleting a room and clears the deleted room selection', () => {
    const id = state().addRoom({ name: 'Lounge' }); render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Room 1 actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete room' }));
    expect(state().project.rooms).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state().selection).toEqual({ kind: 'room', id });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Room 1 actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Room 1 actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
    expect(state().project.rooms).toHaveLength(0);
    expect(state().selection).toEqual({ kind: 'none' });
    expect(screen.getByText('No rooms yet')).toBeTruthy();
  });

  it('deletes stairs from their row without disturbing an unrelated room selection', () => {
    state().addStaircase({ name: 'Loft' }); const room = state().addRoom(); render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Staircase 1 actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete staircase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
    expect(state().project.staircases).toHaveLength(0);
    expect(state().selection).toEqual({ kind: 'room', id: room });
  });

  it('explains product reassignment before confirming deletion', () => {
    const original = state().project.products[0]!.id;
    const replacement = state().addProduct({ name: 'Replacement carpet', kind: 'carpet', rollWidth: 4000 });
    state().addRoom({ productId: original }); state().addStaircase({ productId: original }); render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Product 1 actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete product' }));
    expect(screen.getByText(/2 spaces will switch to Replacement carpet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
    expect(state().project.rooms[0]!.productId).toBe(replacement);
    expect(state().project.staircases[0]!.productId).toBe(replacement);
  });

  it('warns that deleting the last product leaves spaces unassigned and closes actions with Escape', () => {
    state().addRoom(); render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Product 1 actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete product' }));
    expect(screen.getByText(/1 space will be left without a product/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Confirm deletion' }), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Confirm deletion' })).toBeNull();
    expect(state().project.products).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Product 1 actions' }));
  });
});
