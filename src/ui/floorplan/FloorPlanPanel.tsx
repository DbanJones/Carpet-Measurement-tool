import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useProjectStore } from '@store/projectStore';
import type { FloorPlanDocument, Mm, Polygon, Room } from '@engine/types';
import { centroid, doorwaySegment, polygonAreaM2, polygonPerimeter, shapeToPolygon } from '@engine/geometry';
import { Checkbox, Field, LengthInput, Section, Select, formatArea, formatLength } from '@ui/components/inputs';
import { FloorPlanCanvas, type PointerInfo } from './FloorPlanCanvas';
import { importImageFile, isImageFile, isPdfFile, openPdf, type PdfHandle } from './pdf';
import {
  closeEnough,
  doorwayFromPoints,
  mmPerPxFromCalibration,
  mmToPx,
  pixelDistance,
  pixelPolygonArea,
  pointInPixelPolygon,
  pxToMm,
  roomPlanTransform,
  round1,
  snapOrthogonal,
  svgPoints,
  traceToPolygon,
  type Px,
} from './tracing';

type Mode = 'select' | 'scale' | 'measure' | 'trace' | 'doorway';

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'select', label: 'Select', title: 'Click a traced room to open it; drag to pan' },
  { id: 'scale', label: 'Set scale', title: 'Click the two ends of a known dimension' },
  { id: 'measure', label: 'Measure', title: 'Click two points to measure between them' },
  { id: 'trace', label: 'Trace room', title: 'Click each corner of a room' },
  { id: 'doorway', label: 'Mark doorway', title: 'Click the two sides of an opening on a traced room' },
];

const SCALE_PRESETS: { label: string; mm: Mm }[] = [
  { label: 'Standard door 762 mm', mm: 762 },
  { label: '838 mm door', mm: 838 },
];

/** Screen-pixel tolerances (divided by zoom to get plan pixels). */
const CLOSE_TOL_SCREEN_PX = 10;
const DUPLICATE_TOL_SCREEN_PX = 6;
/** Warn when a doorway click lands further than this from the room's wall. */
const DOORWAY_WARN_SCREEN_PX = 40;

interface Hover {
  p: Px;
  shiftKey: boolean;
  altKey: boolean;
}

