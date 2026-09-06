/**
 * RoomEditor: the main editor for one room. Basics (name, product, notes), shape with a live plan,
 * doorways, subfloor, and collapsed per-room planning overrides. All state lives in the project store.
 */
import type { BroadloomPlanningOptions, CoveringKind, HardFloorOptions, LayPattern, PileDirection, Product, Room, SeamPolicy } from '@engine/types';
import { isBroadloom } from '@engine/types';
import { useProjectStore } from '@store/projectStore';
import { Field, Section, Select, formatLength } from '@ui/components/inputs';
import { ShapeEditor } from './ShapeEditor';
import { DoorwaysEditor } from './DoorwaysEditor';
import { SubfloorEditor } from './SubfloorEditor';
import { RoomPreview } from './RoomPreview';

type DisplayUnit = 'metric' | 'imperial';

const KIND_LABELS: Record<CoveringKind, string> = {
  carpet: 'Carpet',
  sheet_vinyl: 'Sheet vinyl',
  laminate: 'Laminate',
  engineered_wood: 'Engineered wood',
  lvt_click: 'LVT (click)',
  lvt_glue: 'LVT (glue-down)',
  carpet_tiles: 'Carpet tiles',
};

function productLabel(p: Product, unit: DisplayUnit): string {
  const supply = 'rollWidth' in p ? `${formatLength(p.rollWidth, unit)} roll` : `${p.packCoverageM2} m² per pack`;
  return `${p.name} — ${KIND_LABELS[p.kind]}, ${supply}`;
}

export function RoomEditor({ roomId }: { roomId: string }) {
  const room = useProjectStore((s) => s.project.rooms.find((r) => r.id === roomId));
  const products = useProjectStore((s) => s.project.products);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const options = useProjectStore((s) => s.project.options);
  const updateRoom = useProjectStore((s) => s.updateRoom);
  const duplicateRoom = useProjectStore((s) => s.duplicateRoom);
  const removeRoom = useProjectStore((s) => s.removeRoom);

  if (!room) {
    return (
      <div className="panel">
        <div className="empty">This room no longer exists. Pick another room from the list on the left, or add a new one.</div>
      </div>
    );
  }

  const product = products.find((p) => p.id === room.productId);
  const productOptions = [
    ...(product ? [] : [{ value: '', label: 'Choose a product…', disabled: true }]),
    ...products.map((p) => ({ value: p.id, label: productLabel(p, unit) })),
  ];
  const broadloom = product ? isBroadloom(product.kind) : false;
  const effectivePile = room.planning?.pileDirection ?? options.broadloom.pileDirection;
  const pileArrow = broadloom && effectivePile !== 'auto' ? effectivePile : undefined;

  return (
    <div className="panel room-editor" key={room.id}>
      <div className="room-title">
        <h2>{room.name || 'Untitled room'}</h2>
        <span className="section-actions">
          <button type="button" onClick={() => duplicateRoom(room.id)}>
            Duplicate
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (window.confirm(`Delete "${room.name}"? This cannot be undone.`)) removeRoom(room.id);
            }}
          >
            Delete
          </button>
        </span>
      </div>

      <Section title="Basics">
        <div className="grid-2">
          <Field label="Room name">
            <input type="text" aria-label="Room name" value={room.name} onChange={(e) => updateRoom(room.id, { name: e.target.value })} />
          </Field>
          <Field label="Product" hint={product ? undefined : 'Add products under Materials & options.'}>
            <Select value={room.productId} options={productOptions} ariaLabel="Product" onChange={(productId) => updateRoom(room.id, { productId })} />
          </Field>
        </div>
        <Field label="Notes" hint="Shown on the quote, e.g. access, furniture to move, doors to ease.">
          <textarea aria-label="Room notes" rows={2} value={room.notes ?? ''} onChange={(e) => updateRoom(room.id, { notes: e.target.value })} />
        </Field>
      </Section>

      <Section title="Shape">
        <div className="shape-layout">
          <div>
            <ShapeEditor key={room.id} room={room} unit={unit} />
          </div>
          <div className="shape-preview">
            <RoomPreview room={room} unit={unit} showPileArrow={pileArrow} />
            <p className="field-hint">Circled numbers are the edge numbers used in the doorway table; blue bars are doorways.</p>
          </div>
        </div>
      </Section>

      <Section title="Doorways">
        <DoorwaysEditor room={room} unit={unit} />
      </Section>

      <Section title="Subfloor">
        <SubfloorEditor room={room} />
      </Section>

      <Section title="Planning overrides" collapsible defaultOpen={false}>
        <PlanningOverrides room={room} product={product} options={options} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Planning overrides (undefined = project default)
// ---------------------------------------------------------------------------

