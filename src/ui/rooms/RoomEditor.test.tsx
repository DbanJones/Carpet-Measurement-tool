import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useProjectStore, makeEmptyProject } from '@store/projectStore';
import type { CutPiece, Seam } from '@engine/types';
import { RoomEditor } from './RoomEditor';
import { RoomPreview, safePolygon } from './RoomPreview';
import { convertShape } from './ShapeEditor';

function resetStore() {
  useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' }, tab: 'rooms', revision: 0 });
}
const getRoom = (id: string) => useProjectStore.getState().project.rooms.find((r) => r.id === id)!;
/** LengthInput commits on blur. */
const typeLength = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};
const addLounge = () => useProjectStore.getState().addRoom({ name: 'Lounge' });

beforeEach(resetStore);
afterEach(cleanup);

describe('RoomEditor', () => {
  it('shows a friendly message when the room does not exist', () => {
    render(<RoomEditor roomId="nope" />);
    expect(screen.getByText(/This room no longer exists/)).toBeTruthy();
  });

  it('renders basics, shape, live figures, doorways and subfloor from the store', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    expect(screen.getByRole('heading', { name: 'Lounge' })).toBeTruthy();
    expect((screen.getByLabelText('Room name') as HTMLInputElement).value).toBe('Lounge');
    expect((screen.getByLabelText('Product') as HTMLSelectElement).selectedOptions[0]!.textContent).toMatch(/Carpet \(4 m roll\).*4\.00 m roll/);
    expect((screen.getByLabelText('Shape type') as HTMLSelectElement).value).toBe('rectangle');
    expect(screen.getByText(/Measure at the longest and widest points/)).toBeTruthy();
    expect(screen.getByTestId('figure-area').textContent).toBe('12.00 m²');
    expect(screen.getByTestId('figure-perimeter').textContent).toBe('14.00 m');
    expect(screen.getByTestId('figure-bbox').textContent).toBe('4.00 m × 3.00 m');
    const edge = screen.getByLabelText('Wall or edge') as HTMLSelectElement;
    expect(edge.value).toBe('0');
    expect(Array.from(edge.options).map((o) => o.textContent)).toEqual(['Top wall (4.00 m)', 'Right wall (3.00 m)', 'Bottom wall (4.00 m)', 'Left wall (3.00 m)']);
    expect((screen.getByLabelText('Subfloor type') as HTMLSelectElement).value).toBe('floorboards');
    expect(screen.getByTestId('room-preview')).toBeTruthy();
  });

  it('editing the length writes millimetres to the store and updates the figures', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    typeLength(screen.getByLabelText('Room length'), '5');
    expect(getRoom(id).shape).toEqual({ kind: 'rectangle', length: 5000, width: 3000 });
    expect(screen.getByTestId('figure-area').textContent).toBe('15.00 m²');
    expect(screen.getByTestId('figure-perimeter').textContent).toBe('16.00 m');
  });

  it('honours the imperial display unit', () => {
    const id = addLounge();
    useProjectStore.getState().updateProject({ displayUnit: 'imperial' });
    render(<RoomEditor roomId={id} />);
    expect(screen.getByTestId('figure-bbox').textContent).toBe(`13' 1" × 9' 10"`);
    expect(screen.getByTestId('figure-area').textContent).toMatch(/sq ft/);
    typeLength(screen.getByLabelText('Room width'), `10'`);
    expect(getRoom(id).shape).toEqual({ kind: 'rectangle', length: 4000, width: 3048 });
  });

  it('renames the room and edits notes', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'Front room' } });
    fireEvent.change(screen.getByLabelText('Room notes'), { target: { value: 'Move the sofa' } });
    expect(getRoom(id).name).toBe('Front room');
    expect(getRoom(id).notes).toBe('Move the sofa');
    expect(screen.getByRole('heading', { name: 'Front room' })).toBeTruthy();
  });

  it('switching the shape type converts the outline sensibly', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    const kind = screen.getByLabelText('Shape type');

    fireEvent.change(kind, { target: { value: 'polygon' } });
    let shape = getRoom(id).shape;
    expect(shape.kind).toBe('polygon');
    if (shape.kind === 'polygon') expect(shape.points).toHaveLength(4);
    // lands on the walk-the-walls form, seeded empty
    expect(screen.getByRole('button', { name: 'Walk the walls' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/No walls yet/)).toBeTruthy();

    fireEvent.change(kind, { target: { value: 'l_shape' } });
    shape = getRoom(id).shape;
    expect(shape.kind).toBe('l_shape');
    if (shape.kind === 'l_shape') {
      expect(shape.length).toBe(4000);
      expect(shape.width).toBe(3000);
      expect(shape.cutoutLength).toBeGreaterThan(0);
    }

    fireEvent.change(kind, { target: { value: 'rectangle_with_features' } });
    shape = getRoom(id).shape;
    expect(shape.kind).toBe('rectangle_with_features');
    if (shape.kind === 'rectangle_with_features') {
      expect(shape.features).toHaveLength(1);
      expect(shape.features[0]!.depth).toBeLessThan(0);
    }

    fireEvent.change(kind, { target: { value: 'rectangle' } });
    expect(getRoom(id).shape).toEqual({ kind: 'rectangle', length: 4000, width: 3000 });
  });

  it('moves the doorways onto the new outline when the shape type changes', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    // put the doorway on a wall that a rectangle will not have
    fireEvent.change(screen.getByLabelText('Shape type'), { target: { value: 'rectangle_with_features' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Bay window' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Chimney breast' }));
    const walls = (screen.getByLabelText('Wall or edge') as HTMLSelectElement).options.length;
    expect(walls).toBeGreaterThan(4);
    fireEvent.change(screen.getByLabelText('Wall or edge'), { target: { value: String(walls - 1) } });
    expect(getRoom(id).doorways[0]!.edgeIndex).toBe(walls - 1);

    // back to a 4-wall rectangle: the doorway follows rather than being orphaned on a wall that is gone
    fireEvent.change(screen.getByLabelText('Shape type'), { target: { value: 'rectangle' } });
    const d = getRoom(id).doorways[0]!;
    expect(d.edgeIndex).toBeLessThan(4);
    expect(d.edgeIndex).toBeGreaterThanOrEqual(0);
    expect(screen.queryByText(/no longer exists/)).toBeNull();
  });

  it('walking the walls writes a polygon once three walls are entered', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    fireEvent.change(screen.getByLabelText('Shape type'), { target: { value: 'polygon' } });
    const add = screen.getByRole('button', { name: '+ Add wall' });
    fireEvent.click(add);
    // one wall is not an outline: the converted rectangle is kept
    let shape = getRoom(id).shape;
    if (shape.kind === 'polygon') expect(shape.points).toHaveLength(4);
    fireEvent.click(add);
    fireEvent.click(add);
    typeLength(screen.getByLabelText('Wall 1 length'), '4');
    typeLength(screen.getByLabelText('Wall 2 length'), '3');
    typeLength(screen.getByLabelText('Wall 3 length'), '1.5');
    shape = getRoom(id).shape;
    expect(shape.kind).toBe('polygon');
    if (shape.kind === 'polygon') {
      expect(shape.points).toEqual([
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 3000 },
        { x: 2500, y: 3000 },
      ]);
    }
    expect(screen.getByText(/Implied closing wall of 3\.91 m/)).toBeTruthy();

    // the points table edits the same polygon
    fireEvent.click(screen.getByRole('button', { name: 'Edit points (x, y)' }));
    typeLength(screen.getByLabelText('Point 4 x'), '0');
    shape = getRoom(id).shape;
    if (shape.kind === 'polygon') expect(shape.points[3]).toEqual({ x: 0, y: 3000 });
    expect(screen.getByTestId('figure-area').textContent).toBe('12.00 m²');
  });

  it('adds wall features from presets with the documented sign convention', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Add a bay window, alcove or chimney breast/ }));
    expect(getRoom(id).shape.kind).toBe('rectangle_with_features');
    fireEvent.click(screen.getByRole('button', { name: '+ Bay window' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Chimney breast' }));
    const shape = getRoom(id).shape;
    expect(shape.kind).toBe('rectangle_with_features');
    if (shape.kind === 'rectangle_with_features') {
      expect(shape.features[0]).toMatchObject({ wall: 'top', offset: 800, width: 2400, depth: 600, label: 'Bay window' });
      // the top wall is taken by the bay, so the chimney breast lands centred on the next wall
      expect(shape.features[1]).toMatchObject({ wall: 'right', offset: 800, width: 1400, depth: -350, label: 'Chimney breast' });
    }
    // 12 + 2.4*0.6 - 1.4*0.35
    expect(screen.getByTestId('figure-area').textContent).toBe('12.95 m²');
    const directions = screen.getAllByLabelText('Feature direction') as HTMLSelectElement[];
    expect(directions[1]!.value).toBe('in');
    fireEvent.change(directions[1]!, { target: { value: 'out' } });
    const after = getRoom(id).shape;
    if (after.kind === 'rectangle_with_features') expect(after.features[1]!.depth).toBe(350);
    expect(screen.getByText(/positive projects out of the room/)).toBeTruthy();
  });

  it('edits doorways: preset widths, validation, add and remove', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    const preset = screen.getByLabelText('Standard door width') as HTMLSelectElement;
    expect(preset.value).toBe('838');
    expect(Array.from(preset.options).some((o) => o.textContent === `762 mm (2' 6")`)).toBe(true);
    fireEvent.change(preset, { target: { value: '762' } });
    expect(getRoom(id).doorways[0]!.width).toBe(762);

    expect(screen.queryByText(/runs past the end of this edge/)).toBeNull();
    typeLength(screen.getByLabelText('Offset from edge start'), '3.5');
    expect(getRoom(id).doorways[0]!.offset).toBe(3500);
    expect(screen.getByText(/runs past the end of this edge \(4\.00 m long\)/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Wall or edge'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Leads to'), { target: { value: 'hard_floor' } });
    expect(getRoom(id).doorways[0]).toMatchObject({ edgeIndex: 2, transition: 'hard_floor' });

    fireEvent.click(screen.getByRole('button', { name: '+ Add doorway' }));
    expect(getRoom(id).doorways).toHaveLength(2);
    const rows = screen.getAllByLabelText('Doorway label');
    expect(rows).toHaveLength(2);
    const secondRow = rows[1]!.closest('tr')!;
    // a row delete discards a measured opening and there is no undo, so it asks first
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Remove' }));
    expect(getRoom(id).doorways).toHaveLength(2);
    confirmSpy.mockReturnValue(true);
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Remove' }));
    expect(getRoom(id).doorways).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it('links a doorway to the same opening in another room so only one bar is bought', () => {
    const hall = addLounge();
    useProjectStore.getState().updateRoom(hall, { name: 'Hall' });
    const lounge = useProjectStore.getState().addRoom({ name: 'Lounge' });
    render(<RoomEditor roomId={lounge} />);
    const shared = screen.getByLabelText('Shared with') as HTMLSelectElement;
    // the far side is offered by room and doorway, never matched on the label
    const option = Array.from(shared.options).find((o) => o.textContent?.startsWith('Hall —'))!;
    expect(option).toBeTruthy();
    fireEvent.change(shared, { target: { value: option.value } });
    const openingId = getRoom(lounge).doorways[0]!.sharedOpeningId;
    expect(openingId).toBeTruthy();
    // both sides now carry the same opening id
    expect(getRoom(hall).doorways[0]!.sharedOpeningId).toBe(openingId);
  });

  it('edits the subfloor', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    fireEvent.change(screen.getByLabelText('Subfloor type'), { target: { value: 'concrete' } });
    fireEvent.change(screen.getByLabelText('Subfloor condition'), { target: { value: 'uneven' } });
    fireEvent.click(screen.getByLabelText('Underfloor heating'));
    fireEvent.click(screen.getByLabelText('Damp-proof membrane known to be present'));
    expect(getRoom(id).subfloor).toMatchObject({ type: 'concrete', condition: 'uneven', underfloorHeating: true, dpmKnown: true, existingGripper: true });
    expect(screen.getByText(/smoothing compound suggested/)).toBeTruthy();
  });

  it('planning overrides write room.planning and clear back to the project default', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    expect(screen.queryByLabelText('Pile direction')).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByRole('button', { name: /Planning overrides/ }));
    const pile = screen.getByLabelText('Pile direction') as HTMLSelectElement;
    expect(pile.value).toBe('default');
    expect(pile.selectedOptions[0]!.textContent).toMatch(/Project default/);
    fireEvent.change(pile, { target: { value: 'along_width' } });
    expect(getRoom(id).planning).toEqual({ pileDirection: 'along_width' });
    expect(screen.getByTestId('pile-arrow').getAttribute('data-direction')).toBe('along_width');
    fireEvent.change(screen.getByLabelText('Seam policy'), { target: { value: 'min_seams' } });
    expect(getRoom(id).planning).toEqual({ pileDirection: 'along_width', seamPolicy: 'min_seams' });
    fireEvent.change(pile, { target: { value: 'default' } });
    fireEvent.change(screen.getByLabelText('Seam policy'), { target: { value: 'default' } });
    expect(getRoom(id).planning).toBeUndefined();
    expect(screen.queryByTestId('pile-arrow')).toBeNull();
  });

  it('shows hard floor overrides for pack products', () => {
    const id = addLounge();
    const lamId = useProjectStore.getState().addProduct({ name: 'Oak laminate', kind: 'laminate', packCoverageM2: 2.22 });
    useProjectStore.getState().updateRoom(id, { productId: lamId });
    render(<RoomEditor roomId={id} />);
    fireEvent.click(screen.getByRole('button', { name: /Planning overrides/ }));
    expect(screen.queryByLabelText('Pile direction')).toBeNull();
    fireEvent.change(screen.getByLabelText('Lay pattern'), { target: { value: 'herringbone' } });
    fireEvent.change(screen.getByLabelText('Expansion gap finish'), { target: { value: 'refit' } });
    expect(getRoom(id).hardFloor).toEqual({ layPattern: 'herringbone', useBeading: false });
  });

  it('duplicates and deletes (after confirmation)', () => {
    const id = addLounge();
    render(<RoomEditor roomId={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const rooms = useProjectStore.getState().project.rooms;
    expect(rooms).toHaveLength(2);
    expect(rooms[1]!.name).toBe('Lounge (copy)');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useProjectStore.getState().project.rooms).toHaveLength(2);
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useProjectStore.getState().project.rooms.find((r) => r.id === id)).toBeUndefined();
    expect(screen.getByText(/This room no longer exists/)).toBeTruthy();
    confirmSpy.mockRestore();
  });
});

