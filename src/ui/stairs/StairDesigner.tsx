import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Point, Staircase, Step, StepKind } from '@engine/types';
import { useProjectStore } from '@store/projectStore';
import { newId } from '@store/ids';
import { Field, LengthInput, NumberInput, Select, formatLength } from '@ui/components/inputs';
import { changeStepKind, isStepRectangular, makeStepRectangular, patchStepMeasurements, contiguousSelection, curveSteps, deleteSteps, editableSteps, insertStep, insertStepBefore, moveSteps, reconcileStepPlans, measuredStairPreset, stairFlightDimensions, type StairPresetOptions } from './stepEditing';
import { StepResizeHandles } from './StepResizeHandles';
import { StairCornerHandles } from './StairCornerHandles';
import { reshapeStairCorner, setLandingOutline, stairCornerHandles } from './stairShapeEditing';
import { defaultDrawing, drawingClearanceWarning, drawingGeometry, validateDrawing } from './stairDrawing';
import { stairPlanGeometry } from './stairLayout';
import { StairPhysicalView } from './StairPhysicalView';
import { StairPlanContextMenu, type StairPlanMenuItem } from './StairPlanContextMenu';
import { StepDimensionsEditor } from './StepDimensionsEditor';
import './stair-designer.css';

type RoutePoint = Point & { curve?: boolean };
type Mode = 'inspect' | 'draw' | 'edit';
type Unit = 'metric' | 'imperial';
type Frame = { minX: number; minY: number; width: number; height: number };
const W = 600, H = 400;
const savedDrafts = new Map<string, { points: RoutePoint[]; mode: Mode; frame: Frame }>();
const clone = (points: RoutePoint[]) => points.map(point => ({ ...point }));
const SHAPES = [
  { name: 'Straight', path: 'M30 40V7', points: [{ x: 300, y: 60 }, { x: 300, y: 340 }] },
  { name: 'L-shaped', path: 'M15 40V13H48', points: [{ x: 220, y: 60 }, { x: 220, y: 280 }, { x: 430, y: 280 }] },
  { name: 'U-shaped', path: 'M14 40V10H45V40', points: [{ x: 200, y: 60 }, { x: 200, y: 280 }, { x: 400, y: 280 }, { x: 400, y: 60 }] },
  { name: 'Curved', path: 'M14 40C0 4 53 1 47 32', points: [{ x: 160, y: 60 }, { x: 160, y: 310, curve: true }, { x: 420, y: 310, curve: true }, { x: 420, y: 90 }] },
];

/** Fit an existing route into the sketch grid without changing its relative proportions. */
function fitRoute(points: RoutePoint[]): RoutePoint[] {
  if (points.length < 2) return clone(SHAPES[0]!.points);
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const scale = Math.min(320 / Math.max(1, maxX - minX), 240 / Math.max(1, maxY - minY));
  return points.map(p => ({ ...p, x: 300 + (p.x - (minX + maxX) / 2) * scale, y: 200 + (p.y - (minY + maxY) / 2) * scale }));
}