const PILE_LABELS: Record<PileDirection, string> = {
  auto: 'automatic, least waste',
  along_length: 'along the length',
  along_width: 'along the width',
};
const SEAM_LABELS: Record<SeamPolicy, string> = {
  min_seams: 'fewest seams',
  balanced: 'balanced',
  min_waste: 'least waste',
};
const PATTERN_LABELS: Record<LayPattern, string> = {
  straight: 'Straight',
  random_stagger: 'Random stagger',
  brick: 'Brick bond',
  diagonal: 'Diagonal',
  herringbone: 'Herringbone',
  chevron: 'Chevron',
};

const DEFAULT = 'default';

function PlanningOverrides({ room, product, options }: { room: Room; product: Product | undefined; options: { broadloom: BroadloomPlanningOptions; hardFloor: HardFloorOptions } }) {
  const updateRoom = useProjectStore((s) => s.updateRoom);

  const setPlanning = <K extends keyof BroadloomPlanningOptions>(key: K, value: BroadloomPlanningOptions[K] | undefined) =>
    updateRoom(room.id, (r) => {
      const next: Partial<BroadloomPlanningOptions> = { ...(r.planning ?? {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      const { planning: _drop, ...rest } = r;
      return Object.keys(next).length ? { ...rest, planning: next } : rest;
    });

  const setHardFloor = <K extends keyof HardFloorOptions>(key: K, value: HardFloorOptions[K] | undefined) =>
    updateRoom(room.id, (r) => {
      const next: Partial<HardFloorOptions> = { ...(r.hardFloor ?? {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      const { hardFloor: _drop, ...rest } = r;
      return Object.keys(next).length ? { ...rest, hardFloor: next } : rest;
    });

  if (!product) return <p className="field-hint">Choose a product first; the overrides depend on whether it comes off a roll or in packs.</p>;

  if (isBroadloom(product.kind)) {
    const pileOptions: { value: PileDirection | typeof DEFAULT; label: string }[] = [
      { value: DEFAULT, label: `Project default (${PILE_LABELS[options.broadloom.pileDirection]})` },
      { value: 'auto', label: 'Automatic (least waste)' },
      { value: 'along_length', label: 'Along the length' },
      { value: 'along_width', label: 'Along the width' },
    ];
    const seamOptions: { value: SeamPolicy | typeof DEFAULT; label: string }[] = [
      { value: DEFAULT, label: `Project default (${SEAM_LABELS[options.broadloom.seamPolicy]})` },
      { value: 'min_seams', label: 'Fewest seams (full-length strips only)' },
      { value: 'balanced', label: 'Balanced (cross joins only when they save carpet)' },
      { value: 'min_waste', label: 'Least waste (cross joins allowed)' },
    ];
    return (
      <div className="grid-2">
        <Field label="Pile direction" hint="Which way the roll length runs in this room. Every piece keeps the same orientation; match the room next door if the carpet continues through.">
          <Select
            value={room.planning?.pileDirection ?? DEFAULT}
            options={pileOptions}
            ariaLabel="Pile direction"
            onChange={(v) => setPlanning('pileDirection', v === DEFAULT ? undefined : v)}
          />
        </Field>
        <Field label="Seam policy" hint="Trade-off between the number of seams and the amount of carpet ordered.">
          <Select
            value={room.planning?.seamPolicy ?? DEFAULT}
            options={seamOptions}
            ariaLabel="Seam policy"
            onChange={(v) => setPlanning('seamPolicy', v === DEFAULT ? undefined : v)}
          />
        </Field>
      </div>
    );
  }

  const patternOptions: { value: LayPattern | typeof DEFAULT; label: string }[] = [
    { value: DEFAULT, label: `Project default (${PATTERN_LABELS[options.hardFloor.layPattern]})` },
    ...(Object.keys(PATTERN_LABELS) as LayPattern[]).map((p) => ({ value: p, label: PATTERN_LABELS[p] })),
  ];
  const beadingOptions: { value: 'beading' | 'refit' | typeof DEFAULT; label: string }[] = [
    { value: DEFAULT, label: `Project default (${options.hardFloor.useBeading ? 'beading / scotia' : 'refit skirting'})` },
    { value: 'beading', label: 'Beading / scotia over the expansion gap' },
    { value: 'refit', label: 'Remove and refit the skirting' },
  ];
  const beadingValue = room.hardFloor?.useBeading === undefined ? DEFAULT : room.hardFloor.useBeading ? 'beading' : 'refit';
  return (
    <div className="grid-2">
      <Field label="Lay pattern" hint="Diagonal, herringbone and chevron layouts need more wastage than a straight lay.">
        <Select
          value={room.hardFloor?.layPattern ?? DEFAULT}
          options={patternOptions}
          ariaLabel="Lay pattern"
          onChange={(v) => setHardFloor('layPattern', v === DEFAULT ? undefined : v)}
        />
      </Field>
      <Field label="Expansion gap finish" hint="Beading is quicker; refitting skirting gives a cleaner edge but adds labour.">
        <Select
          value={beadingValue}
          options={beadingOptions}
          ariaLabel="Expansion gap finish"
          onChange={(v) => setHardFloor('useBeading', v === DEFAULT ? undefined : v === 'beading')}
        />
      </Field>
    </div>
  );
}
