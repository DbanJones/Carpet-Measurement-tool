import type { DetectedDoorway } from './detection';
import { formatLength } from '@ui/components/inputs';
import { pixelDistance, pointInPixelPolygon, type Px } from './tracing';
import { doorwayThresholdCovered } from './doorwaySuggestions';
import './doorway-suggestions.css';

export function DoorwaySuggestions({ doorways, excluded = [], roomName, polygon, mmPerPx, unit, disabled = false, onChangeExcluded }: {
  doorways: DetectedDoorway[]; excluded?: number[]; roomName: string; mmPerPx?: number;
  polygon?: Px[];
  unit: 'metric' | 'imperial'; disabled?: boolean; onChangeExcluded: (excluded: number[]) => void;
}) {
  if (!doorways.length) return null;
  const included = doorways.filter((_, index) => !excluded.includes(index)).length;
  return <fieldset className="fp-detected-doorways" aria-label={`Detected doorways in ${roomName}`} disabled={disabled}>
    <legend><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5v10h4m6 0h4V5M7 15h6"/></svg>Doorways found <span>{included} included</span></legend>
    <p>Added with this room. Untick any that aren’t doors.</p>
    <div className="fp-detected-doorway-list">{doorways.map((door, index) => {
      const checked = !excluded.includes(index);
      const changedFloor = door.floorIncluded === true && polygon && !doorwayThresholdCovered(door, polygon);
      const floorIncluded = door.floorIncluded === true && !changedFloor;
      const floorWarning = changedFloor ? 'The edited outline no longer covers this threshold. Adjust its corners to include the floor beneath the door.' : door.floorWarning;
      return <label className={`fp-detected-doorway-row${checked ? '' : ' is-excluded'}`} key={index}>
        <input type="checkbox" aria-label={`Include doorway D${index + 1} in ${roomName}`} checked={checked}
          onChange={event => onChangeExcluded(event.target.checked ? excluded.filter(value => value !== index) : [...new Set([...excluded, index])])}/>
        <span className="fp-doorway-number" aria-hidden="true">D{index + 1}</span>
        <span className="fp-doorway-copy"><strong>{mmPerPx ? formatLength(pixelDistance(door.a, door.b) * mmPerPx, unit) : 'Width after scale'}</strong>
          <small>Straight threshold{floorIncluded ? ' · floor beneath included' : ''}{door.confidence === 'medium' ? ' · check symbol' : ''}</small>
          {door.floorIncluded === false || floorWarning ? <small className="fp-doorway-floor-warning">{floorWarning || 'Check the floor beneath this threshold.'}</small> : null}</span>
      </label>;
    })}</div>
  </fieldset>;
}

/** Show the straight floor boundary; the scanned door symbol remains visible in the background. */
export function DoorwaySuggestionOverlay({ doorways, excluded = [], roomName, polygon, zoom, mmPerPx, unit = 'metric' }: {
  doorways: DetectedDoorway[]; excluded?: number[]; roomName: string; polygon: Px[];
  zoom: number; mmPerPx?: number; unit?: 'metric' | 'imperial';
}) {
  const z = Math.max(.01, zoom);
  return <g className="fp-detected-doorway-layer" pointerEvents="none">{doorways.map((door, index) => {
    const included = !excluded.includes(index);
    const width = pixelDistance(door.a, door.b);
    const middle = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
    const normal = { x: -(door.b.y - door.a.y) / Math.max(.01, width), y: (door.b.x - door.a.x) / Math.max(.01, width) };
    const offset = 16 / z;
    const forward = { x: middle.x + normal.x * offset, y: middle.y + normal.y * offset };
    const reverse = { x: middle.x - normal.x * offset, y: middle.y - normal.y * offset };
    const label = pointInPixelPolygon(forward, polygon) ? forward : pointInPixelPolygon(reverse, polygon) ? reverse : middle;
    const name = `Doorway D${index + 1} in ${roomName}${mmPerPx ? `, ${formatLength(width * mmPerPx, unit)}` : ''}, ${included ? 'included' : 'excluded'}`;
    return <g key={index} className={`fp-detected-doorway ${included ? 'is-included' : 'is-excluded'}`} role="img" aria-label={name}
      data-testid="detected-doorway-overlay" data-room-name={roomName} data-door-index={index} data-included={String(included)} data-floor-included={door.floorIncluded === undefined ? undefined : String(door.floorIncluded && doorwayThresholdCovered(door, polygon))}>
      <title>{name}</title>
      <line className="fp-detected-door-halo" x1={door.a.x} y1={door.a.y} x2={door.b.x} y2={door.b.y} strokeWidth={7 / z}/>
      <line className="fp-detected-door-threshold" x1={door.a.x} y1={door.a.y} x2={door.b.x} y2={door.b.y} strokeWidth={4 / z} strokeDasharray={included ? undefined : `${3 / z} ${3 / z}`}/>
      <g className="fp-detected-door-marker">
        <rect x={label.x - 12 / z} y={label.y - 9 / z} width={24 / z} height={18 / z} rx={5 / z} strokeWidth={1 / z}/>
        <text x={label.x} y={label.y + .5 / z} dominantBaseline="central" textAnchor="middle" fontSize={10 / z}>D{index + 1}</text>
      </g>
    </g>;
  })}</g>;
}