export function StairDesigner({ staircase, unit, selectedIds: controlledSelection, onSelectionChange }: { staircase: Staircase; unit: Unit; selectedIds?: string[]; onSelectionChange?: (ids: string[]) => void }) {
  const rawUpdate = useProjectStore(s => s.updateStaircase);
  const update: typeof rawUpdate = (id, patch) => rawUpdate(id, current => reconcileStepPlans(current, typeof patch === 'function' ? patch(current) : { ...current, ...patch }));
  const projectId = useProjectStore(s => s.project.id);
  const draftKey = `${projectId}:${staircase.id}`;
  const restored = savedDrafts.get(draftKey);
  const [mode, setMode] = useState<Mode>(restored?.mode ?? 'inspect');
  const [points, setPoints] = useState<RoutePoint[]>(() => clone(restored?.points ?? []));
  const [history, setHistory] = useState<RoutePoint[][]>([]);
  const [node, setNode] = useState(-1);
  const [localSelection, setLocalSelection] = useState<string[]>([]);
  const selectedIds = controlledSelection ?? localSelection;
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const setSelectedIds = (ids: string[]) => { setLocalSelection(ids); onSelectionChange?.(ids); };
  const setSelectedId = (id?: string) => setSelectedIds(id ? [id] : []);
  const [stepEdit, setStepEdit] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [stepHistory, setStepHistory] = useState<Staircase[]>([]);
  const lastStepEdit = useRef<Staircase>();
  const signature = (stairs?: Staircase) => stairs ? JSON.stringify([stairs.steps, stairs.landings, stairs.drawing, stairs.layout]) : '';
  const canUndoStepEdit = !!stepHistory.length && signature(lastStepEdit.current) === signature(staircase);
  const [curveAngle, setCurveAngle] = useState(90);
  const [curveRadius, setCurveRadius] = useState(150);
  const [cornerStyle, setCornerStyle] = useState<'round' | 'square'>('round');
  const [shapeMode, setShapeMode] = useState<'corners' | 'size'>('corners');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ids: string[]; target: HTMLElement | SVGElement }>();
  const measurements = useRef<HTMLDivElement>(null);
  const [exactDimensionsOpen, setExactDimensionsOpen] = useState(false);
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [presetOptions, setPresetOptions] = useState<StairPresetOptions>();
  const preset = useMemo(() => presetOptions ? measuredStairPreset(staircase, presetOptions) : undefined, [staircase, presetOptions]);
  const [movingPreview, setMovingPreview] = useState<Staircase>();
  const stepDrag = useRef<{ start: Point; source: Staircase; ids: string[]; moved: boolean }>();
  const resizeSource = useRef<Staircase>();
  const cornerSource = useRef<Staircase>();
  const suppressClick = useRef(false);
  const [square, setSquare] = useState(true);
  const [notice, setNotice] = useState('');
  const [hover, setHover] = useState<Point>();
  const [frame, setFrame] = useState<Frame>(restored?.frame ?? { minX: 0, minY: 0, width: W, height: H });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; start: Point; points: RoutePoint[]; moved: boolean }>();
  const pointsRef = useRef(points); pointsRef.current = points;
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const editing = mode !== 'inspect';
  const problem = editing ? validateDrawing(points) : null;
  const validDraft = editing && !problem;
  const preview = useMemo(() => movingPreview ?? preset ?? (validDraft ? { ...staircase, steps: staircase.steps.map(({ plan: _plan, outline: _outline, ...step }) => step), drawing: { points } } : staircase), [staircase, points, validDraft, preset, movingPreview]);
  const physical = useMemo(() => stairPlanGeometry(preview), [preview]);
  const stationary = useMemo(() => stairPlanGeometry(staircase), [staircase]);
  const rawStationary = useMemo(() => stairPlanGeometry(staircase, { normalize: false }), [staircase]);
  const rawMoving = useMemo(() => movingPreview ? stairPlanGeometry(movingPreview, { normalize: false }) : undefined, [movingPreview]);
  const sketch = useMemo(() => validDraft ? drawingGeometry(staircase, { points }) : undefined, [staircase, points, validDraft]);
  const clearanceWarning = useMemo(() => preview.drawing ? drawingClearanceWarning(preview) : null, [preview]);
  const rawPiecePoints = (polygon: Point[]) => sketch ? polygon.map(point => ({ x: (point.x - sketch.drawingTransform.offsetX) / sketch.drawingTransform.scale, y: (point.y - sketch.drawingTransform.offsetY) / sketch.drawingTransform.scale })) : polygon;
  const firstPiece = stationary.pieces.find(piece => piece.stepIndex === 0);
  const rawFirst = rawStationary.pieces.find(piece => piece.stepIndex === 0);
  const sourceOffset = firstPiece?.start && rawFirst?.start ? { x: firstPiece.start.x - rawFirst.start.x, y: firstPiece.start.y - rawFirst.start.y } : { x: 0, y: 0 };
  const shifted = (p: Point) => ({ x: p.x + sourceOffset.x, y: p.y + sourceOffset.y });
  const geometry = editing ? sketch : rawMoving ? { ...rawMoving, pieces: rawMoving.pieces.map(piece => ({ ...piece, points: piece.points.map(shifted), ...(piece.start ? { start: shifted(piece.start) } : {}), ...(piece.end ? { end: shifted(piece.end) } : {}) })), route: rawMoving.route.map(shifted) } : physical;
  const displayedBounds = movingPreview ? stationary : physical;
  const bounds = editing ? frame : { minX: 0, minY: 0, width: displayedBounds.width, height: displayedBounds.height };
  const factor = Math.min((W - 70) / Math.max(1, bounds.width), (H - 65) / Math.max(1, bounds.height));
  const left = (W - bounds.width * factor) / 2, bottom = (H - bounds.height * factor) / 2;
  const screen = (point: Point) => ({ x: left + (point.x - bounds.minX) * factor, y: H - bottom - (point.y - bounds.minY) * factor });
  const list = (polygon: Point[]) => polygon.map(point => { const p = screen(point); return `${p.x},${p.y}`; }).join(' ');
  const renderedRoute = geometry ? editing ? rawPiecePoints(geometry.route) : geometry.route : [];
  const stepIndex = staircase.steps.findIndex(step => step.id === selectedId);
  const step = staircase.steps[stepIndex];
  const landing = staircase.landings.find(item => item.id === selectedId);
  const followingLanding = step ? staircase.landings.find(item => item.afterStepIndex === stepIndex) : undefined;
  const chosenStepIds = selectedIds.filter(id => staircase.steps.some(step => step.id === id));
  const selectedIsRectangle = step?.kind === 'straight' && isStepRectangular(staircase, step.id);
  const canCurve = contiguousSelection(staircase, chosenStepIds);
  const selectPiece = (id: string, modifiers?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    if (editing || preset) return;
    if (staircase.landings.some(landing => landing.id === id)) { setSelectedId(id); setNode(-1); return; }
    if (modifiers?.shiftKey && selectedIds.length) {
      const first = staircase.steps.findIndex(step => step.id === selectedIds[0]);
      const last = staircase.steps.findIndex(step => step.id === id);
      if (first >= 0 && last >= 0) { setSelectedIds(staircase.steps.slice(Math.min(first, last), Math.max(first, last) + 1).map(step => step.id)); setNode(-1); return; }
    }
    setSelectedIds(multiSelect || modifiers?.ctrlKey || modifiers?.metaKey ? selectedIds.includes(id) ? chosenStepIds.filter(item => item !== id) : [...chosenStepIds, id] : [id]);
    setNode(-1);
  };
  const applySteps = (next: Staircase) => {
    if (next === staircase) return;
    setStepHistory(old => [...(canUndoStepEdit ? old.slice(-19) : []), structuredClone(staircase)]);
    update(staircase.id, next);
    lastStepEdit.current = useProjectStore.getState().project.staircases.find(item => item.id === staircase.id);
    setNotice(staircase.drawing && next.steps.some(step => step.outline) ? 'Shape updated. Custom treads now use their full cut size; review the step dimensions.' : 'Steps updated. Measurements and both diagrams are connected.');
  };
  const undoSteps = () => {
    if (!canUndoStepEdit) return;
    const previous = stepHistory.at(-1)!;
    rawUpdate(staircase.id, { steps: previous.steps, landings: previous.landings, drawing: previous.drawing, layout: previous.layout });
    lastStepEdit.current = useProjectStore.getState().project.staircases.find(item => item.id === staircase.id);
    setStepHistory(old => old.slice(0, -1)); setSelectedIds([]);
  };
  const addLandingAfterStep = () => {
    if (!step) return;
    if (followingLanding) { setSelectedId(followingLanding.id); return; }
    const width = stairFlightDimensions(staircase, stepIndex).width;
    const newLanding = { id: newId('landing'), kind: stepIndex === staircase.steps.length - 1 ? 'top' as const : 'quarter' as const, length: width, width, afterStepIndex: stepIndex };
    applySteps(reconcileStepPlans(staircase, { ...staircase, landings: [...staircase.landings, newLanding] }));
    setSelectedId(newLanding.id);
  };
  const addSelectedStep = () => {
    const next = insertStep(staircase, chosenStepIds[0]!);
    const added = next.steps.find(step => !staircase.steps.some(old => old.id === step.id));
    applySteps(next);
    if (added) setSelectedId(added.id);
    else setNotice('This tread cannot be divided without crossing its outline. Adjust its corners or insert next to a straight tread.');
  };
  const removeSteps = (ids: string[]) => {
    const next = deleteSteps(staircase, ids);
    if (next === staircase) { setNotice('These steps cannot be removed while keeping the remaining outlines connected. Adjust the selection or adjoining corners.'); return; }
    applySteps(next); setSelectedIds([]);
  };

  const makeRectangle = (stepId: string) => {
    if (staircase.steps.find(step => step.id === stepId)?.kind === 'straight' && isStepRectangular(staircase, stepId)) return;
    const next = makeStepRectangular(staircase, stepId);
    if (next === staircase) setNotice('There is not enough space to square this tread without crossing a neighbouring step. Adjust its adjoining corners first.');
    else {
      applySteps(next); setShapeMode('corners');
      const updated = next.steps.find(step => step.id === stepId)!;
      setNotice(`Rectangular tread applied: ${formatLength(updated.going, unit, 3)} deep by ${formatLength(updated.width, unit, 3)} wide. Check these dimensions against your staircase.`);
    }
  };
  const changeMeasurements = (patch: Partial<Step>) => {
    if (!step) return;
    const next = patchStepMeasurements(staircase, step.id, patch);
    if (next === staircase) {
      setMeasurementRevision(value => value + 1);
      setNotice('That size would cross a neighbouring tread or collapse its outline. The previous measurement has been kept.');
    } else applySteps(next);
  };
  const openContextMenu = (target: HTMLElement | SVGElement, x: number, y: number, pieceId?: string) => {
    if (editing || preset) return;
    const ids = pieceId ? selectedIds.includes(pieceId) ? selectedIds : [pieceId] : selectedIds;
    setSelectedIds(ids); setContextMenu({ x, y, ids, target });
  };
  const menuStepIds = contextMenu?.ids.filter(id => staircase.steps.some(step => step.id === id)) ?? [];
  const menuLanding = contextMenu?.ids.length === 1 ? staircase.landings.find(item => item.id === contextMenu.ids[0]) : undefined;
  const menuSingleStep = menuStepIds.length === 1 && contextMenu?.ids.length === 1;
  const menuItems: StairPlanMenuItem[] = [
    ...(menuSingleStep || menuLanding ? [
      { id: 'rectangle', label: 'Make rectangular', disabled: menuLanding ? !menuLanding.outline : staircase.steps.find(step => step.id === menuStepIds[0])?.kind === 'straight' && isStepRectangular(staircase, menuStepIds[0]!) },
      { id: 'corners', label: 'Edit corners' },
      { id: 'dimensions', label: 'Edit dimensions' },
    ] : []),
    ...(menuSingleStep ? [
      { id: 'before', label: 'Insert step before', separatorBefore: true, disabled: staircase.steps.length >= 30 },
      { id: 'after', label: 'Insert step after', disabled: staircase.steps.length >= 30 },
      { id: 'landing', label: staircase.landings.some(item => item.afterStepIndex === staircase.steps.findIndex(step => step.id === menuStepIds[0])) ? 'Edit landing after step' : 'Add landing after step' },
    ] : []),
    ...(menuStepIds.length || menuLanding ? [{ id: 'delete', label: menuLanding ? 'Delete landing' : menuStepIds.length > 1 ? `Delete ${menuStepIds.length} steps` : 'Delete step', danger: true, separatorBefore: true, disabled: menuStepIds.length >= staircase.steps.length }] : []),
    { id: 'undo', label: 'Undo step edit', disabled: !canUndoStepEdit, separatorBefore: true },
  ];
  const menuAction = (action: string) => {
    const stepId = menuStepIds[0];
    if (action === 'undo') { undoSteps(); return; }
    if (action === 'rectangle') {
      if (menuLanding) applySteps(setLandingOutline(staircase, menuLanding.id, 'rectangle'));
      else if (stepId) makeRectangle(stepId);
    } else if (action === 'corners' || action === 'dimensions') {
      setShapeMode(action === 'corners' ? 'corners' : 'size');
      if (action === 'dimensions') setExactDimensionsOpen(true);
      requestAnimationFrame(() => {
        if (action === 'dimensions') {
          const panel = menuLanding ? document.querySelector('.stair-landing-controls') : measurements.current;
          panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          panel?.querySelector<HTMLInputElement>(menuLanding ? 'input' : '[aria-label="Exact tread side length"]')?.focus({ preventScroll: true });
        } else (svg.current?.querySelector<SVGGElement>('[data-stair-corner]') ?? svg.current)?.focus({ preventScroll: true });
      });
    } else if (action === 'before' || action === 'after') {
      const next = action === 'before' ? insertStepBefore(staircase, stepId!) : insertStep(staircase, stepId!);
      const added = next.steps.find(step => !staircase.steps.some(old => old.id === step.id));
      applySteps(next); if (added) setSelectedId(added.id);
      else setNotice('This tread cannot be divided without crossing its outline. Adjust its corners or insert next to a straight tread.');
    } else if (action === 'landing') addLandingAfterStep();
    else if (action === 'delete') {
      if (menuLanding) { applySteps(reconcileStepPlans(staircase, { ...staircase, landings: staircase.landings.filter(item => item.id !== menuLanding.id) })); setSelectedIds([]); }
      else removeSteps(menuStepIds);
    }
  };

  useEffect(() => {
    if (mode === 'inspect') savedDrafts.delete(draftKey);
    else savedDrafts.set(draftKey, { points: clone(points), mode, frame: { ...frame } });
    if (savedDrafts.size > 20) savedDrafts.delete(savedDrafts.keys().next().value!);
  }, [points, mode, draftKey, frame]);

  const remember = () => setHistory(old => [...old.slice(-29), clone(pointsRef.current)]);
  const change = (next: RoutePoint[]) => { remember(); setPoints(next); setNotice(''); };
  const begin = (next: RoutePoint[], nextMode: Mode) => {
    setPresetOptions(undefined); setStepEdit(false);
    setPoints(clone(next)); setMode(nextMode); setHistory([]); setNode(-1); setSelectedId(undefined); setNotice('');
    setFrame({ minX: -90, minY: -60, width: W + 180, height: H + 120 });
    requestAnimationFrame(() => svg.current?.focus());
  };
  const undo = () => {
    if (!history.length) return;
    setPoints(clone(history.at(-1)!)); setHistory(old => old.slice(0, -1)); setNode(-1); setNotice('');
  };
  const removeNode = () => {
    if (node < 0 || (mode === 'edit' && points.length <= 2)) return;
    change(points.filter((_, index) => index !== node)); setNode(-1);
  };
  const pointer = (event: PointerEvent<SVGSVGElement>): Point => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(((point.x - left) / factor + bounds.minX) / 5) * 5, y: Math.round(((H - bottom - point.y) / factor + bounds.minY) / 5) * 5 };
  };
  const snap = (point: Point) => {
    const previous = pointsRef.current.at(-1);
    if (!square || !previous) return point;
    return Math.abs(point.x - previous.x) < Math.abs(point.y - previous.y) ? { ...point, x: previous.x } : { ...point, y: previous.y };
  };
  const addPoint = (point: Point) => {
    if (points.length >= 16) { setNotice('Use up to 16 route points. Move or remove an existing point to adjust this staircase.'); return; }
    if (points.at(-1) && Math.hypot(point.x - points.at(-1)!.x, point.y - points.at(-1)!.y) < 5) return;
    change([...points, point]); setNode(points.length);
  };
  const commit = () => {
    if (problem) return;
    update(staircase.id, { steps: staircase.steps.map(({ plan: _plan, outline: _outline, ...step }) => step), drawing: { points: clone(points) } });
    setMode('inspect'); setNode(-1); setHistory([]);
    setNotice('Drawing saved. Select any turning tread to check its type and measured dimensions.');
  };
  const fit = () => {
    if (!sketch) return;
    const all = [...points, ...sketch.pieces.flatMap(piece => rawPiecePoints(piece.points))];
    const minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x));
    const minY = Math.min(...all.map(p => p.y)), maxY = Math.max(...all.map(p => p.y));
    setFrame({ minX: minX - 35, minY: minY - 35, width: maxX - minX + 70, height: maxY - minY + 70 });
  };

  return <section className="stair-designer" aria-label="Staircase drawing workspace">
    <div className="stair-designer-heading"><div><div className="eyebrow">EDIT ON THE PLAN</div><h3>Shape your staircase</h3><p>Select a step to add, remove or reshape it. Both views update together.</p></div><button type="button" className="link" onClick={() => begin([], 'draw')}>Draw your own</button></div>
    <div className="stair-starting-shapes" aria-label="Drawing starting shapes">{SHAPES.map((shape, index) => <button type="button" key={shape.name} aria-label={`Start ${shape.name.toLowerCase()} drawing`} onClick={() => { setMode('inspect'); setStepEdit(false); setPresetOptions({ kind: (['straight', 'quarter_turn', 'half_turn', 'curved'] as const)[index]!, direction: 'right', turn: 'landing', corner: 'round', curveAngle: 180 }); setSelectedIds([]); }}><svg viewBox="0 0 60 46" aria-hidden="true"><path d={shape.path} /></svg><span>{shape.name}</span></button>)}</div>
    {preset && presetOptions ? <div className="stair-selection-toolbar" aria-label="Staircase shape preview">
      <p><strong>{presetOptions.kind === 'quarter_turn' ? 'L-shaped' : presetOptions.kind === 'half_turn' ? 'U-shaped' : presetOptions.kind === 'curved' ? 'Curved' : 'Straight'} preview</strong> Built from your step count and measurements. Choose how the turn works, then check the preview.</p>
      {presetOptions.kind !== 'straight' ? <div className="stair-preset-controls">
        <Field label="Going upstairs, turn"><Select ariaLabel="Preset turn direction" value={presetOptions.direction} options={[{value:'right',label:'Right'},{value:'left',label:'Left'}]} onChange={direction => setPresetOptions({...presetOptions, direction})}/></Field>
        {presetOptions.kind !== 'curved' ? <Field label="At the turn"><Select ariaLabel="Preset turn type" value={presetOptions.turn ?? 'landing'} options={[{value:'landing',label:'Flat landing'},{value:'winders',label:'Turning steps'}]} onChange={turn => setPresetOptions({...presetOptions,turn})}/></Field> : null}
        {presetOptions.kind === 'curved' || presetOptions.turn === 'winders' ? <><Field label="Turning steps"><NumberInput ariaLabel="Preset turning steps" value={preset.layout?.turnSteps ?? 8} min={2} max={staircase.steps.length} integer onChange={turnSteps => setPresetOptions({...presetOptions,turnSteps})}/></Field><Field label="Outside corners"><Select ariaLabel="Preset outside corners" value={presetOptions.corner ?? 'round'} options={[{value:'round',label:'Rounded'},{value:'square',label:'Square'}]} onChange={corner => setPresetOptions({...presetOptions,corner})}/></Field>{presetOptions.kind === 'curved' ? <Field label="Total rotation"><NumberInput ariaLabel="Preset curve angle" value={presetOptions.curveAngle ?? 180} min={15} max={330} suffix="°" onChange={curveAngle => setPresetOptions({...presetOptions,curveAngle})}/></Field> : null}</> : null}
      </div> : null}
      <p className="small muted">Applying resets step shapes and intermediate landings; top landings stay. Check turning tread measurements before ordering.</p>
      <div className="row"><button type="button" onClick={() => setPresetOptions(undefined)}>Cancel preset</button><button type="button" className="primary" onClick={() => { applySteps(preset); setPresetOptions(undefined); }}>Use staircase shape</button></div>
    </div> : null}
    <div className="stair-linked-views">
      <section className="stair-plan-card">
        <header><div><strong>Top down</strong><span>{editing ? 'Place and move the route points' : stepEdit ? 'Drag a step or the selected group' : 'Select a tread or landing to change its shape'}</span></div>{!editing ? <button type="button" disabled={!!preset} aria-pressed={stepEdit} onClick={() => { setStepEdit(true); setNotice('Drag steps to move them. Use Select multiple or Shift-click to work on a group.'); }}>Edit route</button> : <button type="button" onClick={fit} disabled={!sketch}>Fit drawing</button>}</header>
        {!editing && !preset ? <div className="stair-selection-toolbar stair-plan-toolbar" aria-label="Edit selected stairs">
          <div className="row"><button type="button" aria-pressed={multiSelect} onClick={() => setMultiSelect(!multiSelect)}>Select multiple</button><span className="small muted">{step ? `Step ${stepIndex + 1}` : landing ? 'Landing selected' : chosenStepIds.length ? `${chosenStepIds.length} steps selected` : 'Select a step on the plan'}</span><button type="button" className="link" onClick={undoSteps} disabled={!canUndoStepEdit}>Undo step edit</button></div>
          {chosenStepIds.length ? <div className="row stair-context-actions"><button type="button" aria-label="Add step after selection" disabled={chosenStepIds.length !== 1 || staircase.steps.length >= 30} onClick={addSelectedStep}>+ Add step</button>{step ? <button type="button" aria-label={followingLanding ? 'Edit landing after this step' : 'Add a flat landing after this step'} onClick={addLandingAfterStep}>{followingLanding ? 'Edit landing' : '+ Add landing'}</button> : null}<button type="button" className="danger" aria-label="Delete selected steps" disabled={chosenStepIds.length >= staircase.steps.length} onClick={() => removeSteps(chosenStepIds)}>Delete {chosenStepIds.length === 1 ? 'step' : 'steps'}</button><button type="button" className="link" aria-label="Clear step selection" onClick={() => setSelectedIds([])}>Clear</button></div> : null}
          {chosenStepIds.length > 1 ? <button type="button" aria-label="Open stair actions" aria-haspopup="menu" aria-expanded={!!contextMenu} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); openContextMenu(event.currentTarget, rect.left, rect.bottom + 4); }}>Actions <span aria-hidden="true">⌄</span></button> : null}
          {stepEdit ? <details className="stair-route-advanced"><summary>Walking line and placement tools</summary><div className="row"><button type="button" onClick={() => begin(fitRoute(defaultDrawing(staircase).points), 'edit')}>Edit walking line</button><button type="button" onClick={() => setStepEdit(false)}>Done editing steps</button></div></details> : null}
        </div> : null}
        {!editing && !preset && (step || landing) ? <div className="stair-shape-mode" aria-label="Top-down shape tools"><strong>{step ? `Step ${stepIndex+1}` : 'Landing'}</strong><button type="button" aria-pressed={shapeMode === 'corners'} onClick={() => setShapeMode('corners')}>Edit corners</button>{step ? <button type="button" aria-pressed={shapeMode === 'size'} onClick={() => setShapeMode('size')}>Width &amp; depth</button> : null}<button type="button" className="stair-rectangle-action" disabled={step ? selectedIsRectangle : !landing?.outline} onClick={() => step ? makeRectangle(step.id) : applySteps(setLandingOutline(staircase, landing!.id, 'rectangle'))}>Make rectangular</button><button type="button" aria-label="Open stair actions" aria-haspopup="menu" aria-expanded={!!contextMenu} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); openContextMenu(event.currentTarget, rect.left, rect.bottom + 4); }}>Actions <span aria-hidden="true">⌄</span></button></div> : null}
        {!editing && !preset && chosenStepIds.length > 1 ? <>      <div className="stair-group-curve"><Field label="Turn across selection"><NumberInput ariaLabel="Selected group turn" value={curveAngle} min={-330} max={330} suffix="°" onChange={setCurveAngle} /></Field><Field label="Inside curve radius"><LengthInput ariaLabel="Selected group inside radius" value={curveRadius} unit={unit} onChange={setCurveRadius} /></Field><Field label="Outside corners"><Select ariaLabel="Selected group outside corners" value={cornerStyle} options={[{value:'round',label:'Rounded'},{value:'square',label:'Square'}]} onChange={setCornerStyle}/></Field><button type="button" disabled={!canCurve} onClick={() => applySteps(curveSteps(staircase, chosenStepIds, -curveAngle, curveRadius, cornerStyle))}>Curve selected steps</button><button type="button" disabled={!canCurve} onClick={() => applySteps(curveSteps(staircase, chosenStepIds, 0))}>Make selection straight</button></div><p className="small muted">{canCurve ? 'Positive turns go right upstairs. Curving creates winder measurements; check the widest and narrowest depths on site.' : 'Choose consecutive steps without a landing between them to make a curve.'}</p></> : null}
        <svg ref={svg} className={`stair-drawing-canvas ${editing || stepEdit ? 'editing' : ''}`} viewBox={`0 0 ${W} ${H}`} tabIndex={0} role="group" aria-label="Top-down staircase drawing" data-testid="stair-drawing-canvas"
          onContextMenu={event => {
            if (editing || preset) return;
            event.preventDefault(); event.stopPropagation();
            const piece = (event.target as Element).closest<SVGGElement>('[data-plan-piece]');
            openContextMenu(piece ?? event.currentTarget, event.clientX, event.clientY, piece?.dataset.planPiece);
          }}
          onPointerDown={event => {
            if (stepEdit && !editing && event.button <= 0) {
              const target = (event.target as Element).closest('[data-plan-piece]');
              const stepId = target?.getAttribute('data-plan-piece');
              if (stepId && staircase.steps.some(step => step.id === stepId) && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                const ids = chosenStepIds.includes(stepId) ? chosenStepIds : [stepId];
                stepDrag.current = { start: pointer(event), source: staircase, ids, moved: false };
                event.preventDefault();
              }
              return;
            }
            if (!editing || event.button > 0) return;
            const handle = (event.target as Element).closest('[data-route-node]');
            if (handle) {
              const index = Number(handle.getAttribute('data-route-node'));
              setNode(index); setSelectedId(undefined);
              drag.current = { index, start: pointer(event), points: clone(points), moved: false };
              svg.current?.setPointerCapture?.(event.pointerId); event.preventDefault();
            } else if (mode === 'draw') { addPoint(snap(pointer(event))); setSelectedId(undefined); event.preventDefault(); }
            else { setNode(-1); }
          }}
          onPointerMove={event => {
            if (stepDrag.current) {
              const next = pointer(event), active = stepDrag.current;
              const delta = { x: next.x - active.start.x, y: next.y - active.start.y };
              if (!active.moved && Math.hypot(delta.x, delta.y) < 15) return;
              if (!active.moved) svg.current?.setPointerCapture(event.pointerId);
              active.moved = true; setSelectedIds(active.ids);
              setMovingPreview(moveSteps(active.source, active.ids, delta)); return;
            }
            if (drag.current) {
              const next = pointer(event);
              if (!drag.current.moved && Math.hypot(next.x - drag.current.start.x, next.y - drag.current.start.y) < 3) return;
              if (!drag.current.moved) remember();
              drag.current.moved = true;
              const moved = clone(drag.current.points); moved[drag.current.index] = { ...moved[drag.current.index]!, ...next }; setPoints(moved);
            } else if (mode === 'draw') setHover(snap(pointer(event)));
          }}
          onPointerUp={event => { if (stepDrag.current?.moved && movingPreview) { applySteps(movingPreview); suppressClick.current = true; requestAnimationFrame(() => { suppressClick.current = false; }); } stepDrag.current = undefined; setMovingPreview(undefined); drag.current = undefined; if (svg.current?.hasPointerCapture?.(event.pointerId)) svg.current.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { if (drag.current?.moved) setPoints(drag.current.points); drag.current = undefined; stepDrag.current = undefined; setMovingPreview(undefined); }}
          onPointerLeave={() => setHover(undefined)}
          onKeyDown={event => {
            if (!editing && !preset && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
              event.preventDefault(); event.stopPropagation();
              const target = (event.target as Element).closest<SVGGElement>('[data-plan-piece]') ?? event.currentTarget;
              const rect = target.getBoundingClientRect();
              openContextMenu(target, rect.x + rect.width / 2, rect.y + rect.height / 2, target.getAttribute('data-plan-piece') ?? undefined);
              return;
            }
            if (!editing && stepEdit) {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undoSteps(); }
              else if (chosenStepIds.length && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); removeSteps(chosenStepIds); }
              else if (chosenStepIds.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const distance = event.shiftKey ? 100 : 10; applySteps(moveSteps(staircase, chosenStepIds, { x: event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0, y: event.key === 'ArrowDown' ? -distance : event.key === 'ArrowUp' ? distance : 0 })); }
              return;
            }
            if (!editing) return;
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
            else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeNode(); }
            else if (node >= 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault(); const amount = event.shiftKey ? 20 : 5; const point = points[node]!;
              change(points.map((p, index) => index !== node ? p : { ...point, x: point.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0), y: point.y + (event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0) }));
            } else if (event.key === 'Enter' && event.target === svg.current && !problem) { event.preventDefault(); commit(); }
          }}>
          <defs><pattern id={`stair-grid-${id}`} width="25" height="25" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dbe5e0" /></pattern><marker id={`stair-up-${id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#286558" /></marker></defs>
          <rect width={W} height={H} fill={`url(#stair-grid-${id})`} />
          {geometry?.pieces.map(piece => {
            const polygon = editing ? rawPiecePoints(piece.points) : piece.points;
            const centre = screen({ x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length, y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length });
            const selected = selectedIds.includes(piece.id);
            return <g key={piece.id} role={editing ? undefined : 'button'} tabIndex={editing ? undefined : 0} aria-label={editing ? undefined : `Select ${piece.label.toLowerCase()} in plan`} aria-pressed={editing ? undefined : selected} data-plan-piece={piece.id} className={`stair-plan-piece ${piece.kind}${selected ? ' selected' : ''}`} onClick={event => { if (suppressClick.current) { suppressClick.current = false; return; } if (!editing) selectPiece(piece.id, event); }} onKeyDown={event => { if (!editing && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectPiece(piece.id, event); } }}>
              <polygon points={list(polygon)} /><text x={centre.x} y={centre.y + 3} textAnchor="middle">{piece.stepIndex !== undefined ? piece.stepIndex + 1 : 'L'}</text><title>{piece.label}</title>
            </g>;
          })}
          {renderedRoute.length ? <polyline className="stair-walk-line" points={list(renderedRoute)} markerEnd={`url(#stair-up-${id})`} /> : null}
          {editing && points.length ? <polyline className={`stair-route-control${problem && points.length > 1 ? ' invalid' : ''}`} points={list(points)} /> : null}
          {mode === 'draw' && points.length && hover ? <line className="stair-route-next" x1={screen(points.at(-1)!).x} y1={screen(points.at(-1)!).y} x2={screen(hover).x} y2={screen(hover).y} /> : null}
          {editing ? points.map((point, index) => {
            const p = screen(point);
            return <g key={index} data-route-node={index} className={`stair-route-node${node === index ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Route point ${index + 1}${index === 0 ? ', bottom' : index === points.length - 1 ? ', top' : point.curve ? ', curved turn' : ', corner'}`} aria-pressed={node === index} onFocus={() => { setNode(index); setSelectedId(undefined); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setNode(index); } }}><circle className="stair-node-hit" cx={p.x} cy={p.y} r="22" /><circle className="stair-node-dot" cx={p.x} cy={p.y} r={node === index ? 9 : 7} /><text x={p.x} y={p.y - 16} textAnchor="middle">{index === 0 ? 'Bottom' : index === points.length - 1 ? 'Top' : index}</text></g>;
          }) : renderedRoute.length ? <>{[renderedRoute[0]!, renderedRoute.at(-1)!].map((point, index) => { const p = screen(point); return <g key={index}><circle cx={p.x} cy={p.y} r="5" fill={index ? '#286558' : '#83958e'} /><text className="stair-end-label" x={p.x} y={Math.min(H - 8, Math.max(14, p.y + (index ? -12 : 20)))} textAnchor="middle">{index ? 'Top · UP' : 'Bottom'}</text></g>; })}</> : null}
          {mode === 'draw' && !points.length ? <g className="stair-draw-empty" pointerEvents="none"><text x={W / 2} y={H / 2 - 10} textAnchor="middle">Start at the bottom of the stairs</text><text x={W / 2} y={H / 2 + 16} textAnchor="middle">Click each turn, then finish at the top</text></g> : null}
          {!editing && !preset && shapeMode === 'size' && step && geometry?.pieces.find(piece => piece.id === step.id) ? <StepResizeHandles
            step={preview.steps.find(item => item.id === step.id) ?? step} piece={geometry.pieces.find(piece => piece.id === step.id)!} unit={unit} toScreen={screen}
            onStart={() => { resizeSource.current = staircase; }}
            onPreview={patch => { const source = resizeSource.current ?? staircase; setMovingPreview(patchStepMeasurements(source, step.id, patch)); }}
            onCommit={patch => { const source = resizeSource.current ?? staircase; const next = patchStepMeasurements(source, step.id, patch); if (next === source) setNotice('That size would cross a neighbouring tread. Try a smaller adjustment.'); else applySteps(next); resizeSource.current = undefined; setMovingPreview(undefined); }}
            onCancel={() => { resizeSource.current = undefined; setMovingPreview(undefined); }}
          /> : null}
          {!editing && !preset && selectedId && (landing || shapeMode === 'corners') ? <StairCornerHandles key={selectedId}
            points={stairCornerHandles(preview, selectedId)} toScreen={point => screen(shifted(point))} label={step ? `Step ${stepIndex+1}` : 'Landing'}
            onStart={() => { cornerSource.current = staircase; }}
            onPreview={(index, point) => { const source = cornerSource.current ?? staircase; const next = reshapeStairCorner(source, selectedId, index, point); setMovingPreview(next === source ? undefined : next); }}
            onCommit={(index, point) => { const source = cornerSource.current ?? staircase; const next = reshapeStairCorner(source, selectedId, index, point); if (next === source) setNotice('That corner would fold the outline over itself. Try a smaller adjustment.'); else applySteps(next); cornerSource.current = undefined; setMovingPreview(undefined); }}
            onCancel={() => { cornerSource.current = undefined; setMovingPreview(undefined); }}
          /> : null}
        </svg>
        <p className="stair-view-caption">{editing ? 'Draw the walking route from bottom to top. Drag route points to adjust it.' : step || landing ? shapeMode === 'corners' || landing ? 'Drag a numbered corner to reshape it. Right-click for step actions; arrow keys adjust corners by 10 mm (Shift for 100 mm).' : 'Drag the gold handles to change width or depth. Right-click for actions, or Shift-click to select a group.' : 'Select a tread to reshape it. Right-click for actions; Shift-click selects a run.'}</p>
        {!editing && !preset && landing ? <div className="stair-landing-controls" aria-label="Landing shape and dimensions">
          {(['length', 'width'] as const).map(key => <Field key={key} label={`Landing ${key}`}><LengthInput ariaLabel={`Selected landing ${key}`} unit={unit} min={100} value={landing[key]} onChange={value => applySteps(reconcileStepPlans(staircase, { ...staircase, landings: staircase.landings.map(item => item.id === landing.id ? { ...item, [key]: value } : item) }))}/></Field>)}
          <Field label="Landing shape"><Select ariaLabel="Selected landing shape" value={landing.outline ? 'custom' : 'rectangle'} options={[{value:'rectangle',label:'Rectangle'},{value:'l_shape',label:'L-shaped'},{value:'custom',label:'Custom corners'}]} onChange={shape => { setShapeMode('corners'); if (shape !== 'custom') applySteps(setLandingOutline(staircase, landing.id, shape)); }}/></Field>
        </div> : null}

      </section>
      <StairPhysicalView staircase={preview} unit={unit} selectedId={selectedId} selectedIds={selectedIds} onSelect={selectPiece} />
    </div>
    {editing ? <div className="stair-drawing-controls">
      <div className="stair-route-toolbar"><div><strong>{mode === 'draw' ? 'Draw from bottom to top' : 'Adjust the route'}</strong><span>{points.length} of 16 points · {node >= 0 ? `point ${node + 1} selected` : 'select a point to edit it'}</span></div><div className="row"><button type="button" onClick={undo} disabled={!history.length}>Undo route edit</button><button type="button" onClick={removeNode} disabled={node < 0 || (mode === 'edit' && points.length <= 2)}>Delete point</button><button type="button" onClick={() => { setMode('inspect'); setNode(-1); setNotice('Drawing changes discarded.'); }}>Cancel drawing</button><button type="button" className="primary" onClick={commit} disabled={!!problem}>{mode === 'draw' ? 'Finish drawing' : 'Use drawing'}</button></div></div>
      {node > 0 && node < points.length - 1 ? <div className="stair-corner-choice"><span>Selected corner</span><button type="button" aria-pressed={!points[node]?.curve} onClick={() => change(points.map((p, index) => index === node ? { ...p, curve: false } : p))}>Sharp turn</button><button type="button" aria-pressed={!!points[node]?.curve} onClick={() => change(points.map((p, index) => index === node ? { ...p, curve: true } : p))}>Curved turn</button></div> : null}
      {mode === 'draw' ? <div className="stair-draw-accessible"><label className="row small"><input type="checkbox" checked={square} onChange={event => setSquare(event.target.checked)} />Square corners</label><span className="small muted">Or extend the route:</span>{(['Left', 'Up', 'Right', 'Down'] as const).map(direction => <button type="button" key={direction} onClick={() => { const last = points.at(-1) ?? { x: 300, y: 60 }; if (!points.length) { change([last]); setNode(0); } else addPoint({ x: last.x + (direction === 'Left' ? -120 : direction === 'Right' ? 120 : 0), y: last.y + (direction === 'Down' ? -120 : direction === 'Up' ? 120 : 0) }); }} aria-label={`Extend route ${direction.toLowerCase()}`}>{direction === 'Left' ? '←' : direction === 'Right' ? '→' : direction === 'Up' ? '↑' : '↓'} {direction}</button>)}</div> : null}
      {problem && points.length > 1 ? <p className="warning" role="status">{problem} The side view shows the saved staircase until the route is valid.</p> : null}
    </div> : null}
    {notice ? <p className="stair-designer-notice" role="status">{notice}</p> : null}
    {clearanceWarning ? <p className="warning" role="status">{clearanceWarning}</p> : null}
    {!editing && !preset && step ? <div ref={measurements} className="stair-piece-inspector" aria-label="Selected step measurements"><div className="stair-piece-inspector-title"><div><div className="eyebrow">SELECTED IN BOTH VIEWS</div><h4>Step {stepIndex + 1}{stepIndex === staircase.steps.length - 1 ? ' · upper landing level' : ''}</h4></div><button type="button" className="link" onClick={() => setSelectedId(undefined)}>Close selection</button></div>
      <div className="stair-selected-fields"><Field label="Step type"><Select ariaLabel="Selected step type" value={step.kind} options={[{ value: 'straight', label: 'Straight tread' }, { value: 'winder', label: 'Winder / turning tread' }, { value: 'bullnose', label: 'Bullnose' }, { value: 'curtail', label: 'Curtail' }]} onChange={(kind: StepKind) => { const next = changeStepKind(staircase, step.id, kind); if (next === staircase && kind !== step.kind) setNotice('This change would cross a neighbouring tread. Adjust the shared corners first.'); else applySteps(next); }} /></Field>
        {(['rise', 'going', 'width'] as const).map(key => <Field key={`${key}:${measurementRevision}`} label={key === 'rise' ? 'Rise · vertical' : key === 'going' ? step.outline ? 'Overall depth' : step.kind === 'winder' ? 'Depth · widest edge' : 'Depth · horizontal' : step.outline ? 'Overall width' : 'Width · across'}><LengthInput ariaLabel={`Selected step ${key}`} unit={unit} min={key === 'rise' ? 1 : 10} value={step[key]} onChange={value => changeMeasurements({ [key]: value })} /></Field>)}
        {step.kind === 'winder' && !step.outline ? <Field key={`narrow:${measurementRevision}`} label="Depth · narrowest edge"><LengthInput ariaLabel="Selected step narrow depth" unit={unit} value={step.goingNarrow ?? 100} onChange={goingNarrow => changeMeasurements({ goingNarrow })} /></Field> : null}
        {step.kind === 'bullnose' || step.kind === 'curtail' ? <><Field label="Bullnose projection"><LengthInput ariaLabel="Selected step bullnose projection" unit={unit} value={step.bullnoseProjection} placeholder="Not measured" onChange={bullnoseProjection => changeMeasurements({ bullnoseProjection })} /></Field><Field label="Wrapped sides"><Select ariaLabel="Selected step bullnose sides" value={step.bullnoseSides ?? (step.kind === 'curtail' ? 'both' : 'right')} options={[{value:'left',label:'Left'},{value:'right',label:'Right'},{value:'both',label:'Both'}]} onChange={bullnoseSides => changeMeasurements({ bullnoseSides })}/></Field></> : null}
      </div>{step.plan ? <details className="stair-route-advanced"><summary>Exact position and heading</summary><div className="stair-selected-fields">{(['x', 'y'] as const).map(key => <Field key={key} label={`Plan ${key} position`}><LengthInput ariaLabel={`Selected step plan ${key}`} unit={unit} min={-1000000} value={step.plan![key]} onChange={value => applySteps({ ...staircase, steps: staircase.steps.map(item => item.id === step.id ? { ...item, plan: { ...item.plan!, [key]: value } } : item) })} /></Field>)}<Field label="Heading"><NumberInput ariaLabel="Selected step heading" value={step.plan.heading} min={-360} max={360} suffix="°" onChange={heading => applySteps({ ...staircase, steps: staircase.steps.map(item => item.id === step.id ? { ...item, plan: { ...item.plan!, heading } } : item) })} /></Field></div></details> : null}<p className="small muted">{step.outline ? 'Width and depth describe the complete cut size around this outline. Drag its corners to change the actual shape.' : 'Size changes keep the upper flight connected. Measure turning treads at their widest and narrowest edges.'}</p>
      <StepDimensionsEditor staircase={staircase} stepId={step.id} unit={unit} onChange={applySteps} open={exactDimensionsOpen} onOpenChange={setExactDimensionsOpen} />
    </div> : !editing && !preset && landing ? <div className="stair-piece-inspector" aria-label="Selected landing measurements"><div className="stair-piece-inspector-title"><h4>Landing · {landing.afterStepIndex < 0 ? 'before the first step' : `after step ${landing.afterStepIndex + 1}`}</h4><button type="button" className="link" onClick={() => setSelectedId(undefined)}>Close selection</button></div><button type="button" className="danger" onClick={() => { applySteps(reconcileStepPlans(staircase, { ...staircase, landings: staircase.landings.filter(item => item.id !== landing.id) })); setSelectedId(undefined); }}>Remove selected landing</button></div> : null}
    {contextMenu ? <StairPlanContextMenu x={contextMenu.x} y={contextMenu.y} label={menuLanding ? 'Landing actions' : menuStepIds.length > 1 ? `${menuStepIds.length} selected steps` : menuSingleStep ? `Step ${staircase.steps.findIndex(step => step.id === menuStepIds[0]) + 1} actions` : 'Staircase actions'} items={menuItems} onAction={menuAction} onClose={() => setContextMenu(undefined)} returnFocusTo={contextMenu.target} /> : null}
    <p className="stair-designer-note">The drawing sets the route and how it wraps. Carpet cuts use your measured step sizes; check the turning treads and landings. The last numbered surface marks the upper landing level.</p>
  </section>;
}
