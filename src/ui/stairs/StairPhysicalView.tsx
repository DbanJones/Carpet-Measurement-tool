import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import type { Staircase } from '@engine/types';
import { formatLength } from '@ui/components/inputs';
import { DEFAULT_STAIR_ORBIT, isStairPointVisible, layoutStairLabels, normaliseStairOrbit, physicalStairFaces, projectStairPoint, raisedStairSurfaces, type RaisedPoint, type StairOrbit, type StairView } from './stairPhysicalGeometry';
import './stair-physical-view.css';

const VIEWS: { value: StairView; label: string }[] = [{ value: 'side', label: 'Side' }, { value: 'front', label: 'Front' }, { value: '3d', label: '3D' }];
const W = 420; const H = 320;
const round = (value: number) => value.toFixed(2);
const clampZoom = (value: number) => Math.max(.65, Math.min(3, value));
export interface StairSelectionModifiers { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
const modifiers = (event: StairSelectionModifiers): StairSelectionModifiers => ({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey });

export function StairPhysicalView({ staircase, unit, selectedId, selectedIds, onSelect }: {
  staircase: Staircase;
  unit: 'metric' | 'imperial';
  selectedId?: string;
  selectedIds?: string[];
  onSelect?: (id: string, modifiers?: StairSelectionModifiers) => void;
}) {
  const [view, setView] = useState<StairView>('side');
  const [orbit, setOrbit] = useState<StairOrbit>({ ...DEFAULT_STAIR_ORBIT });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef({ points: new Map<number, { x: number; y: number }>(), moved: false, distance: 0, pieceId: undefined as string | undefined });
  const suppressClick = useRef(false);
  const descriptionId = useId();
  const { surfaces, totalRise } = raisedStairSurfaces(staircase);
  const faces = physicalStairFaces(surfaces, view, orbit);
  const selectedSet = new Set(selectedIds ?? (selectedId ? [selectedId] : []));
  const footprint = surfaces.flatMap(surface => surface.points);
  const planMinX = Math.min(0, ...footprint.map(point => point.x));
  const planMinY = Math.min(0, ...footprint.map(point => point.y));
  const planWidth = Math.max(1, ...footprint.map(point => point.x));
  const planHeight = Math.max(1, ...footprint.map(point => point.y));
  const ground: RaisedPoint[] = [{ x: planMinX, y: planMinY, z: 0 }, { x: planWidth, y: planMinY, z: 0 }, { x: planWidth, y: planHeight, z: 0 }, { x: planMinX, y: planHeight, z: 0 }];
  const bounds = surfaces.flatMap((surface) => surface.points.flatMap((point) => [projectStairPoint({ ...point, z: surface.elevation }, view, orbit), projectStairPoint({ ...point, z: 0 }, view, orbit)]));
  const minX = Math.min(0, ...bounds.map(p => p.x)); const maxX = Math.max(1, ...bounds.map(p => p.x));
  const minY = Math.min(-1, ...bounds.map(p => p.y)); const maxY = Math.max(0, ...bounds.map(p => p.y));
  const scale = Math.min((W - 95) / Math.max(1, maxX - minX), (H - 72) / Math.max(1, maxY - minY));
  const left = 28 + (W - 95 - (maxX - minX) * scale) / 2;
  const top = 28 + (H - 72 - (maxY - minY) * scale) / 2;
  // A fixed orbit centre and radius prevent the view jumping or resizing as it turns.
  const orbitCentre = { x: (planMinX + planWidth) / 2, y: (planMinY + planHeight) / 2, z: totalRise / 2 };
  const radius = Math.max(1, Math.hypot(planWidth - planMinX, planHeight - planMinY, totalRise) / 2);
  const orbitScale = Math.min(W - 48, H - 48) / (2 * radius) * zoom;
  const project = (point: RaisedPoint) => {
    if (view === '3d') {
      const p = projectStairPoint({ x: point.x - orbitCentre.x, y: point.y - orbitCentre.y, z: point.z - orbitCentre.z }, view, orbit);
      return { x: W / 2 + p.x * orbitScale, y: H / 2 + p.y * orbitScale };
    }
    const p = projectStairPoint(point, view);
    return { x: left + (p.x - minX) * scale, y: top + (p.y - minY) * scale };
  };
  const points = (vertices: RaisedPoint[]) => vertices.map(vertex => { const p = project(vertex); return `${round(p.x)},${round(p.y)}`; }).join(' ');
  const first = surfaces.find(surface => surface.stepIndex === 0);
  const last = [...surfaces].reverse().find(surface => surface.stepIndex !== undefined);
  const basePoint = first ? { ...first.centre, z: 0 } : { x: 0, y: 0, z: 0 };
  const lower = project(basePoint), upper = project({ ...basePoint, z: totalRise });
  const dimX = W - 36;
  const selected = surfaces.find(surface => selectedSet.has(surface.id));
  const labelPoint = (surface: typeof surfaces[number]): RaisedPoint => ({ ...surface.centre, z: view === '3d' && orbit.pitch < 0 ? surface.lowerElevation : surface.elevation });
  const labels = layoutStairLabels(surfaces.filter(surface => selectedSet.has(surface.id) || surface === first || surface === last || isStairPointVisible(labelPoint(surface), surface.id, faces, view, orbit)).map(surface => ({
    ...project(labelPoint(surface)), id: surface.id, text: surface.stepIndex !== undefined ? String(surface.stepIndex + 1) : 'L',
    selected: selectedSet.has(surface.id),
    end: surface === first && surface === last ? 'both' as const : surface === first ? 'start' as const : surface === last ? 'top' as const : undefined,
  })), view === '3d');
  const currentLabel = VIEWS.find(item => item.value === view)!.label;
  const choose = (id: string, event: StairSelectionModifiers) => {
    if (!onSelect) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey) onSelect(id, modifiers(event));
    else onSelect(id);
  };
  const rotate = (yaw: number, pitch: number) => setOrbit(current => normaliseStairOrbit({ yaw: current.yaw + yaw, pitch: current.pitch + pitch }));
  const reset = () => { setOrbit({ ...DEFAULT_STAIR_ORBIT }); setZoom(1); };
  const changeView = (next: StairView) => { gesture.current.points.clear(); setDragging(false); suppressClick.current = false; setView(next); };
  useEffect(() => {
    const element = svg.current;
    if (view !== '3d' || !element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? H : 1);
      setZoom(current => clampZoom(current * Math.exp(-delta * .0015)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [view, surfaces.length]);
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (view !== '3d' || event.button !== 0) return;
    const state = gesture.current;
    if (state.points.size === 0) {
      state.moved = false; state.distance = 0; suppressClick.current = false;
      const target = (event.target as Element).closest('[data-physical-piece], [data-physical-target]');
      state.pieceId = target?.getAttribute('data-physical-piece') ?? target?.getAttribute('data-physical-target') ?? undefined;
    } else state.moved = true;
    state.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const state = gesture.current, previous = state.points.get(event.pointerId);
    if (view !== '3d' || !previous) return;
    const before = [...state.points.values()];
    state.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...state.points.values()];
    if (after.length >= 2) {
      const oldDistance = Math.hypot(before[0]!.x - before[1]!.x, before[0]!.y - before[1]!.y);
      const newDistance = Math.hypot(after[0]!.x - after[1]!.x, after[0]!.y - after[1]!.y);
      if (oldDistance > 5) setZoom(current => clampZoom(current * newDistance / oldDistance));
      state.moved = true; setDragging(true);
      return;
    }
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    state.distance += Math.hypot(dx, dy);
    if (state.distance > 4) { state.moved = true; rotate(dx * .45, dy * .45); setDragging(true); }
  };
  const pointerEnd = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    const state = gesture.current;
    if (!state.points.has(event.pointerId)) return;
    state.points.delete(event.pointerId);
    if (!state.points.size) {
      if (!cancelled && !state.moved && state.pieceId) choose(state.pieceId, event);
      suppressClick.current = true; setDragging(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <section className="stair-physical-view" aria-label="Physical staircase view">
    <header className="stair-physical-header">
      <div><h3>See the height</h3><p>{view === '3d' ? 'Turn it to inspect every angle' : 'Linked to your drawing'}</p></div>
      <div className="stair-view-switch" role="group" aria-label="Staircase viewing angle">
        {VIEWS.map(item => <button key={item.value} type="button" aria-pressed={view === item.value} onClick={() => changeView(item.value)}>{item.label}</button>)}
      </div>
    </header>
    {surfaces.length ? <svg ref={svg} className={`stair-physical-svg${view === '3d' ? ' orbitable' : ''}${dragging ? ' dragging' : ''}`} viewBox={`0 0 ${W} ${H}`} role="group" tabIndex={view === '3d' ? 0 : undefined} aria-label={`${currentLabel} view of physical staircase: ${staircase.steps.length} risers, ${formatLength(totalRise, unit)} total rise`} aria-describedby={descriptionId}
      data-orbit-yaw={orbit.yaw} data-orbit-pitch={orbit.pitch} data-orbit-zoom={zoom}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)}
      onKeyDown={event => {
        if (view !== '3d' || event.target !== event.currentTarget) return;
        const increment = event.shiftKey ? 30 : 10;
        if (event.key === 'ArrowLeft') rotate(-increment, 0);
        else if (event.key === 'ArrowRight') rotate(increment, 0);
        else if (event.key === 'ArrowUp') rotate(0, increment);
        else if (event.key === 'ArrowDown') rotate(0, -increment);
        else if (event.key === '+' || event.key === '=') setZoom(current => clampZoom(current * 1.2));
        else if (event.key === '-' || event.key === '_') setZoom(current => clampZoom(current / 1.2));
        else if (event.key === 'Home' || event.key.toLowerCase() === 'r') reset();
        else return;
        event.preventDefault();
      }}>
      {view === '3d' ? (orbit.pitch >= 0 ? <polygon className="stair-physical-ground" points={points(ground)} /> : null) : <>
        <line className="stair-physical-floor" x1="20" y1={lower.y} x2={W - 56} y2={lower.y} />
        <line className="stair-physical-level" x1="20" y1={upper.y} x2={W - 56} y2={upper.y} />
        <text className="stair-physical-floor-label" x="20" y={lower.y + 16}>Lower floor</text>
        <text className="stair-physical-floor-label" x="20" y={Math.max(12, upper.y - 21)}>Top tread / landing level</text>
      </>}
      {faces.map(face => {
        const surface = surfaces.find(item => item.id === face.pieceId)!;
        const isSelected = selectedSet.has(face.pieceId);
        const fill = isSelected ? (face.kind === 'surface' ? '#f5bc5a' : '#dc9a32') : face.kind === 'surface' ? (surface.kind === 'landing' ? '#c6e9e1' : surface.kind === 'winder' ? '#7fc2b6' : '#a9d7cc') : `hsl(165 27% ${Math.round(face.shade * 67)}%)`;
        return <polygon key={face.id} data-physical-face={face.kind} data-physical-piece={face.pieceId} data-elevation={surface.elevation} points={points(face.points)} fill={fill} className={`stair-physical-face${isSelected ? ' selected' : ''}${onSelect ? ' selectable' : ''}`} onClick={onSelect ? event => { if (!suppressClick.current) choose(face.pieceId, event); } : undefined}><title>{surface.label} · {formatLength(surface.elevation, unit)} above lower floor</title></polygon>;
      })}
      {surfaces.map(surface => {
        const p = project(labelPoint(surface)), label = labels.get(surface.id);
        const fallbackLabel = surface.stepIndex !== undefined ? String(surface.stepIndex + 1) : 'L';
        const isSelected = selectedSet.has(surface.id);
        return <g key={surface.id} data-physical-target={surface.id} className={`stair-physical-target${isSelected ? ' selected' : ''}`} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={`${surface.label}, height ${formatLength(surface.elevation, unit)}`} aria-pressed={onSelect ? isSelected : undefined} onClick={onSelect ? event => { if (!suppressClick.current) choose(surface.id, event); } : undefined} onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(surface.id, event); } } : undefined}>
          <circle className="stair-physical-focus" cx={p.x} cy={p.y} r="12" />
          {label?.leader ? <line className="stair-physical-label-leader" x1={p.x} y1={p.y} x2={label.x} y2={label.y} /> : null}
          <text className={`stair-physical-number${label ? '' : ' quiet'}`} x={label?.x ?? p.x} y={(label?.y ?? p.y) + 3} textAnchor="middle">{label?.text ?? fallbackLabel}</text>
        </g>;
      })}
      {view !== '3d' ? <g className="stair-physical-dimension">
        <line x1={dimX} y1={lower.y} x2={dimX} y2={upper.y} />
        <line x1={dimX - 4} y1={lower.y} x2={dimX + 4} y2={lower.y} />
        <line x1={dimX - 4} y1={upper.y} x2={dimX + 4} y2={upper.y} />
        <text x={dimX + 16} y={(lower.y + upper.y) / 2} textAnchor="middle" transform={`rotate(-90 ${dimX + 16} ${(lower.y + upper.y) / 2})`}>Total rise {formatLength(totalRise, unit)}</text>
      </g> : <text className="stair-physical-orbit-rise" x="15" y={H - 13}>Total rise {formatLength(totalRise, unit)}</text>}
    </svg> : <div className="empty small">Add a riser to see the staircase.</div>}
    {view === '3d' && surfaces.length > 0 ? <div className="stair-orbit-controls">
      <div className="stair-orbit-toolbar"><span>Drag to turn · scroll or pinch to zoom</span><div className="stair-orbit-zoom" role="group" aria-label="3D zoom">
        <button type="button" aria-label="Zoom staircase out" disabled={zoom <= .65} onClick={() => setZoom(current => clampZoom(current / 1.2))}>−</button>
        <output aria-label="Staircase zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label="Zoom staircase in" disabled={zoom >= 3} onClick={() => setZoom(current => clampZoom(current * 1.2))}>+</button>
        <button type="button" onClick={reset}>Reset view</button>
      </div></div>
      <details className="stair-orbit-more"><summary>More viewing angles</summary><div role="group" aria-label="Rotate staircase">
        <button type="button" onClick={() => rotate(-15, 0)}>Rotate left</button><button type="button" onClick={() => rotate(15, 0)}>Rotate right</button>
        <button type="button" onClick={() => rotate(0, 15)}>Tilt up</button><button type="button" onClick={() => rotate(0, -15)}>Tilt down</button>
        <button type="button" onClick={() => setOrbit(current => ({ ...current, pitch: 89 }))}>View from above</button>
        <button type="button" onClick={() => setOrbit(current => ({ ...current, pitch: -60 }))}>View from below</button>
        <button type="button" onClick={() => setOrbit({ yaw: 135, pitch: 30 })}>View from back</button>
      </div><p>Focus the diagram and use arrow keys to turn, + / − to zoom, or Home to reset.</p></details>
    </div> : null}
    <div className="stair-physical-caption" id={descriptionId}>
      <p>{selectedSet.size > 1 ? `${selectedSet.size} pieces selected in both views` : selected ? `${selected.label} · ${formatLength(selected.elevation, unit)} high` : 'Select a step in either view to inspect it.'}</p>
      {view === '3d' ? <p>Drag to rotate. Arrow keys turn the focused diagram; + / − zoom and Home resets the view.</p> : null}
      <p>Schematic surfaces, using your measured rises. The last tread represents the top landing level.</p>
    </div>
  </section>;
}
