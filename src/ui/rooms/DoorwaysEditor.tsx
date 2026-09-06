/**
 * DoorwaysEditor: the openings in a room's walls. Each doorway sits on a polygon edge at an offset
 * from the edge's start; the transition drives door-bar selection and gripper is omitted across it.
 */
import type { Doorway, DoorwayTransition, Polygon, Room, RoomShape } from '@engine/types';
import { edgeLength } from '@engine/geometry';
import { formatFtIn } from '@engine/units';
import { UK_DOOR_WIDTHS } from '@engine/defaults';
import { useProjectStore } from '@store/projectStore';
import { Checkbox, LengthInput, Select, formatLength } from '@ui/components/inputs';
import { safePolygon } from './RoomPreview';

type DisplayUnit = 'metric' | 'imperial';

const TRANSITION_OPTIONS: { value: DoorwayTransition; label: string }[] = [
  { value: 'carpet', label: 'Carpet in the next room' },
  { value: 'hard_floor', label: 'Hard floor (laminate, LVT, tiles, vinyl)' },
  { value: 'same_floor', label: 'Same floor continues' },
  { value: 'external', label: 'External door' },
  { value: 'none', label: 'Opening only (nothing to fix to)' },
];

const RECT_WALLS = ['Top wall', 'Right wall', 'Bottom wall', 'Left wall'];

/** "Top wall (4.00 m)" for plain rectangles, otherwise "Edge 3 (1.20 m)" matching the circled numbers on the plan. */
export function edgeLabel(shape: RoomShape, poly: Polygon, edgeIndex: number, unit: DisplayUnit): string {
  const len = formatLength(edgeLength(poly, edgeIndex), unit);
  const wall = shape.kind === 'rectangle' && poly.length === 4 ? RECT_WALLS[edgeIndex] : undefined;
  return wall ? `${wall} (${len})` : `Edge ${edgeIndex + 1} (${len})`;
}

const DOOR_WIDTH_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Custom width' },
  ...[...UK_DOOR_WIDTHS].sort((a, b) => a - b).map((w) => ({ value: String(w), label: `${w} mm (${formatFtIn(w)})` })),
];

/**
 * The doorways of the OTHER rooms, offered as the far side of a shared opening. A door between two
 * rooms is measured from both (each room's gripper stops at it) but there is one leaf and one bar to
 * buy, so the two entries are linked explicitly. The estimate never guesses this from the labels.
 */
function useSharedOpeningOptions(room: Room): { value: string; label: string }[] {
  const rooms = useProjectStore((s) => s.project.rooms);
  const options = [{ value: '', label: 'Not shared — its own opening' }];
  for (const other of rooms) {
    if (other.id === room.id) continue;
    for (const d of other.doorways) {
      options.push({ value: d.sharedOpeningId?.trim() || `pair:${other.id}:${d.id}`, label: `${other.name} — ${d.label?.trim() || 'doorway'} (${d.width} mm)` });
    }
  }
  return options;
}

