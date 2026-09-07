import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Point } from '@engine/types';
import './stair-corner-handles.css';

interface CornerDrag {
  index: number;
  pointerId: number;
  start: Point;
  corner: Point;
  point: Point;
  moved: boolean;
  fromClient: (x: number, y: number) => Point;
}

/** Raw plan coordinates keep adjoining stair corners attached while a gesture is previewed. */
export function StairCornerHandles({ points, toScreen, label = 'Stair', onStart, onPreview, onCommit, onCancel }: {
  points: Point[];
  toScreen: (point: Point) => Point;
  label?: string;
  onStart: () => void;
  onPreview: (index: number, point: Point) => void;
  onCommit: (index: number, point: Point) => void;
  onCancel: () => void;
}) {
  const drag = useRef<CornerDrag>();
  const group = useRef<SVGGElement>(null);
  const cancelRef = useRef(onCancel); cancelRef.current = onCancel;
  const [pixelScale, setPixelScale] = useState(1);
  const [selected, setSelected] = useState(-1);
  useEffect(() => () => { if (drag.current) { drag.current = undefined; cancelRef.current(); } }, []);
  useEffect(() => {
    const svg = group.current?.ownerSVGElement;
    if (!svg) return;
    const measure = () => { const matrix = svg.getScreenCTM?.(); const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 0; if (scale > 0) setPixelScale(1 / scale); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(svg); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const finish = (event: PointerEvent<SVGGElement>, cancel = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); drag.current = undefined;
    if (cancel || !active.moved) onCancel(); else onCommit(active.index, active.point);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <g ref={group} className="stair-corner-handles" aria-label={`${label} corner controls`} onClick={event => event.stopPropagation()}>
    {points.map((corner, index) => {
      const screen = toScreen(corner);
      return <g key={index} className={`stair-corner-handle${selected === index ? ' active' : ''}`} role="button" tabIndex={0}
        aria-label={`${label} corner ${index + 1}`} aria-pressed={selected === index} data-stair-corner={index}
        onFocus={() => setSelected(index)}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          const matrix = event.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
          if (!matrix) return;
          const zero = toScreen({ x: 0, y: 0 }), x = toScreen({ x: 1, y: 0 }), y = toScreen({ x: 0, y: 1 });
          const ax = x.x - zero.x, ay = x.y - zero.y, bx = y.x - zero.x, by = y.y - zero.y;
          const det = ax * by - ay * bx;
          if (Math.abs(det) < 1e-12) return;
          const fromClient = (clientX: number, clientY: number): Point => {
            const p = new DOMPoint(clientX, clientY).matrixTransform(matrix), dx = p.x - zero.x, dy = p.y - zero.y;
            return { x: (dx * by - dy * bx) / det, y: (dy * ax - dx * ay) / det };
          };
          // Turning treads meet at a small newel: their touch targets can overlap. Pick the
          // nearest visible dot so a large target cannot steal a neighbouring corner's drag.
          const start = fromClient(event.clientX, event.clientY);
          const nearest = points.reduce((best, p, i) => Math.hypot(p.x-start.x, p.y-start.y) < Math.hypot(points[best]!.x-start.x, points[best]!.y-start.y) ? i : best, index);
          const selectedCorner = points[nearest]!;
          drag.current = { index: nearest, pointerId: event.pointerId, corner: { ...selectedCorner }, point: { ...selectedCorner }, start, moved: false, fromClient };
          group.current?.querySelector<SVGGElement>(`[data-stair-corner="${nearest}"]`)?.focus();
          setSelected(nearest); event.currentTarget.setPointerCapture(event.pointerId); onStart();
        }}
        onPointerMove={event => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation();
          const p = active.fromClient(event.clientX, event.clientY);
          const dx = Math.round((p.x - active.start.x) / 5) * 5, dy = Math.round((p.y - active.start.y) / 5) * 5;
          if (!active.moved && Math.hypot(dx, dy) < 5) return;
          active.moved = true; active.point = { x: active.corner.x + dx, y: active.corner.y + dy };
          onPreview(active.index, active.point);
        }}
        onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
        onLostPointerCapture={() => { if (drag.current) { drag.current = undefined; onCancel(); } }}
        onKeyDown={event => {
          if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); drag.current = undefined; onCancel(); return; }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setSelected(index); return; }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const amount = event.shiftKey ? 100 : 10;
          onStart(); onCommit(index, { x: corner.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), y: corner.y + (event.key === 'ArrowDown' ? -amount : event.key === 'ArrowUp' ? amount : 0) });
        }}>
        <circle className="stair-corner-hit" cx={screen.x} cy={screen.y} r={22 * pixelScale} />
        <circle className="stair-corner-dot" cx={screen.x} cy={screen.y} r={7 * pixelScale} />
        <text x={screen.x + 11 * pixelScale} y={screen.y - 10 * pixelScale} style={{ fontSize: `${12 * pixelScale}px` }}>{index + 1}</text>
        <title>Move corner {index + 1}. Adjacent steps stay attached. Arrow keys: 10 mm; Shift: 100 mm.</title>
      </g>;
    })}
  </g>;
}
