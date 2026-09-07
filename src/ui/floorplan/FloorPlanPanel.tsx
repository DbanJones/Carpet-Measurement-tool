import { useEffect, useMemo, useRef, useState } from 'react';
import { makeSteps, useProjectStore } from '@store/projectStore';
import type { FloorPlanDocument, Room, Staircase, Doorway } from '@engine/types';
import { doorwaySegment, isSimplePolygon, polygonAreaM2, polygonPerimeter, shapeToPolygon } from '@engine/geometry';
import { parseLength } from '@engine/units';
import { Field, LengthInput, formatArea, formatLength } from '@ui/components/inputs';
import { blankHousePlan } from '@ui/setup/blankHousePlan';
import { MAX_RISERS } from '@ui/stairs/stairLimits';
import { FloorPlanCanvas, type PointerInfo } from './FloorPlanCanvas';
import { PlanOverlay, type Gap, type PlanTool } from './PlanOverlay';
import { PdfPagePicker } from './PdfPagePicker';
import { PlanReader, type PlanReadingStatus } from './PlanReader';
import { PlanDimensionCheck } from './PlanDimensionCheck';
import { DetectedRoomsReview } from './DetectedRoomsReview';
import { DetectedRoomsOverlay } from './DetectedRoomsOverlay';
import { DetectedStairsReview } from './DetectedStairsReview';
import { DetectedStairsOverlay } from './DetectedStairsOverlay';
import { DoorwaySuggestions, DoorwaySuggestionOverlay } from './DetectedDoorwayControls';
import type { DetectedDoorway } from './detection';
import { prepareDetectedDoorways, reconcileDetectedDoorways } from './doorwaySuggestions';
import { previewManualDoorway } from './manualDoorway';
import { isSmallRoomSuggestion, roomSuggestionIssue, type RoomSuggestion, type RoomSuggestionBatch, type StaircaseSuggestion } from './roomSuggestions';
import { newId } from '@store/ids';
import { suggestRoomName } from './planText';
import { importImageFile, isImageFile, isPdfFile, openPdf, type PdfHandle, type PlanRaster } from './pdf';
import { useRoomDetection } from './useRoomDetection';
import { useSuggestedScale, suggestedScaleSourceKey } from './useSuggestedScale';
import { ScaleSuggestionCard } from './ScaleSuggestionCard';
import { outlinesOverlap, snapToOutline } from './outlineEditing';
import { closeEnough, doorwayFromPoints, mmPerPxFromCalibration, mmToPx, nearestEdge, pixelDistance, pixelPolygonArea, pointInPixelPolygon, pxToMm, roomPlanTransform, round1, snapOrthogonal, traceToPolygon, type Px } from './tracing';
import './floorplan.css';
import './floorplan-studio.css';

interface Draft { points: Px[]; closed: boolean; name: string; productId: string; gaps: Gap[]; acceptedGaps: number[]; kind: 'room' | 'stairs'; editingId?: string; candidateId?: string; nameEdited?: boolean; detectedDoorways?: DetectedDoorway[]; excludedDoorways?: number[] }
interface PlanSession { tool: PlanTool; draft: Draft; selectedRoomId: string; selectedStaircaseId: string; toolPoints: Px[]; squareWalls: boolean; review: boolean; batch?: RoomSuggestionBatch; activeCandidateId?: string; scalePreference?: 'automatic' | 'manual' }
const emptyDraft = (): Draft => ({ points: [], closed: false, name: '', productId: '', gaps: [], acceptedGaps: [], kind: 'room' });
// Navigation preserves small editing drafts in memory. The project file holds confirmed rooms only.
const sessions = new Map<string, PlanSession>();
const previousPlans = new Map<string, string>();
const drawingTools: PlanTool[] = ['detect', 'rectangle', 'trace', 'stairs'];

