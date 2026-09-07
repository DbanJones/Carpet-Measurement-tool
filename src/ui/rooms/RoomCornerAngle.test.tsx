import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Polygon, RoomShape } from '@engine/types';
import { edgeLength, shapeToPolygon } from '@engine/geometry';
import { makeEmptyProject, useProjectStore } from '@store/projectStore';
import { RoomEditor } from './RoomEditor';
import { outlineProblem, roomCornerAngle, setRoomCornerAngle } from './roomDiagramGeometry';

const irregular: RoomShape = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 4200, y: 120 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] };
const state = () => useProjectStore.getState();
const currentRoom = (id: string) => state().project.rooms.find(room => room.id === id)!;
const applyAngle = (value: string) => { fireEvent.change(screen.getByLabelText('Selected corner angle'), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: 'Apply angle' })); };
beforeEach(() => useProjectStore.setState({ project: makeEmptyProject(), revision: 0, selection: { kind: 'none' }, tab: 'rooms', newSpaceProductId: null }));
afterEach(cleanup);

describe('exact room corner angles', () => {
  it('squares a skewed imported corner without moving any of the other three corners', () => {
    const result = setRoomCornerAngle(irregular, 1, 90);
    expect(result.error).toBeUndefined();
    const points = result.edit!.polygon;
    expect(roomCornerAngle(points, 1)).toBeCloseTo(90, 9);
    expect(points.filter((_, index) => index !== 1)).toEqual(shapeToPolygon(irregular).filter((_, index) => index !== 1));
    expect(edgeLength(points, 2)).toBe(4000);
    expect(outlineProblem(points)).toBeNull();
  });

  it.each([60, 105, 135])('sets a custom %d degree corner precisely', angle => {
    const result = setRoomCornerAngle(irregular, 1, angle);
    expect(result.error).toBeUndefined();
    expect(roomCornerAngle(result.edit!.polygon, 1)).toBeCloseTo(angle, 8);
    expect(outlineProblem(result.edit!.polygon)).toBeNull();
  });

  it('distinguishes a concave inward corner and works in either winding', () => {
    const points: Polygon = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 1800 }, { x: 2200, y: 1900 }, { x: 2000, y: 4000 }, { x: 0, y: 4000 }];
    expect(roomCornerAngle(points, 3)).toBeGreaterThan(180);
    const result = setRoomCornerAngle({ kind: 'polygon', points }, 3, 270);
    expect(result.error).toBeUndefined();
    expect(roomCornerAngle(result.edit!.polygon, 3)).toBeCloseTo(270, 9);
    const reversed = setRoomCornerAngle({ kind: 'polygon', points: points.slice().reverse() }, 2, 270);
    expect(reversed.error).toBeUndefined();
    expect(roomCornerAngle(reversed.edit!.polygon, 2)).toBeCloseTo(270, 9);
  });

  it('rejects degenerate, nonnumeric and crossing changes without mutating the original', () => {
    const saved = structuredClone(irregular);
    for (const angle of [0, 180, 360, NaN]) expect(setRoomCornerAngle(irregular, 1, angle).error).toMatch(/interior angle/);
    expect(setRoomCornerAngle({ kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }] }, 1, 270).error).toMatch(/cross or collapse/);
    expect(irregular).toEqual(saved);
  });
});

