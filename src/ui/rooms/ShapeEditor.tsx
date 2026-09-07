/**
 * ShapeEditor: how the user describes a room's outline. Four modes, all writing `room.shape`:
 * rectangle, L-shape, rectangle with wall features (bays / alcoves / chimney breasts), and a free
 * polygon entered either by "walking the walls" or as an editable point list.
 */
import { useState } from 'react';
import type { Doorway, Mm, Polygon, Room, RoomShape, WallFeature } from '@engine/types';
import { boundingBox, edgeLength, polygonAreaM2, polygonPerimeter, rectanglePolygon, walkToPolygon } from '@engine/geometry';
import { useProjectStore } from '@store/projectStore';
import { newId } from '@store/ids';
import { Field, LengthInput, Select, formatArea, formatLength } from '@ui/components/inputs';
import { safePolygon } from './RoomPreview';

type DisplayUnit = 'metric' | 'imperial';
type ShapeKind = RoomShape['kind'];
type Wall = WallFeature['wall'];

export const SHAPE_KIND_OPTIONS: { value: ShapeKind; label: string }[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'l_shape', label: 'L-shape' },
  { value: 'rectangle_with_features', label: 'Rectangle with bays, alcoves or chimney breast' },
  { value: 'polygon', label: 'Walk the walls / any outline' },
];

const WALL_OPTIONS: { value: Wall; label: string }[] = [
  { value: 'top', label: 'Top wall' },
  { value: 'right', label: 'Right wall' },
  { value: 'bottom', label: 'Bottom wall' },
  { value: 'left', label: 'Left wall' },
];

const CORNER_OPTIONS: { value: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; label: string }[] = [
  { value: 'top-left', label: 'Top-left' },
  { value: 'top-right', label: 'Top-right' },
  { value: 'bottom-left', label: 'Bottom-left' },
  { value: 'bottom-right', label: 'Bottom-right' },
];

/** Quick-add wall features. Depth: positive projects OUT of the room, negative comes INTO it. */
export const FEATURE_PRESETS: { label: string; width: Mm; depth: Mm }[] = [
  { label: 'Bay window', width: 2400, depth: 600 },
  { label: 'Alcove', width: 900, depth: 300 },
  { label: 'Chimney breast', width: 1400, depth: -350 },
  { label: 'Door recess', width: 900, depth: 150 },
  { label: 'Wardrobe recess', width: 1800, depth: 600 },
];

export const RECTANGLE_HINT =
  'Measure at the longest and widest points, into door thresholds and bays. The fitting allowance is added automatically.';

const KIND_HINT =
  'Changing the type converts the outline to the nearest equivalent. A rectangle keeps only the overall size, so bays, alcoves and cut-outs are lost; check the doorway edges afterwards.';

/**
 * Convert a shape to another kind, keeping as much as makes sense:
 * rectangle -> polygon keeps the corners, polygon -> rectangle keeps the bounding box,
 * L-shape -> features becomes one recess into the room.
 */
export function convertShape(shape: RoomShape, kind: ShapeKind): RoomShape {
  if (shape.kind === kind) return shape;
  const poly = safePolygon(shape);
  const bb = poly.length >= 3 ? boundingBox(poly) : { length: 4000, width: 3000 };
  const L = Math.max(1, Math.round(bb.length));
  const W = Math.max(1, Math.round(bb.width));
  switch (kind) {
    case 'rectangle':
      return { kind: 'rectangle', length: L, width: W };
    case 'l_shape':
      return { kind: 'l_shape', length: L, width: W, cutoutLength: Math.round(L / 3), cutoutWidth: Math.round(W / 3), cutoutCorner: 'top-right' };
    case 'rectangle_with_features': {
      if (shape.kind === 'l_shape') {
        const l = Math.min(Math.max(shape.cutoutLength, 0), shape.length);
        const w = Math.min(Math.max(shape.cutoutWidth, 0), shape.width);
        // The cut-out is a recess into the room on the top or bottom wall; walls run clockwise from top-left.
        const onTop = shape.cutoutCorner.startsWith('top');
        const atStart = shape.cutoutCorner === 'top-left' || shape.cutoutCorner === 'bottom-right';
        const feature: WallFeature = {
          id: newId('feat'),
          wall: onTop ? 'top' : 'bottom',
          offset: atStart ? 0 : shape.length - l,
          width: l,
          depth: -w,
          label: 'Cut-out',
        };
        return { kind, length: shape.length, width: shape.width, features: l > 0 && w > 0 ? [feature] : [] };
      }
      return { kind, length: L, width: W, features: [] };
    }
    case 'polygon':
      return { kind: 'polygon', points: poly.length >= 3 ? poly : rectanglePolygon(L, W) };
  }
}

