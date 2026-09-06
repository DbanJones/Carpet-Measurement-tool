import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { FloorPlanDocument } from '@engine/types';
import { clampZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, type Px } from './tracing';

export interface PointerInfo {
  shiftKey: boolean;
  altKey: boolean;
  /** Zoom at the time of the event: divide screen tolerances by it to get plan pixels. */
  zoom: number;
  pointerType: string;
}

export interface FloorPlanCanvasProps {
  plan: FloorPlanDocument;
  /** 1 = 100 %. Controlled by the parent so overlay stroke widths can be kept zoom-independent. */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Show a crosshair (drawing modes) instead of the pan hand. */
  crosshair?: boolean;
  /** A click or tap (pointer down + up without dragging), in plan pixel coordinates. */
  onTap?: (p: Px, info: PointerInfo) => void;
  /** Pointer movement over the plan, or null when it leaves. */
  onHover?: (p: Px | null, info: PointerInfo) => void;
  onDoubleTap?: (p: Px, info: PointerInfo) => void;
  /** SVG overlay content in plan pixel coordinates (0..widthPx, 0..heightPx). */
  children?: ReactNode;
  ariaLabel?: string;
}

const DRAG_THRESHOLD_PX = 5;

/**
 * Scrollable view of a floor plan raster with an SVG overlay of the same size. Zoom is a CSS
 * transform on a wrapper so the image is never re-decoded; pointer positions are mapped back to
 * plan pixels through the overlay's bounding box. Dragging pans (mouse or touch); a press without
 * movement is a tap.
 */
export function FloorPlanCanvas({ plan, zoom, onZoomChange, crosshair, onTap, onHover, onDoubleTap, children, ariaLabel }: FloorPlanCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Plan point that should stay under the same screen spot across the next zoom change. */
  const anchor = useRef<{ plan: Px; client: Px } | null>(null);

  const toPlan = useCallback(
    (e: { clientX: number; clientY: number }): Px => {
      const rect = svgRef.current?.getBoundingClientRect();
      // jsdom (and a not-yet-laid-out element) report a zero rect: fall back to the nominal zoom.
      const sx = rect && rect.width > 0 ? plan.widthPx / rect.width : 1 / zoom;
      const sy = rect && rect.height > 0 ? plan.heightPx / rect.height : 1 / zoom;
      return { x: ((e.clientX ?? 0) - (rect?.left ?? 0)) * sx, y: ((e.clientY ?? 0) - (rect?.top ?? 0)) * sy };
    },
    [plan.widthPx, plan.heightPx, zoom],
  );

  const info = (e: { shiftKey?: boolean; altKey?: boolean; pointerType?: string }): PointerInfo => ({
    shiftKey: !!e.shiftKey,
    altKey: !!e.altKey,
    zoom,
    pointerType: e.pointerType ?? 'mouse',
  });

  /** Fit the whole plan into the scroll container. */
  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const availW = el.clientWidth - 2;
    const availH = Math.max(200, Math.round(window.innerHeight * 0.7) - 2);
    if (availW <= 0) return; // not laid out (e.g. jsdom): keep the current zoom
    const z = Math.min(availW / plan.widthPx, availH / plan.heightPx);
    onZoomChange(clampZoom(Math.min(z, 1)));
  }, [plan.widthPx, plan.heightPx, onZoomChange]);

  // Fit on first display of each plan.
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const zoomTo = useCallback(
    (z: number, clientAnchor?: Px) => {
      const el = scrollRef.current;
      const next = clampZoom(z);
      if (el && next !== zoom) {
        const rect = el.getBoundingClientRect();
        const client = clientAnchor ?? { x: rect.left + el.clientWidth / 2, y: rect.top + el.clientHeight / 2 };
        anchor.current = { plan: toPlan({ clientX: client.x, clientY: client.y }), client: { x: client.x - rect.left, y: client.y - rect.top } };
      }
      onZoomChange(next);
    },
    [zoom, onZoomChange, toPlan],
  );

  // After a zoom change, scroll so the anchored plan point stays under the same screen spot.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.plan.x * zoom - a.client.x;
    el.scrollTop = a.plan.y * zoom - a.client.y;
  }, [zoom]);

  // Ctrl/⌘ + wheel zooms about the cursor (native listener: React registers wheel as passive).
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

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const el = scrollRef.current;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el?.scrollLeft ?? 0,
      scrollTop: el?.scrollTop ?? 0,
      moved: false,
    };
    const target = e.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved) {
        const el = scrollRef.current;
        if (el) {
          el.scrollLeft = d.scrollLeft - dx;
          el.scrollTop = d.scrollTop - dy;
        }
        return;
      }
    }
    onHover?.(toPlan(e), info(e));
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return null;
    drag.current = null;
    setDragging(false);
    const target = e.currentTarget;
    if (typeof target.releasePointerCapture === 'function') {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    return d;
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = endDrag(e);
    if (d && !d.moved) onTap?.(toPlan(e), info(e));
  };

  const onPointerCancel = (e: ReactPointerEvent<SVGSVGElement>) => {
    endDrag(e);
  };

  const onPointerLeave = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) onHover?.(null, info(e));
  };

  const cursor = dragging ? 'grabbing' : crosshair ? 'crosshair' : 'grab';
  const pct = Math.round(zoom * 100);

  return (
    <div className="floorplan-view">
      <div className="toolbar zoom-controls" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomTo(zoom / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">
          −
        </button>
        <span className="zoom-readout small" aria-live="polite" data-testid="zoom-readout">
          {pct}%
        </span>
        <button type="button" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={fit}>
          Fit
        </button>
        <button type="button" onClick={() => zoomTo(1)} title="Zoom to 100%">
          Actual size
        </button>
        <span className="muted small">Drag to pan · Ctrl + scroll to zoom</span>
      </div>
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
              data-testid="floorplan-overlay"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onPointerLeave={onPointerLeave}
              onDoubleClick={(e) => onDoubleTap?.(toPlan(e), info(e))}
              onContextMenu={(e) => e.preventDefault()}
            >
              {children}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
