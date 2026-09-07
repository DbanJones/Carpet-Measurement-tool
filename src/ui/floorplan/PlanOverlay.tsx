import type { FloorPlanDocument, Room, Staircase } from '@engine/types';
import { boundingBox, centroid, doorwaySegment, shapeToPolygon } from '@engine/geometry';
import { formatArea, formatLength } from '@ui/components/inputs';
import { stairPlanGeometry } from '@ui/stairs/stairLayout';
import { mmToPx, pixelDistance, roomPlanTransform, svgPoints, type Px } from './tracing';
import { ScaleReference } from './ScaleOverlay';

export type PlanTool = 'detect' | 'rectangle' | 'trace' | 'stairs' | 'select' | 'scale' | 'measure' | 'doorway';
export interface Gap { a: Px; b: Px }

export function PlanOverlay({ plan, rooms, stairs = [], selectedRoomId, selectedStaircaseId, selectedPoint, overlappingIds = [], editingRoomId, outlineScale, tool, points, closed, hover, zoom, gaps, previewDoor, previewDoorOutline, scaleDistance, unit }: {
  plan: FloorPlanDocument; rooms: Room[]; selectedRoomId: string; tool: PlanTool; points: Px[];
  closed: boolean; hover: Px | null; zoom: number; gaps: Gap[]; previewDoor?: Gap; unit: 'metric' | 'imperial';
  previewDoorOutline?: Px[];
  stairs?: Staircase[]; selectedStaircaseId?: string; selectedPoint?: number; overlappingIds?: string[]; editingRoomId?: string; outlineScale?: number;
  /** Entered real-world length for a new scale reference, before saving. */
  scaleDistance?: number;
}) {
  const sw = 2 / zoom;
  const fs = 12 / zoom;
  const radius = 5 / zoom;
  const areaScale = outlineScale ?? plan.mmPerPx;
  const first = points[0];
  const last = points[points.length - 1];
  const draw = tool === 'trace' || tool === 'rectangle' || tool === 'detect' || tool === 'stairs';
  const label = (px: number) => plan.mmPerPx ? formatLength(px * plan.mmPerPx, unit) : 'Known distance';
  const lineEnd = points[1] ?? hover;
  const rectangle = (tool === 'rectangle' || tool === 'stairs') && first && hover && !closed
    ? [first, { x: hover.x, y: first.y }, hover, { x: first.x, y: hover.y }] : null;
  return <g pointerEvents="none">
    {rooms.map((room) => {
      const polygon = room.source?.pixelPolygon;
      if (!polygon?.length) return null;
      const c = centroid(polygon);
      const transform = roomPlanTransform(room);
      const active = selectedRoomId === room.id;
      return <g key={room.id} className={`fp-room${active ? ' active' : ''}${overlappingIds.includes(room.id) ? ' fp-overlap' : ''}${editingRoomId === room.id ? ' fp-being-edited' : ''}`} data-testid={`room-overlay-${room.id}`}>
        <polygon points={svgPoints(polygon)} strokeWidth={active ? sw * 1.7 : sw}/>
        {transform ? room.doorways.map((door) => {
          const edge = doorwaySegment(shapeToPolygon(room.shape), door);
          const a = mmToPx(transform, edge.from); const b = mmToPx(transform, edge.to);
          return <line key={door.id} className="fp-door" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={sw * 3}/>;
        }) : null}
        <text x={c.x} y={c.y} fontSize={fs} className="fp-label" textAnchor="middle">{room.name}</text>
      </g>;
    })}
    {stairs.map((stair) => {
      const footprint = stair.source?.pixelPolygon;
      if (!footprint?.length) return null;
      const bounds = boundingBox(footprint); const c = centroid(footprint);
      const layout = stairPlanGeometry(stair);
      const id = `stair-clip-${stair.id}`;
      const width = bounds.maxX - bounds.minX; const height = bounds.maxY - bounds.minY;
      const rotate = (width > height) !== (layout.width > layout.height);
      const projectPoint = (p: Px) => rotate
        ? { x: bounds.minX + p.y / Math.max(1, layout.height) * width, y: bounds.minY + p.x / Math.max(1, layout.width) * height }
        : { x: bounds.minX + p.x / Math.max(1, layout.width) * width, y: bounds.maxY - p.y / Math.max(1, layout.height) * height };
      return <g key={stair.id} className={`fp-stairs${selectedStaircaseId === stair.id ? ' active' : ''}`} data-testid={`stairs-overlay-${stair.id}`}>
        <defs><clipPath id={id}><polygon points={svgPoints(footprint)}/></clipPath></defs>
        <polygon points={svgPoints(footprint)} strokeWidth={sw * 1.5}/>
        <g clipPath={`url(#${id})`} className="fp-stair-treads">{layout.pieces.map((piece) => <polygon key={piece.id} points={svgPoints(piece.points.map(projectPoint))} strokeWidth={sw / 2}/>)}<polyline points={svgPoints(layout.route.map(projectPoint))} fill="none" stroke="#5b21b6" strokeWidth={sw} strokeDasharray={`${4 / zoom} ${3 / zoom}`}/></g>
        <text x={c.x} y={c.y} fontSize={fs} className="fp-label" textAnchor="middle">{width * zoom < 90 ? 'Stairs' : stair.name.length > 18 ? `${stair.name.slice(0, 16)}…` : stair.name}</text>
      </g>;
    })}
    {tool === 'measure' && first ? <g className="fp-measure">
      {lineEnd ? <><line x1={first.x} y1={first.y} x2={lineEnd.x} y2={lineEnd.y} strokeWidth={sw}/>
        <text x={(first.x + lineEnd.x) / 2} y={(first.y + lineEnd.y) / 2 - fs} className="fp-label" fontSize={fs} textAnchor="middle">{label(pixelDistance(first, lineEnd))}</text></> : null}
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={radius} strokeWidth={sw}/>)}
    </g> : null}
    {!plan.sketch && plan.calibration && !(tool === 'scale' && first) ? <ScaleReference plan={plan} a={plan.calibration.a} b={plan.calibration.b} distance={plan.calibration.distance} zoom={zoom} unit={unit}/> : null}
    {tool === 'scale' && first ? <ScaleReference plan={plan} a={first} b={lineEnd} distance={scaleDistance} zoom={zoom} unit={unit} draft endpointPlaced={points.length > 1}/> : null}
    {draw && first ? <g className="fp-trace">
      {closed || rectangle ? <polygon points={svgPoints(rectangle ?? points)} strokeWidth={sw}/> : <polyline points={svgPoints(points)} fill="none" strokeWidth={sw}/>}
      {!closed && !rectangle && last && hover ? <line className="rubber" x1={last.x} y1={last.y} x2={hover.x} y2={hover.y} strokeWidth={sw} strokeDasharray={`${5 / zoom} ${4 / zoom}`}/> : null}
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={selectedPoint === i ? radius * 1.6 : i === 0 && !closed ? radius * 1.5 : radius} strokeWidth={sw} className={selectedPoint === i ? 'selected' : i === 0 ? 'first' : undefined}/>)}
      {closed && areaScale ? <text x={centroid(points).x} y={centroid(points).y} fontSize={fs} className="fp-label" textAnchor="middle">
        Review outline · {formatArea(Math.abs(points.reduce((area, p, i) => {
          const q = points[(i + 1) % points.length]!; return area + p.x * q.y - q.x * p.y;
        }, 0)) / 2 * areaScale ** 2 / 1e6, unit)}
      </text> : null}
      {gaps.map((gap, i) => <g key={i}><line className="fp-inferred-gap" x1={gap.a.x} y1={gap.a.y} x2={gap.b.x} y2={gap.b.y} strokeWidth={sw * 2} strokeDasharray={`${4 / zoom} ${4 / zoom}`}/><text x={(gap.a.x + gap.b.x) / 2} y={(gap.a.y + gap.b.y) / 2 - fs} className="fp-label" fontSize={fs * .8} textAnchor="middle">Opening {i + 1}</text></g>)}
    </g> : null}
    {tool === 'doorway' && first ? <g className="fp-door-new">
      {previewDoorOutline ? <polygon data-testid="straight-doorway-outline" points={svgPoints(previewDoorOutline)} fill="#0f8d7915" stroke="#078177" strokeWidth={sw} strokeDasharray={`${5/zoom} ${3/zoom}`}/> : null}
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={radius} strokeWidth={sw}/>)}
      {previewDoor ? <line className="fp-door" x1={previewDoor.a.x} y1={previewDoor.a.y} x2={previewDoor.b.x} y2={previewDoor.b.y} strokeWidth={sw * 3}/> : null}
    </g> : null}
  </g>;
}