/**
 * Move the doorways onto an outline that has a different number of walls.
 *
 * A doorway records an edge INDEX, so an 8-wall room converted to a 4-wall rectangle would leave
 * indices 4-7 pointing at nothing; the engine reports them and leaves them out of the quantities,
 * but the fitter would rather they landed somewhere sensible. Each doorway keeps the wall it can
 * still reach (its index, if it exists and is long enough) and is otherwise clamped to the last
 * wall, with its offset pulled back so the opening still fits.
 */
export function remapDoorways(doorways: Doorway[], next: Polygon): Doorway[] {
  if (next.length < 3) return doorways;
  return doorways.map((d) => {
    const edgeIndex = d.edgeIndex >= 0 && d.edgeIndex < next.length ? d.edgeIndex : next.length - 1;
    const len = edgeLength(next, edgeIndex);
    const offset = Math.max(0, Math.min(d.offset, Math.max(0, len - d.width)));
    return edgeIndex === d.edgeIndex && offset === d.offset ? d : { ...d, edgeIndex, offset };
  });
}

export function ShapeEditor({ room, unit, onShapeChange, showFigures = true }: { room: Room; unit: DisplayUnit; onShapeChange?: (shape: RoomShape, doorways?: Doorway[]) => void; showFigures?: boolean }) {
  const updateRoom = useProjectStore((s) => s.updateRoom);
  const select = useProjectStore((s) => s.select);
  const setTab = useProjectStore((s) => s.setTab);
  const sourceAvailable = useProjectStore((s) => s.project.floorPlans.some((plan) => plan.id === room.source?.floorPlanId));
  const shape = room.shape;
  const setShape = (next: RoomShape) => {
    // Length fields also commit on blur. An unchanged measurement must keep its trace position.
    if (JSON.stringify(next) === JSON.stringify(shape)) return;
    if (onShapeChange) onShapeChange(next);
    else updateRoom(room.id, { shape: next, source: undefined });
  };
  const [polygonMode, setPolygonMode] = useState<'points' | 'walk'>('points');

  const onKind = (kind: ShapeKind) => {
    if (kind === shape.kind) return;
    const next = convertShape(shape, kind);
    // Changing the shape changes the walls; doorways must follow or they are silently orphaned.
    if (onShapeChange) onShapeChange(next, remapDoorways(room.doorways, safePolygon(next)));
    else updateRoom(room.id, (r) => ({ ...r, shape: next, source: undefined, doorways: remapDoorways(r.doorways, safePolygon(next)) }));
    if (kind === 'polygon') setPolygonMode('walk');
  };

  return (
    <div className="shape-editor">
      {room.source ? <div className="field-hint"><p>Traced from a floor plan. Edit its outline on the plan to keep it positioned. Changing the shape or measurements here removes that plan link.</p>{sourceAvailable ? <button type="button" className="link" onClick={() => { select({ kind: 'room', id: room.id }); setTab('floorplan'); }}>Edit outline on plan</button> : <p>The source plan is no longer in this project.</p>}</div> : null}
      <Field label="Shape type" hint={KIND_HINT}>
        <Select value={shape.kind} onChange={onKind} options={SHAPE_KIND_OPTIONS} ariaLabel="Shape type" />
      </Field>

      {shape.kind === 'rectangle' ? (
        <RectangleForm shape={shape} unit={unit} onChange={setShape} onAddFeature={() => onKind('rectangle_with_features')} />
      ) : null}
      {shape.kind === 'l_shape' ? <LShapeForm shape={shape} unit={unit} onChange={setShape} /> : null}
      {shape.kind === 'rectangle_with_features' ? <FeaturesForm shape={shape} unit={unit} onChange={setShape} /> : null}
      {shape.kind === 'polygon' ? (
        <PolygonForm shape={shape} unit={unit} onChange={setShape} mode={polygonMode} setMode={setPolygonMode} />
      ) : null}

      {showFigures ? <ShapeFigures shape={shape} unit={unit} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rectangle
// ---------------------------------------------------------------------------

function RectangleForm({
  shape,
  unit,
  onChange,
  onAddFeature,
}: {
  shape: Extract<RoomShape, { kind: 'rectangle' }>;
  unit: DisplayUnit;
  onChange: (s: RoomShape) => void;
  onAddFeature: () => void;
}) {
  return (
    <div>
      <div className="grid-2">
        <Field label="Length">
          <LengthInput value={shape.length} unit={unit} min={1} ariaLabel="Room length" onChange={(length) => onChange({ ...shape, length })} />
        </Field>
        <Field label="Width">
          <LengthInput value={shape.width} unit={unit} min={1} ariaLabel="Room width" onChange={(width) => onChange({ ...shape, width })} />
        </Field>
      </div>
      <p className="field-hint">{RECTANGLE_HINT}</p>
      <button type="button" className="link small" onClick={onAddFeature}>
        Add a bay window, alcove or chimney breast…
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// L-shape
// ---------------------------------------------------------------------------

function LShapeForm({ shape, unit, onChange }: { shape: Extract<RoomShape, { kind: 'l_shape' }>; unit: DisplayUnit; onChange: (s: RoomShape) => void }) {
  const tooBig = shape.cutoutLength >= shape.length || shape.cutoutWidth >= shape.width;
  return (
    <div>
      <div className="grid-2">
        <Field label="Overall length">
          <LengthInput value={shape.length} unit={unit} min={1} ariaLabel="Overall length" onChange={(length) => onChange({ ...shape, length })} />
        </Field>
        <Field label="Overall width">
          <LengthInput value={shape.width} unit={unit} min={1} ariaLabel="Overall width" onChange={(width) => onChange({ ...shape, width })} />
        </Field>
        <Field label="Cut-out length" hint="Along the length">
          <LengthInput value={shape.cutoutLength} unit={unit} min={0} ariaLabel="Cut-out length" onChange={(cutoutLength) => onChange({ ...shape, cutoutLength })} />
        </Field>
        <Field label="Cut-out width" hint="Along the width">
          <LengthInput value={shape.cutoutWidth} unit={unit} min={0} ariaLabel="Cut-out width" onChange={(cutoutWidth) => onChange({ ...shape, cutoutWidth })} />
        </Field>
        <Field label="Cut-out corner" hint="The corner that is not part of the room, e.g. where a hallway or bathroom takes a corner out of a bedroom.">
          <Select value={shape.cutoutCorner} options={CORNER_OPTIONS} ariaLabel="Cut-out corner" onChange={(cutoutCorner) => onChange({ ...shape, cutoutCorner })} />
        </Field>
      </div>
      <p className="field-hint">Measure the overall rectangle at the longest and widest points, then the size of the missing corner.</p>
      {tooBig ? <p className="field-hint invalid">The cut-out must be smaller than the overall room in both directions.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rectangle with wall features
// ---------------------------------------------------------------------------

function wallLength(shape: { length: Mm; width: Mm }, wall: Wall): Mm {
  return wall === 'top' || wall === 'bottom' ? shape.length : shape.width;
}

/** Two features on the same wall whose spans overlap: the engine keeps only the first, so warn. */
function overlapsAnother(f: WallFeature, all: WallFeature[]): boolean {
  return all.some((g) => g.id !== f.id && g.wall === f.wall && f.offset < g.offset + g.width && g.offset < f.offset + f.width);
}

/**
 * Where to put a new feature of `width`: centred on the first wall (clockwise from the top) that has
 * no features yet, otherwise in the first gap that fits; failing that at the start of the top wall.
 */
export function findFeatureSlot(shape: { length: Mm; width: Mm; features: WallFeature[] }, width: Mm): { wall: Wall; offset: Mm } {
  const walls: Wall[] = ['top', 'right', 'bottom', 'left'];
  for (const wall of walls) {
    const wl = wallLength(shape, wall);
    const taken = shape.features.filter((f) => f.wall === wall).sort((a, b) => a.offset - b.offset);
    if (taken.length === 0) {
      if (width <= wl) return { wall, offset: Math.max(0, Math.round((wl - width) / 2)) };
      continue;
    }
    let cursor = 0;
    for (const f of taken) {
      if (f.offset - cursor >= width) return { wall, offset: cursor };
      cursor = Math.max(cursor, f.offset + f.width);
    }
    if (wl - cursor >= width) return { wall, offset: cursor };
  }
  return { wall: 'top', offset: 0 };
}

function FeaturesForm({
  shape,
  unit,
  onChange,
}: {
  shape: Extract<RoomShape, { kind: 'rectangle_with_features' }>;
  unit: DisplayUnit;
  onChange: (s: RoomShape) => void;
}) {
  const setFeatures = (features: WallFeature[]) => onChange({ ...shape, features });
  const updateFeature = (id: string, patch: Partial<WallFeature>) => setFeatures(shape.features.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const addFeature = (width: Mm, depth: Mm, label: string) => {
    const { wall, offset } = findFeatureSlot(shape, width);
    setFeatures([...shape.features, { id: newId('feat'), wall, offset, width, depth, label }]);
  };

  return (
    <div>
      <div className="grid-2">
        <Field label="Base length" hint="The main rectangle, without bays or recesses">
          <LengthInput value={shape.length} unit={unit} min={1} ariaLabel="Base length" onChange={(length) => onChange({ ...shape, length })} />
        </Field>
        <Field label="Base width">
          <LengthInput value={shape.width} unit={unit} min={1} ariaLabel="Base width" onChange={(width) => onChange({ ...shape, width })} />
        </Field>
      </div>

      <div className="presets" role="group" aria-label="Quick-add wall features">
        {FEATURE_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => addFeature(p.width, p.depth, p.label)}>
            + {p.label}
          </button>
        ))}
        <button type="button" onClick={() => addFeature(1000, 300, '')}>
          + Custom feature
        </button>
      </div>

      {shape.features.length === 0 ? (
        <div className="empty small">No wall features yet. Use the buttons above to add a bay, alcove or chimney breast.</div>
      ) : (
        <div className="table-scroll">
          <table className="data features-table">
            <thead>
              <tr>
                <th scope="col">Wall</th>
                <th scope="col">Offset</th>
                <th scope="col">Width</th>
                <th scope="col">Depth</th>
                <th scope="col">Direction</th>
                <th scope="col">Label</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shape.features.map((f) => {
                const wl = wallLength(shape, f.wall);
                const overrun = f.offset + f.width > wl;
                const overlap = overlapsAnother(f, shape.features);
                // A recess cannot be deeper than the room: the wall would come out through the far
                // side. The engine clamps it and warns, but say so where it is typed.
                const depthLimit = f.wall === 'top' || f.wall === 'bottom' ? shape.width : shape.length;
                const tooDeep = f.depth < 0 && -f.depth > depthLimit;
                return (
                  <tr key={f.id} data-feature-id={f.id}>
                    <td>
                      <Select value={f.wall} options={WALL_OPTIONS} ariaLabel="Wall" onChange={(wall) => updateFeature(f.id, { wall })} />
                    </td>
                    <td>
                      <LengthInput value={f.offset} unit={unit} min={0} ariaLabel="Feature offset" onChange={(offset) => updateFeature(f.id, { offset })} />
                      {overrun ? <div className="field-hint invalid">Extends past the end of the wall ({formatLength(wl, unit)}).</div> : null}
                      {overlap ? <div className="field-hint invalid">Overlaps another feature on this wall; only the first is used.</div> : null}
                    </td>
                    <td>
                      <LengthInput value={f.width} unit={unit} min={1} ariaLabel="Feature width" onChange={(width) => updateFeature(f.id, { width })} />
                    </td>
                    <td>
                      <LengthInput
                        value={Math.abs(f.depth)}
                        unit={unit}
                        min={0}
                        ariaLabel="Feature depth"
                        onChange={(d) => updateFeature(f.id, { depth: f.depth < 0 ? -d : d })}
                      />
                      {tooDeep ? (
                        <div className="field-hint invalid">Deeper than the room ({formatLength(depthLimit, unit)}); it is cut back to the opposite wall.</div>
                      ) : null}
                    </td>
                    <td>
                      <Select
                        value={f.depth < 0 ? 'in' : 'out'}
                        options={[
                          { value: 'out', label: 'Out of the room (bay, alcove)' },
                          { value: 'in', label: 'Into the room (chimney breast)' },
                        ]}
                        ariaLabel="Feature direction"
                        onChange={(dir) => updateFeature(f.id, { depth: dir === 'in' ? -Math.abs(f.depth) : Math.abs(f.depth) })}
                      />
                    </td>
                    <td>
                      <input type="text" className="cell-text" aria-label="Feature label" value={f.label ?? ''} onChange={(e) => updateFeature(f.id, { label: e.target.value })} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          // no undo anywhere in the app; the row holds a measured width and depth
                          if (window.confirm(`Remove "${f.label ?? 'this feature'}"? Its measured width and depth are lost.`)) {
                            setFeatures(shape.features.filter((x) => x.id !== f.id));
                          }
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="field-hint">
        Walls run clockwise from the top-left corner; the offset is measured from the start of the wall (top and bottom walls from the left, left
        and right walls from the top). Depth is stored as a signed number: positive projects out of the room (bay window, alcove, door recess),
        negative comes into the room (chimney breast, pillar).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Polygon: walk the walls, or edit points
// ---------------------------------------------------------------------------

interface WalkSegment {
  id: string;
  turn: 'straight' | 'left' | 'right';
  length: Mm;
}

const TURN_OPTIONS: { value: WalkSegment['turn']; label: string }[] = [
  { value: 'straight', label: 'Straight on' },
  { value: 'right', label: 'Turn right' },
  { value: 'left', label: 'Turn left' },
];

/** Where a walk ends relative to its start (before normalisation), to tell the user about the implied closing wall. */
function walkEndPoint(segments: WalkSegment[]): { x: Mm; y: Mm } {
  let heading = 0;
  let x = 0;
  let y = 0;
  for (const s of segments) {
    if (s.turn === 'right') heading = (heading + 1) % 4;
    else if (s.turn === 'left') heading = (heading + 3) % 4;
    if (heading === 0) x += s.length;
    else if (heading === 1) y += s.length;
    else if (heading === 2) x -= s.length;
    else y -= s.length;
  }
  return { x, y };
}

function PolygonForm({
  shape,
  unit,
  onChange,
  mode,
  setMode,
}: {
  shape: Extract<RoomShape, { kind: 'polygon' }>;
  unit: DisplayUnit;
  onChange: (s: RoomShape) => void;
  mode: 'points' | 'walk';
  setMode: (m: 'points' | 'walk') => void;
}) {
  return (
    <div>
      <div className="mode-toggle" role="group" aria-label="Outline entry method">
        <button type="button" aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>
          Walk the walls
        </button>
        <button type="button" aria-pressed={mode === 'points'} onClick={() => setMode('points')}>
          Edit points (x, y)
        </button>
      </div>
      {mode === 'walk' ? <WalkTheWalls unit={unit} onChange={onChange} /> : <PointsTable points={shape.points} unit={unit} onChange={onChange} />}
    </div>
  );
}

function WalkTheWalls({ unit, onChange }: { unit: DisplayUnit; onChange: (s: RoomShape) => void }) {
  const [segments, setSegments] = useState<WalkSegment[]>([]);

  const apply = (next: WalkSegment[]) => {
    setSegments(next);
    const valid = next.filter((s) => s.length > 0);
    const points = walkToPolygon(valid);
    if (points.length >= 3) onChange({ kind: 'polygon', points });
  };
  const update = (id: string, patch: Partial<WalkSegment>) => apply(segments.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const add = () => apply([...segments, { id: newId('wall'), turn: segments.length === 0 ? 'straight' : 'right', length: 1000 }]);

  const end = walkEndPoint(segments.filter((s) => s.length > 0));
  const closingGap = Math.hypot(end.x, end.y);
  const validCount = segments.filter((s) => s.length > 0).length;

  return (
    <div>
      <p className="field-hint">
        Start in any corner, facing along the top wall (left to right on the plan). For each wall in turn: which way you turn at the corner,
        then how far you walk. The final wall back to where you started is implied.
      </p>
      {segments.length === 0 ? <div className="empty small">No walls yet. The current outline is kept until you add at least three walls.</div> : null}
      {segments.length > 0 ? (
        <div className="table-scroll">
          <table className="data walk-table">
            <thead>
              <tr>
                <th scope="col">Wall</th>
                <th scope="col">At the corner</th>
                <th scope="col">Length</th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s, i) => (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td>
                    <Select value={s.turn} options={TURN_OPTIONS} ariaLabel={`Wall ${i + 1} turn`} onChange={(turn) => update(s.id, { turn })} />
                  </td>
                  <td>
                    <LengthInput value={s.length} unit={unit} min={0} ariaLabel={`Wall ${i + 1} length`} onChange={(length) => update(s.id, { length })} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (window.confirm(`Remove wall ${i + 1}? Its measured length is lost.`)) apply(segments.filter((x) => x.id !== s.id));
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="row" style={{ marginTop: '.5rem' }}>
        <button type="button" onClick={add}>
          + Add wall
        </button>
        <span className="field-hint" aria-live="polite">
          {validCount < 2
            ? 'Add at least three walls (the last one back to the start is implied).'
            : closingGap < 1
              ? 'Outline closed: you are back at the start.'
              : `Implied closing wall of ${formatLength(closingGap, unit)} back to the start.`}
        </span>
      </div>
    </div>
  );
}

function PointsTable({ points, unit, onChange }: { points: Polygon; unit: DisplayUnit; onChange: (s: RoomShape) => void }) {
  const setPoints = (next: Polygon) => onChange({ kind: 'polygon', points: next });
  const setPoint = (i: number, patch: Partial<{ x: Mm; y: Mm }>) => setPoints(points.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addPoint = () => {
    const last = points[points.length - 1] ?? { x: 0, y: 0 };
    const first = points[0] ?? { x: 0, y: 0 };
    setPoints([...points, { x: Math.round((last.x + first.x) / 2), y: Math.round((last.y + first.y) / 2) }]);
  };
  return (
    <div>
      <p className="field-hint">
        Corners in order around the room (either direction); x runs along the length, y along the width, from the top-left of the plan. The
        outline closes from the last point back to the first.
      </p>
      <div className="table-scroll">
        <table className="data points-table">
          <thead>
            <tr>
              <th scope="col">Point</th>
              <th scope="col">x</th>
              <th scope="col">y</th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <LengthInput value={p.x} unit={unit} min={0} ariaLabel={`Point ${i + 1} x`} onChange={(x) => setPoint(i, { x })} />
                </td>
                <td>
                  <LengthInput value={p.y} unit={unit} min={0} ariaLabel={`Point ${i + 1} y`} onChange={(y) => setPoint(i, { y })} />
                </td>
                <td>
                  <button
                    type="button"
                    className="danger"
                    disabled={points.length <= 3}
                    onClick={() => {
                      if (window.confirm(`Remove corner ${i + 1}? Its measured position is lost.`)) setPoints(points.filter((_, j) => j !== i));
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: '.5rem' }}>
        <button type="button" onClick={addPoint}>
          + Add point
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live figures
// ---------------------------------------------------------------------------

export function ShapeFigures({ shape, unit }: { shape: RoomShape; unit: DisplayUnit }) {
  const poly = safePolygon(shape);
  if (poly.length < 3) {
    return (
      <div className="figures" aria-live="polite">
        <span>Outline incomplete: at least three corners are needed.</span>
      </div>
    );
  }
  const bb = boundingBox(poly);
  return (
    <div className="figures" aria-live="polite">
      <span>
        Net area <b data-testid="figure-area">{formatArea(polygonAreaM2(poly), unit)}</b>
      </span>
      <span>
        Perimeter <b data-testid="figure-perimeter">{formatLength(polygonPerimeter(poly), unit)}</b>
      </span>
      <span>
        Overall <b data-testid="figure-bbox">{formatLength(bb.length, unit)} × {formatLength(bb.width, unit)}</b>
      </span>
      <span className="muted">({poly.length} corners)</span>
    </div>
  );
}
