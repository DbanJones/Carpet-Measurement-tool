import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { FloorPlanDocument } from '@engine/types';
import type { CSSProperties } from 'react';
import { clampZoom, pixelDistance, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type Px } from './tracing';
import { CanvasCalibrationNotice, CanvasScaleOverlay, type CanvasScaleState } from './ScaleOverlay';
import './canvas.css';

export interface PointerInfo {
  shiftKey: boolean;
  altKey: boolean;
  /** Zoom at the time of the event: divide screen tolerances by it to get plan pixels. */
  zoom: number;
  pointerType: string;
}

export interface FloorPlanCanvasProps {
  plan: FloorPlanDocument;
  /** 1 = 100 %. Controlled by the parent so overlay stroke widths stay zoom-independent. */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  crosshair?: boolean;
  /** A click or tap, in plan pixel coordinates. Panning and pinching never produce taps. */
  onTap?: (p: Px, info: PointerInfo) => void;
  onHover?: (p: Px | null, info: PointerInfo) => void;
  onDoubleTap?: (p: Px, info: PointerInfo) => void;
  /** Visible draft handles; dragging near one edits it instead of panning. */
  editablePoints?: Px[];
  onPointMove?: (index: number, point: Px) => void;
  onPointSelect?: (index: number) => void;
  /** Active calibration guidance stays visible while the image is panned or zoomed. */
  scaleState?: CanvasScaleState;
  /** A floating close-up for placing scale ends, doorway jambs and outline corners. */
  precision?: boolean;
  precisionPoints?: Px[];
  unit?: 'metric' | 'imperial';
  children?: ReactNode;
  ariaLabel?: string;
}

interface Drag {
  pointerId: number;
  start: Px;
  scroll: Px;
  moved: boolean;
  canTap: boolean;
  vertex: { index: number; start: Px; pointerStart: Px } | null;
}

interface Pinch {
  distance: number;
  zoom: number;
  planAnchor: Px;
}