describe('convertShape', () => {
  it('turns an L-shape into a rectangle with one recess that has the same outline', () => {
    const l = { kind: 'l_shape' as const, length: 6000, width: 5000, cutoutLength: 2000, cutoutWidth: 1500, cutoutCorner: 'bottom-left' as const };
    const f = convertShape(l, 'rectangle_with_features');
    expect(f.kind).toBe('rectangle_with_features');
    if (f.kind === 'rectangle_with_features') {
      expect(f.features).toHaveLength(1);
      expect(f.features[0]).toMatchObject({ wall: 'bottom', offset: 4000, width: 2000, depth: -1500 });
    }
    // Same polygon (as a point set) after conversion.
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    expect(safePolygon(f).map(key).sort()).toEqual(safePolygon(l).map(key).sort());
  });

  it('falls back to a default rectangle for a degenerate polygon', () => {
    expect(convertShape({ kind: 'polygon', points: [] }, 'rectangle')).toEqual({ kind: 'rectangle', length: 4000, width: 3000 });
  });
});

describe('RoomPreview', () => {
  const rect = { kind: 'rectangle' as const, length: 4000, width: 3000 };

  it('draws the outline, dimensions, edge badges and doorways', () => {
    const { container } = render(
      <RoomPreview
        room={{ name: 'Lounge', shape: rect, doorways: [{ id: 'd1', edgeIndex: 0, offset: 100, width: 838, transition: 'carpet', label: 'Hall door' }] }}
        unit="metric"
      />,
    );
    expect(screen.getByRole('img', { name: 'Plan of Lounge' })).toBeTruthy();
    expect(container.querySelector('polygon.room')?.getAttribute('points')).toBe('0,0 4000,0 4000,3000 0,3000');
    expect(container.querySelectorAll('.edge-badge')).toHaveLength(4);
    expect(container.querySelectorAll('.edge-badge text')[2]!.textContent).toBe('3');
    expect(container.querySelectorAll('text.dim').length).toBe(4);
    expect(screen.getAllByText('4.00 m')).toHaveLength(2);
    const door = container.querySelector('line.door')!;
    expect(door.getAttribute('x1')).toBe('100');
    expect(door.getAttribute('x2')).toBe('938');
    expect(screen.getByText('Hall door')).toBeTruthy();
  });

  it('overlays pieces, seams and the pile arrow', () => {
    const pieces: CutPiece[] = [
      { id: 'p1', ownerId: 'r', ownerName: 'Lounge', label: 'Lounge A', length: 4100, width: 4000, role: 'main', placement: { polygon: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 0, y: 2000 }] } },
      { id: 'p2', ownerId: 'r', ownerName: 'Lounge', label: 'Lounge B', length: 4100, width: 1100, role: 'fill', placement: { polygon: [{ x: 0, y: 2000 }, { x: 4000, y: 2000 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] } },
      { id: 'p3', ownerId: 'r', ownerName: 'Lounge', label: 'no placement', length: 1, width: 1, role: 'other' },
    ];
    const seams: Seam[] = [
      { from: { x: 0, y: 2000 }, to: { x: 4000, y: 2000 }, kind: 'side' },
      { from: { x: 2000, y: 2000 }, to: { x: 2000, y: 3000 }, kind: 'cross' },
    ];
    const { container } = render(<RoomPreview room={{ shape: rect, doorways: [] }} unit="imperial" pieces={pieces} seams={seams} showPileArrow="along_length" />);
    expect(container.querySelectorAll('polygon.piece')).toHaveLength(2);
    expect(container.querySelectorAll('polygon.piece.fill')).toHaveLength(1);
    expect(screen.getByText('Lounge A')).toBeTruthy();
    expect(container.querySelectorAll('line.seam')).toHaveLength(2);
    expect(container.querySelectorAll('line.seam.cross')).toHaveLength(1);
    expect(screen.getByTestId('pile-arrow').getAttribute('data-direction')).toBe('along_length');
    expect(screen.getAllByText(`13' 1"`).length).toBeGreaterThan(0);
  });

  it('handles degenerate polygons and out-of-range doorways without throwing', () => {
    expect(() => render(<RoomPreview room={{ shape: { kind: 'polygon', points: [] } }} unit="metric" />)).not.toThrow();
    expect(screen.getByTestId('room-preview-empty')).toBeTruthy();
    expect(screen.getByText('No outline to draw yet')).toBeTruthy();
    cleanup();
    expect(() =>
      render(<RoomPreview room={{ shape: { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] } }} unit="metric" />),
    ).not.toThrow();
    cleanup();
    const { container } = render(
      <RoomPreview room={{ shape: rect, doorways: [{ id: 'd9', edgeIndex: 9, offset: 0, width: 800, transition: 'none' }] }} unit="metric" />,
    );
    expect(container.querySelectorAll('line.door')).toHaveLength(0);
  });
});
