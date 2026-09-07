import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DetectedDoorway } from './detection';
import type { FloorPlanDocument } from '@engine/types';
import type { RoomSuggestion } from './roomSuggestions';
import { DoorwaySuggestions, DoorwaySuggestionOverlay } from './DetectedDoorwayControls';
import { DetectedRoomsReview } from './DetectedRoomsReview';
import { DetectedRoomsOverlay } from './DetectedRoomsOverlay';

const doorways: DetectedDoorway[] = [
  { a: { x: 100, y: 200 }, b: { x: 180, y: 200 }, hinge: { x: 100, y: 200 }, leafEnd: { x: 100, y: 120 }, evidence: 'swing-arc', confidence: 'high' },
  { a: { x: 240, y: 200 }, b: { x: 310, y: 200 }, hinge: { x: 240, y: 200 }, leafEnd: { x: 240, y: 130 }, evidence: 'door-leaf', confidence: 'medium' },
];
const polygon = [{ x: 20, y: 20 }, { x: 400, y: 20 }, { x: 400, y: 200 }, { x: 20, y: 200 }];
const plan: FloorPlanDocument = { id: 'plan', name: 'Ground floor', widthPx: 800, heightPx: 500, imageDataUrl: 'data:image/png;base64,test', mmPerPx: 10 };
const room: RoomSuggestion = { id: 'lounge', polygon, inferredGaps: [{ a: { x: 40, y: 200 }, b: { x: 80, y: 200 } }], name: 'Lounge', included: true, detectedDoorways: doorways };

afterEach(cleanup);

describe('Detected doorway review', () => {
  it('includes evidence-qualified doors by default, measures their widths and lets each be excluded independently', () => {
    const changed = vi.fn();
    function Harness() {
      const [excluded, setExcluded] = useState<number[]>([]);
      return <DoorwaySuggestions doorways={doorways} excluded={excluded} roomName="Lounge" mmPerPx={10} unit="metric" onChangeExcluded={next => { setExcluded(next); changed(next); }}/>;
    }
    render(<Harness/>);
    const first = screen.getByRole('checkbox', { name: 'Include doorway D1 in Lounge' }) as HTMLInputElement;
    const second = screen.getByRole('checkbox', { name: 'Include doorway D2 in Lounge' }) as HTMLInputElement;
    expect(first.checked).toBe(true); expect(second.checked).toBe(true);
    expect(screen.getByText('0.80 m')).toBeTruthy(); expect(screen.getByText('0.70 m')).toBeTruthy();
    expect(screen.getByText('Straight threshold')).toBeTruthy();
    expect(screen.getByText('Straight threshold · check symbol')).toBeTruthy();
    fireEvent.click(first);
    expect(changed).toHaveBeenLastCalledWith([0]); expect(first.checked).toBe(false); expect(second.checked).toBe(true);
    expect(screen.getByText('1 included')).toBeTruthy();
    fireEvent.click(first);
    expect(changed).toHaveBeenLastCalledWith([]); expect(first.checked).toBe(true);
  });

  it('sends doorway exclusions to the selected room without changing the room selection', () => {
    const onChange = vi.fn(); const onSelect = vi.fn();
    render(<DetectedRoomsReview plan={plan} rooms={[room]} activeId={room.id} issues={new Map()} unit="metric" message="" products={[]} productId="" onProductChange={vi.fn()} onSelect={onSelect} onChange={onChange} onEdit={vi.fn()} onRemove={vi.fn()} onAccept={vi.fn()} onCancel={vi.fn()}/>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include doorway D2 in Lounge' }));
    expect(onChange).toHaveBeenCalledWith('lounge', { excludedDoorways: [1] });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/Only the included door symbols above/)).toBeTruthy();
  });

  it('does not turn generic gaps into detected doors', () => {
    render(<DetectedRoomsReview plan={plan} rooms={[{ ...room, detectedDoorways: undefined }]} activeId={room.id} issues={new Map()} unit="metric" message="" products={[]} productId="" onProductChange={vi.fn()} onSelect={vi.fn()} onChange={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} onAccept={vi.fn()} onCancel={vi.fn()}/>);
    expect(screen.queryByRole('group', { name: 'Detected doorways in Lounge' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Include doorway/ })).toBeNull();
    expect(screen.getByText(/These gaps are not confirmed doors/)).toBeTruthy();
  });

  it('states floor coverage only when the geometry confirms it and otherwise shows the check message', () => {
    const accepted: DetectedDoorway = { ...doorways[0]!, floorIncluded: true };
    const uncertain: DetectedDoorway = { ...doorways[1]!, floorIncluded: false, floorWarning: 'Check the threshold next to this wall junction.' };
    render(<DoorwaySuggestions doorways={[accepted, uncertain]} roomName="Lounge" mmPerPx={10} unit="metric" onChangeExcluded={vi.fn()}/>);
    expect(screen.getAllByText(/floor beneath included/)).toHaveLength(1);
    expect(screen.getByText('Check the threshold next to this wall junction.')).toBeTruthy();
  });

  it('updates floor coverage during corner edits and restores it without changing the original door evidence', () => {
    const detected = { ...doorways[0]!, floorIncluded: true };
    const props = { doorways: [detected], roomName: 'Lounge', mmPerPx: 10, unit: 'metric' as const, onChangeExcluded: vi.fn() };
    const { rerender } = render(<DoorwaySuggestions {...props} polygon={polygon}/>);
    expect(screen.getByText(/floor beneath included/)).toBeTruthy();
    rerender(<DoorwaySuggestions {...props} polygon={polygon.map(point => ({ ...point, y: point.y === 200 ? 195 : point.y }))}/>);
    expect(screen.queryByText(/floor beneath included/)).toBeNull();
    expect(screen.getByText(/edited outline no longer covers this threshold/)).toBeTruthy();
    expect(detected.floorIncluded).toBe(true);
    rerender(<DoorwaySuggestions {...props} polygon={polygon}/>);
    expect(screen.getByText(/floor beneath included/)).toBeTruthy();
    expect(screen.queryByText(/edited outline no longer covers this threshold/)).toBeNull();
  });
});

