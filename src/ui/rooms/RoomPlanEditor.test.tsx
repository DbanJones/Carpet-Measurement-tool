import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useProjectStore, makeEmptyProject } from '@store/projectStore';
import type { Doorway, RoomShape } from '@engine/types';
import { shapeToPolygon } from '@engine/geometry';
import { RoomEditor } from './RoomEditor';
import { diagramDoorways, insertRoomCorner, moveRoomHandle, outlineProblem } from './roomDiagramGeometry';

const rect = { kind: 'rectangle', length: 4000, width: 3000 } as const;
const room = (id: string) => useProjectStore.getState().project.rooms.find(r => r.id === id)!;
const typeLength = (label: string, value: string) => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); fireEvent.blur(screen.getByLabelText(label)); };
beforeEach(() => useProjectStore.setState({ project: makeEmptyProject('Plan edits'), selection: { kind: 'none' }, tab: 'rooms' }));
afterEach(cleanup);

describe('room diagram geometry', () => {
  it('resizes from opposite corners without converting rectangles into polygons', () => {
    expect(moveRoomHandle(rect, { kind: 'corner', index: 2 }, { x: 320, y: -240 }).shape).toEqual({ ...rect, length: 4320, width: 2760 });
    const left = moveRoomHandle(rect, { kind: 'corner', index: 0 }, { x: -320, y: 240 });
    expect(left.shape).toEqual({ ...rect, length: 4320, width: 2760 });
    expect(left.polygon[0]).toEqual({ x: -320, y: 240 });
    expect(moveRoomHandle(rect, { kind: 'corner', index: 2 }, { x: -5000, y: -4000 }).shape).toEqual({ ...rect, length: 10, width: 10 });
  });
  it('moves a wall perpendicular to its line and keeps the L-shape cutout editable', () => {
    expect(moveRoomHandle(rect, { kind: 'wall', index: 1 }, { x: 350, y: 650 }).shape).toEqual({ ...rect, length: 4350 });
    const l: RoomShape = { kind: 'l_shape', length: 5000, width: 4000, cutoutLength: 1500, cutoutWidth: 1200, cutoutCorner: 'top-right' };
    const edited = moveRoomHandle(l, { kind: 'corner', index: 2 }, { x: -250, y: 150 });
    expect(edited.shape).toEqual({ ...l, cutoutLength: 1750, cutoutWidth: 1350 });
    expect(shapeToPolygon(edited.shape)).toEqual(edited.polygon);
  });
  it('rejects crossings, touching walls and lost corners', () => {
    expect(outlineProblem([{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }, { x: 1000, y: 0 }])).toMatch(/cross/);
    expect(outlineProblem([{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 1000, y: 0 }, { x: 0, y: 2000 }])).toMatch(/touch/);
    expect(outlineProblem([{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }])).toMatch(/remove a corner/);
    expect(outlineProblem(insertRoomCorner(shapeToPolygon(rect), 0))).toBeNull();
  });
  it('keeps openings on their existing walls and reanchors them when another wall is split', () => {
    const door: Doorway = { id: 'door', edgeIndex: 1, offset: 600, width: 838, transition: 'carpet', sharedOpeningId: 'shared' };
    const before = shapeToPolygon(rect);
    const after = insertRoomCorner(before, 0);
    const moved = diagramDoorways([door], before, after, true)[0]!;
    expect(moved).toEqual({ ...door, edgeIndex: 2 });
    expect(diagramDoorways([{ ...door, offset: 2500 }], before, before)[0]!.offset).toBe(2162);
  });
});

