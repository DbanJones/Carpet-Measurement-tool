import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Doorway, Point, Polygon, Room, RoomShape } from '@engine/types';
import { boundingBox, edgeLength, normalizePolygon, shapeToPolygon } from '@engine/geometry';
import { useProjectStore } from '@store/projectStore';
import { Field, LengthInput } from '@ui/components/inputs';
import { RoomPreview, safePolygon } from './RoomPreview';
import { ShapeEditor, ShapeFigures, remapDoorways } from './ShapeEditor';
import { diagramDoorways, insertRoomCorner, moveRoomHandle, outlineProblem, roomCornerAngle, setRoomCornerAngle, type RoomHandle } from './roomDiagramGeometry';
import { RoomCornerAngle, RoomCornerAngleMarker } from './RoomCornerAngle';
import { outlinesOverlap } from '@ui/floorplan/outlineEditing';

type Geometry = Pick<Room, 'shape' | 'doorways' | 'source'>;
type History = { before: Geometry; after: Geometry };
const geometry = (room: Room): Geometry => structuredClone({ shape: room.shape, doorways: room.doorways, source: room.source });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Shared measurements and SVG editor: a pointer gesture is one undoable change, with live quantities. */
export function RoomPlanEditor({ room, unit, pileArrow }: { room: Room; unit: 'metric' | 'imperial'; pileArrow?: 'along_length' | 'along_width' }) {
  const updateRoom = useProjectStore(s => s.updateRoom);
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<RoomHandle | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [message, setMessage] = useState('');
  const [fieldEdit, setFieldEdit] = useState(0);
  const [lockedView, setLockedView] = useState<string>();
  const [preview, setPreview] = useState<Polygon>();
  const drag = useRef<{ pointerId: number; handle: RoomHandle; origin: Point; before: Geometry } | null>(null);
  const currentRoom = () => useProjectStore.getState().project.rooms.find(r => r.id === room.id)!;
  const currentPolygon = safePolygon(room.shape);
  const polygon = preview ?? currentPolygon;
  const box = polygon.length > 2 ? boundingBox(polygon) : { length: 4000, width: 3000 };
  const size = Math.max(box.length, box.width, 1);
  const canUndo = history.length > 0 && equal(history[history.length - 1]!.after, geometry(room));
  const remember = (before: Geometry) => {
    const after = geometry(currentRoom());
    if (!equal(before, after)) setHistory(entries => [...entries.slice(-29), { before, after }]);
  };

  const sourceForEdit = (before: Geometry, points: Polygon): { source?: Room['source']; error?: string } => {
    const project = useProjectStore.getState().project;
    const plan = project.floorPlans.find(plan => plan.id === before.source?.floorPlanId);
    if (!plan?.sketch || !plan.mmPerPx || !before.source?.pixelPolygon.length) return {};
    const origin = { x: Math.min(...before.source.pixelPolygon.map(p => p.x)), y: Math.min(...before.source.pixelPolygon.map(p => p.y)) };
    const pixelPolygon = points.map(p => ({ x: origin.x + p.x / plan.mmPerPx!, y: origin.y + p.y / plan.mmPerPx! }));
    if (pixelPolygon.some(p => p.x < 0 || p.y < 0 || p.x > plan.widthPx || p.y > plan.heightPx)) return { error: 'That edit goes outside the drawing sheet. Reposition the room on the house drawing first.' };
    const clash = [...project.rooms, ...project.staircases].find(space => space.id !== room.id && space.source?.floorPlanId === plan.id && outlinesOverlap(pixelPolygon, space.source.pixelPolygon));
    if (clash) return { error: `That edit would overlap ${clash.name} on the house drawing. Move its outline or adjust this room first.` };
    return { source: { floorPlanId: plan.id, pixelPolygon } };
  };

  const changeShape = (shape: RoomShape, doors?: Doorway[]) => {
    const before = geometry(currentRoom());
    if (equal(before.shape, shape)) return;
    const next = safePolygon(shape);
    const link = sourceForEdit(before, next);
    if (link.error) { setMessage(link.error); return; }
    updateRoom(room.id, { shape, source: link.source, doorways: doors ?? remapDoorways(before.doorways, next) });
    remember(before);
    setMessage('Measurements and plan updated.');
    if (shape.kind !== before.shape.kind || next.length !== safePolygon(before.shape).length) setSelected(null);
  };

  const applyDiagram = (nextShape: RoomShape, rawPolygon: Polygon, before: Geometry, topologyChanged = false): boolean => {
    const issue = outlineProblem(rawPolygon);
    if (issue) { setMessage(issue); return false; }
    const next = shapeToPolygon(nextShape);
    // Match openings in the same coordinate frame before normalizing an outward corner back to zero.
    const doors = diagramDoorways(before.doorways, shapeToPolygon(before.shape), topologyChanged ? rawPolygon : next, topologyChanged);
    if (doors.some(d => edgeLength(next, d.edgeIndex) < d.width)) {
      setMessage('That wall would be narrower than its doorway. Move the doorway or keep the wall longer.'); return false;
    }
    if (equal(before.shape, nextShape)) { if (!equal(geometry(currentRoom()), before)) updateRoom(room.id, before); return true; }
    const link = sourceForEdit(before, rawPolygon);
    if (link.error) { setMessage(link.error); return false; }
    updateRoom(room.id, { shape: nextShape, source: link.source, doorways: doors });
    setMessage(topologyChanged && doors.length ? 'Outline updated. Doorways followed the nearest wall; check their positions.' : 'Measurements and plan updated.');
    return true;
  };

  const undo = () => {
    if (!canUndo || drag.current) return;
    const last = history[history.length - 1]!;
    updateRoom(room.id, last.before);
    setHistory(entries => entries.slice(0, -1)); setSelected(null); setMessage('Last shape edit undone.');
  };
  const pointAt = (event: PointerEvent<SVGElement>): Point | null => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const begin = (event: PointerEvent<SVGGElement>, handle: RoomHandle) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    setSelected(handle); event.currentTarget.focus();
    const point = pointAt(event);
    if (!point) return;
    drag.current = { pointerId: event.pointerId, handle, origin: point, before: geometry(currentRoom()) };
    setLockedView(svgRef.current?.getAttribute('viewBox') ?? undefined);
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const point = pointAt(event); if (!point) return;
    const delta = { x: Math.round((point.x - active.origin.x) / 10) * 10, y: Math.round((point.y - active.origin.y) / 10) * 10 };
    if (delta.x === 0 && delta.y === 0 && !preview) return;
    const edit = moveRoomHandle(active.before.shape, active.handle, delta);
    if (applyDiagram(edit.shape, edit.polygon, active.before)) setPreview(edit.polygon);
  };
  const finish = (cancel = false) => {
    const active = drag.current; if (!active) return;
    if (cancel) { updateRoom(room.id, active.before); setMessage('Drag cancelled. Measurements restored.'); }
    else remember(active.before);
    drag.current = null; setPreview(undefined); setLockedView(undefined);
    if (svgRef.current?.hasPointerCapture(active.pointerId)) svgRef.current.releasePointerCapture(active.pointerId);
  };
  const nudge = (handle: RoomHandle, delta: Point) => {
    const before = geometry(currentRoom());
    const edit = moveRoomHandle(before.shape, handle, delta);
    if (applyDiagram(edit.shape, edit.polygon, before)) remember(before);
  };
  const deleteCorner = () => {
    if (selected?.kind !== 'corner' || currentPolygon.length <= 3) return;
    const before = geometry(currentRoom());
    const raw = currentPolygon.filter((_, i) => i !== selected.index);
    if (applyDiagram({ kind: 'polygon', points: normalizePolygon(raw) }, raw, before, true)) { remember(before); setSelected(null); }
  };
  const insertCorner = () => {
    if (selected?.kind !== 'wall') return;
    const before = geometry(currentRoom());
    const raw = insertRoomCorner(currentPolygon, selected.index);
    if (applyDiagram({ kind: 'polygon', points: normalizePolygon(raw) }, raw, before, true)) { remember(before); setSelected({ kind: 'corner', index: selected.index + 1 }); }
  };
  const keyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); if (drag.current) finish(true); else setSelected(null); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
    if (!selected || drag.current) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteCorner(); return; }
    const step = event.shiftKey ? 100 : 10;
    const delta = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[event.key];
    if (delta) { event.preventDefault(); nudge(selected, delta); }
  };
  const selectedWall = selected?.kind === 'wall' && selected.index < currentPolygon.length ? selected.index : null;
  const selectedCorner = selected?.kind === 'corner' && selected.index < currentPolygon.length ? selected.index : null;
  const changeAngle = (degrees: number) => {
    if (selectedCorner === null) return;
    const before = geometry(currentRoom());
    const result = setRoomCornerAngle(before.shape, selectedCorner, degrees);
    if (!result.edit) { setMessage(result.error ?? 'Unable to set that angle.'); return; }
    if (applyDiagram(result.edit.shape, result.edit.polygon, before)) {
      remember(before);
      setMessage(`Corner ${selectedCorner + 1} set to ${degrees}°. Check the two adjoining wall lengths.`);
    }
  };

  return <div className="room-plan-workspace">
    <div className="room-metric-cards"><ShapeFigures shape={room.shape} unit={unit}/></div>
    <div className="room-design-grid">
      <div className="room-plan-card">
        <header><div><strong>Edit the room plan</strong><span>Drag a corner or wall. Dimensions update as you move.</span></div><button type="button" disabled={!canUndo || !!drag.current} onClick={undo}>Undo shape edit</button></header>
        <RoomPreview room={room} unit={unit} showPileArrow={pileArrow} className="room-editable-plan" editing={{ viewBox: lockedView, polygon: preview, svgProps: { ref: svgRef, tabIndex: 0, onPointerMove: move, onPointerUp: () => finish(), onPointerCancel: () => finish(true), onKeyDown: keyDown }, children: <g className="room-edit-handles">
          {selectedCorner !== null && <RoomCornerAngleMarker points={polygon} index={selectedCorner} size={size}/>}
          {polygon.map((a, i) => {
            const b = polygon[(i + 1) % polygon.length]!;
            const active = selected?.kind === 'wall' && selected.index === i;
            return <g key={`wall-${i}`} className={`room-wall-handle${active ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Edit wall ${i + 1}`} aria-pressed={active} data-room-wall={i} onPointerDown={event => begin(event, { kind: 'wall', index: i })} onClick={() => setSelected({ kind: 'wall', index: i })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ kind: 'wall', index: i }); } }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="room-wall-hit" vectorEffect="non-scaling-stroke"/><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="room-wall-highlight" vectorEffect="non-scaling-stroke"/>
            </g>;
          })}
          {polygon.map((p, i) => <g key={`corner-${i}`} className={`room-corner-handle${selected?.kind === 'corner' && selected.index === i ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Edit corner ${i + 1}`} aria-pressed={selected?.kind === 'corner' && selected.index === i} data-room-corner={i} onPointerDown={event => begin(event, { kind: 'corner', index: i })} onClick={() => setSelected({ kind: 'corner', index: i })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ kind: 'corner', index: i }); } }}>
            <circle cx={p.x} cy={p.y} r={size * .038} className="room-corner-hit"/><circle cx={p.x} cy={p.y} r={size * .011} className="room-corner-dot" vectorEffect="non-scaling-stroke"/>
          </g>)}
        </g> }}/>
        <div className="room-plan-inspector">
          {selected ? <><div className="room-inspector-heading"><strong>{selected.kind === 'wall' ? 'Wall' : 'Corner'} {selected.index + 1}</strong><button className="link" type="button" onClick={() => setSelected(null)}>Clear selection</button></div>
            {selectedWall !== null ? <div className="room-wall-fields"><Field label="Wall length"><LengthInput key={fieldEdit} value={edgeLength(currentPolygon, selectedWall)} unit={unit} min={10} ariaLabel="Selected wall length" onChange={length => { const a = currentPolygon[selectedWall]!, b = currentPolygon[(selectedWall + 1) % currentPolygon.length]!, old = edgeLength(currentPolygon, selectedWall); nudge({ kind: 'corner', index: (selectedWall + 1) % currentPolygon.length }, { x: (b.x - a.x) * (length / old - 1), y: (b.y - a.y) * (length / old - 1) }); setFieldEdit(value => value + 1); }}/></Field><button type="button" onClick={insertCorner}>Add corner to this wall</button></div> : <div className="room-corner-actions"><span>Drag to move, or use arrow keys: 10 mm. Shift + arrow: 100 mm.</span><button type="button" disabled={currentPolygon.length <= 3} onClick={deleteCorner}>Delete corner</button></div>}
            {selectedCorner !== null && <RoomCornerAngle key={selectedCorner} angle={roomCornerAngle(currentPolygon, selectedCorner)} onChange={changeAngle}/>}
          </> : <p>Select a wall for its exact length, or select a corner to move it or set its angle. Changes are saved automatically.</p>}
          <p className="room-edit-status" role="status">{message || 'Rectangles and L shapes keep their square corners.'}</p>
        </div>
        <p className="room-plan-footnote">Drag snaps to 10 mm; type a measurement for millimetre precision. Escape cancels a drag.{room.shape.kind === 'rectangle_with_features' ? ' Moving this outline converts its wall features into editable corners.' : ''}</p>
      </div>
      <div className="room-dimension-card"><h4>Shape & dimensions</h4><p className="field-hint">{unit === 'metric' ? 'Enter metres, or include cm or mm.' : 'Enter feet and inches, or include a metric unit.'} Every edit updates the plan and estimate.</p><ShapeEditor room={room} unit={unit} onShapeChange={changeShape} showFigures={false}/></div>
    </div>
  </div>;
}