export function FloorPlanPanel() {
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);
  const { addFloorPlan, removeFloorPlan, select, updateFloorPlan } = useProjectStore();
  const [localId, setLocalId] = useState(() => previousPlans.get(project.id) ?? '');
  const incomingOwner = selection.kind === 'room' ? project.rooms.find((r) => r.id === selection.id) : selection.kind === 'staircase' ? project.staircases.find((s) => s.id === selection.id) : undefined;
  const plan = project.floorPlans.find((p) => p.id === incomingOwner?.source?.floorPlanId) ?? project.floorPlans.find((p) => p.id === (selection.kind === 'floorplan' ? selection.id : localId)) ?? project.floorPlans.find((p) => p.id === localId) ?? project.floorPlans[0];
  const initialOwner = incomingOwner?.source?.floorPlanId === plan?.id && (selection.kind === 'room' || selection.kind === 'staircase') ? selection : undefined;
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<PdfHandle | null>(null);
  const importVersion = useRef(0);
  const [pdf, setPdf] = useState<{ name: string; handle: PdfHandle } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => () => { importVersion.current++; void pdfRef.current?.destroy(); }, []);
  const choose = (id: string) => {
    setLocalId(id); select({ kind: 'floorplan', id });
    previousPlans.set(project.id, id);
    if (previousPlans.size > 20) previousPlans.delete(previousPlans.keys().next().value!);
  };
  const addRaster = (name: string, raster: PlanRaster) => choose(addFloorPlan({ name, ...raster }));
  const closePdf = () => { setPdf(null); void pdfRef.current?.destroy(); pdfRef.current = null; };
  const load = async (file: File | undefined) => {
    if (!file || busy) return;
    const version = ++importVersion.current;
    setError(''); setBusy(true);
    try {
      if (isPdfFile(file)) {
        const handle = await openPdf(file);
        if (version !== importVersion.current) { void handle.destroy(); return; }
        closePdf(); pdfRef.current = handle;
        if (handle.pageCount > 1) setPdf({ name: file.name, handle });
        else {
          const raster = await handle.renderPage(1);
          if (version === importVersion.current) addRaster(file.name, raster);
          closePdf();
        }
      } else if (isImageFile(file)) {
        const raster = await importImageFile(file);
        if (version === importVersion.current) { closePdf(); addRaster(file.name, raster); }
      } else setError(`“${file.name}” is not a supported file. Choose a PNG, JPG or PDF.`);
    } catch (cause) {
      if (version === importVersion.current) { closePdf(); setError(cause instanceof Error ? cause.message : 'The file could not be opened.'); }
    } finally { if (version === importVersion.current) setBusy(false); }
  };

  return <div className="floorplan-panel fp-studio">
    <header className="fp-heading">
      <div><div className="eyebrow">MEASURE FROM A DRAWING</div><h2>Floor plan</h2></div>
      {plan ? <div className="fp-document-actions">
        <label className="sr-only" htmlFor="current-floorplan">Current plan</label>
        <select id="current-floorplan" value={plan.id} onChange={(e) => choose(e.target.value)}>{project.floorPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Add plan</button>
        <button type="button" onClick={() => choose(addFloorPlan(blankHousePlan(`Floor ${project.floorPlans.filter(p => p.sketch).length + 1} sketch`)))} disabled={busy}>New drawing sheet</button>
        <details className="fp-plan-options"><summary>Plan options</summary><div className="fp-options-body">
          <Field label="Plan name"><input value={plan.name} aria-label="Plan name" onChange={(e) => updateFloorPlan(plan.id, { name: e.target.value })}/></Field>
          <button type="button" className="danger" onClick={() => {
            if (window.confirm(`Remove “${plan.name}”? Rooms already added to the estimate are kept.`)) { removeFloorPlan(plan.id); sessions.delete(`${project.id}:${plan.id}`); }
          }}>Remove this plan</button>
        </div></details>
      </div> : null}
    </header>
    <input ref={fileRef} className="sr-only" type="file" accept="image/*,application/pdf" aria-label="Upload a floor plan (PNG, JPG or PDF)" disabled={busy} onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }}/>
    {error ? <div className="warning error" role="alert">{error}</div> : null}
    {busy ? <p role="status" className="fp-loading">Opening your plan…</p> : null}
    {pdf ? <PdfPagePicker name={pdf.name} handle={pdf.handle} onCancel={closePdf} onChoose={(raster, page) => { addRaster(`${pdf.name} (page ${page})`, raster); closePdf(); }}/> : !plan ? <>
      <Progress stage={0}/>
      <div className={`fp-upload${dragOver ? ' active' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); void load(e.dataTransfer.files?.[0]); }}>
        <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true"><rect x="8" y="7" width="44" height="46" rx="5" fill="var(--accent-soft)" stroke="var(--accent)"/><path d="M17 43V18h26v11H30v14M35 35h8v8" fill="none" stroke="var(--accent)" strokeWidth="2"/></svg>
        <h3>Start with your floor plan</h3>
        <p>Drop an estate-agent PDF or image here.<br/>For a PDF brochure, choose the page with the plan.</p>
        <button type="button" className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>Choose a floor plan</button>
        <span className="muted small">PNG, JPG or PDF · processed on this device</span>
      </div>
      <p className="fp-upload-note">We’ll try the printed room dimensions to suggest a scale for you to confirm. You can also use any known wall length.</p>
      <section className="fp-no-plan"><div><h3>No floor plan? Draw your house</h3><p>Start with a scaled grid. Draw rooms next to each other, enter measured sizes and add the stairs. Create a separate sheet for each floor.</p></div><button type="button" onClick={() => choose(addFloorPlan(blankHousePlan()))}>Draw a house without a plan</button></section>
    </> : <FloorPlanEditor key={`${project.id}:${plan.id}`} plan={plan} initialOwner={initialOwner}/>}
  </div>;
}

function Progress({ stage }: { stage: number }) {
  return <ol className="floorplan-steps fp-progress" aria-label="Floor plan progress">
    {['Upload', 'Set scale', 'Add rooms', 'Review'].map((label, i) => <li key={label} className={i < stage ? 'done' : ''} aria-current={i === stage ? 'step' : undefined}>
      <span aria-hidden="true">{i < stage ? '✓' : i + 1}</span><b>{label}</b>
    </li>)}
  </ol>;
}

function FloorPlanEditor({ plan, initialOwner }: { plan: FloorPlanDocument; initialOwner?: { kind: 'room' | 'staircase'; id: string } }) {
  const project = useProjectStore((s) => s.project);
  const newSpaceProductId = useProjectStore((s) => s.newSpaceProductId);
  const { addRoom, updateRoom, addStaircase, updateStaircase, addDoorway, updateDoorway, removeDoorway, updateFloorPlan, select, setTab } = useProjectStore();
  const key = `${project.id}:${plan.id}`;
  const [session, setSession] = useState<PlanSession>(() => {
    const previous = sessions.get(key);
    const restored: PlanSession = previous ? previous.draft.points.length || !newSpaceProductId ? previous
      : { ...previous, draft: { ...previous.draft, productId: newSpaceProductId } } : {
      tool: plan.sketch ? 'rectangle' : plan.mmPerPx ? 'detect' : 'scale', draft: emptyDraft(), selectedRoomId: '', selectedStaircaseId: '', toolPoints: [], squareWalls: true, review: false,
    };
    return initialOwner ? { ...restored, tool: plan.mmPerPx ? 'select' : 'scale', selectedRoomId: initialOwner.kind === 'room' ? initialOwner.id : '', selectedStaircaseId: initialOwner.kind === 'staircase' ? initialOwner.id : '' } : restored;
  });
  const { tool, draft, toolPoints, squareWalls, review } = session;
  const batch = session.batch;
  const reviewingBatch = !!batch && !draft.candidateId;
  const change = (patch: Partial<PlanSession>) => setSession((s) => ({ ...s, ...patch }));
  const changeDraft = (patch: Partial<Draft>) => setSession((s) => ({ ...s, draft: { ...s.draft, ...patch } }));
  useEffect(() => {
    sessions.set(key, session);
    while (sessions.size > 20) sessions.delete(sessions.keys().next().value!);
  }, [key, session]);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<Px | null>(null);
  const [notice, setNotice] = useState('');
  const [selectedPoint, setSelectedPoint] = useState(-1);
  const [snapWalls, setSnapWalls] = useState(true);
  const [scaleText, setScaleText] = useState(() => plan.calibration ? String(plan.calibration.distance / 1000) + 'm' : '');
  const scaleRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef<HTMLElement>(null);
  const showCanvasOnPhone = () => {
    if (window.matchMedia?.('(max-width: 760px)').matches) drawingRef.current?.scrollIntoView?.({ block: 'start' });
  };
  const detectVersion = useRef(0);
  const detection = useRoomDetection(plan);
  const [readingStatus, setReadingStatus] = useState<PlanReadingStatus>({ busy: false, error: null, cancelled: false });
  const automaticScaleEnabled = tool === 'scale' && !plan.sketch && !toolPoints.length && session.scalePreference !== 'manual' && (!plan.mmPerPx || session.scalePreference === 'automatic');
  const scaleFinder = useSuggestedScale(plan, { enabled: automaticScaleEnabled });
  const scaleSuggestion = automaticScaleEnabled ? scaleFinder.suggestion : undefined;
  const scaleUnavailable = scaleFinder.error || (!plan.reading && !readingStatus.busy && (readingStatus.cancelled ? 'Text reading is paused. Set a known wall length, or resume reading in the plan text options above.' : readingStatus.error ? 'The printed dimensions could not be read. Set a known wall length, or retry reading in the plan text options above.' : null));
  const [queuedDetection, setQueuedDetection] = useState<{ imageDataUrl: string; mmPerPx: number } | null>(null);
  const rooms = useMemo(() => project.rooms.filter((r) => r.source?.floorPlanId === plan.id), [project.rooms, plan.id]);
  const stairs = useMemo(() => project.staircases.filter((s) => s.source?.floorPlanId === plan.id), [project.staircases, plan.id]);
  const selected = rooms.find((r) => r.id === session.selectedRoomId);
  const selectedStaircase = stairs.find((s) => s.id === session.selectedStaircaseId);
  const editingRoom = draft.kind === 'room' ? rooms.find((r) => r.id === draft.editingId) : undefined;
  const unit = project.displayUnit;
  const drawing = drawingTools.includes(tool);
  const nextName = draft.kind === 'stairs' ? `Stairs ${project.staircases.length + 1}` : `Room ${project.rooms.length + 1}`;
  const outlineName = (points: Px[]) => draft.name || (draft.kind === 'room' ? suggestRoomName(plan.reading, points) : undefined) || nextName;
  const proposedProduct = batch?.productId ?? draft.productId;
  const currentProduct = project.products.some((p) => p.id === proposedProduct) ? proposedProduct : project.products.find((p) => p.id === newSpaceProductId)?.id ?? project.products[0]?.id ?? '';
  const editingTransform = editingRoom ? roomPlanTransform(editingRoom) : null;
  const draftScale = editingTransform ? 1 / editingTransform.pxPerMm : plan.mmPerPx;
  const pixelPrecision = plan.sketch ? 100 : 10;
  const storedPoints = draft.points.map((p) => ({ x: Math.round(p.x * pixelPrecision) / pixelPrecision, y: Math.round(p.y * pixelPrecision) / pixelPrecision }));
  // Keep the original symbol evidence during a drag so returning a corner restores its door.
  const draftDoorReview = reconcileDetectedDoorways(draft.detectedDoorways, draft.excludedDoorways, storedPoints, draftScale ?? 0);
  const removedDoorSuggestions = (draft.detectedDoorways?.length ?? 0) - draftDoorReview.detectedDoorways.length;
  const changeDraftDoorExclusions = (excluded: number[]) => {
    const originalIndices = draftDoorReview.detectedDoorways.map(door => draft.detectedDoorways!.indexOf(door));
    changeDraft({ excludedDoorways: [...(draft.excludedDoorways ?? []).filter(index => !originalIndices.includes(index)), ...excluded.map(index => originalIndices[index]!)] });
  };
  const polygon = draft.closed && draftScale ? traceToPolygon(storedPoints, draftScale) : null;
  const validPolygon = !!polygon && polygon.length >= 3 && polygonAreaM2(polygon) > 0 && isSimplePolygon(polygon);
  const overlapping = draft.closed && validPolygon ? [...rooms, ...stairs].filter((r) => r.id !== draft.editingId && outlinesOverlap(storedPoints, r.source!.pixelPolygon)) : [];
  const outsideSheet = !!plan.sketch && storedPoints.some(p => p.x < 0 || p.y < 0 || p.x > plan.widthPx || p.y > plan.heightPx);
  const boundaryPolygons = [...rooms, ...stairs].filter((r) => r.id !== draft.editingId).map((r) => r.source!.pixelPolygon);
  const snapPoint = (p: Px) => {
    const grid = plan.sketch && plan.mmPerPx ? plan.sketch.gridMm / plan.mmPerPx / 10 : 0;
    const gridded = grid ? { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid } : p;
    return snapWalls && draft.kind === 'room' ? snapToOutline(gridded, boundaryPolygons, 8 / zoom) : gridded;
  };
  const distance = parseLength(scaleText, unit === 'metric' ? 'm' : 'ft');
  const draftMm = (p: Px) => ({ x: (p.x - Math.min(...draft.points.map((v) => v.x))) * draftScale!, y: (p.y - Math.min(...draft.points.map((v) => v.y))) * draftScale! });
  const suggestedDoors = polygon ? draft.gaps.map((gap, index) => ({ index, placement: doorwayFromPoints(polygon, draftMm(gap.a), draftMm(gap.b)) }))
    .filter((item) => item.placement && item.placement.width >= 300 && item.placement.width <= 2000 && item.placement.maxDistance <= 200) : [];
  const keptDoors: Doorway[] = polygon && editingRoom && editingTransform ? editingRoom.doorways.flatMap((door) => {
    const edge = doorwaySegment(shapeToPolygon(editingRoom.shape), door);
    const next = doorwayFromPoints(polygon, draftMm(mmToPx(editingTransform, edge.from)), draftMm(mmToPx(editingTransform, edge.to)));
    if (!next || next.maxDistance > 300) return [];
    const { edgeIndex, offset, width } = next;
    return [{ ...door, edgeIndex, offset, width }];
  }) : [];

  useEffect(() => { if (tool === 'scale' && toolPoints.length === 2) scaleRef.current?.focus(); }, [tool, toolPoints.length]);
  useEffect(() => { if (draft.closed) { nameRef.current?.focus(); nameRef.current?.select(); } }, [draft.closed]);
  useEffect(() => () => { detectVersion.current++; }, []);
  useEffect(() => {
    if (!plan.reading || !draft.closed || draft.editingId || draft.nameEdited || draft.kind !== 'room') return;
    const name = suggestRoomName(plan.reading, draft.points);
    if (name && name !== draft.name) changeDraft({ name });
  }, [plan.reading, draft.closed, draft.editingId, draft.nameEdited, draft.kind, draft.points, draft.name]);
  useEffect(() => {
    if (!batch || !plan.reading) return;
    const updated = batch.rooms.map(room => {
      const name = !room.nameEdited ? suggestRoomName(plan.reading, room.polygon) : undefined;
      return name && name !== room.name ? { ...room, name } : room;
    });
    if (updated.some((room, index) => room !== batch.rooms[index])) change({ batch: { ...batch, rooms: updated } });
  }, [plan.reading, batch]);
  useEffect(() => {
    if (batch && (batch.mmPerPx !== plan.mmPerPx || batch.imageDataUrl !== plan.imageDataUrl || batch.widthPx !== plan.widthPx || batch.heightPx !== plan.heightPx)) {
      change({ batch: undefined, activeCandidateId: undefined, ...(draft.candidateId ? { draft: emptyDraft() } : {}) });
      setNotice('The plan or scale changed. Detect rooms again using the updated drawing.');
    }
  }, [plan.mmPerPx, plan.imageDataUrl, plan.widthPx, plan.heightPx, batch, draft.candidateId]);

  const switchTool = (next: PlanTool) => {
    if (plan.sketch && next === 'detect') next = 'rectangle';
    detectVersion.current++; detection.reset(); setHover(null); setNotice(''); setSelectedPoint(-1);
    change({ tool: next, toolPoints: [], review: false, ...(!draft.points.length && drawingTools.includes(next) ? { draft: { ...emptyDraft(), productId: currentProduct, kind: next === 'stairs' ? 'stairs' : 'room' } } : {}) });
  };
  const discard = () => {
    detectVersion.current++; detection.reset(); setHover(null); setNotice(''); setSelectedPoint(-1);
    change({ ...(draft.editingId || draft.candidateId ? { tool: 'select' as const } : {}), draft: { ...emptyDraft(), kind: tool === 'stairs' ? 'stairs' : 'room' }, toolPoints: [] });
  };
  const deletePoint = () => {
    if (!drawing || selectedPoint < 0) return;
    if (draft.closed && draft.points.length <= 3) { setNotice('An outline needs at least three corners. Move a corner or discard the outline.'); return; }
    changeDraft({ points: draft.points.filter((_, i) => i !== selectedPoint), gaps: [], acceptedGaps: [] });
    setSelectedPoint(-1); setNotice('Corner deleted. Check the updated outline before saving.');
  };
  const movePoint = (index: number, point: Px) => {
    setSelectedPoint(index);
    changeDraft({ points: draft.points.map((p, i) => i === index ? snapPoint(point) : p), gaps: [], acceptedGaps: [] });
  };
  const insertPoint = () => {
    if (selectedPoint < 0 || draft.points.length < 2) return;
    const a = draft.points[selectedPoint]!; const b = draft.points[(selectedPoint + 1) % draft.points.length]!;
    const points = [...draft.points]; points.splice(selectedPoint + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    changeDraft({ points, gaps: [], acceptedGaps: [] }); setSelectedPoint(selectedPoint + 1);
  };
  const undo = () => {
    setNotice(''); setSelectedPoint(-1);
    if (drawing && draft.closed) change({ tool: 'trace', draft: { ...draft, closed: false, gaps: [], acceptedGaps: [] } });
    else if (drawing) changeDraft({ points: draft.points.slice(0, -1), gaps: [] });
    else change({ toolPoints: toolPoints.slice(0, -1) });
  };
  const close = () => {
    if (draft.points.length < 3) return;
    changeDraft({ closed: true, name: outlineName(draft.points), productId: currentProduct }); setHover(null);
  };
  const applyScale = () => {
    if (toolPoints.length !== 2 || !distance || distance <= 0) return;
    const mmPerPx = mmPerPxFromCalibration(toolPoints[0]!, toolPoints[1]!, distance);
    if (!mmPerPx) { setNotice('Choose two different points for a known wall length.'); return; }
    updateFloorPlan(plan.id, { mmPerPx, calibration: { a: toolPoints[0]!, b: toolPoints[1]!, distance } });
    switchTool(draft.points.length ? 'trace' : 'detect');
    setNotice('Scale set. Choose a room on the plan to get started.');
    showCanvasOnPhone();
  };
  const startManualScale = () => {
    scaleFinder.reset();
    change({ scalePreference: 'manual', toolPoints: [] });
    setScaleText('');
    setNotice('Choose both ends of a wall with a known length.');
  };
  const startAutomaticScale = () => {
    change({ scalePreference: 'automatic', toolPoints: [] });
    setNotice('');
    scaleFinder.retry();
  };
  const confirmSuggestedScale = () => {
    if (!scaleSuggestion || tool !== 'scale' || toolPoints.length) return;
    const current = useProjectStore.getState().project.floorPlans.find(item => item.id === plan.id);
    if (!current || scaleSuggestion.sourceKey !== suggestedScaleSourceKey(current)) return;
    const { a, b, distance: knownLength } = scaleSuggestion;
    const mmPerPx = mmPerPxFromCalibration(a, b, knownLength);
    if (!mmPerPx || !Number.isFinite(mmPerPx) || !Number.isFinite(scaleSuggestion.mmPerPx)
      || Math.abs(mmPerPx - scaleSuggestion.mmPerPx) > mmPerPx * .005
      || [a, b].some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > plan.widthPx || point.y > plan.heightPx)) return;
    updateFloorPlan(plan.id, { mmPerPx, calibration: { a, b, distance: knownLength } });
    switchTool('detect');
    setQueuedDetection({ imageDataUrl: plan.imageDataUrl, mmPerPx });
    showCanvasOnPhone();
  };
  const saveRoom = () => {
    if (!validPolygon || !polygon || !currentProduct || overlapping.length || outsideSheet) return;
    const invalid = nameRef.current?.closest('section')?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return; }
    const name = draft.name.trim() || nextName;
    if (draft.candidateId && batch) {
      change({ tool: 'select', draft: { ...emptyDraft(), productId: currentProduct }, batch: { ...batch, ...(draft.kind === 'stairs' ? { staircases: batch.staircases?.map(stair => stair.id === draft.candidateId ? { ...stair, polygon: storedPoints, name } : stair) } : { rooms: batch.rooms.map(room => room.id === draft.candidateId ? { ...room, polygon: storedPoints, inferredGaps: draft.gaps, name, nameEdited: draft.nameEdited, ...reconcileDetectedDoorways(draft.detectedDoorways, draft.excludedDoorways, storedPoints, batch.mmPerPx) } : room) }) } });
      setSelectedPoint(-1); setNotice('Suggestion updated. Add the selected rooms when you have checked the plan.');
      return;
    }
    const source = {
      floorPlanId: plan.id, pixelPolygon: storedPoints,
    };
    if (draft.kind === 'stairs') {
      const id = draft.editingId ?? addStaircase({ name, productId: currentProduct, source });
      if (draft.editingId) updateStaircase(id, { name, productId: currentProduct, source });
      change({ tool: 'select', draft: { ...emptyDraft(), productId: currentProduct }, selectedRoomId: '', selectedStaircaseId: id });
      setSelectedPoint(-1); setNotice(`${name} footprint saved. Open Stair dimensions to check the risers, treads and turns; the footprint does not determine them.`);
      return;
    }
    const roomPatch = { name, productId: currentProduct, shape: { kind: 'polygon' as const, points: polygon }, doorways: keptDoors, source };
    const id = draft.editingId ?? addRoom(roomPatch);
    if (draft.editingId) updateRoom(id, roomPatch);
    for (const suggestion of suggestedDoors.filter((s) => draft.acceptedGaps.includes(s.index))) {
      const { edgeIndex, offset, width } = suggestion.placement!;
      addDoorway(id, { edgeIndex, offset, width, transition: 'carpet' });
    }
    select({ kind: 'floorplan', id: plan.id });
    change({ ...(draft.editingId ? { tool: 'select' as const } : {}), draft: { ...emptyDraft(), productId: currentProduct }, selectedRoomId: id, selectedStaircaseId: '' });
    setSelectedPoint(-1); setNotice(`${name} ${draft.editingId ? 'updated' : 'added'}. Add another room, or select this room to mark its doorways.`);
    showCanvasOnPhone();
  };
  const selectRoom = (room: Room) => { switchTool('select'); change({ selectedRoomId: room.id, selectedStaircaseId: '', tool: 'select', toolPoints: [], review }); };
  const selectStairs = (stair: Staircase) => { switchTool('select'); change({ selectedRoomId: '', selectedStaircaseId: stair.id, tool: 'select', toolPoints: [], review }); };
  const editOutline = (item: Room | Staircase, kind: 'room' | 'stairs') => {
    if (!item.source) return;
    switchTool('trace');
    change({ tool: 'trace', draft: { ...emptyDraft(), points: item.source.pixelPolygon.map((p) => ({ ...p })), closed: true, name: item.name, productId: item.productId, editingId: item.id, kind } });
  };
  const hitRoom = (point: Px) => rooms.filter((r) => pointInPixelPolygon(point, r.source!.pixelPolygon)).sort((a, b) => pixelPolygonArea(a.source!.pixelPolygon) - pixelPolygonArea(b.source!.pixelPolygon))[0];

  const batchIssues = new Map<string, string>();
  const selectedSuggestions = [...(batch?.rooms ?? []), ...(batch?.staircases ?? [])].filter(item => item.included);
  for (const room of batch?.rooms ?? []) {
    const issue = roomSuggestionIssue(room, selectedSuggestions, [...rooms, ...stairs], plan);
    if (issue) batchIssues.set(room.id, issue);
  }
  const staircaseIssue = (stair: StaircaseSuggestion) => !Number.isInteger(stair.estimatedRisers) || stair.estimatedRisers < 2 || stair.estimatedRisers > MAX_RISERS || !Number.isFinite(stair.widthMm) || stair.widthMm < 300 || !Number.isFinite(stair.goingMm) || stair.goingMm < 100 || !Number.isFinite(stair.riseMm) || stair.riseMm < 80
    ? 'Check the stair count, width, tread depth and riser height.' : roomSuggestionIssue({ ...stair, inferredGaps: [] }, selectedSuggestions, [...rooms, ...stairs], plan);
  for (const stair of batch?.staircases ?? []) { const issue = staircaseIssue(stair); if (issue) batchIssues.set(stair.id, issue); }
  const updateCandidate = (id: string, patch: Partial<RoomSuggestion>) => setSession(current => current.batch ? { ...current, batch: { ...current.batch, rooms: current.batch.rooms.map(room => room.id === id ? { ...room, ...patch } : room) } } : current);
  const updateStairCandidate = (id: string, patch: Partial<StaircaseSuggestion>) => setSession(current => current.batch ? { ...current, batch: { ...current.batch, staircases: current.batch.staircases?.map(stair => stair.id === id ? { ...stair, ...patch } : stair) } } : current);
  const detectAll = async () => {
    if (!plan.mmPerPx || plan.sketch || draft.points.length || detection.busy) return;
    const version = ++detectVersion.current;
    change({ tool: 'detect', batch: undefined, activeCandidateId: undefined, selectedRoomId: '', selectedStaircaseId: '', review: false });
    setNotice('');
    try {
      const result = await detection.detectAll({ excludePolygons: [...rooms, ...stairs].map(room => room.source!.pixelPolygon) });
      if (version !== detectVersion.current) return;
      if (!result.ok) { setNotice(result.reason); return; }
      if (!result.candidates.length && !result.staircases?.length) { setNotice(result.message || 'No new enclosed rooms found. Click inside a room or draw its outline.'); return; }
      const candidates = result.candidates.map((candidate, index): RoomSuggestion => ({ ...candidate, ...reconcileDetectedDoorways(candidate.detectedDoorways, [], candidate.polygon, plan.mmPerPx!), id: newId('suggestion'), name: suggestRoomName(plan.reading, candidate.polygon) ?? `Room ${project.rooms.length + index + 1}`, included: !isSmallRoomSuggestion(candidate.polygon, plan.mmPerPx!) }));
      const staircaseCandidates = result.staircases?.map((stair, index): StaircaseSuggestion => ({ ...stair, id: newId('stair-suggestion'), name: stair.name || `Stairs ${project.staircases.length + index + 1}`, included: false, riseMm: 200 }));
      change({ tool: 'select', batch: { rooms: candidates, staircases: staircaseCandidates, mmPerPx: plan.mmPerPx, message: result.message, productId: currentProduct, imageDataUrl: plan.imageDataUrl, widthPx: plan.widthPx, heightPx: plan.heightPx }, activeCandidateId: candidates[0]?.id ?? staircaseCandidates?.[0]?.id });
    } catch (error) { if (version === detectVersion.current) setNotice(error instanceof Error ? error.message : 'Detection could not finish. Try one room or draw an outline.'); }
  };
  useEffect(() => {
    if (!queuedDetection) return;
    setQueuedDetection(null);
    if (tool === 'detect' && plan.mmPerPx === queuedDetection.mmPerPx && plan.imageDataUrl === queuedDetection.imageDataUrl) void detectAll();
  }, [queuedDetection, tool, plan.mmPerPx, plan.imageDataUrl]);
  const acceptBatch = () => {
    if (!batch || !currentProduct || batch.mmPerPx !== plan.mmPerPx || batch.imageDataUrl !== plan.imageDataUrl || batch.widthPx !== plan.widthPx || batch.heightPx !== plan.heightPx) return;
    const included = batch.rooms.filter(room => room.included);
    const includedStairs = (batch.staircases ?? []).filter(stair => stair.included);
    const current = useProjectStore.getState().project;
    const existing = [...current.rooms, ...current.staircases].filter(room => room.source?.floorPlanId === plan.id);
    const allIncluded = [...included, ...includedStairs];
    if (!allIncluded.length || included.some(room => roomSuggestionIssue(room, allIncluded, existing, plan)) || includedStairs.some(stair => staircaseIssue(stair) || roomSuggestionIssue({ ...stair, inferredGaps: [] }, allIncluded, existing, plan))) { setNotice('Check the highlighted overlaps and stair measurements before adding these spaces.'); return; }
    const doorways = prepareDetectedDoorways(included, batch.mmPerPx, currentProduct, current.rooms.filter(room => room.source?.floorPlanId === plan.id), current.products);
    let doorwayCount = 0;
    let firstId = '';
    for (const candidate of included) {
      const acceptedDoors = doorways.byCandidate.get(candidate.id) ?? [];
      doorwayCount += acceptedDoors.length;
      const id = addRoom({ name: candidate.name.trim() || `Room ${useProjectStore.getState().project.rooms.length+1}`, doorways: acceptedDoors, productId: currentProduct, shape: { kind: 'polygon', points: traceToPolygon(candidate.polygon, batch.mmPerPx) }, source: { floorPlanId: plan.id, pixelPolygon: candidate.polygon } });
      firstId ||= id;
    }
    for (const link of doorways.links) updateDoorway(link.roomId, link.doorwayId, { sharedOpeningId: link.sharedOpeningId });
    let firstStairId = '';
    for (const candidate of includedStairs) {
      const id = addStaircase({ name: candidate.name.trim() || 'Stairs', productId: currentProduct, steps: makeSteps(candidate.estimatedRisers, { kind: 'straight', width: Math.round(candidate.widthMm), going: Math.round(candidate.goingMm), rise: Math.round(candidate.riseMm) }), landings: [],
        layout: { kind: 'straight', direction: 'right', turnStartIndex: 0, turnSteps: 0 }, source: { floorPlanId: plan.id, pixelPolygon: candidate.polygon },
        notes: `Estimated from ${candidate.visibleTreads} visible tread lines on the floor plan. Check the total riser count, turns, landings and rise before ordering. ${candidate.message}` });
      firstStairId ||= id;
    }
    select({ kind: 'floorplan', id: plan.id });
    change({ tool: 'select', batch: undefined, activeCandidateId: undefined, selectedRoomId: firstId, selectedStaircaseId: firstId ? '' : firstStairId, review: true });
    setNotice(`${included.length} rooms${includedStairs.length ? ` and ${includedStairs.length} staircases` : ''} added${doorwayCount ? ' with the selected doorways' : ''}. ${includedStairs.length ? 'Open Stair dimensions & turns to check the full flights.' : 'Select a room to edit its outline or doorways.'}`);
  };

  const detectAt = async (point: Px) => {
    const version = ++detectVersion.current;
    setNotice('');
    try {
      const result = await detection.detect(point);
      if (version !== detectVersion.current) return;
      if (!result.ok) { setNotice(result.reason); return; }
      setSelectedPoint(-1);
      changeDraft({ points: result.polygon, closed: true, name: outlineName(result.polygon), productId: currentProduct, gaps: result.inferredGaps, acceptedGaps: [] });
      if (result.message && !result.inferredGaps.length) setNotice(result.message);
    } catch (cause) {
      if (version === detectVersion.current) setNotice(cause instanceof Error ? cause.message : 'Could not detect this room. Use Rectangle or Draw outline.');
    }
  };
  const onTap = (point: Px, info: PointerInfo) => {
    if (point.x < 0 || point.y < 0 || point.x > plan.widthPx || point.y > plan.heightPx) return;
    if (reviewingBatch) {
      const stair = batch!.staircases?.find(stair => pointInPixelPolygon(point, stair.polygon));
      if (stair) { change({ activeCandidateId: stair.id }); return; }
      const candidate = batch!.rooms.find(room => pointInPixelPolygon(point, room.polygon));
      if (candidate) change({ activeCandidateId: candidate.id });
      return;
    }
    if (drawing && draft.closed) return;
    if (tool === 'select' || (drawing && draft.kind === 'room' && !draft.points.length)) {
      const stair = stairs.find((s) => pointInPixelPolygon(point, s.source!.pixelPolygon));
      if (stair && tool === 'select') { selectStairs(stair); return; }
      const hit = hitRoom(point);
      // An empty manual tool can start on a shared wall; clicking inside a room selects it.
      if (hit && (tool === 'select' || tool === 'detect' || (nearestEdge(hit.source!.pixelPolygon, point)?.distance ?? 0) > 8 / zoom)) { selectRoom(hit); return; }
    }
    if (tool === 'select') { change({ selectedRoomId: '', selectedStaircaseId: '' }); return; }
    if (tool === 'scale' || tool === 'measure' || tool === 'doorway') {
      if (tool === 'scale') scaleFinder.reset();
      setNotice(''); change({ ...(tool === 'scale' ? { scalePreference: 'manual' as const } : {}), toolPoints: toolPoints.length >= 2 ? [point] : [...toolPoints, point] }); return;
    }
    if (!plan.mmPerPx || detection.busy) return;
    if (tool === 'detect') { void detectAt(point); return; }
    const placed = snapPoint(point);
    if (tool === 'rectangle' || tool === 'stairs') {
      const a = draft.points[0];
      if (!a) { changeDraft({ points: [placed] }); return; }
      if (Math.abs(a.x - placed.x) < 2 || Math.abs(a.y - placed.y) < 2) { setNotice('Choose the opposite corner, away from the first point.'); return; }
      const points = [a, { x: placed.x, y: a.y }, placed, { x: a.x, y: placed.y }];
      changeDraft({ points, closed: true, name: outlineName(points), productId: currentProduct });
      setHover(null); return;
    }
    const last = draft.points[draft.points.length - 1];
    const p = snapPoint(last && (info.shiftKey || (squareWalls && !info.altKey)) ? snapOrthogonal(last, point) : point);
    if (draft.points.length >= 3 && closeEnough(point, draft.points[0]!, (info.pointerType === 'touch' ? 22 : 12) / zoom)) { close(); return; }
    if (draft.points.some((v) => closeEnough(v, point, 10 / zoom))) return;
    if (last && closeEnough(last, p, 5 / zoom)) return;
    changeDraft({ points: [...draft.points, p] }); setNotice('');
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === 'Escape') discard();
      if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); if (drawing && selectedPoint >= 0) deletePoint(); else undo(); }
      if (drawing && selectedPoint >= 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); const p = draft.points[selectedPoint]!; const step = (event.shiftKey ? 10 : 1) / zoom;
        movePoint(selectedPoint, { x: Math.max(0, Math.min(plan.widthPx, p.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))), y: Math.max(0, Math.min(plan.heightPx, p.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0))) });
      }
      if (event.key === 'Enter' && tool === 'trace' && !draft.closed) { event.preventDefault(); close(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const doorPreview = useMemo(() => {
    if (tool !== 'doorway' || !selected || toolPoints.length !== 2) return null;
    return previewManualDoorway(selected, toolPoints[0]!, toolPoints[1]!, zoom);
  }, [tool, selected, toolPoints, zoom]);
  const doorOverlap = doorPreview?.adjusted ? [...rooms, ...stairs].find(room => room.id !== selected?.id && room.source && outlinesOverlap(doorPreview.pixelPolygon, room.source.pixelPolygon)) : undefined;
  const saveDoorway = () => {
    if (!doorPreview || !selected || doorOverlap) return;
    const { edgeIndex, offset, width } = doorPreview.placement;
    if (doorPreview.adjusted) {
      const current = useProjectStore.getState().project;
      if ([...current.rooms, ...current.staircases].some(room => room.id !== selected.id && room.source?.floorPlanId === plan.id && outlinesOverlap(doorPreview.pixelPolygon, room.source.pixelPolygon))) { setNotice('The straight doorway would overlap another space. Adjust the room outline first.'); return; }
      updateRoom(selected.id, { shape: { kind: 'polygon', points: doorPreview.polygon }, source: { ...selected.source!, pixelPolygon: doorPreview.pixelPolygon }, doorways: [...doorPreview.retainedDoorways, { id: newId('door'), edgeIndex, offset, width, transition: 'carpet', label: `${selected.name} door ${selected.doorways.length + 1}` }] });
    } else addDoorway(selected.id, { edgeIndex, offset, width, transition: 'carpet' });
    change({ toolPoints: [] }); setNotice(`Doorway added to ${selected.name}${doorPreview.adjusted ? ' with a straight threshold and the floor beneath included' : ''}. Mark another opening or finish.`);
  };
  const totalArea = rooms.reduce((sum, room) => sum + polygonAreaM2(shapeToPolygon(room.shape)), 0);
  const stage = !plan.mmPerPx || tool === 'scale' ? 1 : review ? 3 : 2;
  const pendingOutline = draft.points.length > 0;
  const toolHelp = tool === 'detect' ? 'Click an empty part inside a room. We’ll suggest its outline for you to check.'
    : tool === 'rectangle' ? 'Click two opposite corners inside the walls. The rectangle closes automatically.'
    : tool === 'stairs' ? 'Click two opposite corners of the staircase footprint. Then adjust its corners to fit the plan.'
    : 'Click the inside corners around the room, then finish the outline. Square walls keeps horizontal and vertical edges aligned.';
  const canvasTask = reviewingBatch ? 'Review the numbered room suggestions. Select an outline to check its name, measurements and corners.' : scaleSuggestion ? 'Suggested scale: check the highlighted A–B length, then confirm below.' : tool === 'scale' ? (toolPoints.length === 2 ? 'Enter the known distance below to set the scale.' : `Set scale: tap ${toolPoints.length ? 'the other' : 'one'} end of a known wall length.`)
    : drawing && draft.closed ? `Review the outline. Select a corner to move or delete it, then ${draft.candidateId ? 'save the suggestion' : draft.editingId ? 'save changes' : draft.kind === 'stairs' ? 'add the staircase' : 'add the room'} below.`
    : drawing ? (detection.busy ? 'Finding the room boundary…' : toolHelp.replaceAll('Click', 'Tap'))
    : tool === 'measure' ? 'Tap two points to check a distance.'
    : tool === 'doorway' ? `Tap both sides of a doorway on ${selected?.name ?? 'the selected room'}.`
    : 'Tap an added room or staircase to see its details below.';

  return <>
    {plan.sketch ? <div className="fp-sketch-guide"><strong>Draw your house, one room at a time</strong><p>Each large square is {formatLength(plan.sketch.gridMm, unit)}. Choose two corners, then enter the room’s exact length and width. Add neighbouring rooms against shared walls; use a new drawing sheet for the next floor.</p></div> : <Progress stage={stage}/>}
    <div className={`fp-workspace-bar${tool === 'scale' ? ' is-calibrating' : ''}`}>

      <span className="fp-scale-summary" data-testid="scale-status">{tool === 'scale' ? 'Setting scale · confirmation needed' : plan.mmPerPx ? `Scale set${plan.calibration ? ` from ${formatLength(plan.calibration.distance, unit)}` : ''}` : 'Set the scale to start measuring'}
        {plan.mmPerPx && tool !== 'scale' && !plan.sketch ? <button type="button" className="link" disabled={!!batch || detection.busy} onClick={() => switchTool('scale')}>Change scale</button> : null}
      </span>
      <span className="fp-workspace-total">{rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} · {formatArea(totalArea, unit)}{stairs.length ? ` · ${stairs.length} ${stairs.length === 1 ? 'staircase' : 'staircases'}` : ''}</span>
      {rooms.length + stairs.length > 0 && !batch && tool !== 'scale' ? <button type="button" onClick={() => { switchTool('select'); change({ tool: 'select', review: true }); }}>Review rooms</button> : null}
    </div>
    <div className="fp-workspace">
      <section className="fp-drawing-area" aria-label="Plan workspace" ref={drawingRef}>
        {tool !== 'scale' ? <div className="fp-tools" aria-label="Room drawing methods" role="group">
          {!plan.sketch ? <button type="button" className="fp-detect-all" disabled={!plan.mmPerPx || detection.busy || pendingOutline || !!batch} onClick={() => void detectAll()}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3H3v3m11-3h3v3M3 14v3h3m11-3v3h-3M7 7h6v6H7z"/></svg>Detect all rooms</button> : null}
          {([{ id: 'detect', label: 'Detect room' }, { id: 'rectangle', label: 'Rectangle' }, { id: 'trace', label: 'Draw outline' }] as const).filter(m => !plan.sketch || m.id !== 'detect').map((m) => <button type="button" key={m.id} aria-pressed={tool === m.id} disabled={!plan.mmPerPx || !!batch || detection.busy || (pendingOutline && tool !== m.id)} onClick={() => switchTool(m.id)}>{m.label}</button>)}
          <button type="button" aria-pressed={tool === 'stairs'} disabled={!plan.mmPerPx || !!batch || detection.busy || (pendingOutline && tool !== 'stairs')} onClick={() => switchTool('stairs')}>Draw stairs</button>
          <span className="fp-tool-spacer"/>
          <button type="button" aria-pressed={tool === 'select'} disabled={!plan.mmPerPx || !!batch || detection.busy} onClick={() => switchTool('select')}>Select room</button>
          <button type="button" aria-pressed={tool === 'measure'} disabled={!plan.mmPerPx || !!batch || detection.busy} onClick={() => switchTool('measure')}>Measure</button>
        </div> : null}
        <p className="fp-mobile-task" role="status">{canvasTask}</p>
        <FloorPlanCanvas plan={plan} zoom={zoom} scaleState={{ active: tool === 'scale', pointCount: scaleSuggestion ? 2 : toolPoints.length, distance: scaleSuggestion?.distance ?? distance ?? undefined, suggested: !!scaleSuggestion, searching: automaticScaleEnabled && !scaleSuggestion && !scaleUnavailable }} unit={unit} onZoomChange={setZoom} crosshair={tool !== 'select'} onTap={onTap} onDoubleTap={() => { if (tool === 'trace' && !draft.closed) close(); }}
          precision={['scale', 'measure', 'doorway', 'trace', 'rectangle', 'stairs'].includes(tool) && !reviewingBatch} precisionPoints={drawing ? draft.points : toolPoints}
          editablePoints={drawing ? draft.points : ['scale', 'measure', 'doorway'].includes(tool) ? toolPoints : undefined} onPointSelect={setSelectedPoint} onPointMove={(index, point) => {
            if (drawing) movePoint(index, point);
            else if (['scale', 'measure', 'doorway'].includes(tool)) { if (tool === 'scale') scaleFinder.reset(); change({ toolPoints: toolPoints.map((old, i) => i === index ? point : old), ...(tool === 'scale' ? { scalePreference: 'manual' } : {}) }); }
          }}
          onHover={(p, info) => {
            const last = draft.points[draft.points.length - 1];
            setHover(p && tool === 'trace' && last && (info.shiftKey || (squareWalls && !info.altKey)) ? snapOrthogonal(last, p) : p);
          }}>
          {scaleSuggestion ? <g pointerEvents="none" data-testid="scale-reference-room"><title>{scaleSuggestion.roomName || 'Room used to suggest scale'}</title><polygon className="fp-scale-room-preview" points={scaleSuggestion.polygon.map(point => `${point.x},${point.y}`).join(' ')} strokeWidth={1.5 / zoom}/></g> : null}
          <PlanOverlay plan={plan} scaleDistance={scaleSuggestion?.distance ?? distance ?? undefined} rooms={rooms} stairs={stairs} selectedStaircaseId={selectedStaircase?.id} selectedRoomId={selected?.id ?? ''} selectedPoint={selectedPoint} overlappingIds={overlapping.map((r) => r.id)} editingRoomId={draft.editingId} outlineScale={draftScale} tool={tool} points={drawing ? draft.points : scaleSuggestion ? [scaleSuggestion.a, scaleSuggestion.b] : toolPoints} closed={drawing && draft.closed} hover={hover} zoom={zoom} gaps={draft.gaps} previewDoor={doorPreview ?? undefined} previewDoorOutline={doorPreview?.adjusted ? doorPreview.pixelPolygon : undefined} unit={unit}/>
          {drawing && draft.closed && draftDoorReview.detectedDoorways.length ? <DoorwaySuggestionOverlay doorways={draftDoorReview.detectedDoorways} excluded={draftDoorReview.excludedDoorways} roomName={draft.name} polygon={draft.points} zoom={zoom} mmPerPx={draftScale} unit={unit}/> : null}
          {batch ? <DetectedRoomsOverlay rooms={batch.rooms} activeId={session.activeCandidateId} editingId={draft.candidateId} zoom={zoom} mmPerPx={batch.mmPerPx} unit={unit} onSelect={id => { if (!draft.candidateId) change({ activeCandidateId: id }); }}/> : null}
          {batch?.staircases?.length ? <DetectedStairsOverlay stairs={batch.staircases} activeId={session.activeCandidateId} editingId={draft.candidateId} zoom={zoom} onSelect={id => { if (!draft.candidateId) change({ activeCandidateId: id }); }}/> : null}
        </FloorPlanCanvas>
        <div className="fp-canvas-footer"><span><i className="fp-key saved"/>Added room</span>{stairs.length ? <span><i className="fp-key stairs"/>Stairs footprint</span> : null}<span><i className="fp-key draft"/>Outline to review</span>{draft.gaps.length > 0 ? <span><i className="fp-key inferred"/>Possible doorway</span> : null}<span className="fp-footer-tip">Shared walls allowed · room overlaps prevented</span></div>
      </section>
      <aside className={`fp-inspector${tool === 'scale' ? ' fp-scale-inspector' : ''}`} aria-label="Current floor plan task">
        {!plan.sketch ? <PlanReader plan={plan} onStatusChange={setReadingStatus} onUseName={drawing ? (name) => { changeDraft({ name, nameEdited: true }); nameRef.current?.focus(); } : undefined} onUseDistance={tool === 'scale' ? (mm) => { scaleFinder.reset(); change({ scalePreference: 'manual' }); setScaleText(`${mm}mm`); scaleRef.current?.focus(); } : undefined}/> : null}
        {reviewingBatch ? <><DetectedRoomsReview plan={plan} products={project.products} productId={currentProduct} onProductChange={productId => change({ batch: { ...batch!, productId } })} rooms={batch!.rooms} activeId={session.activeCandidateId} issues={batchIssues} unit={unit} message={batch!.message}
          blockedSummary={selectedSuggestions.filter(item => item.id !== session.activeCandidateId && batchIssues.has(item.id)).slice(0, 2).map(item => `${item.name}: ${batchIssues.get(item.id)}`).join(' ')}
          selectedStairs={batch!.staircases?.filter(stair => stair.included).length} invalidStairs={batch!.staircases?.some(stair => stair.included && batchIssues.has(stair.id))}
          stairsReview={batch!.staircases?.length ? <DetectedStairsReview stairs={batch!.staircases} activeId={session.activeCandidateId} issues={batchIssues} unit={unit} onSelect={id => change({ activeCandidateId: id })} onChange={updateStairCandidate}
            onEdit={stair => { change({ tool: 'trace', draft: { ...emptyDraft(), kind: 'stairs', candidateId: stair.id, points: stair.polygon.map(point => ({ ...point })), name: stair.name, productId: currentProduct, closed: true } }); setSelectedPoint(-1); }}/> : undefined}
          onSelect={id => change({ activeCandidateId: id })} onChange={updateCandidate}
          onEdit={room => { change({ tool: 'trace', draft: { ...emptyDraft(), candidateId: room.id, points: room.polygon.map(p => ({...p})), gaps: room.inferredGaps, name: room.name, nameEdited: room.nameEdited, productId: currentProduct, closed: true, detectedDoorways: room.detectedDoorways, excludedDoorways: room.excludedDoorways } }); setSelectedPoint(-1); }}
          onRemove={id => { const remaining = batch!.rooms.filter(room => room.id !== id); change({ batch: remaining.length || batch!.staircases?.length ? { ...batch!, rooms: remaining } : undefined, activeCandidateId: remaining[0]?.id ?? batch!.staircases?.[0]?.id }); }}
          onAccept={acceptBatch} onCancel={() => { change({ batch: undefined, activeCandidateId: undefined, tool: 'detect' }); setNotice('Suggestions discarded. Saved rooms are unchanged.'); }}/></>
        : tool === 'scale' ? <section data-testid="mode-scale">
          {scaleSuggestion ? <ScaleSuggestionCard suggestion={scaleSuggestion} unit={unit} onConfirm={confirmSuggestedScale} onManual={startManualScale}/> : automaticScaleEnabled && !toolPoints.length ? <div className="fp-auto-scale-search">
            <div className="eyebrow">STEP 2 · SET THE SCALE</div><h3>{scaleUnavailable ? 'Set a known wall length' : 'Finding the scale for you'}</h3>
            <p className="fp-scale-search-status" role="status">{scaleUnavailable || (scaleFinder.busy ? 'Matching printed dimensions to the room walls…' : !plan.reading ? 'Room sizes are being read from the plan. A matching length will appear here for you to confirm.' : 'Checking the printed room sizes against the drawing…')}</p>
            <button type="button" className={scaleUnavailable ? 'primary fp-primary' : ''} onClick={startManualScale}>Set scale manually</button>
            {scaleFinder.error && plan.reading ? <button type="button" className="link" onClick={startAutomaticScale}>Try automatic scale again</button> : null}
          </div> : <>
          <div className="eyebrow">STEP 2 · SET THE SCALE</div><h3>{toolPoints.length === 2 ? 'How long is that wall?' : 'Mark a known wall length'}</h3>
          <p>Click each end of a wall with a known dimension on the plan.</p>
          <ol className="fp-scale-checklist"><li className={toolPoints.length > 0 ? 'complete' : 'current'}><span>A</span>Mark the first end</li><li className={toolPoints.length > 1 ? 'complete' : toolPoints.length === 1 ? 'current' : ''}><span>B</span>Mark the other end</li><li className={toolPoints.length === 2 ? 'current' : ''}><span>3</span>Enter the length and confirm</li></ol><div className="fp-task-progress">{toolPoints.length} of 2 points selected</div>
          {toolPoints.length === 2 ? <form onSubmit={(e) => { e.preventDefault(); applyScale(); }}>
            <Field label="Known distance" hint={unit === 'metric' ? 'For example 4.35, 435cm or 14ft 3in.' : 'For example 14ft 3in or 4.35m.'}>
              <input ref={scaleRef} type="text" aria-label="Known distance" value={scaleText} onChange={(e) => setScaleText(e.target.value)}/>
            </Field>
            <button type="submit" className="primary fp-primary" disabled={!distance || distance <= 0}>Set scale & continue</button>
            {scaleText && (!distance || distance <= 0) ? <p className="field-hint invalid">Enter a positive wall length.</p> : null}
          </form> : null}
          {toolPoints.length > 0 ? <button type="button" className="link" onClick={() => change({ toolPoints: [] })}>Choose different points</button> : null}
          <p className="fp-help">Use a printed or measured length. The size of an image does not tell us its real scale.</p>
          {!plan.sketch ? <button type="button" className="link" onClick={startAutomaticScale}>Try automatic scale</button> : null}
          </>}
          {rooms.length > 0 ? <p className="warning">Changing the scale affects new outlines. The {rooms.length} existing rooms keep their saved measurements.</p> : null}
          {plan.mmPerPx ? <button type="button" onClick={() => switchTool(pendingOutline ? 'trace' : 'detect')}>Keep current scale</button> : null}
        </section> : drawing && draft.closed ? <section data-testid="mode-review-outline">
          <div className="eyebrow">{draft.candidateId ? draft.kind === 'stairs' ? 'EDIT STAIRCASE SUGGESTION' : 'EDIT ROOM SUGGESTION' : draft.editingId ? 'EDIT SAVED OUTLINE' : 'CHECK BEFORE ADDING'}</div><h3>{draft.kind === 'stairs' ? 'Check the stairs footprint' : 'Does this outline match?'}</h3>
          <p>Drag a corner to adjust it, or select a corner to delete it. Check that the outline follows the inside of the walls.</p>
          {polygon ? <div className="fp-outline-figures"><strong data-testid="trace-area">{formatArea(polygonAreaM2(polygon), unit)}</strong><span>{formatLength(polygonPerimeter(polygon), unit)} perimeter</span></div> : null}
          {draft.kind === 'room' && !plan.sketch ? <PlanDimensionCheck reading={plan.reading} polygon={storedPoints} mmPerPx={draftScale}/> : null}
          {plan.sketch && draft.points.length === 4 && draft.points.every((p, i) => Math.abs(p.x - draft.points[(i + 1) % 4]!.x) < .01 || Math.abs(p.y - draft.points[(i + 1) % 4]!.y) < .01) ? <div className="grid-2">
            {(['x', 'y'] as const).map(axis => { const min = Math.min(...draft.points.map(p => p[axis])); const extent = Math.max(...draft.points.map(p => p[axis])) - min; return <Field key={axis} label={axis === 'x' ? 'Measured length' : 'Measured width'}><LengthInput ariaLabel={axis === 'x' ? 'Sketch room length' : 'Sketch room width'} unit={unit} min={100} value={extent * draftScale!} onChange={mm => changeDraft({ points: draft.points.map(p => ({ ...p, [axis]: min + (p[axis] - min) / Math.max(.01, extent) * mm / draftScale! })) })}/></Field>; })}
          </div> : null}
          {draft.gaps.length ? <p className="warning">Dashed edges close possible door openings. Check that only one room is included.</p> : null}
          {draftDoorReview.detectedDoorways.length ? <DoorwaySuggestions doorways={draftDoorReview.detectedDoorways} excluded={draftDoorReview.excludedDoorways} roomName={draft.name} polygon={storedPoints} mmPerPx={draftScale!} unit={unit} onChangeExcluded={changeDraftDoorExclusions}/> : null}
          {removedDoorSuggestions ? <p className="fp-help">{removedDoorSuggestions} doorway {removedDoorSuggestions === 1 ? 'suggestion no longer matches' : 'suggestions no longer match'} the moved wall. Restore the outline or mark the opening again after adding the room.</p> : null}
          {suggestedDoors.length && !draft.candidateId ? <fieldset className="fp-door-suggestions"><legend>Possible doorways</legend><p>Choose the openings that are doors. Their measured width comes from this plan’s scale.</p>{suggestedDoors.map(({ index, placement }) => <label className="checkbox" key={index}><input type="checkbox" checked={draft.acceptedGaps.includes(index)} onChange={(e) => changeDraft({ acceptedGaps: e.target.checked ? [...draft.acceptedGaps, index] : draft.acceptedGaps.filter((i) => i !== index) })}/>Opening {index + 1} · {formatLength(placement!.width, unit)}</label>)}</fieldset> : null}
          {!validPolygon ? <p className="warning error" role="alert">The outline crosses itself or has no area. Move its corners or draw it again.</p> : null}
          {outsideSheet ? <p className="warning error" role="alert">This outline reaches outside the drawing sheet. Move its corners or reduce the measured size to fit the grid.</p> : null}
          {overlapping.length ? <p className="warning error" role="alert">This outline overlaps {overlapping.map((r) => `“${r.name}”`).join(', ')}. Move or delete corners until the rooms meet at a shared wall. The conflicting room is highlighted.</p> : null}
          {editingRoom && keptDoors.length < editingRoom.doorways.length ? <p className="warning">{editingRoom.doorways.length - keptDoors.length} existing doorway(s) no longer match a wall and will be removed when you save. You can mark them again afterwards.</p> : null}
          {draft.kind === 'stairs' ? <p className="fp-help">This marks where the staircase sits on the plan. Check riser count, tread sizes and turns in Stair dimensions after adding it.</p> : null}
          <form onSubmit={(e) => { e.preventDefault(); saveRoom(); }}>
            <Field label={draft.kind === 'stairs' ? 'Staircase name' : 'Room name'}><input ref={nameRef} type="text" aria-label={draft.kind === 'stairs' ? 'Staircase name' : 'Room name'} value={draft.name} onChange={(e) => changeDraft({ name: e.target.value, nameEdited: true })}/></Field>
            {!draft.candidateId ? <Field label="Floor covering"><select aria-label="Floor covering" value={currentProduct} onChange={(e) => changeDraft({ productId: e.target.value })}>{project.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field> : <p className="fp-help">Uses the floor covering selected for this batch. Included doorway suggestions are saved with the room.</p>}
            <button type="submit" className="primary fp-primary" disabled={!validPolygon || !currentProduct || overlapping.length > 0 || outsideSheet}>{draft.candidateId ? draft.kind === 'stairs' ? 'Save staircase suggestion' : 'Save room suggestion' : draft.editingId ? 'Save outline changes' : draft.kind === 'stairs' ? 'Add staircase' : 'Add room'}</button>
          </form>
          {!currentProduct ? <p className="warning">Add a product under Materials & options before saving this room.</p> : null}
          <div className="row fp-secondary-actions"><button type="button" onClick={() => { change({ tool: 'trace' }); changeDraft({ closed: false, gaps: [], acceptedGaps: [] }); setSelectedPoint(-1); }}>Continue outline</button><button type="button" onClick={discard}>{draft.candidateId ? 'Back to suggestions' : draft.editingId ? 'Cancel changes' : 'Discard outline'}</button></div>
        </section> : drawing ? <section data-testid={`mode-${tool}`}>
          <div className="eyebrow">STEP 3 · ADD {draft.kind === 'stairs' ? 'STAIRS' : 'ROOMS'}</div><h3>{tool === 'detect' ? 'Find rooms on this plan' : tool === 'rectangle' ? 'Mark two opposite corners' : tool === 'stairs' ? 'Mark the staircase footprint' : 'Draw around the room'}</h3>
          <p>{tool === 'detect' ? 'Use Detect all rooms to find the rooms on this sheet. For one room, click an empty part inside its walls.' : toolHelp}</p>
          {tool === 'detect' ? <p className="fp-help">Best with clear, dark walls. Furniture and open doorways can confuse detection; every result needs your review.</p> : null}
          {tool === 'trace' ? <label className="checkbox"><input type="checkbox" checked={squareWalls} onChange={(e) => change({ squareWalls: e.target.checked })}/>Square walls</label> : null}
          {tool === 'stairs' ? <button type="button" className="link" onClick={() => change({ tool: 'trace' })}>Trace a turning or curved footprint</button> : null}
          {detection.busy ? <div role="status" className="fp-loading">{detection.mode === 'all' ? 'Finding rooms across the plan…' : 'Finding the room boundary…'} <button type="button" onClick={discard}>Cancel detection</button></div> : null}
          {tool !== 'detect' ? <>
            <div data-testid="trace-status" className="fp-task-progress">{draft.points.length} {draft.points.length === 1 ? 'corner' : 'corners'} placed</div>
            {tool === 'trace' ? <button type="button" className="primary fp-primary" disabled={draft.points.length < 3} onClick={close}>Finish outline</button> : null}
            {pendingOutline ? <div className="row fp-secondary-actions"><button type="button" onClick={undo}>Undo corner</button><button type="button" onClick={discard}>Discard outline</button></div> : null}
            {tool === 'trace' ? <p className="fp-help">Enter finishes · Backspace undoes · Escape discards. Hold Alt for a diagonal edge.</p> : null}
          </> : null}
        </section> : tool === 'measure' ? <section data-testid="mode-measure"><div className="eyebrow">CHECK A DIMENSION</div><h3>Measure another wall</h3><p>Click two points to check the scale against another known length.</p>
          <strong className="fp-distance" data-testid="measure-readout">{toolPoints.length === 2 ? formatLength(pixelDistance(toolPoints[0]!, toolPoints[1]!) * plan.mmPerPx!, unit) : '—'}</strong>
          <button type="button" className="primary fp-primary" onClick={() => switchTool(pendingOutline ? 'trace' : 'detect')}>Continue adding rooms</button>
        </section> : tool === 'doorway' && selected ? <section data-testid="mode-doorway"><div className="eyebrow">DOORWAY · {selected.name}</div><h3>Mark the opening</h3><p>Click both sides of one doorway on the highlighted room’s wall.</p>
          <div className="fp-task-progress">{toolPoints.length} of 2 points selected</div>
          {doorPreview ? <><p>Opening width: <strong>{formatLength(doorPreview.placement.width, unit)}</strong></p>{doorPreview.adjusted ? <p className="fp-help">The preview straightens the door opening and includes the floor beneath it.</p> : null}{doorOverlap ? <p className="warning" role="alert">The straight threshold overlaps {doorOverlap.name}. Adjust the room outline before adding this doorway.</p> : null}<button type="button" className="primary fp-primary" disabled={!!doorOverlap} onClick={saveDoorway}>Add doorway</button></> : toolPoints.length === 2 ? <p className="warning" role="alert">Those points are not close enough to the same wall or doorway recess. Mark the two jambs at the base of the door swing.</p> : null}
          {toolPoints.length ? <p className="fp-help">Drag either marker to refine its position. Precision zoom shows the detail beneath your pointer.</p> : null}
          <div className="row fp-secondary-actions"><button type="button" onClick={() => change({ toolPoints: [] })} disabled={!toolPoints.length}>Start opening again</button><button type="button" onClick={() => switchTool('select')}>Done with doorways</button></div>
        </section> : <section data-testid="mode-select">
          <div className="eyebrow">{review ? 'STEP 4 · REVIEW' : selectedStaircase ? 'STAIR DETAILS' : 'ROOM DETAILS'}</div><h3>{review ? 'Check your measured rooms' : selected?.name ?? selectedStaircase?.name ?? 'Select a room on the plan'}</h3>
          {review ? <><p>Check the outlines, floor coverings and openings before using the estimate.</p><p><strong>{rooms.length} rooms · {formatArea(totalArea, unit)}</strong></p><button type="button" className="primary fp-primary" onClick={() => setTab('results')}>View estimate</button></> : null}
          {selectedStaircase ? <div className="fp-selected-room">
            <Field label="Staircase name"><input type="text" aria-label="Selected staircase name" value={selectedStaircase.name} onChange={(e) => updateStaircase(selectedStaircase.id, { name: e.target.value })}/></Field>
            <p><strong>{selectedStaircase.steps.length} risers</strong> · {selectedStaircase.layout?.kind.replaceAll('_', ' ') ?? 'straight'}</p>
            <p className="fp-help">The overlay locates this staircase. Set its measured rise, treads, turns and landings before relying on the estimate.</p>
            <button type="button" className="primary fp-primary" onClick={() => { select({ kind: 'staircase', id: selectedStaircase.id }); setTab('rooms'); }}>Stair dimensions & turns</button>
            <button type="button" disabled={pendingOutline} onClick={() => editOutline(selectedStaircase, 'stairs')}>Edit stairs footprint</button>
          </div> : selected ? <div className="fp-selected-room">
            <Field label="Room name"><input type="text" aria-label="Selected room name" value={selected.name} onChange={(e) => updateRoom(selected.id, { name: e.target.value })}/></Field>
            <Field label="Floor covering"><select aria-label="Selected room floor covering" value={selected.productId} onChange={(e) => updateRoom(selected.id, { productId: e.target.value })}>{project.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <p><strong>{formatArea(polygonAreaM2(shapeToPolygon(selected.shape)), unit)}</strong> · {selected.doorways.length} doorways</p>
            {!plan.sketch ? <PlanDimensionCheck reading={plan.reading} polygon={selected.source!.pixelPolygon} mmPerPx={roomPlanTransform(selected) ? 1 / roomPlanTransform(selected)!.pxPerMm : plan.mmPerPx}/> : null}
            <button type="button" className="primary fp-primary" onClick={() => switchTool('doorway')}>Mark doorway</button>
            <button type="button" disabled={pendingOutline} onClick={() => editOutline(selected, 'room')}>Edit room outline</button>
            {selected.doorways.map((door, i) => <div className="fp-door-row" key={door.id}><span>Opening {i + 1} · {formatLength(door.width, unit)}</span><button type="button" className="link" aria-label={`Remove opening ${i + 1} from ${selected.name}`} onClick={() => removeDoorway(selected.id, door.id)}>Remove</button></div>)}
            <button type="button" className="link fp-editor-link" onClick={() => { select({ kind: 'room', id: selected.id }); setTab('rooms'); }}>Open full room editor →</button>
          </div> : !review ? <p>Click a shaded room to review it here. You can change its name, covering and doorways without leaving the plan.</p> : null}
          <button type="button" className="fp-continue" onClick={() => switchTool(pendingOutline ? 'trace' : 'detect')}>{pendingOutline ? 'Continue room outline' : 'Add another room'}</button>
        </section>}
        {drawing && pendingOutline ? <section className="fp-corner-editor" aria-label="Outline corners">
          <div className="row"><strong>{selectedPoint >= 0 ? `Corner ${selectedPoint + 1} selected` : 'Edit outline corners'}</strong><span className="meta">{draft.points.length} corners</span></div>
          <Field label="Selected corner"><select aria-label="Selected corner" value={selectedPoint} onChange={(e) => setSelectedPoint(Number(e.target.value))}><option value={-1}>Select a corner on the plan</option>{draft.points.map((_, i) => <option key={i} value={i}>Corner {i + 1}</option>)}</select></Field>
          <div className="row fp-secondary-actions"><button type="button" disabled={selectedPoint < 0 || (draft.closed && draft.points.length <= 3)} onClick={deletePoint}>Delete selected corner</button><button type="button" disabled={selectedPoint < 0 || draft.points.length < 2 || (!draft.closed && selectedPoint === draft.points.length - 1)} onClick={insertPoint}>Add corner after</button></div>
          <p className="fp-help">Drag to move. Select a corner, then Delete to remove or arrow keys to nudge. A closed outline needs at least three corners.</p>
        </section> : null}
        {drawing && draft.kind === 'room' && tool !== 'detect' ? <label className="checkbox fp-snap-option"><input type="checkbox" checked={snapWalls} onChange={(e) => setSnapWalls(e.target.checked)}/>Snap to existing room walls</label> : null}
        {notice ? <div className="fp-notice" role="status">{notice}</div> : null}
        {pendingOutline && !drawing ? <button type="button" className="fp-resume" onClick={() => switchTool('trace')}>Continue saved outline</button> : null}
        {rooms.length > 0 && !batch ? <section className="fp-room-list"><h4>Rooms on this plan <span className="badge">{rooms.length}</span></h4><ul className="list" aria-label="Rooms on this plan">{rooms.map((room) => <li key={room.id}><button type="button" className="list-row" aria-current={selected?.id === room.id ? 'true' : undefined} onClick={() => selectRoom(room)}><span className="list-row-name">{room.name}</span><span className="meta">{formatArea(polygonAreaM2(shapeToPolygon(room.shape)), unit)} · {room.doorways.length} doorways</span></button></li>)}</ul></section> : null}
        {stairs.length > 0 && !batch ? <section className="fp-room-list"><h4>Stairs on this plan <span className="badge">{stairs.length}</span></h4><ul className="list" aria-label="Stairs on this plan">{stairs.map((stair) => <li key={stair.id}><button type="button" className="list-row" aria-current={selectedStaircase?.id === stair.id ? 'true' : undefined} onClick={() => selectStairs(stair)}><span className="list-row-name">{stair.name}</span><span className="meta">{stair.steps.length} risers · check dimensions</span></button></li>)}</ul></section> : null}
      </aside>
    </div>
  </>;
}