describe('linked room measurements and plan', () => {
  it('updates rectangle details and quantities from a diagram corner and supports one-step undo', () => {
    const id = useProjectStore.getState().addRoom({ name: 'Lounge' });
    render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit corner 3' }));
    fireEvent.keyDown(screen.getByRole('group', { name: 'Editable plan of Lounge' }), { key: 'ArrowRight', shiftKey: true });
    expect(room(id).shape).toEqual({ ...rect, length: 4100 });
    expect((screen.getByLabelText('Room length') as HTMLInputElement).value).toBe('4.1');
    expect(screen.getByTestId('figure-area').textContent).toBe('12.30 m²');
    fireEvent.click(screen.getByRole('button', { name: 'Undo shape edit' }));
    expect(room(id).shape).toEqual(rect);
  });
  it('updates the selected wall and rendered polygon when dimensions are typed', () => {
    const id = useProjectStore.getState().addRoom({ name: 'Study' });
    const { container } = render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit wall 1' }));
    typeLength('Selected wall length', '4.75');
    expect(room(id).shape).toEqual({ ...rect, length: 4750 });
    expect((screen.getByLabelText('Room length') as HTMLInputElement).value).toBe('4.75');
    typeLength('Room length', '5.123');
    expect((screen.getByLabelText('Selected wall length') as HTMLInputElement).value).toBe('5.123');
    expect(container.querySelector('polygon.room')?.getAttribute('points')).toContain('5123,3000');
  });
  it('adds a movable corner to the plan and updates the outline details, then deletes and undoes it', () => {
    const id = useProjectStore.getState().addRoom({ name: 'Hall', doorways: [] });
    render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit wall 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add corner to this wall' }));
    expect(room(id).shape.kind).toBe('polygon');
    expect(shapeToPolygon(room(id).shape)).toHaveLength(5);
    expect(screen.getByLabelText('Point 3 x')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('group', { name: 'Editable plan of Hall' }), { key: 'ArrowRight', shiftKey: true });
    expect((screen.getByLabelText('Point 3 x') as HTMLInputElement).value).toBe('4.25');
    fireEvent.click(screen.getByRole('button', { name: 'Delete corner' }));
    expect(shapeToPolygon(room(id).shape)).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Undo shape edit' }));
    expect(shapeToPolygon(room(id).shape)).toHaveLength(5);
  });
  it('restores floor-plan association and doorway data on undo, and preserves unchanged imperial values', () => {
    const source = { floorPlanId: 'plan', pixelPolygon: [{ x: 1, y: 1 }, { x: 401, y: 1 }, { x: 401, y: 301 }, { x: 1, y: 301 }] };
    const id = useProjectStore.getState().addRoom({ name: 'Linked room', source });
    const doors = structuredClone(room(id).doorways);
    useProjectStore.getState().updateProject({ displayUnit: 'imperial' });
    render(<RoomEditor roomId={id}/>);
    fireEvent.blur(screen.getByLabelText('Room length'));
    expect(room(id).source).toEqual(source);
    fireEvent.click(screen.getByRole('button', { name: 'Edit wall 2' }));
    fireEvent.keyDown(screen.getByRole('group', { name: 'Editable plan of Linked room' }), { key: 'ArrowRight' });
    expect(room(id).source).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Undo shape edit' }));
    expect(room(id).source).toEqual(source);
    expect(room(id).doorways).toEqual(doors);
    expect(room(id).shape).toEqual(rect);
  });
  it('refuses a diagram change that would lose an existing doorway', () => {
    const id = useProjectStore.getState().addRoom({ name: 'Door room', doorways: [{ id: 'door', edgeIndex: 0, offset: 100, width: 3500, transition: 'carpet' }] });
    render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit wall 1' }));
    typeLength('Selected wall length', '3');
    expect(room(id).shape).toEqual(rect);
    expect(screen.getByRole('status').textContent).toMatch(/narrower than its doorway/);
    expect((screen.getByLabelText('Selected wall length') as HTMLInputElement).value).toBe('4');
  });
  it('keeps doorway offsets when an added top corner changes the normalized origin', () => {
    const id = useProjectStore.getState().addRoom({ name: 'Bay room', doorways: [{ id: 'door', edgeIndex: 1, offset: 600, width: 838, transition: 'carpet' }] });
    render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit wall 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add corner to this wall' }));
    expect(room(id).doorways[0]).toMatchObject({ edgeIndex: 2, offset: 600, width: 838 });
  });
});
