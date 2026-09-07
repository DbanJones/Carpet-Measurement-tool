import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import { useProjectStore, makeEmptyProject } from '@store/projectStore';
import { FloorPlanPanel } from './FloorPlanPanel';
import { traceToPolygon } from './tracing';
import { isImageFile, isPdfFile, rasterFromSource } from './pdf';
import type { DetectedDoorway, DetectionResult } from './detection';
import { blankHousePlan } from '@ui/setup/blankHousePlan';
import type { SuggestedScale } from './automaticScale';
import { suggestedScaleSourceKey } from './useSuggestedScale';

const detector = vi.hoisted(() => ({ detect: vi.fn(), detectAll: vi.fn(), mode: null as 'room' | 'all' | null, progress: 0, reset: vi.fn(), busy: false, error: null as string | null }));
vi.mock('./useRoomDetection', () => ({ useRoomDetection: () => detector }));
const automaticScale = vi.hoisted(() => ({ suggestion: undefined as SuggestedScale | undefined, busy: false, error: null as string | null, retry: vi.fn(), reset: vi.fn() }));
vi.mock('./useSuggestedScale', async () => ({ ...await vi.importActual<typeof import('./useSuggestedScale')>('./useSuggestedScale'), useSuggestedScale: (_plan: unknown, options: { enabled: boolean }) => ({ ...automaticScale, suggestion: options.enabled ? automaticScale.suggestion : undefined }) }));

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const PIXEL_ROOM = [{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 200 }, { x: 100, y: 200 }];
const MM_ROOM = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1500 }, { x: 0, y: 1500 }];
const suggested: DetectionResult = { ok: true, polygon: PIXEL_ROOM, inferredGaps: [] };
const state = () => useProjectStore.getState();
const addPlan = (mmPerPx?: number, name = 'ground.png') => state().addFloorPlan({ name, imageDataUrl: PNG, widthPx: 400, heightPx: 300, ...(mmPerPx ? { mmPerPx } : {}) });
const addTracedRoom = (planId: string, name = 'Lounge') => state().addRoom({ name, shape: { kind: 'polygon', points: MM_ROOM }, doorways: [], source: { floorPlanId: planId, pixelPolygon: PIXEL_ROOM } });
const storedPlan = (id: string) => state().project.floorPlans.find((p) => p.id === id)!;
const overlay = () => screen.getByTestId('floorplan-overlay');
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const changeInput = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });
const submit = (name: string) => fireEvent.submit(input(name).closest('form')!);
const key = (value: string) => fireEvent.keyDown(window, { key: value });
const activeStep = () => screen.getByRole('list', { name: 'Floor plan progress' }).querySelector('[aria-current="step"]')?.textContent;

/** Real down/up gesture; jsdom has no PointerEvent implementation. */
function tap(x: number, y: number, init: MouseEventInit = {}) {
  for (const type of ['pointerdown', 'pointerup']) fireEvent(overlay(), new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init }));
}
function traceRoom() {
  fireEvent.click(button('Draw outline'));
  for (const point of PIXEL_ROOM) tap(point.x, point.y);
  fireEvent.click(button('Finish outline'));
}
function selectListedRoom(name: string) {
  fireEvent.click(within(screen.getByRole('list', { name: 'Rooms on this plan' })).getByRole('button', { name: new RegExp(name) }));
}