/** Image and overlay share one transform; all gestures are mapped back into image pixels. */
export function FloorPlanCanvas({ plan, zoom, onZoomChange, crosshair, onTap, onHover, onDoubleTap, editablePoints, onPointMove, onPointSelect, scaleState, precision = false, precisionPoints = [], unit = 'metric', children, ariaLabel }: FloorPlanCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Px>());
  const pinch = useRef<Pinch | null>(null);
  const suppressTap = useRef(false);
  const fitting = useRef(true);
  const [dragKind, setDragKind] = useState<'pan' | 'point' | null>(null);
  const [overHandle, setOverHandle] = useState(false);
  const [precisionEnabled, setPrecisionEnabled] = useState(true);
  const [lens, setLens] = useState<{ point: Px; left: boolean } | null>(null);
  const helpId = useId();
  /** Plan point that should remain under the same viewport position after React updates zoom. */
  const anchor = useRef<{ plan: Px; client: Px } | null>(null);

  const toPlan = useCallback(
    (e: { clientX: number; clientY: number }): Px => {
      const rect = svgRef.current?.getBoundingClientRect();
      const sx = rect && rect.width > 0 ? plan.widthPx / rect.width : 1 / zoom;
      const sy = rect && rect.height > 0 ? plan.heightPx / rect.height : 1 / zoom;
      return { x: (e.clientX - (rect?.left ?? 0)) * sx, y: (e.clientY - (rect?.top ?? 0)) * sy };
    },
    [plan.widthPx, plan.heightPx, zoom],
  );

  const info = (e: { shiftKey?: boolean; altKey?: boolean; pointerType?: string }): PointerInfo => ({
    shiftKey: !!e.shiftKey,
    altKey: !!e.altKey,
    zoom,
    pointerType: e.pointerType || 'mouse',
  });

  const fit = useCallback(() => {
    const el = scrollRef.current;
    fitting.current = true;
    if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return;
    anchor.current = null;
    const z = Math.min((el.clientWidth - 2) / plan.widthPx, (el.clientHeight - 2) / plan.heightPx, 1);
    onZoomChange(clampZoom(z));
    el.scrollLeft = 0;
    el.scrollTop = 0;
  }, [plan.widthPx, plan.heightPx, onZoomChange]);

  useLayoutEffect(() => {
    pointers.current.clear();
    pinch.current = null;
    drag.current = null;
    suppressTap.current = false;
    setDragKind(null);
    setOverHandle(false);
    setLens(null);
    fit();
    // A plan change resets its view; changes to the controlled zoom do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onResize = () => { if (fitting.current) fit(); };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(onResize);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit]);

  const zoomTo = useCallback(
    (z: number, clientAnchor?: Px, planAnchor?: Px) => {
      const el = scrollRef.current;
      const next = clampZoom(z);
      fitting.current = false;
      if (el) {
        const rect = el.getBoundingClientRect();
        const client = clientAnchor ?? { x: rect.left + el.clientWidth / 2, y: rect.top + el.clientHeight / 2 };
        const position = {
          plan: planAnchor ?? toPlan({ clientX: client.x, clientY: client.y }),
          client: { x: client.x - rect.left - el.clientLeft, y: client.y - rect.top - el.clientTop },
        };
        if (next !== zoom) anchor.current = position;
        else {
          // A two-finger translation still pans when the distance/zoom is unchanged.
          el.scrollLeft = position.plan.x * next - position.client.x;
          el.scrollTop = position.plan.y * next - position.client.y;
        }
      }
      onZoomChange(next);
    },
    [zoom, onZoomChange, toPlan],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.plan.x * zoom - a.client.x;
    el.scrollTop = a.plan.y * zoom - a.client.y;
  }, [zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomTo]);

  const handleAt = (p: Px, pointerType: string): number => {
    if (!onPointMove || !editablePoints) return -1;
    const tolerance = (pointerType === 'touch' ? 22 : 10) / zoom;
    let nearest = -1;
    let distance = tolerance;
    editablePoints.forEach((point, index) => {
      const d = pixelDistance(p, point);
      if (d <= distance) { nearest = index; distance = d; }
    });
    return nearest;
  };

  const beginPinch = () => {
    setLens(null);
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch.current = { distance: Math.max(1, pixelDistance(a, b)), zoom, planAnchor: toPlan({ clientX: mid.x, clientY: mid.y }) };
    drag.current = null;
    suppressTap.current = true;
    setDragKind('pan');
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    // A synthesized mouse press after a touch can steal focus from the newly opened task form.
    if (e.pointerType === 'touch') e.preventDefault();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* best-effort capture */ }
    if (pointers.current.size >= 2) {
      beginPinch();
      return;
    }
    if (suppressTap.current) return;
    const el = scrollRef.current;
    const p = toPlan(e);
    updateLens(p, e.clientX);
    const index = e.button === 1 ? -1 : handleAt(p, e.pointerType);
    if (index >= 0) onPointSelect?.(index);
    drag.current = {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      scroll: { x: el?.scrollLeft ?? 0, y: el?.scrollTop ?? 0 },
      moved: false,
      canTap: e.button !== 1,
      vertex: index >= 0 ? { index, start: { ...editablePoints![index]! }, pointerStart: p } : null,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) zoomTo(pinch.current.zoom * pixelDistance(a, b) / pinch.current.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, pinch.current.planAnchor);
      return;
    }
    if (suppressTap.current) return;
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) {
      const dx = e.clientX - d.start.x;
      const dy = e.clientY - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 7 : 5)) {
        d.moved = true;
        setDragKind(d.vertex ? 'point' : 'pan');
      }
      if (d.moved) {
        if (d.vertex) {
          const p = toPlan(e);
          const next = {
            x: Math.max(0, Math.min(plan.widthPx, d.vertex.start.x + p.x - d.vertex.pointerStart.x)),
            y: Math.max(0, Math.min(plan.heightPx, d.vertex.start.y + p.y - d.vertex.pointerStart.y)),
          };
          updateLens(next, e.clientX);
          onPointMove?.(d.vertex.index, next);
        } else {
          setLens(null);
          const el = scrollRef.current;
          if (el) { el.scrollLeft = d.scroll.x - dx; el.scrollTop = d.scroll.y - dy; }
          fitting.current = false;
        }
        return;
      }
    }
    const p = toPlan(e);
    updateLens(p, e.clientX);
    setOverHandle(handleAt(p, e.pointerType) >= 0);
    onHover?.(p, info(e));
  };

  const endPointer = (e: ReactPointerEvent<SVGSVGElement>, cancelled = false) => {
    const d = drag.current;
    const wasTracked = pointers.current.delete(e.pointerId);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* best-effort capture */ }
    if (d && d.pointerId === e.pointerId) drag.current = null;
    if (wasTracked && !cancelled && !suppressTap.current && d && d.pointerId === e.pointerId && !d.moved && d.canTap) {
      const p = toPlan(e);
      if (p.x >= 0 && p.y >= 0 && p.x <= plan.widthPx && p.y <= plan.heightPx) onTap?.(p, info(e));
    }
    if (pointers.current.size >= 2) beginPinch();
    else pinch.current = null;
    if (pointers.current.size === 0) { suppressTap.current = false; setDragKind(null); }
    if (cancelled || e.pointerType === 'touch') setLens(null);
  };

  const updateLens = (point: Px, clientX: number) => {
    if (!precision || !precisionEnabled || point.x < 0 || point.y < 0 || point.x > plan.widthPx || point.y > plan.heightPx) { setLens(null); return; }
    const bounds = scrollRef.current?.getBoundingClientRect();
    setLens({ point, left: !!bounds && clientX > bounds.left + bounds.width / 2 });
  };
  const lensZoom = Math.max(2, zoom * 3);
  const lensSpan = 192 / lensZoom;

  const cursor = dragKind === 'point' || overHandle ? 'move' : dragKind === 'pan' ? 'grabbing' : crosshair ? 'crosshair' : 'grab';

  return (
    <div className="floorplan-view" style={{ '--plan-aspect': `${plan.widthPx} / ${plan.heightPx}` } as CSSProperties}>
      <div className="toolbar zoom-controls" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomTo(zoom / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
        <span className="zoom-readout small" aria-live="polite" data-testid="zoom-readout">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
        <button type="button" onClick={fit}>Fit plan</button>
        <button type="button" className="fp-actual-size" onClick={() => zoomTo(1)} title="Zoom to 100%">100%</button>
        {precision ? <button type="button" className="fp-precision-toggle" aria-pressed={precisionEnabled} onClick={() => { setPrecisionEnabled(value => !value); setLens(null); }}>Precision zoom</button> : null}
        <span className="muted small fp-canvas-help" id={helpId}>
          Drag to pan · Pinch<span className="fp-mouse-help"> or Ctrl + scroll</span> to zoom
          {onPointMove && editablePoints?.length ? <span className="fp-edit-help"> · Drag a corner to adjust</span> : null}
        </span>
      </div>
      <div className={`fp-canvas-frame${scaleState?.active ? ' is-setting-scale' : ''}`}>
      <CanvasCalibrationNotice unit={unit} state={scaleState}/>
      <div className="floorplan-canvas" ref={scrollRef}>
        <div className="floorplan-stage" style={{ width: plan.widthPx * zoom, height: plan.heightPx * zoom }}>
          <div className="floorplan-zoom" style={{ width: plan.widthPx, height: plan.heightPx, transform: `scale(${zoom})` }}>
            <img src={plan.imageDataUrl} width={plan.widthPx} height={plan.heightPx} alt={`Floor plan: ${plan.name}`} draggable={false} />
            <svg
              ref={svgRef}
              className="floorplan-overlay"
              width={plan.widthPx}
              height={plan.heightPx}
              viewBox={`0 0 ${plan.widthPx} ${plan.heightPx}`}
              style={{ cursor }}
              role="img"
              aria-label={ariaLabel ?? `Tracing overlay for ${plan.name}`}
              aria-describedby={helpId}
              data-testid="floorplan-overlay"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => endPointer(e)}
              onPointerCancel={(e) => endPointer(e, true)}
              onLostPointerCapture={(e) => { if (pointers.current.has(e.pointerId)) endPointer(e, true); }}
              onPointerLeave={(e) => { if (!pointers.current.size) { setLens(null); setOverHandle(false); onHover?.(null, info(e)); } }}
              onDoubleClick={(e) => { if (!suppressTap.current) onDoubleTap?.(toPlan(e), info(e)); }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {children}
            </svg>
          </div>
        </div>
      </div>
      <CanvasScaleOverlay plan={plan} zoom={zoom} unit={unit} state={scaleState}/>
      {precision && precisionEnabled && lens ? <div className={`fp-precision-lens${lens.left ? ' is-left' : ''}`} data-testid="precision-zoom" role="img" aria-label="Magnified placement preview">
        <div className="fp-precision-caption"><strong>Precision view</strong><span>{Math.round(lensZoom / zoom)}× closer</span></div>
        <svg viewBox={`${lens.point.x - lensSpan / 2} ${lens.point.y - lensSpan / 2} ${lensSpan} ${lensSpan}`}>
          <image href={plan.imageDataUrl} x="0" y="0" width={plan.widthPx} height={plan.heightPx}/>
          {precisionPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={4 / lensZoom} fill="#fff" stroke="#0a817e" strokeWidth={1.5 / lensZoom}/>)}
          <path d={`M${lens.point.x - lensSpan/2},${lens.point.y}h${lensSpan}M${lens.point.x},${lens.point.y - lensSpan/2}v${lensSpan}`} stroke="#fff" strokeWidth={3 / lensZoom}/>
          <path d={`M${lens.point.x - lensSpan/2},${lens.point.y}h${lensSpan}M${lens.point.x},${lens.point.y - lensSpan/2}v${lensSpan}`} stroke="#057f7c" strokeWidth={1 / lensZoom}/>
          <circle cx={lens.point.x} cy={lens.point.y} r={4 / lensZoom} fill="none" stroke="#057f7c" strokeWidth={1.5 / lensZoom}/>
        </svg>
      </div> : null}
      </div>
    </div>
  );
}
