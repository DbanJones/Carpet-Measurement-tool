import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useProjectStore, makeEmptyProject } from '@store/projectStore';
import { FloorPlanPanel } from './FloorPlanPanel';
import { isImageFile, isPdfFile, rasterFromSource } from './pdf';

// jsdom never loads images, so any string will do as the raster.
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const PIXEL_ROOM = [
  { x: 100, y: 50 },
  { x: 300, y: 50 },
  { x: 300, y: 200 },
  { x: 100, y: 200 },
];
const MM_ROOM = [
  { x: 0, y: 0 },
  { x: 2000, y: 0 },
  { x: 2000, y: 1500 },
  { x: 0, y: 1500 },
];

function resetStore() {
  useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' }, tab: 'floorplan', revision: 0 });
}
const state = () => useProjectStore.getState();
const addPlan = (mmPerPx?: number) =>
  state().addFloorPlan({ name: 'ground.png', imageDataUrl: PNG, widthPx: 400, heightPx: 300, ...(mmPerPx ? { mmPerPx } : {}) });
const addTracedRoom = (planId: string) =>
  state().addRoom({ name: 'Lounge', shape: { kind: 'polygon', points: MM_ROOM }, doorways: [], source: { floorPlanId: planId, pixelPolygon: PIXEL_ROOM } });
const plan = (id: string) => state().project.floorPlans.find((p) => p.id === id)!;

const overlay = () => screen.getByTestId('floorplan-overlay');
/** A click on the plan: pointer down + up at the same screen point. jsdom has no PointerEvent, so a MouseEvent carries the coordinates. */
function tap(x: number, y: number, init: MouseEventInit = {}) {
  const el = overlay();
  fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, ...init }));
  fireEvent(el, new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, ...init }));
}
const move = (x: number, y: number) => fireEvent(overlay(), new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
const key = (k: string) => fireEvent.keyDown(window, { key: k });
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const typeLength = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};