export function DoorwaysEditor({ room, unit }: { room: Room; unit: DisplayUnit }) {
  const addDoorway = useProjectStore((s) => s.addDoorway);
  const updateDoorway = useProjectStore((s) => s.updateDoorway);
  const removeDoorway = useProjectStore((s) => s.removeDoorway);
  const updateRoom = useProjectStore((s) => s.updateRoom);
  const rooms = useProjectStore((s) => s.project.rooms);
  const poly = safePolygon(room.shape);
  const edgeOptions = poly.map((_, i) => ({ value: String(i), label: edgeLabel(room.shape, poly, i, unit) }));
  const sharedOptions = useSharedOpeningOptions(room);

  /**
   * Link this doorway to one in another room. A `pair:<roomId>:<doorwayId>` value means the far side
   * has no id yet, so one is minted and written to BOTH doorways; an existing id is simply adopted.
   */
  const setShared = (doorwayId: string, value: string) => {
    if (!value) {
      updateRoom(room.id, (r) => ({
        ...r,
        doorways: r.doorways.map((d) => {
          if (d.id !== doorwayId) return d;
          const { sharedOpeningId: _drop, ...rest } = d;
          return rest;
        }),
      }));
      return;
    }
    if (!value.startsWith('pair:')) {
      updateDoorway(room.id, doorwayId, { sharedOpeningId: value });
      return;
    }
    const [, otherRoomId, otherDoorwayId] = value.split(':');
    const openingId = `opening-${otherDoorwayId}`;
    updateDoorway(room.id, doorwayId, { sharedOpeningId: openingId });
    if (otherRoomId && otherDoorwayId) updateDoorway(otherRoomId, otherDoorwayId, { sharedOpeningId: openingId });
  };

  /** What the doorway is currently linked to, as one of the option values. */
  const sharedValue = (d: Doorway): string => {
    const id = d.sharedOpeningId?.trim();
    if (!id) return '';
    if (sharedOptions.some((o) => o.value === id)) return id;
    // linked to a doorway that has since been deleted: show it as unlinked but keep the stored id
    return rooms.some((r) => r.id !== room.id && r.doorways.some((x) => x.sharedOpeningId?.trim() === id)) ? id : '';
  };

  return (
    <div className="doorways-editor">
      <p className="field-hint">
        Add every opening: doors, archways and open stretches into another room. Gripper is left out across each one and a door bar is
        chosen from what is on the other side. Edge numbers match the circled numbers on the plan. Where you have measured the same
        opening from both rooms, link the two with <b>Shared with</b> so only one bar and one door easing is quoted.
      </p>
      {room.doorways.length === 0 ? <div className="empty small">No doorways. A room with no openings gets gripper all the way round.</div> : null}
      {room.doorways.length > 0 ? (
        <div className="table-scroll">
          <table className="data doorways-table">
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Wall / edge</th>
                <th scope="col">Offset from edge start</th>
                <th scope="col">Opening width</th>
                <th scope="col">Leads to</th>
                <th scope="col">Continuous</th>
                <th scope="col">Shared with</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {room.doorways.map((d) => (
                <DoorwayRow
                  key={d.id}
                  doorway={d}
                  poly={poly}
                  unit={unit}
                  edgeOptions={edgeOptions}
                  sharedOptions={sharedOptions}
                  sharedValue={sharedValue(d)}
                  onShared={(v) => setShared(d.id, v)}
                  onChange={(patch) => updateDoorway(room.id, d.id, patch)}
                  onRemove={() => {
                    // The row deletes a measured opening and there is no undo anywhere in the app.
                    if (window.confirm(`Remove "${d.label?.trim() || 'this doorway'}"? Its position and width are lost.`)) removeDoorway(room.id, d.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="row" style={{ marginTop: '.5rem' }}>
        <button type="button" onClick={() => addDoorway(room.id)}>
          + Add doorway
        </button>
      </div>
    </div>
  );
}

function DoorwayRow({
  doorway: d,
  poly,
  unit,
  edgeOptions,
  sharedOptions,
  sharedValue,
  onShared,
  onChange,
  onRemove,
}: {
  doorway: Doorway;
  poly: Polygon;
  unit: DisplayUnit;
  edgeOptions: { value: string; label: string }[];
  sharedOptions: { value: string; label: string }[];
  sharedValue: string;
  onShared: (value: string) => void;
  onChange: (patch: Partial<Doorway>) => void;
  onRemove: () => void;
}) {
  const edgeMissing = poly.length < 3 || d.edgeIndex < 0 || d.edgeIndex >= poly.length;
  const options = edgeMissing ? [...edgeOptions, { value: String(d.edgeIndex), label: `Edge ${d.edgeIndex + 1} (no longer exists)` }] : edgeOptions;
  const len = edgeMissing ? 0 : edgeLength(poly, d.edgeIndex);
  const overrun = !edgeMissing && d.offset + d.width > len + 0.5;
  const presetValue = UK_DOOR_WIDTHS.includes(d.width) ? String(d.width) : '';
  const isCarpetLike = d.transition === 'carpet' || d.transition === 'same_floor';

  return (
    <tr data-doorway-id={d.id}>
      <td>
        <input type="text" className="cell-text" aria-label="Doorway label" value={d.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} />
      </td>
      <td>
        <Select value={String(d.edgeIndex)} options={options} ariaLabel="Wall or edge" onChange={(v) => onChange({ edgeIndex: Number(v) })} />
        {edgeMissing ? <div className="field-hint invalid">This edge no longer exists after the shape changed; pick another.</div> : null}
      </td>
      <td>
        <LengthInput value={d.offset} unit={unit} min={0} ariaLabel="Offset from edge start" onChange={(offset) => onChange({ offset })} />
        {overrun ? (
          <div className="field-hint invalid" role="status">
            Offset plus width runs past the end of this edge ({formatLength(len, unit)} long).
          </div>
        ) : null}
      </td>
      <td>
        <div className="stack">
          <LengthInput value={d.width} unit={unit} min={1} ariaLabel="Opening width" onChange={(width) => onChange({ width })} />
          <Select
            value={presetValue}
            options={DOOR_WIDTH_OPTIONS}
            ariaLabel="Standard door width"
            onChange={(v) => {
              if (v) onChange({ width: Number(v) });
            }}
          />
        </div>
      </td>
      <td>
        <Select value={d.transition} options={TRANSITION_OPTIONS} ariaLabel="Leads to" onChange={(transition) => onChange({ transition })} />
      </td>
      <td>
        <Checkbox
          checked={d.continuous ?? false}
          disabled={!isCarpetLike}
          label={<span className="small">Same carpet continues through, no door bar</span>}
          onChange={(continuous) => onChange({ continuous })}
        />
      </td>
      <td>
        <Select value={sharedValue} options={sharedOptions} ariaLabel="Shared with" onChange={onShared} />
      </td>
      <td>
        <button type="button" className="danger" onClick={onRemove}>
          Remove
        </button>
      </td>
    </tr>
  );
}