describe('angle controls and linked measurements', () => {
  it('updates the SVG, exact outline fields and door data, and restores the imported source on undo', () => {
    const source = { floorPlanId: 'import', pixelPolygon: shapeToPolygon(irregular).map(p => ({ x: p.x / 10, y: p.y / 10 })) };
    const doors = [{ id: 'door', edgeIndex: 2, offset: 300, width: 838, transition: 'carpet' as const }];
    const id = state().addRoom({ name: 'Skewed lounge', shape: irregular, source, doorways: doors });
    const { container } = render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit corner 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make right angle · 90°' }));
    expect(roomCornerAngle(shapeToPolygon(currentRoom(id).shape), 1)).toBeCloseTo(90, 8);
    expect(currentRoom(id).doorways).toEqual(doors);
    expect(currentRoom(id).source).toBeUndefined();
    expect(container.querySelector('.room-angle-marker text')?.textContent).toBe('90°');
    expect((screen.getByLabelText('Selected corner angle') as HTMLInputElement).value).toBe('90.0');
    expect(screen.getByLabelText('Point 2 x')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo shape edit' }));
    expect(currentRoom(id).shape).toEqual(irregular);
    expect(currentRoom(id).source).toEqual(source);
    expect(currentRoom(id).doorways).toEqual(doors);
  });

  it('lets Enter apply a custom angle and explains invalid input while retaining the measured room', () => {
    const id = state().addRoom({ shape: irregular, doorways: [] }); render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit corner 2' }));
    fireEvent.change(screen.getByLabelText('Selected corner angle'), { target: { value: '105' } });
    fireEvent.keyDown(screen.getByLabelText('Selected corner angle'), { key: 'Enter' });
    expect(roomCornerAngle(shapeToPolygon(currentRoom(id).shape), 1)).toBeCloseTo(105, 8);
    const saved = structuredClone(currentRoom(id).shape);
    applyAngle('180');
    expect(currentRoom(id).shape).toEqual(saved);
    expect(screen.getByRole('status').textContent).toMatch(/Delete corner/);
    applyAngle('');
    expect(currentRoom(id).shape).toEqual(saved);
  });

  it('shows the inward-square shortcut instead of silently flattening a concave corner', () => {
    const shape: RoomShape = { kind: 'l_shape', length: 5000, width: 4000, cutoutLength: 2000, cutoutWidth: 2000, cutoutCorner: 'top-right' };
    const points = shapeToPolygon(shape), inward = points.findIndex((_, i) => roomCornerAngle(points, i) > 180);
    const id = state().addRoom({ shape, doorways: [] }); render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: `Edit corner ${inward + 1}` }));
    expect(screen.getByText('Inward corner')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Square inward corner · 270°' }));
    expect(currentRoom(id).shape).toEqual(shape);
  });

  it('keeps blank house drawings linked as room dimensions change, prevents overlaps and supports undo', () => {
    const plan = state().addFloorPlan({ name: 'House sketch', imageDataUrl: 'data:image/png;base64,AA==', widthPx: 1000, heightPx: 1000, mmPerPx: 20, sketch: { gridMm: 1000 } });
    const source = { floorPlanId: plan, pixelPolygon: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }, { x: 100, y: 250 }] };
    const id = state().addRoom({ name: 'Lounge', source, doorways: [] });
    state().addRoom({ name: 'Neighbour', source: { floorPlanId: plan, pixelPolygon: [{ x: 350, y: 100 }, { x: 550, y: 100 }, { x: 550, y: 250 }, { x: 350, y: 250 }] } });
    render(<RoomEditor roomId={id}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit corner 3' }));
    fireEvent.keyDown(screen.getByRole('group', { name: 'Editable plan of Lounge' }), { key: 'ArrowRight', shiftKey: true });
    expect(currentRoom(id).source?.pixelPolygon[1]).toEqual({ x: 305, y: 100 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo shape edit' }));
    expect(currentRoom(id).source).toEqual(source);
    fireEvent.change(screen.getByLabelText('Room length'), { target: { value: '6' } }); fireEvent.blur(screen.getByLabelText('Room length'));
    expect(currentRoom(id).source).toEqual(source);
    expect(screen.getByRole('status').textContent).toMatch(/overlap Neighbour/);
    fireEvent.change(screen.getByLabelText('Room length'), { target: { value: '5' } }); fireEvent.blur(screen.getByLabelText('Room length'));
    expect(currentRoom(id).source?.pixelPolygon[1]).toEqual({ x: 350, y: 100 });
  });
});
