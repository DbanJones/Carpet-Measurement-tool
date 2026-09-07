import type { RoomSuggestion } from './roomSuggestions';
import { boundingBox, centroid } from '@engine/geometry';
import { pointInPixelPolygon, svgPoints } from './tracing';
import { DoorwaySuggestionOverlay } from './DetectedDoorwayControls';

/** A provisional layer: saving the suggestions is an explicit action in the review panel. */
export function DetectedRoomsOverlay({ rooms, activeId, editingId, zoom, mmPerPx, unit, onSelect }: { rooms: RoomSuggestion[]; activeId?: string; editingId?: string; zoom: number; mmPerPx?: number; unit?: 'metric' | 'imperial'; onSelect: (id: string) => void }) {
  return <g className="fp-detected-rooms" aria-label="Detected room suggestions">
    {rooms.map((room, index) => {
      if (room.id === editingId) return null;
      const bounds = boundingBox(room.polygon);
      const inset = { x: bounds.minX + 18 / zoom, y: bounds.minY + 22 / zoom };
      const c = pointInPixelPolygon(inset, room.polygon) ? inset : centroid(room.polygon);
      const space = Math.max(0, (bounds.maxX - c.x) * zoom - 22);
      const letters = Math.floor(space / 7);
      const label = letters >= room.name.length ? room.name : letters >= 7 ? `${room.name.slice(0, letters-1)}…` : '';
      return <g key={room.id} className={`fp-room-suggestion${room.included ? ' included' : ''}${activeId === room.id ? ' active' : ''}`}
        role="button" tabIndex={0} aria-label={`Review detected room ${index+1}: ${room.name}`} aria-pressed={activeId === room.id} data-suggestion-id={room.id}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(room.id); } }}>
        <polygon points={svgPoints(room.polygon)} strokeWidth={2 / zoom} strokeDasharray={`${6/zoom} ${3/zoom}`}/>
        <circle cx={c.x} cy={c.y} r={11/zoom}/>
        <text x={c.x} y={c.y + 4/zoom} textAnchor="middle" className="fp-suggestion-number" fontSize={11/zoom}>{index+1}</text>
        <text x={c.x+16/zoom} y={c.y+4/zoom} textAnchor="start" className="fp-label" fontSize={12/zoom}>{label}</text>
        <DoorwaySuggestionOverlay doorways={room.detectedDoorways ?? []} excluded={room.excludedDoorways} roomName={room.name} polygon={room.polygon} zoom={zoom} mmPerPx={mmPerPx} unit={unit}/>
      </g>;
    })}
  </g>;
}