beforeEach(() => {
  useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' }, tab: 'floorplan', revision: 0, newSpaceProductId: null });
  detector.detect.mockReset().mockResolvedValue({ ok: false, reason: 'Could not find a closed room. Use Rectangle or Draw outline.' });
  detector.detectAll.mockReset().mockResolvedValue({ ok: true, candidates: [], message: 'No new rooms found.', omitted: 0, truncated: false });
  detector.reset.mockReset(); detector.busy = false; detector.error = null;
  automaticScale.suggestion = undefined; automaticScale.busy = false; automaticScale.error = null; automaticScale.retry.mockReset(); automaticScale.reset.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('FloorPlanPanel guided workflow', () => {
  const setScaleSuggestion = (id: string) => {
    automaticScale.suggestion = { a: PIXEL_ROOM[0]!, b: PIXEL_ROOM[1]!, distance: 2000, mmPerPx: 10, polygon: PIXEL_ROOM, roomName: 'Lounge', printedLabel: '2 m × 1.5 m', checkLabel: 'Both printed dimensions agree with the wall spans.', matchedRooms: 1, sourceKey: suggestedScaleSourceKey(storedPlan(id)) };
  };

  it('previews an automatic scale and only applies it after confirmation, then finds rooms for review', async () => {
    const id = addPlan(); setScaleSuggestion(id);
    detector.detectAll.mockResolvedValue({ ok: true, candidates: [suggested], message: '', omitted: 0, truncated: false });
    render(<FloorPlanPanel />);
    expect(screen.getByTestId('automatic-scale-suggestion').textContent).toContain('2 m × 1.5 m');
    expect(screen.getByTestId('draft-scale-reference').textContent).toContain('2.00 m · Not saved');
    expect(screen.getByTestId('scale-canvas-instruction').textContent).toContain('awaiting confirmation');
    expect(storedPlan(id).mmPerPx).toBeUndefined();
    expect(storedPlan(id).calibration).toBeUndefined();
    expect(detector.detectAll).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(button('Confirm scale & find rooms')); });
    expect(storedPlan(id)).toMatchObject({ mmPerPx: 10, calibration: { a: PIXEL_ROOM[0], b: PIXEL_ROOM[1], distance: 2000 } });
    expect(detector.detectAll).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('mode-detected-rooms')).toBeTruthy();
    expect(state().project.rooms).toHaveLength(0);
  });

  it('lets manual points take over without a late scale suggestion replacing the chosen length', () => {
    const id = addPlan(); setScaleSuggestion(id);
    const view = render(<FloorPlanPanel />);
    tap(100, 50);
    expect(screen.queryByTestId('automatic-scale-suggestion')).toBeNull();
    expect(automaticScale.reset).toHaveBeenCalled();
    setScaleSuggestion(id); view.rerender(<FloorPlanPanel />);
    expect(screen.queryByTestId('automatic-scale-suggestion')).toBeNull();
    tap(300, 50); changeInput('Known distance', '3m'); submit('Known distance');
    expect(storedPlan(id).mmPerPx).toBe(15);
    expect(detector.detectAll).not.toHaveBeenCalled();
  });

  it('offers a manual fallback for unreadable text and refuses a stale automatic reference', () => {
    const id = addPlan(); automaticScale.error = 'No reliable printed room dimensions were found.';
    const view = render(<FloorPlanPanel />);
    expect(screen.getByText(automaticScale.error)).toBeTruthy();
    fireEvent.click(button('Set scale manually'));
    expect(screen.getByText('Mark a known wall length')).toBeTruthy();
    automaticScale.error = null; setScaleSuggestion(id);
    fireEvent.click(button('Try automatic scale'));
    act(() => state().updateFloorPlan(id, { imageDataUrl: 'data:image/png;base64,different' }));
    view.rerender(<FloorPlanPanel />);
    fireEvent.click(button('Confirm scale & find rooms'));
    expect(storedPlan(id).mmPerPx).toBeUndefined();
    expect(detector.detectAll).not.toHaveBeenCalled();
  });

  it('keeps an existing scale until an automatic replacement is explicitly requested and confirmed', async () => {
    const id = addPlan(20); addTracedRoom(id); setScaleSuggestion(id);
    const before = state().project.rooms[0]!.shape;
    render(<FloorPlanPanel />);
    fireEvent.click(button('Change scale'));
    expect(screen.queryByTestId('automatic-scale-suggestion')).toBeNull();
    fireEvent.click(button('Try automatic scale'));
    expect(screen.getByTestId('automatic-scale-suggestion')).toBeTruthy();
    expect(storedPlan(id).mmPerPx).toBe(20);
    await act(async () => { fireEvent.click(button('Confirm scale & find rooms')); });
    expect(storedPlan(id).mmPerPx).toBe(10);
    expect(state().project.rooms[0]!.shape).toEqual(before);
  });

  it('includes recognised door symbols by default, respects exclusions, and links both sides of a shared opening', async () => {
    const id = addPlan(10);
    state().updateFloorPlan(id, { heightPx: 450 });
    const upper: DetectedDoorway = { a: { x: 150, y: 50 }, b: { x: 230, y: 50 }, evidence: 'swing-arc', confidence: 'high' };
    const shared: DetectedDoorway = { ...upper, a: { x: 150, y: 200 }, b: { x: 230, y: 200 } };
    const second = PIXEL_ROOM.map(p => ({ x: p.x, y: p.y + 160 }));
    detector.detectAll.mockResolvedValue({ ok: true, candidates: [
      { ...suggested, detectedDoorways: [upper, shared], inferredGaps: [{ a: { x: 100, y: 90 }, b: { x: 100, y: 150 } }] },
      { ...suggested, polygon: second, detectedDoorways: [shared] },
    ], message: '', omitted: 0, truncated: false });
    render(<FloorPlanPanel />);
    await act(async () => { fireEvent.click(button('Detect all rooms')); });
    expect(state().project.rooms).toHaveLength(0);
    const unwanted = screen.getByRole('checkbox', { name: 'Include doorway D1 in Room 1' }) as HTMLInputElement;
    expect(unwanted.checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Include doorway D2 in Room 1' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(unwanted);
    expect(document.querySelector('[data-room-name="Room 1"][data-door-index="0"]')?.getAttribute('data-included')).toBe('false');
    fireEvent.click(button('Add 2 selected rooms'));
    const rooms = state().project.rooms;
    expect(rooms.map(room => room.doorways.length)).toEqual([1, 1]);
    expect(rooms[0]!.doorways[0]).toMatchObject({ edgeIndex: 2, offset: 700, width: 800 });
    expect(rooms[1]!.doorways[0]).toMatchObject({ edgeIndex: 0, offset: 500, width: 800 });
    expect(rooms[0]!.doorways[0]!.sharedOpeningId).toBe(rooms[1]!.doorways[0]!.sharedOpeningId);
  });

  it('keeps a doorway exclusion while editing an unrelated outline corner', async () => {
    addPlan(10);
    const door: DetectedDoorway = { a: { x: 150, y: 50 }, b: { x: 230, y: 50 }, evidence: 'swing-arc', confidence: 'high' };
    detector.detectAll.mockResolvedValue({ ok: true, candidates: [{ ...suggested, detectedDoorways: [door] }], message: '', omitted: 0, truncated: false });
    render(<FloorPlanPanel />);
    await act(async () => { fireEvent.click(button('Detect all rooms')); });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include doorway D1 in Room 1' }));
    fireEvent.click(button('Edit detected outline'));
    fireEvent.change(screen.getByLabelText('Selected corner'), { target: { value: '2' } });
    key('ArrowRight');
    expect((screen.getByRole('checkbox', { name: 'Include doorway D1 in Room 1' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(button('Save room suggestion'));
    expect((screen.getByRole('checkbox', { name: 'Include doorway D1 in Room 1' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(button('Add 1 selected room'));
    expect(state().project.rooms[0]!.doorways).toEqual([]);
  });

  it('restores doorway evidence when a corner is moved away and then returned before saving', async () => {
    addPlan(10);
    const door: DetectedDoorway = { a: { x: 150, y: 50 }, b: { x: 230, y: 50 }, evidence: 'swing-arc', confidence: 'high' };
    detector.detectAll.mockResolvedValue({ ok: true, candidates: [{ ...suggested, detectedDoorways: [door] }], message: '', omitted: 0, truncated: false });
    render(<FloorPlanPanel />);
    await act(async () => { fireEvent.click(button('Detect all rooms')); });
    fireEvent.click(button('Edit detected outline'));
    fireEvent.change(screen.getByLabelText('Selected corner'), { target: { value: '0' } });
    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: 'ArrowDown', shiftKey: true });
    expect(screen.queryByRole('checkbox', { name: 'Include doorway D1 in Room 1' })).toBeNull();
    expect(screen.getByText(/suggestion no longer matches the moved wall/)).toBeTruthy();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    expect((screen.getByRole('checkbox', { name: 'Include doorway D1 in Room 1' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(button('Save room suggestion'));
    fireEvent.click(button('Add 1 selected room'));
    expect(state().project.rooms[0]!.doorways).toHaveLength(1);
    expect(state().project.rooms[0]!.doorways[0]!.width).toBe(800);
  });

  it('reviews all detected rooms, accepts a chosen subset with its product, and never invents doorways', async () => {
    const id = addPlan(10);
    const second = PIXEL_ROOM.map(p => ({ x: p.x + 210, y: p.y }));
    act(() => state().updateFloorPlan(id, { widthPx: 700 }));
    detector.detectAll.mockResolvedValue({ ok: true, candidates: [suggested, { ...suggested, polygon: second }], message: 'Two suggestions.', omitted: 0, truncated: false });
    render(<FloorPlanPanel />);
    await act(async () => { fireEvent.click(button('Detect all rooms')); });
    expect(state().project.rooms).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Review detected room/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include detected room 2: Room 2' }));
    changeInput('Detected room name', 'My living room');
    let product = ''; act(() => { product = state().addProduct({ name: 'Wool', kind: 'carpet', rollWidth: 5000 }); });
    act(() => state().updateFloorPlan(id, { reading: { source: 'pdf', text: 'Lounge\n2m × 1.5m', lines: [{ text: 'Lounge', x: 160, y: 90, width: 80, height: 15, confidence: 100 }, { text: '2m × 1.5m', x: 160, y: 120, width: 90, height: 15, confidence: 100 }] } }));
    expect(input('Detected room name').value).toBe('My living room');
    expect(screen.getByTestId('plan-dimension-check').textContent).toContain('Dimensions look consistent');
    fireEvent.change(screen.getByLabelText('Detected rooms floor covering'), { target: { value: product } });
    fireEvent.click(button('Add 1 selected room'));
    expect(state().project.rooms).toHaveLength(1);
    expect(state().project.rooms[0]).toMatchObject({ name: 'My living room', productId: product, doorways: [], source: { floorPlanId: id, pixelPolygon: PIXEL_ROOM } });
    expect(screen.queryByTestId('mode-detected-rooms')).toBeNull();
  });

  it('edits a detected outline as a suggestion before accepting rooms', async () => {
    addPlan(10); detector.detectAll.mockResolvedValue({ ok: true, candidates: [suggested], message: '', omitted: 0, truncated: false });
    render(<FloorPlanPanel />); await act(async () => { fireEvent.click(button('Detect all rooms')); });
    fireEvent.click(button('Edit detected outline'));
    fireEvent.change(screen.getByLabelText('Selected corner'), { target: { value: '0' } });
    key('ArrowRight'); changeInput('Room name', 'Measured lounge');
    fireEvent.click(button('Save room suggestion'));
    expect(state().project.rooms).toHaveLength(0);
    expect(input('Detected room name').value).toBe('Measured lounge');
    fireEvent.click(button('Add 1 selected room'));
    const points = state().project.rooms[0]!.source!.pixelPolygon;
    expect(points[0]!.x).toBeGreaterThan(100);
    expect(points.slice(1)).toEqual(PIXEL_ROOM.slice(1));
  });

  it('keeps the batch covering when cancelling a candidate edit and clears suggestions for a replaced image', async () => {
    const id = addPlan(10);
    const product = state().addProduct({ name: 'Another carpet', kind: 'carpet', rollWidth: 5000 });
    detector.detectAll.mockResolvedValue({ ok: true, candidates: [suggested], message: '', omitted: 0, truncated: false });
    render(<FloorPlanPanel />); await act(async () => { fireEvent.click(button('Detect all rooms')); });
    fireEvent.change(screen.getByLabelText('Detected rooms floor covering'), { target: { value: product } });
    fireEvent.click(button('Edit detected outline'));
    expect(screen.queryByLabelText('Floor covering', { exact: true })).toBeNull();
    fireEvent.click(button('Back to suggestions'));
    expect((screen.getByLabelText('Detected rooms floor covering') as HTMLSelectElement).value).toBe(product);
    act(() => state().updateFloorPlan(id, { imageDataUrl: 'data:image/png;base64,replacement' }));
    expect(screen.queryByTestId('mode-detected-rooms')).toBeNull();
    expect(state().project.rooms).toHaveLength(0);
  });

  it('excludes existing outlines from the scan and rejects stale overlapping results at acceptance', async () => {
    const id = addPlan(10); addTracedRoom(id);
    detector.detectAll.mockResolvedValue({ ok: true, candidates: [suggested], message: '', omitted: 0, truncated: false });
    render(<FloorPlanPanel />); await act(async () => { fireEvent.click(button('Detect all rooms')); });
    expect(detector.detectAll).toHaveBeenCalledWith({ excludePolygons: [PIXEL_ROOM] });
    expect(button('Add 1 selected room').disabled).toBe(true);
    expect(screen.getByText(/Overlaps Lounge/)).toBeTruthy();
    fireEvent.click(button('Discard suggestions'));
    expect(state().project.rooms).toHaveLength(1);
  });

  it('fills a waiting draft name when OCR arrives but preserves typed names', () => {
    const id = addPlan(10); render(<FloorPlanPanel />); traceRoom();
    act(() => state().updateFloorPlan(id, { reading: { source: 'ocr', text: 'Lounge', lines: [{ text: 'Lounge', x: 160, y: 90, width: 80, height: 15, confidence: 98 }] } }));
    expect(input('Room name').value).toBe('Lounge');
    changeInput('Room name', 'Family room');
    act(() => state().updateFloorPlan(id, { reading: { source: 'ocr', text: 'Kitchen', lines: [{ text: 'Kitchen', x: 160, y: 90, width: 80, height: 15, confidence: 98 }] } }));
    expect(input('Room name').value).toBe('Family room');
  });

  it('does not restore an abandoned all-room scan after a tool switch', async () => {
    addPlan(10);
    let finish!: (value: unknown) => void;
    detector.detectAll.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<FloorPlanPanel />); fireEvent.click(button('Detect all rooms'));
    fireEvent.click(button('Rectangle'));
    await act(async () => finish({ ok: true, candidates: [suggested], message: '', omitted: 0, truncated: false }));
    expect(screen.queryByTestId('mode-detected-rooms')).toBeNull();
    expect(state().project.rooms).toHaveLength(0);
  });
  it('starts a scaled blank house without an upload and hides image-only tools', () => {
    render(<FloorPlanPanel />);
    fireEvent.click(button('Draw a house without a plan'));
    expect(state().project.floorPlans[0]).toMatchObject({ mmPerPx: 20, sketch: { gridMm: 1000 } });
    expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Detect room' })).toBeNull();
    expect(screen.queryByText('Read text from plan')).toBeNull();
    expect(screen.getByText('Draw your house, one room at a time')).toBeTruthy();
  });

  it('sets exact room dimensions on the blank canvas and continues drawing from the saved room', () => {
    state().addFloorPlan(blankHousePlan()); render(<FloorPlanPanel />);
    tap(50, 50); tap(250, 200);
    const length = input('Sketch room length'); fireEvent.change(length, { target: { value: '5m' } }); fireEvent.blur(length);
    changeInput('Room name', 'Lounge'); submit('Room name');
    const room = state().project.rooms[0]!;
    expect(room.shape).toEqual({ kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }] });
    expect(room.source?.pixelPolygon).toEqual([{ x: 50, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 200 }, { x: 50, y: 200 }]);
    selectListedRoom('Lounge'); fireEvent.click(button('Add another room'));
    expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
    tap(300, 50); tap(500, 200); changeInput('Room name', 'Dining'); submit('Room name');
    expect(state().project.rooms).toHaveLength(2);
    expect(detector.detect).not.toHaveBeenCalled();
  });

  it('rejects a measured room that reaches outside the blank drawing sheet', () => {
    state().addFloorPlan(blankHousePlan()); render(<FloorPlanPanel />); tap(50, 50); tap(250, 200);
    const length = input('Sketch room length'); fireEvent.change(length, { target: { value: '30m' } }); fireEvent.blur(length);
    expect(button('Add room').disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('outside the drawing sheet');
    submit('Room name'); expect(state().project.rooms).toHaveLength(0);
  });

  it('retains millimetre precision when typing dimensions on the 20mm-per-pixel sketch', () => {
    state().addFloorPlan(blankHousePlan()); render(<FloorPlanPanel />); tap(50, 50); tap(250, 200);
    const length = input('Sketch room length'); fireEvent.change(length, { target: { value: '5001mm' } }); fireEvent.blur(length);
    submit('Room name');
    const shape = state().project.rooms[0]!.shape;
    expect(shape.kind).toBe('polygon');
    if (shape.kind === 'polygon') expect(Math.max(...shape.points.map(p => p.x))).toBeCloseTo(5001, 6);
  });

  it.each([false, true])('adopts a new flooring choice on plan reentry unless an outline is pending (%s)', (pending) => {
    addPlan(10);
    const original = state().project.products[0]!.id;
    const view = render(<FloorPlanPanel />);
    traceRoom();
    if (!pending) submit('Room name');
    view.unmount();
    const chosen = state().addProduct({ name: 'Different carpet', kind: 'carpet', rollWidth: 5000 });
    state().setNewSpaceProduct(chosen);
    render(<FloorPlanPanel />);
    if (!pending) {
      fireEvent.click(button('Draw outline'));
      tap(5, 5); tap(50, 5); tap(50, 40); tap(5, 40);
      fireEvent.click(button('Finish outline'));
    }
    expect((screen.getByLabelText('Floor covering') as HTMLSelectElement).value).toBe(pending ? original : chosen);
  });
  it('starts with one upload action and four ordered stages', () => {
    render(<FloorPlanPanel />);
    const steps = screen.getByRole('list', { name: 'Floor plan progress' });
    expect([...steps.querySelectorAll('b')].map((item) => item.textContent)).toEqual(['Upload', 'Set scale', 'Add rooms', 'Review']);
    expect(activeStep()).toMatch(/Upload/);
    expect(button('Choose a floor plan')).toBeTruthy();
    expect(input('Upload a floor plan (PNG, JPG or PDF)').accept).toBe('image/*,application/pdf');
    expect(screen.getByText(/printed room dimensions to suggest a scale for you to confirm/)).toBeTruthy();
  });

  it('rejects an unsupported upload without changing the project', async () => {
    render(<FloorPlanPanel />);
    fireEvent.change(input('Upload a floor plan (PNG, JPG or PDF)'), { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/notes\.txt.*not a supported file/);
    expect(state().project.floorPlans).toHaveLength(0);
  });

  it('opens an uncalibrated plan in focused scale setup and hides unrelated tools', () => {
    addPlan(); render(<FloorPlanPanel />);
    expect(screen.getByTestId('mode-scale')).toBeTruthy();
    expect(activeStep()).toMatch(/Set scale/);
    expect(screen.queryByLabelText('Known distance')).toBeNull();
    for (const label of ['Detect room', 'Detect all rooms', 'Rectangle', 'Draw outline', 'Select room', 'Measure']) expect(screen.queryByRole('button', { name: label })).toBeNull();
    expect(screen.getByAltText('Floor plan: ground.png')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose a floor plan' })).toBeNull();
  });

  it('focuses the known length after two points and submits straight into detection', () => {
    const id = addPlan(); render(<FloorPlanPanel />);
    tap(0, 0); tap(200, 0);
    expect(document.activeElement).toBe(input('Known distance'));
    changeInput('Known distance', '200cm');
    // Native form submission is also what Enter in this focused input invokes in the browser.
    submit('Known distance');
    expect(storedPlan(id).mmPerPx).toBe(10);
    expect(storedPlan(id).calibration).toEqual({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, distance: 2000 });
    expect(screen.getByTestId('mode-detect')).toBeTruthy();
    expect(activeStep()).toMatch(/Add rooms/);
    expect(screen.getByTestId('scale-status').textContent).toMatch(/Scale set from 2\.00 m/);
    expect(button('Rectangle').disabled).toBe(false);
  });

  it('requires a positive distance and distinct calibration endpoints', () => {
    const id = addPlan(); render(<FloorPlanPanel />);
    tap(100, 100); tap(100, 100);
    changeInput('Known distance', '0');
    expect(button('Set scale & continue').disabled).toBe(true);
    changeInput('Known distance', '2');
    submit('Known distance');
    expect(storedPlan(id).mmPerPx).toBeUndefined();
    expect(screen.getByText(/Choose two different points/)).toBeTruthy();
  });

  it('creates a rectangle with two corner taps, then confirms the name and floor covering', () => {
    const planId = addPlan(10);
    const extra = state().addProduct({ ...state().project.products[0]!, id: 'bedroom-carpet', name: 'Bedroom carpet' });
    render(<FloorPlanPanel />);
    expect(screen.getByTestId('mode-detect')).toBeTruthy();
    fireEvent.click(button('Rectangle')); tap(100, 50); tap(300, 200);
    expect(screen.getByTestId('trace-area').textContent).toBe('3.00 m²');
    expect(state().project.rooms).toHaveLength(0);
    expect(document.activeElement).toBe(input('Room name'));
    changeInput('Room name', 'Bedroom');
    fireEvent.change(screen.getByLabelText('Floor covering'), { target: { value: extra } });
    submit('Room name');
    expect(state().project.rooms[0]).toMatchObject({ name: 'Bedroom', productId: extra, shape: { kind: 'polygon', points: MM_ROOM }, source: { floorPlanId: planId, pixelPolygon: PIXEL_ROOM } });
    expect(state().selection).toEqual({ kind: 'floorplan', id: planId });
    expect(state().tab).toBe('floorplan');
    expect(screen.getByTestId('trace-status').textContent).toBe('0 corners placed');
    tap(30, 30); tap(80, 80);
    expect((screen.getByLabelText('Floor covering') as HTMLSelectElement).value).toBe(extra);
  });

  it('rejects a zero-width rectangle and keeps its first corner ready for correction', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Rectangle')); tap(100, 50); tap(100, 200);
    expect(screen.getByText(/Choose the opposite corner/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add room' })).toBeNull();
    tap(300, 200);
    expect(screen.getByTestId('trace-area').textContent).toBe('3.00 m²');
  });

  it('traces square walls, closes at the first corner, and retains a renamed draft when continued', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline'));
    tap(100, 50); tap(300, 53); tap(300, 200); tap(100, 200);
    expect(document.querySelector('.fp-trace polyline')?.getAttribute('points')).toBe('100,50 300,50 300,200 100,200');
    tap(103, 52);
    changeInput('Room name', 'Saved lounge');
    fireEvent.click(button('Continue outline'));
    expect(screen.getByTestId('trace-status').textContent).toBe('4 corners placed');
    fireEvent.click(button('Finish outline'));
    expect(input('Room name').value).toBe('Saved lounge');
    submit('Room name');
    expect(state().project.rooms[0]?.name).toBe('Saved lounge');
  });

  it('keeps outline state when the active drawing method is pressed again', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline')); tap(100, 50); tap(300, 50);
    fireEvent.click(button('Draw outline'));
    expect(screen.getByTestId('trace-status').textContent).toBe('2 corners placed');
    expect(button('Rectangle').disabled).toBe(true);
  });

  it('keeps an unfinished outline recoverable when leaving the drawing tool', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline')); tap(100, 50); tap(300, 50); tap(300, 200);
    fireEvent.click(button('Select room'));
    expect(button('Detect room').disabled).toBe(true);
    expect(button('Rectangle').disabled).toBe(true);
    fireEvent.click(button('Continue saved outline'));
    expect(screen.getByTestId('mode-trace')).toBeTruthy();
    expect(screen.getByTestId('trace-status').textContent).toBe('3 corners placed');
  });

  it('preserves a named draft through measurement and component navigation', () => {
    addPlan(10); const view = render(<FloorPlanPanel />);
    traceRoom(); changeInput('Room name', 'Keep this outline');
    fireEvent.click(button('Measure')); tap(0, 0); tap(0, 150);
    expect(screen.getByTestId('measure-readout').textContent).toBe('1.50 m');
    act(() => state().setTab('results'));
    view.unmount();
    act(() => state().setTab('floorplan'));
    render(<FloorPlanPanel />);
    expect(screen.getByTestId('mode-measure')).toBeTruthy();
    expect(screen.getByTestId('measure-readout').textContent).toBe('1.50 m');
    fireEvent.click(button('Continue saved outline'));
    expect(input('Room name').value).toBe('Keep this outline');
    expect(screen.getByTestId('trace-area').textContent).toBe('3.00 m²');
    expect(state().project.rooms).toHaveLength(0);
  });

  it('recalibrates a draft while retaining existing rooms at their saved dimensions', () => {
    const planId = addPlan(10); addTracedRoom(planId);
    render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline'));
    // Start outside the existing room: tapping an added room now selects it in every empty drawing tool.
    tap(0, 0); tap(200, 0); tap(200, 150); tap(0, 150);
    fireEvent.click(button('Finish outline')); changeInput('Room name', 'New kitchen');
    fireEvent.click(button('Change scale'));
    expect(screen.getByText(/existing rooms keep their saved measurements/)).toBeTruthy();
    tap(0, 0); tap(200, 0); changeInput('Known distance', '4'); submit('Known distance');
    expect(storedPlan(planId).mmPerPx).toBe(20);
    expect(input('Room name').value).toBe('New kitchen');
    expect(screen.getByTestId('trace-area').textContent).toBe('12.00 m²');
    expect(state().project.rooms[0]?.shape).toEqual({ kind: 'polygon', points: MM_ROOM });
  });

  it('disables saving a crossing outline and allows correction', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline')); fireEvent.click(screen.getByLabelText('Square walls'));
    tap(0, 0); tap(200, 100); tap(0, 100); tap(100, 0);
    fireEvent.click(button('Finish outline'));
    expect(screen.getByRole('alert').textContent).toMatch(/crosses itself or has no area/);
    expect(button('Add room').disabled).toBe(true);
    expect(state().project.rooms).toHaveLength(0);
  });

  it('offers keyboard close, undo and discard without intercepting typing in the name input', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline')); tap(0, 0); tap(100, 0); tap(100, 100);
    key('Backspace'); expect(screen.getByTestId('trace-status').textContent).toBe('2 corners placed');
    tap(100, 100); key('Enter');
    expect(screen.getByTestId('trace-area').textContent).toBe('0.50 m²');
    fireEvent.keyDown(input('Room name'), { key: 'Backspace' });
    expect(screen.getByTestId('mode-review-outline')).toBeTruthy();
    key('Backspace'); expect(screen.getByTestId('trace-status').textContent).toBe('3 corners placed');
    key('Escape'); expect(screen.getByTestId('trace-status').textContent).toBe('0 corners placed');
  });

  it('supports diagonal corners and ignores repeated corner taps before double-click closure', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline')); tap(100, 50); tap(150, 80, { altKey: true });
    fireEvent.click(screen.getByLabelText('Square walls')); tap(200, 120); tap(200, 120);
    expect(document.querySelector('.fp-trace polyline')?.getAttribute('points')).toBe('100,50 150,80 200,120');
    fireEvent.dblClick(overlay(), { clientX: 200, clientY: 120 });
    expect(screen.getByTestId('mode-review-outline')).toBeTruthy();
  });

  it('lets a reviewed corner be dragged before the room is confirmed', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Rectangle')); tap(100, 50); tap(300, 200);
    for (const [type, x, y] of [['pointerdown', 300, 200], ['pointermove', 350, 200], ['pointerup', 350, 200]] as const) {
      fireEvent(overlay(), new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
    }
    expect(screen.getByTestId('trace-area').textContent).toBe('3.38 m²');
    submit('Room name');
    expect(state().project.rooms[0]?.source?.pixelPolygon[2]).toEqual({ x: 350, y: 200 });
  });

  it('selects an existing room in place, with an explicit full-editor action', () => {
    const planId = addPlan(10); const roomId = addTracedRoom(planId);
    state().select({ kind: 'floorplan', id: planId });
    render(<FloorPlanPanel />);
    tap(200, 100);
    expect(screen.getByTestId('mode-select')).toBeTruthy();
    expect(input('Selected room name').value).toBe('Lounge');
    expect(state().selection).toEqual({ kind: 'floorplan', id: planId });
    expect(state().tab).toBe('floorplan');
    expect(detector.detect).not.toHaveBeenCalled();
    changeInput('Selected room name', 'Living room');
    expect(state().project.rooms[0]?.name).toBe('Living room');
    fireEvent.click(button(/Open full room editor/));
    expect(state().selection).toEqual({ kind: 'room', id: roomId });
    expect(state().tab).toBe('rooms');
  });

  it.each(['Rectangle', 'Draw outline'])('selects a saved room from an empty %s tool without starting another outline', (method) => {
    const planId = addPlan(10); addTracedRoom(planId);
    state().select({ kind: 'floorplan', id: planId });
    render(<FloorPlanPanel />);
    fireEvent.click(button(method)); tap(200, 100);
    expect(screen.getByTestId('mode-select')).toBeTruthy();
    expect(input('Selected room name').value).toBe('Lounge');
    expect(screen.queryByRole('button', { name: 'Continue saved outline' })).toBeNull();
    expect(state().tab).toBe('floorplan');
    expect(state().project.rooms).toHaveLength(1);
  });

  it('targets the chosen room for doorways and requires confirming the projected opening', () => {
    const planId = addPlan(10); addTracedRoom(planId); const bedroomId = addTracedRoom(planId, 'Bedroom');
    render(<FloorPlanPanel />); selectListedRoom('Bedroom'); fireEvent.click(button('Mark doorway'));
    expect(screen.getByTestId(`room-overlay-${bedroomId}`).classList.contains('active')).toBe(true);
    tap(150, 52); tap(230, 48);
    expect(state().project.rooms.every((room) => room.doorways.length === 0)).toBe(true);
    expect(screen.getByText('0.80 m')).toBeTruthy();
    fireEvent.click(button('Add doorway'));
    expect(state().project.rooms[0]?.doorways).toHaveLength(0);
    expect(state().project.rooms[1]?.doorways[0]).toMatchObject({ edgeIndex: 0, offset: 500, width: 800, transition: 'carpet' });
    fireEvent.click(button('Done with doorways'));
    fireEvent.click(button('Remove opening 1 from Bedroom'));
    expect(state().project.rooms[1]?.doorways).toHaveLength(0);
  });

  it('straightens a detected door-swing recess on confirmation and retains another doorway', () => {
    const planId=addPlan(10);
    const points=[{x:100,y:50},{x:350,y:50},{x:350,y:250},{x:260,y:250},{x:252,y:220},{x:225,y:185},{x:180,y:170},{x:180,y:250},{x:100,y:250}];
    const id=state().addRoom({name:'Lounge',shape:{kind:'polygon',points:traceToPolygon(points,10)},source:{floorPlanId:planId,pixelPolygon:points},doorways:[{id:'old',edgeIndex:0,offset:100,width:600,transition:'carpet'}]});
    render(<FloorPlanPanel/>); selectListedRoom('Lounge'); fireEvent.click(button('Mark doorway'));
    tap(180,250); tap(260,250);
    expect(screen.getByTestId('straight-doorway-outline')).toBeTruthy();
    expect(state().project.rooms[0]!.source!.pixelPolygon).toEqual(points);
    fireEvent.click(button('Add doorway'));
    const room=state().project.rooms.find(room=>room.id===id)!;
    expect(room.doorways).toHaveLength(2); expect(room.doorways[0]!.id).toBe('old');
    expect(room.doorways[1]!.width).toBe(800);
    expect(room.source!.pixelPolygon).toHaveLength(4);
  });

  it('leaves detected spaces below one square metre unchecked and allows explicit inclusion', async () => {
    addPlan(10);
    const small=[{x:5,y:5},{x:55,y:5},{x:55,y:105},{x:5,y:105}];
    const one=[{x:310,y:5},{x:410,y:5},{x:410,y:105},{x:310,y:105}];
    detector.detectAll.mockResolvedValue({ok:true,candidates:[{...suggested,polygon:small},{...suggested,polygon:one}],message:'',omitted:0,truncated:false});
    render(<FloorPlanPanel/>);
    await act(async()=>{fireEvent.click(button('Detect all rooms'));});
    const a=screen.getByRole('checkbox',{name:'Include detected room 1: Room 1'}) as HTMLInputElement;
    const b=screen.getByRole('checkbox',{name:'Include detected room 2: Room 2'}) as HTMLInputElement;
    expect(a.checked).toBe(false); expect(b.checked).toBe(true);
    expect(screen.getByText(/under 1 m² left unchecked/)).toBeTruthy();
    fireEvent.click(a); expect(a.checked).toBe(true);
  });

  it('reviews staircase estimates, edits their footprint and saves only explicitly included flights', async () => {
    const planId=addPlan(10);
    const polygon=[{x:10,y:10},{x:90,y:10},{x:90,y:180},{x:10,y:180}];
    detector.detectAll.mockResolvedValue({ok:true,candidates:[],staircases:[{polygon,treads:[{a:polygon[0],b:polygon[1]}],widthMm:800,lengthMm:1700,goingMm:250,estimatedRisers:7,visibleTreads:6,headingDegrees:90,layout:'straight',confidence:'medium',message:'Check the complete flight.'}],message:'Stairs found',omitted:0,truncated:false});
    render(<FloorPlanPanel/>);
    await act(async()=>{fireEvent.click(button('Detect all rooms'));});
    expect(screen.getByTestId('detected-staircase-overlay')).toBeTruthy();
    expect(state().project.staircases).toHaveLength(0);
    const include=screen.getByRole('checkbox',{name:'Include detected staircase 1: Stairs 1'}) as HTMLInputElement;
    expect(include.checked).toBe(false);
    fireEvent.click(include);
    changeInput('Detected staircase risers','14');
    fireEvent.blur(input('Detected staircase risers'));
    fireEvent.click(button('Edit staircase footprint'));
    changeInput('Staircase name','Ground to first');
    fireEvent.click(button('Save staircase suggestion'));
    expect(input('Detected staircase risers').value).toBe('14');
    fireEvent.click(button('Add 1 selected space'));
    const stair=state().project.staircases[0]!;
    expect(stair.name).toBe('Ground to first'); expect(stair.steps).toHaveLength(14);
    expect(stair.steps[0]).toMatchObject({width:800,going:250,rise:200});
    expect(stair.source).toEqual({floorPlanId:planId,pixelPolygon:polygon});
    expect(stair.notes).toMatch(/Estimated from 6 visible tread lines/);
    expect(state().project.rooms).toHaveLength(0);
  });

  it('prevents adding an estimated staircase over a selected room', async()=>{
    addPlan(10);
    const polygon=[{x:110,y:60},{x:190,y:60},{x:190,y:190},{x:110,y:190}];
    detector.detectAll.mockResolvedValue({ok:true,candidates:[suggested],staircases:[{polygon,treads:[],widthMm:800,lengthMm:1300,goingMm:250,estimatedRisers:6,visibleTreads:5,headingDegrees:90,layout:'straight',confidence:'medium',message:'Check the complete flight.'}],message:'',omitted:0,truncated:false});
    render(<FloorPlanPanel/>); await act(async()=>{fireEvent.click(button('Detect all rooms'));});
    fireEvent.click(screen.getByRole('checkbox',{name:'Include detected staircase 1: Stairs 1'}));
    expect(button('Add 2 selected spaces').disabled).toBe(true);
    expect(screen.getAllByText(/Overlaps another selected suggestion/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('checkbox',{name:'Include detected room 1: Room 1'}));
    expect(button('Add 1 selected space').disabled).toBe(false);
  });

  it('uses the same overlap rule when editing a saved staircase footprint',()=>{
    const planId=addPlan(10);addTracedRoom(planId);
    state().addStaircase({name:'Stairs',source:{floorPlanId:planId,pixelPolygon:[{x:120,y:70},{x:190,y:70},{x:190,y:190},{x:120,y:190}]}});
    render(<FloorPlanPanel/>);fireEvent.click(button('Edit stairs footprint'));
    expect(button('Save outline changes').disabled).toBe(true);
    expect(screen.getByText(/This outline overlaps/).textContent).toContain('Lounge');
  });

  it('blocks a detected riser count that the staircase guide cannot preserve',async()=>{
    addPlan(10);
    detector.detectAll.mockResolvedValue({ok:true,candidates:[],staircases:[{polygon:PIXEL_ROOM,treads:[],widthMm:800,lengthMm:1300,goingMm:250,estimatedRisers:40,visibleTreads:39,headingDegrees:90,layout:'straight',confidence:'medium',message:'Check the full flight.'}],message:'',omitted:0,truncated:false});
    render(<FloorPlanPanel/>);await act(async()=>{fireEvent.click(button('Detect all rooms'));});
    fireEvent.click(screen.getByRole('checkbox',{name:'Include detected staircase 1: Stairs 1'}));
    expect(input('Detected staircase risers').max).toBe('30');
    expect(button('Add 1 selected space').disabled).toBe(true);
    expect(state().project.staircases).toHaveLength(0);
  });

  it('rejects distant doorway clicks before saving and lets the user start again', () => {
    const planId = addPlan(10); addTracedRoom(planId);
    render(<FloorPlanPanel />); selectListedRoom('Lounge'); fireEvent.click(button('Mark doorway'));
    tap(20, 280); tap(380, 280);
    expect(screen.getByRole('alert').textContent).toMatch(/not close enough to the same wall/);
    expect(screen.queryByRole('button', { name: 'Add doorway' })).toBeNull();
    expect(state().project.rooms[0]?.doorways).toHaveLength(0);
    fireEvent.click(button('Start opening again')); tap(150, 50); tap(230, 50);
    expect(button('Add doorway')).toBeTruthy();
  });

  it('also rejects doorway points that are physically too far from the wall at a small zoom', () => {
    const planId = addPlan(10); addTracedRoom(planId);
    render(<FloorPlanPanel />); selectListedRoom('Lounge'); fireEvent.click(button('Mark doorway'));
    // 32px is inside the screen tolerance but represents 320mm from this wall.
    tap(150, 82); tap(230, 82);
    expect(screen.getByRole('alert').textContent).toMatch(/not close enough to the same wall/);
    expect(screen.queryByRole('button', { name: 'Add doorway' })).toBeNull();
    expect(state().project.rooms[0]?.doorways).toHaveLength(0);
  });

  it('moves from review into the estimate only through its explicit action', () => {
    const planId = addPlan(10); addTracedRoom(planId);
    render(<FloorPlanPanel />); fireEvent.click(button('Review rooms'));
    expect(activeStep()).toMatch(/Review/);
    expect(screen.getByText('Check your measured rooms')).toBeTruthy();
    selectListedRoom('Lounge');
    expect(activeStep()).toMatch(/Review/);
    expect(input('Selected room name').value).toBe('Lounge');
    expect(state().tab).toBe('floorplan');
    fireEvent.click(button('View estimate'));
    expect(state().tab).toBe('results');
  });

  it('switches documents through the selector and restores each plan draft independently', () => {
    const a = addPlan(10); const b = addPlan(undefined, 'first-floor.png');
    render(<FloorPlanPanel />);
    expect(screen.getByTestId('mode-scale')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Current plan'), { target: { value: a } });
    traceRoom(); changeInput('Room name', 'Ground floor lounge');
    fireEvent.change(screen.getByLabelText('Current plan'), { target: { value: b } });
    expect(screen.getByAltText('Floor plan: first-floor.png')).toBeTruthy();
    expect(screen.getByTestId('mode-scale')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Current plan'), { target: { value: a } });
    expect(input('Room name').value).toBe('Ground floor lounge');
    expect(state().selection).toEqual({ kind: 'floorplan', id: a });
  });

  it('opens an incoming room or staircase on its own plan while preserving that plan’s pending draft', () => {
    const ground = addPlan(10, 'ground.png'); const roomId = addTracedRoom(ground);
    const first = addPlan(10, 'first-floor.png');
    const stairId = state().addStaircase({ name: 'First-floor stairs', source: { floorPlanId: first, pixelPolygon: PIXEL_ROOM } });
    state().select({ kind: 'floorplan', id: ground });
    const view = render(<FloorPlanPanel/>);
    fireEvent.click(button('Rectangle')); tap(10, 10); tap(60, 40); changeInput('Room name', 'Pending small room');
    fireEvent.change(screen.getByLabelText('Current plan'), { target: { value: first } });
    view.unmount();
    state().select({ kind: 'room', id: roomId });
    const roomView = render(<FloorPlanPanel/>);
    expect(screen.getByAltText('Floor plan: ground.png')).toBeTruthy();
    expect(input('Selected room name').value).toBe('Lounge');
    fireEvent.click(button('Continue saved outline'));
    expect(input('Room name').value).toBe('Pending small room');
    roomView.unmount();
    state().select({ kind: 'staircase', id: stairId });
    render(<FloorPlanPanel/>);
    expect(screen.getByAltText('Floor plan: first-floor.png')).toBeTruthy();
    expect(input('Selected staircase name').value).toBe('First-floor stairs');
  });

  it('removes a plan through its options after confirmation and keeps confirmed rooms', () => {
    const id = addPlan(10); addTracedRoom(id);
    render(<FloorPlanPanel />);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByText('Plan options'));
    fireEvent.click(button('Remove this plan'));
    expect(state().project.floorPlans).toHaveLength(0);
    expect(state().project.rooms).toHaveLength(1);
    expect(button('Choose a floor plan')).toBeTruthy();
  });

  it('measures using the current display unit', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Measure')); tap(0, 0); tap(0, 150);
    expect(screen.getByTestId('measure-readout').textContent).toBe('1.50 m');
    act(() => state().updateProject({ displayUnit: 'imperial' }));
    expect(screen.getByTestId('measure-readout').textContent).toBe(`4' 11"`);
  });

  it('supports the wider 5–400% zoom range and clearly labelled reset controls', () => {
    addPlan(10); render(<FloorPlanPanel />);
    for (let i = 0; i < 10; i++) fireEvent.click(button('Zoom in'));
    expect(screen.getByTestId('zoom-readout').textContent).toBe('400%');
    expect(button('Zoom in').disabled).toBe(true);
    for (let i = 0; i < 20; i++) fireEvent.click(button('Zoom out'));
    expect(screen.getByTestId('zoom-readout').textContent).toBe('5%');
    expect(button('Zoom out').disabled).toBe(true);
    fireEvent.click(button('100%'));
    expect(screen.getByTestId('zoom-readout').textContent).toBe('100%');
    expect(button('Fit plan')).toBeTruthy();
  });
});

describe('assisted detection review', () => {
  it('adds only explicitly accepted detected doorways with the calibrated opening width', async () => {
    addPlan(10);
    detector.detect.mockResolvedValue({ ...suggested, inferredGaps: [{ a: { x: 150, y: 50 }, b: { x: 230, y: 50 } }] });
    render(<FloorPlanPanel />); tap(200, 100);
    await screen.findByTestId('mode-review-outline');
    const opening = screen.getByRole('checkbox', { name: /Opening 1.*0.80 m/ }) as HTMLInputElement;
    expect(opening.checked).toBe(false);
    fireEvent.click(opening);
    expect(state().project.rooms).toHaveLength(0);
    submit('Room name');
    expect(state().project.rooms[0]?.doorways[0]).toMatchObject({ edgeIndex: 0, offset: 500, width: 800 });
  });

  it('suggests a recognised name inside the detected room without adding it automatically', async () => {
    const id = addPlan(10);
    state().updateFloorPlan(id, { reading: { source: 'ocr', text: 'BEDROOM 2', lines: [{ text: 'BEDROOM 2', x: 140, y: 90, width: 100, height: 20, confidence: 90 }] } });
    detector.detect.mockResolvedValue(suggested);
    render(<FloorPlanPanel />); tap(200, 100);
    await screen.findByTestId('mode-review-outline');
    expect(input('Room name').value).toBe('Bedroom 2');
    expect(state().project.rooms).toHaveLength(0);
  });

  it('fills an OCR dimension for review without applying scale until confirmed', () => {
    const id = addPlan();
    state().updateFloorPlan(id, { reading: { source: 'pdf', text: '4.35 m', lines: [] } });
    render(<FloorPlanPanel />); tap(0, 0); tap(200, 0);
    fireEvent.click(screen.getByText(/Read plan text/));
    fireEvent.click(button('4.35 m'));
    expect(input('Known distance').value).toBe('4350mm');
    expect(storedPlan(id).mmPerPx).toBeUndefined();
    submit('Known distance');
    expect(storedPlan(id).mmPerPx).toBe(21.75);
  });
  it('previews the proposed outline and inferred gaps without adding a room until confirmation', async () => {
    addPlan(10);
    detector.detect.mockResolvedValue({ ...suggested, inferredGaps: [{ a: { x: 150, y: 50 }, b: { x: 230, y: 50 } }] });
    render(<FloorPlanPanel />); tap(200, 100);
    expect(await screen.findByTestId('mode-review-outline')).toBeTruthy();
    expect(detector.detect).toHaveBeenCalledWith({ x: 200, y: 100 });
    expect(screen.getByText(/Dashed edges close possible door openings/)).toBeTruthy();
    expect(document.querySelector('.fp-inferred-gap')).toBeTruthy();
    expect(state().project.rooms).toHaveLength(0);
    changeInput('Room name', 'Detected lounge'); submit('Room name');
    expect(state().project.rooms[0]).toMatchObject({ name: 'Detected lounge', shape: { kind: 'polygon', points: MM_ROOM } });
  });

  it('keeps manual drawing available when a room cannot be detected', async () => {
    addPlan(10); render(<FloorPlanPanel />); tap(200, 100);
    expect(await screen.findByText(/Could not find a closed room/)).toBeTruthy();
    expect(state().project.rooms).toHaveLength(0);
    fireEvent.click(button('Rectangle')); tap(100, 50); tap(300, 200);
    expect(screen.getByTestId('trace-area').textContent).toBe('3.00 m²');
  });

  it('undoing a detected outline opens visible corner editing and clears obsolete inferred gaps', async () => {
    addPlan(10);
    detector.detect.mockResolvedValue({ ...suggested, inferredGaps: [{ a: { x: 150, y: 50 }, b: { x: 230, y: 50 } }] });
    render(<FloorPlanPanel />); tap(200, 100);
    await screen.findByTestId('mode-review-outline');
    changeInput('Room name', 'Adjusted lounge');
    key('Backspace');
    expect(screen.getByTestId('mode-trace')).toBeTruthy();
    expect(screen.getByTestId('trace-status').textContent).toBe('4 corners placed');
    expect(document.querySelector('.fp-inferred-gap')).toBeNull();
    fireEvent.click(button('Finish outline'));
    expect(input('Room name').value).toBe('Adjusted lounge');
    expect(state().project.rooms).toHaveLength(0);
  });

  it('ignores a detection result arriving after the user switches tools', async () => {
    let resolve!: (result: DetectionResult) => void;
    detector.detect.mockImplementation(() => new Promise<DetectionResult>((done) => { resolve = done; }));
    addPlan(10); render(<FloorPlanPanel />); tap(200, 100);
    fireEvent.click(button('Select room'));
    await act(async () => { resolve(suggested); });
    expect(screen.getByTestId('mode-select')).toBeTruthy();
    expect(screen.queryByTestId('mode-review-outline')).toBeNull();
    expect(state().project.rooms).toHaveLength(0);
    fireEvent.click(button('Add another room'));
    expect(screen.getByTestId('mode-detect')).toBeTruthy();
  });

  it('ignores a detection result arriving after a different plan is opened', async () => {
    let resolve!: (result: DetectionResult) => void;
    detector.detect.mockImplementation(() => new Promise<DetectionResult>((done) => { resolve = done; }));
    const a = addPlan(10); const b = addPlan(10, 'first-floor.png');
    state().select({ kind: 'floorplan', id: a });
    render(<FloorPlanPanel />); tap(200, 100);
    fireEvent.change(screen.getByLabelText('Current plan'), { target: { value: b } });
    await act(async () => { resolve(suggested); });
    expect(screen.getByAltText('Floor plan: first-floor.png')).toBeTruthy();
    expect(screen.queryByTestId('mode-review-outline')).toBeNull();
    fireEvent.change(screen.getByLabelText('Current plan'), { target: { value: a } });
    expect(screen.getByTestId('mode-detect')).toBeTruthy();
    expect(state().project.rooms).toHaveLength(0);
  });
});

describe('outline editing and staircase footprints', () => {
  it('selects and deletes a closed outline corner, preserving a minimum of three', () => {
    addPlan(10); render(<FloorPlanPanel />); traceRoom();
    tap(300, 50);
    expect(screen.getByText('Corner 2 selected')).toBeTruthy();
    fireEvent.click(button('Delete selected corner'));
    expect(screen.getByTestId('trace-area').textContent).toBe('1.50 m²');
    fireEvent.change(screen.getByLabelText('Selected corner'), { target: { value: '0' } });
    expect(button('Delete selected corner').disabled).toBe(true);
    key('Delete');
    expect(screen.getByText(/An outline needs at least three corners/)).toBeTruthy();
    submit('Room name');
    expect(state().project.rooms[0]?.source?.pixelPolygon).toHaveLength(3);
  });

  it('can insert, move and delete corners while an outline is still open', () => {
    addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw outline')); tap(100, 50); tap(300, 50); tap(300, 200);
    fireEvent.change(screen.getByLabelText('Selected corner'), { target: { value: '0' } });
    fireEvent.click(button('Add corner after'));
    expect(screen.getByTestId('trace-status').textContent).toBe('4 corners placed');
    for (const [type, x, y] of [['pointerdown', 200, 50], ['pointermove', 200, 30], ['pointerup', 200, 30]] as const) fireEvent(overlay(), new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
    expect(document.querySelector('.fp-trace polyline')?.getAttribute('points')).toContain('200,30');
    key('Delete');
    expect(screen.getByTestId('trace-status').textContent).toBe('3 corners placed');
  });

  it('prevents overlap with an existing room and highlights the conflict', () => {
    const id = addPlan(10); const roomId = addTracedRoom(id);
    render(<FloorPlanPanel />); fireEvent.click(button('Rectangle')); tap(50, 20); tap(200, 120);
    expect(screen.getByRole('alert').textContent).toMatch(/overlaps.*Lounge/);
    expect(screen.getByTestId(`room-overlay-${roomId}`).classList.contains('fp-overlap')).toBe(true);
    expect(button('Add room').disabled).toBe(true);
    submit('Room name');
    expect(state().project.rooms).toHaveLength(1);
  });

  it('allows a neighbouring room to start on and share an existing wall', () => {
    const id = addPlan(10); addTracedRoom(id);
    render(<FloorPlanPanel />); fireEvent.click(button('Rectangle')); tap(300, 50); tap(380, 200);
    expect(button('Add room').disabled).toBe(false);
    submit('Room name');
    expect(state().project.rooms).toHaveLength(2);
    expect(state().project.rooms[1]?.source?.pixelPolygon[0]).toEqual({ x: 300, y: 50 });
  });

  it('edits a saved room in place with its original scale and keeps a matching doorway', () => {
    const id = addPlan(10); const roomId = addTracedRoom(id);
    state().addDoorway(roomId, { edgeIndex: 0, offset: 500, width: 800 });
    state().updateFloorPlan(id, { mmPerPx: 20 });
    render(<FloorPlanPanel />); selectListedRoom('Lounge'); fireEvent.click(button('Edit room outline'));
    expect(screen.getByTestId('trace-area').textContent).toBe('3.00 m²');
    expect(document.querySelector('.fp-trace text')?.textContent).toContain('3.00 m²');
    fireEvent.click(button('Cancel changes'));
    expect(screen.getByTestId('mode-select')).toBeTruthy();
    expect(state().project.rooms[0]?.source?.pixelPolygon).toEqual(PIXEL_ROOM);
    fireEvent.click(button('Edit room outline'));
    for (const [type, x, y] of [['pointerdown', 300, 200], ['pointermove', 340, 200], ['pointerup', 340, 200]] as const) fireEvent(overlay(), new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
    fireEvent.click(button('Save outline changes'));
    expect(state().project.rooms).toHaveLength(1);
    expect(state().project.rooms[0]?.id).toBe(roomId);
    expect(state().project.rooms[0]?.doorways[0]).toMatchObject({ edgeIndex: 0, offset: 500, width: 800 });
    expect(state().project.rooms[0]?.source?.pixelPolygon[2]).toEqual({ x: 340, y: 200 });
    expect(state().tab).toBe('floorplan');
  });

  it('adds and edits a staircase footprint without creating a room, then opens stair details', () => {
    const id = addPlan(10); render(<FloorPlanPanel />);
    fireEvent.click(button('Draw stairs')); tap(100, 50); tap(200, 250);
    changeInput('Staircase name', 'Hall stairs');
    expect(state().project.staircases).toHaveLength(0);
    fireEvent.click(button('Add staircase'));
    const stair = state().project.staircases[0]!;
    expect(stair.source?.floorPlanId).toBe(id);
    expect(stair.source?.pixelPolygon).toHaveLength(4);
    expect(state().project.rooms).toHaveLength(0);
    expect(screen.getByTestId(`stairs-overlay-${stair.id}`)).toBeTruthy();
    fireEvent.click(button('Edit stairs footprint'));
    expect(input('Staircase name').value).toBe('Hall stairs');
    fireEvent.click(button('Save outline changes'));
    expect(state().project.staircases).toHaveLength(1);
    fireEvent.click(button('Stair dimensions & turns'));
    expect(state().selection).toEqual({ kind: 'staircase', id: stair.id });
    expect(state().tab).toBe('rooms');
  });

  it('can trace a turning staircase footprint with more than four corners', () => {
    addPlan(10); render(<FloorPlanPanel />); fireEvent.click(button('Draw stairs'));
    fireEvent.click(button('Trace a turning or curved footprint'));
    for (const p of [{ x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 240 }, { x: 50, y: 240 }]) tap(p.x, p.y);
    fireEvent.click(button('Finish outline')); fireEvent.click(button('Add staircase'));
    expect(state().project.staircases[0]?.source?.pixelPolygon).toHaveLength(6);
    expect(state().project.rooms).toHaveLength(0);
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