export function FloorPlanPanel() {
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);
  const selectItem = useProjectStore((s) => s.select);
  const setTab = useProjectStore((s) => s.setTab);
  const addFloorPlan = useProjectStore((s) => s.addFloorPlan);
  const updateFloorPlan = useProjectStore((s) => s.updateFloorPlan);
  const removeFloorPlan = useProjectStore((s) => s.removeFloorPlan);
  const addRoom = useProjectStore((s) => s.addRoom);
  const addDoorway = useProjectStore((s) => s.addDoorway);
  const unit = project.displayUnit;

  // ---- which plan is shown -------------------------------------------------------------------
  const [localPlanId, setLocalPlanId] = useState<string | null>(null);
  const plans = project.floorPlans;
  const plan: FloorPlanDocument | null = useMemo(() => {
    const selectedId = selection.kind === 'floorplan' ? selection.id : null;
    return plans.find((p) => p.id === selectedId) ?? plans.find((p) => p.id === localPlanId) ?? plans[0] ?? null;
  }, [plans, selection, localPlanId]);
  const choosePlan = (id: string) => {
    setLocalPlanId(id);
    selectItem({ kind: 'floorplan', id });
  };
  const tracedRooms = useMemo(() => (plan ? project.rooms.filter((r) => r.source?.floorPlanId === plan.id) : []), [project.rooms, plan]);

  // ---- import ---------------------------------------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pdf, setPdf] = useState<{ name: string; handle: PdfHandle; page: number } | null>(null);
  const pdfRef = useRef<PdfHandle | null>(null);
  useEffect(
    () => () => {
      void pdfRef.current?.destroy();
    },
    [],
  );

  // ---- interaction state ----------------------------------------------------------------------
  const [mode, setModeState] = useState<Mode>('select');
  const [zoom, setZoom] = useState(1);
  const [orthoSnap, setOrthoSnap] = useState(true);
  /** Clicked points for the current tool: 2 for scale/measure/doorway, the outline for trace. */
  const [points, setPoints] = useState<Px[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);
  const [closed, setClosed] = useState(false);
  const [scaleDistance, setScaleDistance] = useState<Mm | undefined>(undefined);
  const [roomName, setRoomName] = useState('');
  const [roomProductId, setRoomProductId] = useState('');
  const [doorRoomId, setDoorRoomId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const resetTool = useCallback(() => {
    setPoints([]);
    setHover(null);
    setClosed(false);
    setNotice(null);
  }, []);
  const setMode = useCallback(
    (m: Mode) => {
      resetTool();
      setModeState(m);
    },
    [resetTool],
  );
  // A different plan: start the tool afresh and pick up its calibration distance.
  useEffect(() => {
    resetTool();
    setScaleDistance(plan?.calibration?.distance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  const doorRoom = tracedRooms.find((r) => r.id === doorRoomId) ?? tracedRooms[0] ?? null;

  // ---- file handling --------------------------------------------------------------------------
  const handleFiles = async (files: FileList | File[] | null | undefined) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      if (isPdfFile(file)) {
        setBusy(`Rendering ${file.name}…`);
        const handle = await openPdf(file);
        void pdfRef.current?.destroy();
        pdfRef.current = handle;
        setPdf({ name: file.name, handle, page: Math.min(2, handle.pageCount) });
        const raster = await handle.renderPage(1);
        const id = addFloorPlan({ name: handle.pageCount > 1 ? `${file.name} (page 1)` : file.name, ...raster });
        setLocalPlanId(id);
        setMode('scale');
      } else if (isImageFile(file)) {
        setBusy(`Loading ${file.name}…`);
        const raster = await importImageFile(file);
        const id = addFloorPlan({ name: file.name, ...raster });
        setLocalPlanId(id);
        setMode('scale');
      } else {
        setError(`"${file.name}" is not a supported file. Upload a PNG or JPG image, or a PDF.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const addPdfPage = async () => {
    if (!pdf) return;
    setError(null);
    setBusy(`Rendering page ${pdf.page}…`);
    try {
      const raster = await pdf.handle.renderPage(pdf.page);
      const id = addFloorPlan({ name: `${pdf.name} (page ${pdf.page})`, ...raster });
      setLocalPlanId(id);
      setMode('scale');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer?.files);
  };

  // ---- tools ----------------------------------------------------------------------------------
  const nextRoomName = `Room ${project.rooms.length + 1}`;

  const closeTrace = useCallback(() => {
    if (mode !== 'trace' || closed || points.length < 3) return;
    setClosed(true);
    setHover(null);
    setRoomName(nextRoomName);
    setRoomProductId((id) => (project.products.some((p) => p.id === id) ? id : (project.products[0]?.id ?? '')));
  }, [mode, closed, points.length, nextRoomName, project.products]);

  const undo = useCallback(() => {
    setNotice(null);
    if (closed) {
      setClosed(false);
      return;
    }
    setPoints((prev) => prev.slice(0, -1));
  }, [closed]);

  const cancel = useCallback(() => resetTool(), [resetTool]);

  const applyScale = (distance: Mm | undefined = scaleDistance) => {
    if (!plan || points.length < 2 || !distance) return;
    const a = points[0]!;
    const b = points[1]!;
    const mmPerPx = mmPerPxFromCalibration(a, b, distance);
    if (!mmPerPx) {
      setNotice('Click two different points before applying the scale.');
      return;
    }
    updateFloorPlan(plan.id, { mmPerPx, calibration: { a: { x: round1(a.x), y: round1(a.y) }, b: { x: round1(b.x), y: round1(b.y) }, distance } });
    setScaleDistance(distance);
    setMode('trace');
  };
  const usePreset = (mm: Mm) => {
    setScaleDistance(mm);
    if (points.length >= 2) applyScale(mm);
  };

  const createRoom = () => {
    if (!plan?.mmPerPx || points.length < 3) return;
    const polygon = traceToPolygon(points, plan.mmPerPx);
    if (polygon.length < 3 || polygonAreaM2(polygon) <= 0) {
      setNotice('The outline has no area: trace at least three corners that are not in a line.');
      return;
    }
    addRoom({
      name: roomName.trim() || nextRoomName,
      productId: roomProductId || project.products[0]?.id || '',
      shape: { kind: 'polygon', points: polygon },
      doorways: [],
      source: { floorPlanId: plan.id, pixelPolygon: points.map((p) => ({ x: round1(p.x), y: round1(p.y) })) },
    });
    // addRoom selects the new room; stay on this plan so the next room can be traced straight away.
    selectItem({ kind: 'floorplan', id: plan.id });
    resetTool();
  };

  const placeDoorway = (a: Px, b: Px, info: PointerInfo) => {
    if (!doorRoom) return;
    const t = roomPlanTransform(doorRoom);
    let polygon: Polygon = [];
    try {
      polygon = shapeToPolygon(doorRoom.shape);
    } catch {
      polygon = [];
    }
    if (!t || polygon.length < 3) {
      setNotice(`${doorRoom.name} has no usable outline on this plan.`);
      return;
    }
    const d = doorwayFromPoints(polygon, pxToMm(t, a), pxToMm(t, b));
    if (!d) {
      setNotice('Click two different points along the wall for the sides of the opening.');
      return;
    }
    addDoorway(doorRoom.id, { edgeIndex: d.edgeIndex, offset: d.offset, width: d.width, transition: 'carpet' });
    const farPx = d.maxDistance * t.pxPerMm * info.zoom;
    setNotice(
      farPx > DOORWAY_WARN_SCREEN_PX
        ? `Doorway of ${formatLength(d.width, unit)} added to ${doorRoom.name}, but a click was well away from the wall — check it in the room editor.`
        : `Doorway of ${formatLength(d.width, unit)} added to ${doorRoom.name}.`,
    );
  };

  const onTap = (p: Px, info: PointerInfo) => {
    if (!plan) return;
    const closeTol = CLOSE_TOL_SCREEN_PX / info.zoom;
    const dupTol = DUPLICATE_TOL_SCREEN_PX / info.zoom;
    switch (mode) {
      case 'select': {
        const hits = tracedRooms.filter((r) => pointInPixelPolygon(p, r.source!.pixelPolygon));
        if (hits.length === 0) return;
        const room = hits.reduce((best, r) => (pixelPolygonArea(r.source!.pixelPolygon) < pixelPolygonArea(best.source!.pixelPolygon) ? r : best));
        selectItem({ kind: 'room', id: room.id });
        setTab('rooms');
        return;
      }
      case 'scale':
      case 'measure': {
        setNotice(null);
        setPoints((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
        return;
      }
      case 'trace': {
        if (closed) return;
        const prev = points[points.length - 1];
        const snap = info.shiftKey || (orthoSnap && !info.altKey);
        const q = prev && snap ? snapOrthogonal(prev, p) : p;
        const first = points[0];
        if (first && points.length >= 3 && (closeEnough(p, first, closeTol) || closeEnough(q, first, closeTol))) {
          closeTrace();
          return;
        }
        if (prev && closeEnough(q, prev, dupTol)) return; // accidental double tap
        setPoints([...points, q]);
        return;
      }
      case 'doorway': {
        if (!doorRoom) return;
        if (points.length === 0) {
          setNotice(null);
          setPoints([p]);
          return;
        }
        placeDoorway(points[0]!, p, info);
        setPoints([]);
        return;
      }
    }
  };

  const onDoubleTap = () => {
    if (mode === 'trace') closeTrace();
  };

  // Keyboard: Escape cancels, Backspace/Delete undoes, Enter closes the outline.
  const keyHandlers = useRef({ undo, cancel, closeTrace });
  keyHandlers.current = { undo, cancel, closeTrace };
  useEffect(() => {
    if (mode === 'select' || !plan) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') keyHandlers.current.cancel();
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        keyHandlers.current.undo();
      } else if (e.key === 'Enter' && t?.tagName !== 'BUTTON') keyHandlers.current.closeTrace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, plan]);

  // ---- derived display values -----------------------------------------------------------------
  const mmPerPx = plan?.mmPerPx;
  const last = points[points.length - 1];
  const rubberTarget: Px | null =
    hover && last && !closed && (mode === 'trace' || ((mode === 'scale' || mode === 'measure') && points.length === 1))
      ? mode === 'trace' && (hover.shiftKey || (orthoSnap && !hover.altKey))
        ? snapOrthogonal(last, hover.p)
        : hover.p
      : null;
  const measureDistancePx = points.length === 2 ? pixelDistance(points[0]!, points[1]!) : points.length === 1 && rubberTarget ? pixelDistance(points[0]!, rubberTarget) : null;
  const tracePolygon = closed && mmPerPx ? traceToPolygon(points, mmPerPx) : null;
  const traceArea = tracePolygon ? polygonAreaM2(tracePolygon) : null;
  const productOptions = project.products.length ? project.products.map((p) => ({ value: p.id, label: p.name })) : [{ value: '', label: 'No products yet' }];
  const roomOptions = tracedRooms.map((r) => ({ value: r.id, label: r.name }));

  const lengthOrPx = (px: number) => (mmPerPx ? formatLength(px * mmPerPx, unit) : `${Math.round(px)} px`);

  // ---- render ---------------------------------------------------------------------------------
  return (
    <div className="panel floorplan-panel">
      <h2>Floor plan</h2>
      <ol className="floorplan-steps" aria-label="How to use a floor plan">
        <li>
          <b>Upload</b> a PNG, JPG or PDF of the plan.
        </li>
        <li>
          <b>Set scale</b> by clicking the two ends of a printed dimension.
        </li>
        <li>
          <b>Trace rooms</b> corner by corner, then mark the doorways.
        </li>
      </ol>
      <p className="muted small">
        Estate-agent plans are usually marked “not to scale”, so calibrate on a printed room dimension rather than the plan’s scale bar,
        and check a second dimension with <b>Measure</b>.
      </p>

      <div
        className={`dropzone${dragOver ? ' active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <label className="dropzone-label">
          <span>Upload a floor plan (PNG, JPG or PDF)</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={!!busy}
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <span className="muted small">…or drop the file here.</span>
        {busy ? (
          <span className="small" aria-busy="true" role="status">
            {busy}
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="warning error" role="alert">
          {error}
        </div>
      ) : null}
      {pdf && pdf.handle.pageCount > 1 ? (
        <div className="row small pdf-pages">
          <span>
            {pdf.name} has {pdf.handle.pageCount} pages.
          </span>
          <Field label="Page" inline>
            <Select
              ariaLabel="PDF page"
              value={String(pdf.page)}
              options={Array.from({ length: pdf.handle.pageCount }, (_, i) => ({ value: String(i + 1), label: `Page ${i + 1}` }))}
              onChange={(v) => setPdf({ ...pdf, page: Number(v) })}
            />
          </Field>
          <button type="button" disabled={!!busy} onClick={() => void addPdfPage()}>
            Add this page as a plan
          </button>
        </div>
      ) : null}

      {plans.length > 0 ? (
        <Section title="Plans" collapsible>
          <ul className="list" aria-label="Floor plans">
            {plans.map((p) => (
              <li key={p.id} aria-selected={p.id === plan?.id} onClick={() => choosePlan(p.id)}>
                <span>
                  {p.name}
                  <div className="meta">
                    {p.widthPx} × {p.heightPx} px · {p.mmPerPx ? `1 px = ${p.mmPerPx.toFixed(1)} mm` : 'needs scale'} ·{' '}
                    {project.rooms.filter((r) => r.source?.floorPlanId === p.id).length} rooms
                  </div>
                </span>
                <span className="row">
                  <button type="button" onClick={(e) => { e.stopPropagation(); choosePlan(p.id); }} aria-label={`Open plan ${p.name}`}>
                    Open
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Remove plan ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove "${p.name}"? Rooms traced from it are kept.`)) removeFloorPlan(p.id);
                    }}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {!plan ? (
        <div className="empty">No floor plan yet. Upload one above, or add rooms by typing their dimensions.</div>
      ) : (
        <>
          <div className="toolbar" role="toolbar" aria-label="Plan tools">
            {MODES.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} title={m.title} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
            <Checkbox checked={orthoSnap} onChange={setOrthoSnap} label="Orthogonal snap" />
          </div>

          {mmPerPx ? (
            <div className="scale-status small" data-testid="scale-status">
              Scale: <b>1 px = {mmPerPx.toFixed(1)} mm</b>
              {plan.calibration ? <span className="muted"> · calibrated on {formatLength(plan.calibration.distance, unit)}</span> : null}
            </div>
          ) : (
            <div className="warning" data-testid="scale-status">
              Not calibrated. Choose <b>Set scale</b> and click the two ends of a printed dimension; rooms cannot be created until the scale is set.
            </div>
          )}

          <div className="mode-panel" data-testid={`mode-${mode}`}>
            {mode === 'select' ? <p className="small muted">Click a traced room to open it in the room editor. Drag to pan the plan.</p> : null}

            {mode === 'scale' ? (
              <div className="stack">
                <p className="small muted">
                  Click the two ends of a wall with a printed dimension (or the two sides of a door opening), then enter the real distance.{' '}
                  {points.length}/2 points{points.length === 2 ? ` · ${Math.round(pixelDistance(points[0]!, points[1]!))} px apart` : ''}.
                </p>
                <div className="row">
                  <Field label="Real distance" inline>
                    <LengthInput ariaLabel="Real distance" value={scaleDistance} onChange={setScaleDistance} unit={unit} min={1} />
                  </Field>
                  <button type="button" className="primary" disabled={points.length < 2 || !scaleDistance} onClick={() => applyScale()}>
                    Apply scale
                  </button>
                  <button type="button" disabled={points.length === 0} onClick={cancel}>
                    Clear points
                  </button>
                </div>
                <div className="presets">
                  <span className="small muted">Presets:</span>
                  {SCALE_PRESETS.map((p) => (
                    <button key={p.mm} type="button" onClick={() => usePreset(p.mm)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {mode === 'measure' ? (
              <div className="stack">
                <p className="small muted">Click two points to measure between them. A third click starts a new measurement.</p>
                <div className="figures">
                  <span>
                    Distance: <b data-testid="measure-readout">{measureDistancePx !== null ? lengthOrPx(measureDistancePx) : '—'}</b>
                  </span>
                  {!mmPerPx ? <span>Set the scale to see real units.</span> : null}
                </div>
              </div>
            ) : null}

            {mode === 'trace' && !closed ? (
              <div className="stack">
                <p className="small muted">
                  Click each corner of the room in turn. Click the first point again, press Enter or double-click to close the outline. Backspace
                  removes the last point, Escape cancels. Hold Shift to snap square, Alt for a free (diagonal) point.
                </p>
                <div className="row">
                  <span className="small" data-testid="trace-status">
                    {points.length} {points.length === 1 ? 'point' : 'points'}
                    {last && rubberTarget ? ` · next side ${lengthOrPx(pixelDistance(last, rubberTarget))}` : ''}
                  </span>
                  <button type="button" disabled={points.length === 0} onClick={undo}>
                    Undo point
                  </button>
                  <button type="button" disabled={points.length < 3} onClick={closeTrace}>
                    Close outline
                  </button>
                  <button type="button" disabled={points.length === 0} onClick={cancel}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {mode === 'trace' && closed ? (
              <div className="stack trace-form">
                <div className="figures">
                  <span>
                    Area: <b data-testid="trace-area">{traceArea !== null ? formatArea(traceArea, unit) : '— (set the scale)'}</b>
                  </span>
                  <span>
                    Perimeter: <b>{tracePolygon ? formatLength(polygonPerimeter(tracePolygon), unit) : '—'}</b>
                  </span>
                  <span>{points.length} corners</span>
                </div>
                {!mmPerPx ? <div className="warning">Set the scale before creating the room; the outline is kept.</div> : null}
                <div className="row">
                  <Field label="Room name">
                    <input type="text" aria-label="Room name" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
                  </Field>
                  <Field label="Product">
                    <Select ariaLabel="Product" value={roomProductId} options={productOptions} onChange={setRoomProductId} />
                  </Field>
                </div>
                <div className="row">
                  <button type="button" className="primary" disabled={!mmPerPx || !tracePolygon || tracePolygon.length < 3} onClick={createRoom}>
                    Create room
                  </button>
                  <button type="button" onClick={undo}>
                    Edit points
                  </button>
                  <button type="button" onClick={cancel}>
                    Discard
                  </button>
                </div>
              </div>
            ) : null}

            {mode === 'doorway' ? (
              <div className="stack">
                {tracedRooms.length === 0 ? (
                  <p className="small muted">Trace a room on this plan first, then mark its doorways.</p>
                ) : (
                  <>
                    <div className="row">
                      <Field label="Room" inline>
                        <Select ariaLabel="Doorway room" value={doorRoom?.id ?? ''} options={roomOptions} onChange={(id) => { setDoorRoomId(id); resetTool(); }} />
                      </Field>
                      <span className="small muted">{points.length}/2 points</span>
                      <button type="button" disabled={points.length === 0} onClick={cancel}>
                        Clear
                      </button>
                    </div>
                    <p className="small muted">
                      Click the two sides of the opening on one wall of {doorRoom?.name ?? 'the room'}; they are projected onto the nearest wall.
                      The door bar type can be changed in the room editor.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            {notice ? (
              <div className="warning info" role="status">
                {notice}
              </div>
            ) : null}
          </div>

          <FloorPlanCanvas
            plan={plan}
            zoom={zoom}
            onZoomChange={setZoom}
            crosshair={mode !== 'select'}
            onTap={onTap}
            onHover={(p, info) => {
              // Only the drawing tools show a rubber band; skip the re-render otherwise.
              if (mode === 'select' || mode === 'doorway') return;
              setHover(p ? { p, shiftKey: info.shiftKey, altKey: info.altKey } : null);
            }}
            onDoubleTap={onDoubleTap}
          >
            <Overlay
              plan={plan}
              rooms={tracedRooms}
              activeRoomId={mode === 'doorway' ? doorRoom?.id : undefined}
              mode={mode}
              points={points}
              closed={closed}
              rubberTarget={rubberTarget}
              zoom={zoom}
              label={lengthOrPx}
              unit={unit}
            />
          </FloorPlanCanvas>

          {tracedRooms.length > 0 ? (
            <Section title={`Rooms traced on this plan (${tracedRooms.length})`} collapsible>
              <ul className="list" aria-label="Rooms traced on this plan">
                {tracedRooms.map((r) => {
                  let area = 0;
                  try {
                    area = polygonAreaM2(shapeToPolygon(r.shape));
                  } catch {
                    area = 0;
                  }
                  return (
                    <li
                      key={r.id}
                      onClick={() => {
                        selectItem({ kind: 'room', id: r.id });
                        setTab('rooms');
                      }}
                    >
                      <span>
                        {r.name}
                        <div className="meta">
                          {formatArea(area, unit)} · {r.doorways.length} {r.doorways.length === 1 ? 'doorway' : 'doorways'}
                        </div>
                      </span>
                      <span className="row">
                        <button
                          type="button"
                          aria-label={`Mark doorway on ${r.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDoorRoomId(r.id);
                            setMode('doorway');
                          }}
                        >
                          Mark doorway
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit room ${r.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectItem({ kind: 'room', id: r.id });
                            setTab('rooms');
                          }}
                        >
                          Edit
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// SVG overlay
// ---------------------------------------------------------------------------------------------

function Overlay({
  plan,
  rooms,
  activeRoomId,
  mode,
  points,
  closed,
  rubberTarget,
  zoom,
  label,
  unit,
}: {
  plan: FloorPlanDocument;
  rooms: Room[];
  activeRoomId?: string;
  mode: Mode;
  points: Px[];
  closed: boolean;
  rubberTarget: Px | null;
  zoom: number;
  label: (px: number) => string;
  unit: 'metric' | 'imperial';
}) {
  const sw = 2 / zoom;
  const fs = 13 / zoom;
  const r = 5 / zoom;
  const first = points[0];
  const last = points[points.length - 1];
  const showCalibration = mode === 'scale' && points.length === 0 && plan.calibration;
  const twoPoint = mode === 'scale' || mode === 'measure';
  const a = points[0];
  const b = points[1] ?? rubberTarget ?? undefined;

  return (
    <g pointerEvents="none">
      {rooms.map((room) => (
        <RoomOverlay key={room.id} room={room} active={room.id === activeRoomId} sw={sw} fs={fs} />
      ))}

      {showCalibration && plan.calibration ? (
        <g className="fp-scale existing">
          <line x1={plan.calibration.a.x} y1={plan.calibration.a.y} x2={plan.calibration.b.x} y2={plan.calibration.b.y} strokeWidth={sw} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />
          <Label at={mid(plan.calibration.a, plan.calibration.b)} fs={fs} text={formatLength(plan.calibration.distance, unit)} />
        </g>
      ) : null}

      {twoPoint && a ? (
        <g className={mode === 'scale' ? 'fp-scale' : 'fp-measure'}>
          {b ? <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={sw} /> : null}
          {b ? <Label at={mid(a, b)} fs={fs} text={label(pixelDistance(a, b))} /> : null}
          <circle cx={a.x} cy={a.y} r={r} strokeWidth={sw} />
          {points[1] ? <circle cx={points[1].x} cy={points[1].y} r={r} strokeWidth={sw} /> : null}
        </g>
      ) : null}

      {mode === 'trace' && first ? (
        <g className="fp-trace">
          {closed ? <polygon points={svgPoints(points)} strokeWidth={sw} /> : <polyline points={svgPoints(points)} strokeWidth={sw} fill="none" />}
          {!closed && last && rubberTarget ? (
            <>
              <line className="rubber" x1={last.x} y1={last.y} x2={rubberTarget.x} y2={rubberTarget.y} strokeWidth={sw} strokeDasharray={`${6 / zoom} ${4 / zoom}`} />
              <Label at={mid(last, rubberTarget)} fs={fs} text={label(pixelDistance(last, rubberTarget))} />
            </>
          ) : null}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? r * 1.5 : r} strokeWidth={sw} className={i === 0 ? 'first' : undefined} />
          ))}
          {closed ? <Label at={centroid(points)} fs={fs * 1.1} text="New room" /> : null}
        </g>
      ) : null}

      {mode === 'doorway' && first ? (
        <g className="fp-door-new">
          <circle cx={first.x} cy={first.y} r={r} strokeWidth={sw} />
        </g>
      ) : null}
    </g>
  );
}

function RoomOverlay({ room, active, sw, fs }: { room: Room; active: boolean; sw: number; fs: number }) {
  const px = room.source?.pixelPolygon ?? [];
  if (px.length < 3) return null;
  const c = centroid(px);
  const t = roomPlanTransform(room);
  let polygon: Polygon | null = null;
  if (t) {
    try {
      polygon = shapeToPolygon(room.shape);
    } catch {
      polygon = null;
    }
  }
  return (
    <g className={`fp-room${active ? ' active' : ''}`} data-testid={`room-overlay-${room.id}`}>
      <polygon points={svgPoints(px)} strokeWidth={active ? sw * 1.5 : sw} />
      {t && polygon && polygon.length >= 3
        ? room.doorways.map((d) => {
            const seg = doorwaySegment(polygon!, d);
            const from = mmToPx(t, seg.from);
            const to = mmToPx(t, seg.to);
            return <line key={d.id} className="fp-door" x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={sw * 3} />;
          })
        : null}
      <text x={c.x} y={c.y} fontSize={fs} textAnchor="middle" dominantBaseline="middle" className="fp-label">
        {room.name}
      </text>
    </g>
  );
}

function Label({ at, fs, text }: { at: Px; fs: number; text: string }) {
  return (
    <text x={at.x} y={at.y - fs * 0.5} fontSize={fs} textAnchor="middle" className="fp-label">
      {text}
    </text>
  );
}

function mid(a: Px, b: Px): Px {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
