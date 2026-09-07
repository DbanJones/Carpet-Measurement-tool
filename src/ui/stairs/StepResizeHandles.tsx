import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Point, Step } from '@engine/types';
import { formatLength } from '@ui/components/inputs';
import type { StairPlanPiece } from './stairLayout';
import { minimumStepResize, resizeStepByVector, resizeStepDimension, stepResizeHandles, type StepResizeHandle, type StepResizePatch } from './stepResizing';
import './step-resize-handles.css';

export interface StepResizeHandlesProps {
  piece: StairPlanPiece;
  step: Step;
  unit: 'metric' | 'imperial';
  /** Millimetres in the piece's plan frame to coordinates in the parent SVG. */
  toScreen: (point: Point) => Point;
  onStart?: () => void;
  onPreview: (patch: StepResizePatch) => void;
  onCommit: (patch: StepResizePatch) => void;
  onCancel: () => void;
}
interface ResizeDrag {
  pointerId: number;
  handle: StepResizeHandle;
  step: Step;
  start: Point;
  toPlan: (x: number, y: number) => Point;
  patch: StepResizePatch;
  moved: boolean;
}

/** A child of the top-down SVG. Only a completed gesture writes measured dimensions. */
export function StepResizeHandles({ piece, step, unit, toScreen, onStart, onPreview, onCommit, onCancel }: StepResizeHandlesProps) {
  const drag = useRef<ResizeDrag>();
  const group = useRef<SVGGElement>(null);
  const cancelRef = useRef(onCancel); cancelRef.current = onCancel;
  const [active, setActive] = useState<string>();
  const [pixelScale, setPixelScale] = useState(1);
  useEffect(() => () => { if (drag.current) { drag.current = undefined; cancelRef.current(); } }, [step.id]);
  useEffect(() => {
    const svg = group.current?.ownerSVGElement;
    if (!svg) return;
    const measure = () => {
      const matrix = svg.getScreenCTM?.();
      const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 0;
      if (scale > 0) setPixelScale(1 / scale);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    observer?.observe(svg);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const handles = stepResizeHandles(step, piece);
  const end = (event: PointerEvent<SVGGElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = undefined; setActive(undefined);
    if (cancelled || !current.moved) onCancel();
    else onCommit(current.patch);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <g ref={group} className="step-resize-handles" aria-label="Resize selected tread" onClick={event => event.stopPropagation()}>
    {handles.map(handle => {
      const p = toScreen(handle.position), value = step[handle.dimension];
      const name = handle.dimension === 'width' ? 'width' : 'depth';
      const label = handle.dimension === 'going' && step.kind === 'winder' ? 'Widest depth' : name === 'width' ? 'Width' : 'Depth';
      const axisEnd = toScreen({ x: handle.position.x + handle.direction.x, y: handle.position.y + handle.direction.y });
      const angle = Math.atan2(axisEnd.y - p.y, axisEnd.x - p.x) * 180 / Math.PI;
      return <g key={handle.dimension} data-step-resize={handle.dimension} className={`step-resize-handle${active === handle.dimension ? ' resizing' : ''}`} role="slider" tabIndex={0}
        aria-label={`Resize selected step ${name}`} aria-valuemin={minimumStepResize(step, handle.dimension)} aria-valuemax={1000000} aria-valuenow={value} aria-valuetext={formatLength(value, unit)}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
          if (!matrix) return;
          const origin = toScreen({ x: 0, y: 0 }), xAxis = toScreen({ x: 1, y: 0 }), yAxis = toScreen({ x: 0, y: 1 });
          const ax = xAxis.x - origin.x, ay = xAxis.y - origin.y, bx = yAxis.x - origin.x, by = yAxis.y - origin.y;
          const determinant = ax * by - ay * bx;
          if (Math.abs(determinant) < 1e-12) return;
          const toPlan = (x: number, y: number): Point => {
            const point = new DOMPoint(x, y).matrixTransform(matrix);
            const dx = point.x - origin.x, dy = point.y - origin.y;
            return { x: (dx * by - dy * bx) / determinant, y: (dy * ax - dx * ay) / determinant };
          };
          drag.current = { pointerId: event.pointerId, handle, step: { ...step }, start: toPlan(event.clientX, event.clientY), toPlan, patch: {}, moved: false };
          event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
          setActive(handle.dimension); onStart?.();
        }}
        onPointerMove={event => {
          const current = drag.current;
          if (!current || event.pointerId !== current.pointerId) return;
          event.preventDefault(); event.stopPropagation();
          const point = current.toPlan(event.clientX, event.clientY);
          const patch = resizeStepByVector(current.step, current.handle, { x: point.x - current.start.x, y: point.y - current.start.y });
          if (patch[current.handle.dimension] === current.step[current.handle.dimension] && !current.moved) return;
          current.moved = true; current.patch = patch; onPreview(patch);
        }}
        onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)}
        onLostPointerCapture={() => { if (drag.current) { drag.current = undefined; setActive(undefined); onCancel(); } }}
        onKeyDown={event => {
          if (event.key === 'Escape' && drag.current) {
            event.preventDefault(); event.stopPropagation(); drag.current = undefined; setActive(undefined); onCancel(); return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
          const patch = resizeStepDimension(step, handle.dimension, direction * (event.shiftKey ? 100 : 10));
          if (patch[handle.dimension] !== value) { onStart?.(); onCommit(patch); }
        }}>
        <circle className="step-resize-hit" cx={p.x} cy={p.y} r={22 * pixelScale} />
        <circle className="step-resize-dot" cx={p.x} cy={p.y} r={8 * pixelScale} />
        <path className="step-resize-arrow" d="M-5 0H5M-3 -2L-5 0L-3 2M3 -2L5 0L3 2" transform={`translate(${p.x} ${p.y}) rotate(${angle}) scale(${pixelScale})`} />
        <title>{label}: {formatLength(value, unit)}. Drag to resize; arrow keys change by 10 mm, Shift by 100 mm.</title>
      </g>;
    })}
  </g>;
}
