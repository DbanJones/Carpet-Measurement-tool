import type { FloorPlanDocument, Product } from '@engine/types';
import { Field, formatArea } from '@ui/components/inputs';
import { pixelPolygonArea } from './tracing';
import { PlanDimensionCheck } from './PlanDimensionCheck';
import { DoorwaySuggestions } from './DetectedDoorwayControls';
import { isSmallRoomSuggestion, type RoomSuggestion } from './roomSuggestions';
import type { ReactNode } from 'react';

export function DetectedRoomsReview({ plan, rooms, activeId, issues, unit, message, products, productId, onProductChange, onSelect, onChange, onEdit, onRemove, onAccept, onCancel, stairsReview, selectedStairs = 0, invalidStairs = false, blockedSummary }: {
  plan: FloorPlanDocument; rooms: RoomSuggestion[]; activeId?: string; issues: Map<string, string>;
  unit: 'metric' | 'imperial'; message: string; onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<RoomSuggestion>) => void; onEdit: (room: RoomSuggestion) => void;
  onRemove: (id: string) => void; onAccept: () => void; onCancel: () => void;
  products: Product[]; productId: string; onProductChange: (id: string) => void;
  stairsReview?: ReactNode; selectedStairs?: number; invalidStairs?: boolean;
  blockedSummary?: string;
}) {
  const active = rooms.find(room => room.id === activeId) ?? (activeId && stairsReview ? undefined : rooms[0]);
  const included = rooms.filter(room => room.included);
  const invalid = included.some(room => issues.has(room.id));
  const smallCount = rooms.filter(room => !room.included && isSmallRoomSuggestion(room.polygon, plan.mmPerPx!)).length;
  const selectedCount = included.length + selectedStairs;
  const doorwayCount = (room: RoomSuggestion) => room.detectedDoorways?.filter((_, index) => !room.excludedDoorways?.includes(index)).length ?? 0;
  return <section className="fp-batch-review" data-testid="mode-detected-rooms">
    <div className="eyebrow">{stairsReview ? 'DETECTED SPACES' : 'ROOM SUGGESTIONS'} · NOT YET ADDED</div><h3>{rooms.length ? `Review ${rooms.length} detected ${rooms.length === 1 ? 'room' : 'rooms'}` : 'Review detected staircases'}</h3>
    <p>Select a shaded outline to check it. Deselect anything you don’t need, or edit its corners before adding.</p>
    {smallCount ? <p className="fp-small-rooms-note">{smallCount} {smallCount === 1 ? 'space' : 'spaces'} under 1 m² left unchecked. Select any you want to include.</p> : null}
    <Field label={stairsReview ? 'Floor covering for selected spaces' : 'Floor covering for selected rooms'}><select aria-label="Detected rooms floor covering" value={productId} onChange={event => onProductChange(event.target.value)}>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
    {rooms.length ? <div className="fp-batch-selection"><strong>{included.length} {stairsReview ? 'rooms ' : ''}selected</strong><button type="button" className="link" onClick={() => rooms.forEach(room => onChange(room.id, { included: included.length !== rooms.length }))}>{included.length === rooms.length ? 'Deselect all' : 'Select all'}</button></div> : null}
    <ol className="fp-suggestion-list" aria-label="Detected rooms to review">{rooms.map((room, index) => <li key={room.id} className={`${room.id === active?.id ? 'active' : ''}${issues.has(room.id) ? ' needs-review' : ''}`}>
      <input type="checkbox" aria-label={`Include detected room ${index+1}: ${room.name}`} checked={room.included} onChange={event => onChange(room.id, { included: event.target.checked })}/>
      <button type="button" aria-current={room.id === active?.id ? 'true' : undefined} onClick={() => onSelect(room.id)}><span className="fp-suggestion-index">{index+1}</span><span><strong>{room.name}</strong><small>{formatArea(pixelPolygonArea(room.polygon) * plan.mmPerPx! ** 2 / 1e6, unit)}{issues.has(room.id) ? ' · check outline' : room.detectedDoorways?.length ? ` · ${doorwayCount(room)} ${doorwayCount(room) === 1 ? 'doorway' : 'doorways'}` : room.inferredGaps.length ? ' · check openings' : ''}</small></span></button>
    </li>)}</ol>
    {active ? <div className="fp-suggestion-detail">
      <Field label="Suggested room name"><input type="text" aria-label="Detected room name" value={active.name} onChange={event => onChange(active.id, { name: event.target.value, nameEdited: true })}/></Field>
      <PlanDimensionCheck reading={plan.reading} polygon={active.polygon} mmPerPx={plan.mmPerPx}/>
      {issues.get(active.id) ? <p className="warning" role="alert">{issues.get(active.id)}</p> : null}
      <DoorwaySuggestions doorways={active.detectedDoorways ?? []} excluded={active.excludedDoorways} roomName={active.name} polygon={active.polygon} mmPerPx={plan.mmPerPx} unit={unit}
        onChangeExcluded={excludedDoorways => onChange(active.id, { excludedDoorways })}/>
      {active.inferredGaps.length ? <p className="fp-help">{active.inferredGaps.length} wall {active.inferredGaps.length === 1 ? 'gap was' : 'gaps were'} closed to find this outline. Check that it includes one room. {active.detectedDoorways?.length ? 'Only the included door symbols above will be added as doorways.' : 'These gaps are not confirmed doors. Mark doorways after adding the room.'}</p> : null}
      <div className="row fp-secondary-actions"><button type="button" onClick={() => onEdit(active)}>Edit detected outline</button><button type="button" className="link" onClick={() => onRemove(active.id)}>Remove suggestion</button></div>
    </div> : null}
    {stairsReview}
    {blockedSummary ? <p className="warning" role="alert">{blockedSummary}</p> : null}
    <div className="fp-batch-accept"><button type="button" className="primary fp-primary" disabled={!selectedCount || invalid || invalidStairs || !productId} onClick={onAccept}>Add {selectedCount || ''} selected {stairsReview ? selectedCount === 1 ? 'space' : 'spaces' : included.length === 1 ? 'room' : 'rooms'}</button>{!productId ? <p className="warning">Add a flooring product before saving these spaces.</p> : null}<button type="button" className="link" onClick={onCancel}>Discard suggestions</button></div>
    {message ? <p className="fp-help">{message}</p> : null}
  </section>;
}
