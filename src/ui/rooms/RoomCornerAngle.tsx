import { useEffect, useId, useState } from 'react';
import type { Polygon } from '@engine/types';
import { edgeLength, signedArea } from '@engine/geometry';
import { roomCornerAngle } from './roomDiagramGeometry';

export function RoomCornerAngle({ angle, onChange }: { angle: number; onChange: (angle: number) => void }) {
  const [value, setValue] = useState(angle.toFixed(1));
  const hintId = useId();
  useEffect(() => setValue(angle.toFixed(1)), [angle]);
  return <div className="room-angle-control">
    <div className="room-angle-heading"><strong>Interior angle <span>{Number(angle.toFixed(1))}°</span></strong><span>{angle > 180 ? 'Inward corner' : 'Outward corner'}</span></div>
    <div className="room-angle-inputs">
      <button type="button" onClick={() => { const square = angle > 180 ? 270 : 90; setValue(square.toFixed(1)); onChange(square); }}>{angle > 180 ? 'Square inward corner · 270°' : 'Make right angle · 90°'}</button>
      <label><span className="field-label">Custom angle (°)</span><input type="number" min="1" max="359" step="0.1" aria-label="Selected corner angle" aria-describedby={hintId} value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onChange(value.trim() ? Number(value) : NaN); } }}/></label>
      <button type="button" onClick={() => onChange(value.trim() ? Number(value) : NaN)}>Apply angle</button>
    </div>
    <p id={hintId}>Moves this corner; the other corners stay in place. The two adjoining wall lengths adjust. Angles over 180° form an inward corner.</p>
  </div>;
}

/** The arc and label show the interior, including the larger arc at an inward corner. */
export function RoomCornerAngleMarker({ points, index, size }: { points: Polygon; index: number; size: number }) {
  const a = points[(index - 1 + points.length) % points.length]!, b = points[index]!, c = points[(index + 1) % points.length]!;
  const degrees = roomCornerAngle(points, index), winding = signedArea(points) >= 0 ? 1 : -1;
  const radius = Math.min(size * .09, edgeLength(points, index) * .25, edgeLength(points, (index - 1 + points.length) % points.length) * .25);
  const startAngle = Math.atan2(c.y - b.y, c.x - b.x), endAngle = Math.atan2(a.y - b.y, a.x - b.x);
  const start = { x: b.x + Math.cos(startAngle) * radius, y: b.y + Math.sin(startAngle) * radius };
  const end = { x: b.x + Math.cos(endAngle) * radius, y: b.y + Math.sin(endAngle) * radius };
  const middle = startAngle + winding * degrees * Math.PI / 360;
  return <g className="room-angle-marker" aria-hidden="true" pointerEvents="none">
    <path d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${degrees > 180 ? 1 : 0} ${winding > 0 ? 1 : 0} ${end.x} ${end.y}`} vectorEffect="non-scaling-stroke"/>
    <text x={b.x + Math.cos(middle) * radius * 1.4} y={b.y + Math.sin(middle) * radius * 1.4} style={{ fontSize: size * .027 }} textAnchor="middle" dominantBaseline="central">{Number(degrees.toFixed(1))}°</text>
  </g>;
}
