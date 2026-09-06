/**
 * SubfloorEditor: what the new floor goes down on. Each answer feeds the floor-preparation lines
 * of the estimate (smoothing compound, ply, DPM, uplift and disposal), so every field says what it triggers.
 */
import type { Room, Subfloor, SubfloorCondition, SubfloorType } from '@engine/types';
import { useProjectStore } from '@store/projectStore';
import { Checkbox, Field, Select } from '@ui/components/inputs';

const TYPE_OPTIONS: { value: SubfloorType; label: string }[] = [
  { value: 'concrete', label: 'Concrete / sand-cement screed' },
  { value: 'anhydrite', label: 'Anhydrite (calcium sulphate) screed' },
  { value: 'floorboards', label: 'Timber floorboards' },
  { value: 'chipboard', label: 'Chipboard' },
  { value: 'plywood', label: 'Plywood' },
  { value: 'existing_tiles', label: 'Existing tiles' },
  { value: 'existing_vinyl', label: 'Existing vinyl (staying down)' },
  { value: 'asphalt', label: 'Asphalt' },
];

const TYPE_HINTS: Record<SubfloorType, string> = {
  concrete: 'Ground-floor concrete without a known damp-proof membrane gets a moisture test and a surface DPM in the estimate.',
  anhydrite: 'Needs an anhydrite-compatible primer and smoothing compound; cement-based products react with it.',
  floorboards: 'Loose, cupped or gappy boards are overlaid with hardboard or plywood before vinyl, LVT or laminate.',
  chipboard: 'Loose sheets are screwed down; a ply overlay is added for vinyl and LVT.',
  plywood: 'Usually ready to go; joints may need a skim of smoothing compound under vinyl.',
  existing_tiles: 'Grout lines are filled with a smoothing compound before vinyl or LVT; carpet can go straight over.',
  existing_vinyl: 'Old vinyl left in place is primed and skimmed, or overlaid with ply if it is loose or cushioned.',
  asphalt: 'Needs an asphalt-compatible smoothing compound; do not use a liquid DPM over it.',
};

const CONDITION_OPTIONS: { value: SubfloorCondition; label: string }[] = [
  { value: 'good', label: 'Good: flat and sound' },
  { value: 'uneven', label: 'Uneven: dips, ridges or gaps' },
  { value: 'poor', label: 'Poor: loose, crumbling or damaged' },
];

const CONDITION_HINTS: Record<SubfloorCondition, string> = {
  good: 'No preparation beyond a sweep and vacuum.',
  uneven: 'Uneven concrete: smoothing compound suggested. Uneven timber: hardboard or ply overlay suggested.',
  poor: 'Full preparation: smoothing compound or ply overlay plus repairs are added; confirm on site.',
};

const COVERING_OPTIONS: { value: NonNullable<Subfloor['existingCovering']>; label: string }[] = [
  { value: 'none', label: 'Nothing (bare subfloor)' },
  { value: 'carpet', label: 'Carpet' },
  { value: 'vinyl', label: 'Vinyl' },
  { value: 'laminate', label: 'Laminate' },
  { value: 'tiles', label: 'Tiles' },
  { value: 'wood', label: 'Wood' },
];

export function SubfloorEditor({ room }: { room: Room }) {
  const updateRoom = useProjectStore((s) => s.updateRoom);
  const sf = room.subfloor;
  const set = (patch: Partial<Subfloor>) => updateRoom(room.id, { subfloor: { ...sf, ...patch } });
  const concreteLike = sf.type === 'concrete' || sf.type === 'anhydrite' || sf.type === 'asphalt';

  return (
    <div className="subfloor-editor">
      <div className="grid-2">
        <Field label="Subfloor type" hint={TYPE_HINTS[sf.type]}>
          <Select value={sf.type} options={TYPE_OPTIONS} ariaLabel="Subfloor type" onChange={(type) => set({ type })} />
        </Field>
        <Field label="Condition" hint={CONDITION_HINTS[sf.condition]}>
          <Select value={sf.condition} options={CONDITION_OPTIONS} ariaLabel="Subfloor condition" onChange={(condition) => set({ condition })} />
        </Field>
        <Field label="Existing covering to take up" hint="Uplift and disposal are priced per square metre.">
          <Select
            value={sf.existingCovering ?? 'none'}
            options={COVERING_OPTIONS}
            ariaLabel="Existing covering"
            onChange={(existingCovering) => set({ existingCovering })}
          />
        </Field>
        <div className="stack">
          <Checkbox checked={sf.underfloorHeating ?? false} onChange={(underfloorHeating) => set({ underfloorHeating })} label="Underfloor heating" />
          <span className="field-hint">Limits the underlay tog (carpet plus underlay no more than 2.5 tog) and needs UFH-rated products.</span>
          <Checkbox checked={sf.dpmKnown ?? false} onChange={(dpmKnown) => set({ dpmKnown })} label="Damp-proof membrane known to be present" />
          <span className="field-hint">
            {concreteLike
              ? 'Leave unticked if unsure: a moisture test and surface DPM are added for concrete-type floors without a known membrane.'
              : 'Only matters for concrete, anhydrite and asphalt floors.'}
          </span>
          <Checkbox checked={sf.existingGripper ?? false} onChange={(existingGripper) => set({ existingGripper })} label="Existing gripper in place" />
          <span className="field-hint">Sound gripper can often be reused for carpet; it is removed for hard floors and vinyl.</span>
        </div>
      </div>
    </div>
  );
}