beforeEach(resetStore);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FloorPlanPanel', () => {
  it('shows the three-step guide and an upload control when there is no plan', () => {
    render(<FloorPlanPanel />);
    expect(screen.getByText(/Estate-agent plans are usually marked/)).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'How to use a floor plan' });
    expect(steps.querySelectorAll('li').length).toBe(3);
    const input = screen.getByLabelText('Upload a floor plan (PNG, JPG or PDF)') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/*,application/pdf');
    expect(screen.getByText(/No floor plan yet/)).toBeTruthy();
  });

  it('rejects an unsupported file with a visible error', async () => {
    render(<FloorPlanPanel />);
    const input = screen.getByLabelText('Upload a floor plan (PNG, JPG or PDF)');
    fireEvent.change(input, { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/notes\.txt.*not a supported file/);
    expect(state().project.floorPlans.length).toBe(0);
  });

  it('lists the plans, shows the image and warns when the scale is not set', () => {
    const id = addPlan();
    render(<FloorPlanPanel />);
    expect(screen.getByText('ground.png')).toBeTruthy();
    expect(screen.getByText(/400 × 300 px · needs scale/)).toBeTruthy();
    expect((screen.getByAltText('Floor plan: ground.png') as HTMLImageElement).src).toBe(PNG);
    expect(screen.getByTestId('scale-status').textContent).toMatch(/Not calibrated/);
    expect(state().selection).toEqual({ kind: 'floorplan', id });
  });

  it('removes a plan after confirmation', () => {
    addPlan();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Remove plan ground.png'));
    expect(state().project.floorPlans.length).toBe(0);
    expect(screen.getByText(/No floor plan yet/)).toBeTruthy();
  });

  it('calibrates the scale from two clicks and a typed distance, then moves on to tracing', () => {
    const id = addPlan();
    render(<FloorPlanPanel />);
    fireEvent.click(button('Set scale'));
    expect(button('Set scale').getAttribute('aria-pressed')).toBe('true');
    tap(0, 0);
    tap(200, 0);
    expect(screen.getByText(/2\/2 points · 200 px apart/)).toBeTruthy();
    typeLength(screen.getByLabelText('Real distance'), '2');
    fireEvent.click(button('Apply scale'));
    expect(plan(id).mmPerPx).toBe(10);
    expect(plan(id).calibration).toEqual({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, distance: 2000 });
    expect(screen.getByTestId('scale-status').textContent).toMatch(/1 px = 10\.0 mm · calibrated on 2\.00 m/);
    expect(screen.getByTestId('mode-trace')).toBeTruthy();
  });

  it('door-width presets apply straight away once two points are placed', () => {
    const id = addPlan();
    render(<FloorPlanPanel />);
    fireEvent.click(button('Set scale'));
    tap(10, 10);
    tap(10, 86.2);
    fireEvent.click(button('Standard door 762 mm'));
    expect(plan(id).mmPerPx).toBeCloseTo(10);
    expect(plan(id).calibration?.distance).toBe(762);
  });

  it('measures between two clicks in the display unit', () => {
    addPlan(10);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Measure'));
    tap(0, 0);
    tap(0, 150);
    expect(screen.getByTestId('measure-readout').textContent).toBe('1.50 m');
    act(() => state().updateProject({ displayUnit: 'imperial' }));
    expect(screen.getByTestId('measure-readout').textContent).toBe(`4' 11"`);
  });

  it('traces a room with orthogonal snapping and creates it in the store', () => {
    const planId = addPlan(10);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Trace room'));
    expect(screen.getByTestId('trace-status').textContent).toMatch(/^0 points/);
    tap(100, 50);
    tap(300, 53); // snapped to y = 50
    tap(300, 200);
    tap(100, 200);
    expect(screen.getByTestId('trace-status').textContent).toMatch(/^4 points/);
    expect(document.querySelector('.fp-trace polyline')?.getAttribute('points')).toBe('100,50 300,50 300,200 100,200');
    tap(103, 52); // near the first point: closes the outline
    expect(screen.getByTestId('trace-area').textContent).toBe('3.00 m²');
    expect((screen.getByLabelText('Room name') as HTMLInputElement).value).toBe('Room 1');
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Lounge' } });
    fireEvent.click(button('Create room'));

    const room = state().project.rooms[0]!;
    expect(room.name).toBe('Lounge');
    expect(room.productId).toBe(state().project.products[0]!.id);
    expect(room.shape).toEqual({ kind: 'polygon', points: MM_ROOM });
    expect(room.doorways).toEqual([]);
    expect(room.source).toEqual({ floorPlanId: planId, pixelPolygon: PIXEL_ROOM });
    // stays on the plan, ready for the next room, and the new room is drawn on the overlay
    expect(state().selection).toEqual({ kind: 'floorplan', id: planId });
    expect(screen.getByTestId('trace-status').textContent).toMatch(/^0 points/);
    expect(screen.getByTestId(`room-overlay-${room.id}`).textContent).toBe('Lounge');
    expect(screen.getByText(/Rooms traced on this plan \(1\)/)).toBeTruthy();
  });

  it('cannot create a room until the plan is calibrated', () => {
    addPlan();
    render(<FloorPlanPanel />);
    fireEvent.click(button('Trace room'));
    tap(0, 0);
    tap(100, 0);
    tap(100, 100);
    fireEvent.click(button('Close outline'));
    expect(screen.getByText(/Set the scale before creating the room/)).toBeTruthy();
    expect((button('Create room') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Enter closes the outline, Backspace undoes a point, Escape cancels', () => {
    addPlan(10);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Trace room'));
    tap(0, 0);
    tap(100, 0);
    tap(100, 100);
    key('Backspace');
    expect(screen.getByTestId('trace-status').textContent).toMatch(/^2 points/);
    tap(100, 100);
    key('Enter');
    expect(screen.getByTestId('trace-area').textContent).toBe('0.50 m²');
    key('Backspace'); // reopens the outline for editing
    expect(screen.getByTestId('trace-status').textContent).toMatch(/^3 points/);
    key('Escape');
    expect(screen.getByTestId('trace-status').textContent).toMatch(/^0 points/);
    expect(state().project.rooms.length).toBe(0);
  });

  it('Alt places a free point, and the snap toggle turns snapping off', () => {
    addPlan(10);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Trace room'));
    tap(100, 50);
    tap(150, 80, { altKey: true });
    expect(document.querySelector('.fp-trace polyline')?.getAttribute('points')).toBe('100,50 150,80');
    fireEvent.click(screen.getByLabelText('Orthogonal snap'));
    tap(200, 120);
    expect(document.querySelector('.fp-trace polyline')?.getAttribute('points')).toBe('100,50 150,80 200,120');
    // rubber band follows the pointer and reports the next side length
    move(200, 220);
    expect(screen.getByTestId('trace-status').textContent).toBe('3 points · next side 1.00 m');
  });

  it('ignores a repeated tap on the same spot (double-click) and closes on double-click', () => {
    addPlan(10);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Trace room'));
    tap(0, 0);
    tap(100, 0);
    tap(100, 100);
    tap(100, 100);
    expect(screen.getByTestId('trace-status').textContent).toMatch(/^3 points/);
    fireEvent.dblClick(overlay(), { clientX: 100, clientY: 100 });
    expect(screen.getByTestId('trace-area').textContent).toBe('0.50 m²');
  });

  it('marks a doorway on the nearest wall of a traced room', () => {
    const planId = addPlan(10);
    const roomId = addTracedRoom(planId);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Mark doorway'));
    expect((screen.getByLabelText('Doorway room') as HTMLSelectElement).value).toBe(roomId);
    tap(150, 52);
    tap(230, 48);
    const doorways = state().project.rooms[0]!.doorways;
    expect(doorways.length).toBe(1);
    expect(doorways[0]).toMatchObject({ edgeIndex: 0, offset: 500, width: 800, transition: 'carpet' });
    expect(screen.getByRole('status').textContent).toBe('Doorway of 0.80 m added to Lounge.');
    const line = document.querySelector('.fp-room .fp-door')!;
    expect([line.getAttribute('x1'), line.getAttribute('y1'), line.getAttribute('x2'), line.getAttribute('y2')]).toEqual(['150', '50', '230', '50']);
  });

  it('opens a traced room in the room editor from the overlay or the list', () => {
    const planId = addPlan(10);
    const roomId = addTracedRoom(planId);
    state().select({ kind: 'floorplan', id: planId });
    render(<FloorPlanPanel />);
    tap(50, 20); // outside the room: nothing happens
    expect(state().selection).toEqual({ kind: 'floorplan', id: planId });
    tap(200, 100); // inside
    expect(state().selection).toEqual({ kind: 'room', id: roomId });
    expect(state().tab).toBe('rooms');

    act(() => {
      state().select({ kind: 'floorplan', id: planId });
      state().setTab('floorplan');
    });
    fireEvent.click(button('Edit room Lounge'));
    expect(state().selection).toEqual({ kind: 'room', id: roomId });
    expect(state().tab).toBe('rooms');

    // the per-room shortcut jumps straight into doorway marking for that room
    act(() => state().select({ kind: 'floorplan', id: planId }));
    fireEvent.click(button('Mark doorway on Lounge'));
    expect(screen.getByTestId('mode-doorway')).toBeTruthy();
    expect((screen.getByLabelText('Doorway room') as HTMLSelectElement).value).toBe(roomId);
  });

  it('switches between plans from the list', () => {
    const a = addPlan(10);
    const b = state().addFloorPlan({ name: 'first-floor.png', imageDataUrl: PNG, widthPx: 500, heightPx: 200 });
    render(<FloorPlanPanel />);
    expect(screen.getByAltText('Floor plan: first-floor.png')).toBeTruthy();
    fireEvent.click(button('Open plan ground.png'));
    expect(state().selection).toEqual({ kind: 'floorplan', id: a });
    expect(screen.getByAltText('Floor plan: ground.png')).toBeTruthy();
    expect(screen.getByTestId('scale-status').textContent).toMatch(/1 px = 10\.0 mm/);
    fireEvent.click(button('Open plan first-floor.png'));
    expect(state().selection).toEqual({ kind: 'floorplan', id: b });
    expect(screen.getByTestId('scale-status').textContent).toMatch(/Not calibrated/);
  });

  it('zoom controls stay within 25%-400%', () => {
    addPlan(10);
    render(<FloorPlanPanel />);
    const readout = () => screen.getByTestId('zoom-readout').textContent;
    expect(readout()).toBe('100%');
    for (let i = 0; i < 10; i++) fireEvent.click(button('Zoom in'));
    expect(readout()).toBe('400%');
    expect((button('Zoom in') as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 20; i++) fireEvent.click(button('Zoom out'));
    expect(readout()).toBe('25%');
    expect((button('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button('Actual size'));
    expect(readout()).toBe('100%');
  });
});

describe('file helpers', () => {
  it('recognises PDFs and images by type or extension', () => {
    expect(isPdfFile({ type: 'application/pdf', name: 'plan' })).toBe(true);
    expect(isPdfFile({ type: '', name: 'Plan.PDF' })).toBe(true);
    expect(isPdfFile({ type: 'image/png', name: 'plan.png' })).toBe(false);
    expect(isImageFile({ type: 'image/jpeg', name: 'x' })).toBe(true);
    expect(isImageFile({ type: '', name: 'scan.JPG' })).toBe(true);
    expect(isImageFile({ type: 'text/plain', name: 'notes.txt' })).toBe(false);
  });
  it('rasterFromSource rejects an empty image', () => {
    expect(() => rasterFromSource(document.createElement('canvas'), 0, 0)).toThrow(/no size/);
  });
});