describe('Detected doorway drawing', () => {
  it('shows threshold evidence and excludes only the unchecked door', () => {
    const { container } = render(<svg><DoorwaySuggestionOverlay doorways={doorways} excluded={[1]} roomName="Lounge" polygon={polygon} zoom={.5} mmPerPx={10}/></svg>);
    const all = screen.getAllByTestId('detected-doorway-overlay');
    expect(all[0]!.getAttribute('aria-label')).toBe('Doorway D1 in Lounge, 0.80 m, included');
    expect(all[1]!.getAttribute('data-included')).toBe('false');
    expect(all[1]!.getAttribute('aria-label')).toBe('Doorway D2 in Lounge, 0.70 m, excluded');
    expect(container.querySelectorAll('.fp-detected-door-leaf, .fp-detected-door-swing')).toHaveLength(0);
    expect(all[1]!.querySelector('.fp-detected-door-threshold')!.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(container.querySelector('.fp-detected-doorway-layer')!.getAttribute('pointer-events')).toBe('none');
  });

  it('keeps the doorway markers and strokes readable at each zoom', () => {
    const { container, rerender } = render(<svg><DoorwaySuggestionOverlay doorways={doorways} roomName="Lounge" polygon={polygon} zoom={1}/></svg>);
    const stroke = () => Number(container.querySelector('.fp-detected-door-threshold')!.getAttribute('stroke-width'));
    const marker = () => Number(container.querySelector('.fp-detected-door-marker rect')!.getAttribute('width'));
    const initial = { stroke: stroke(), marker: marker() };
    rerender(<svg><DoorwaySuggestionOverlay doorways={doorways} roomName="Lounge" polygon={polygon} zoom={.25}/></svg>);
    expect(stroke() * .25).toBe(initial.stroke); expect(marker() * .25).toBe(initial.marker);
  });

  it.each([
    { a: { x: 100, y: 200 }, b: { x: 180, y: 200 }, leafEnd: { x: 100, y: 120 } },
    { a: { x: 100, y: 200 }, b: { x: 180, y: 200 }, leafEnd: { x: 100, y: 138 } },
    { a: { x: 100, y: 100 }, b: { x: 100, y: 180 }, leafEnd: { x: 162, y: 100 } },
  ])('draws a straight threshold for circular and elliptical door symbols: $leafEnd', ({ a, b, leafEnd }) => {
    const doorway: DetectedDoorway = { a, b, hinge: a, leafEnd, evidence: 'swing-arc', confidence: 'high' };
    const { container } = render(<svg><DoorwaySuggestionOverlay doorways={[doorway]} roomName="Lounge" polygon={polygon} zoom={1}/></svg>);
    const line = container.querySelector('.fp-detected-door-threshold')!;
    expect(line.getAttribute('x1')).toBe(String(a.x)); expect(line.getAttribute('y1')).toBe(String(a.y));
    expect(line.getAttribute('x2')).toBe(String(b.x)); expect(line.getAttribute('y2')).toBe(String(b.y));
    expect(container.querySelectorAll('path')).toHaveLength(0);
    expect(container.querySelectorAll('.fp-detected-door-leaf, .fp-detected-door-swing')).toHaveLength(0);
  });

  it('preserves room numbering and keyboard selection while including doorway overlays', () => {
    const next = { ...room, id: 'kitchen', name: 'Kitchen' };
    const onSelect = vi.fn();
    render(<svg><DetectedRoomsOverlay rooms={[room, next]} activeId={next.id} editingId={room.id} zoom={1} mmPerPx={10} onSelect={onSelect}/></svg>);
    const target = screen.getByRole('button', { name: 'Review detected room 2: Kitchen' });
    expect(within(target).getByText('2')).toBeTruthy();
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('kitchen');
    expect(screen.getAllByTestId('detected-doorway-overlay')).toHaveLength(2);
    expect(screen.getAllByTestId('detected-doorway-overlay')[0]!.getAttribute('data-room-name')).toBe('Kitchen');
  });
});
