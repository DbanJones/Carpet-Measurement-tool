/**
 * OptionsEditor: project-wide planning defaults. Broadloom cutting policy, underlay, accessories,
 * floor preparation and hard-floor defaults. Rooms can override the broadloom and hard-floor parts
 * individually (see RoomEditor); everything here writes through store.updateOptions.
 */
import type { AccessoryOptions, BroadloomPlanningOptions, FloorPrepOptions, HardFloorOptions, LayPattern, PileDirection, SeamPolicy, UnderlayOptions } from '@engine/types';
import { LAY_PATTERN_WASTAGE, MAX_TOG_WITH_UFH, MAX_UNDERLAY_THICKNESS_ON_STAIRS, PLY_SCREWS_PER_BOX } from '@engine/defaults';
import { useProjectStore } from '@store/projectStore';
import { Field, FieldGroup, LengthInput, NumberInput, Section, Select, formatMoney } from '@ui/components/inputs';
import { UNDERLAY_PRESETS } from './presets';
import { CheckField, MmInput, MoneyInput, PercentInput } from './fields';

type DisplayUnit = 'metric' | 'imperial';

const PILE_OPTIONS: { value: PileDirection; label: string }[] = [
  { value: 'auto', label: 'Automatic (least waste)' },
  { value: 'along_length', label: 'Along the room length' },
  { value: 'along_width', label: 'Along the room width' },
];
const PILE_DESCRIPTIONS: Record<PileDirection, string> = {
  auto: 'The planner tries both directions for every room and keeps the one that uses least carpet.',
  along_length: 'The roll runs down the longest dimension: the usual choice so the pile faces away from the window and door.',
  along_width: 'The roll runs across the room: sometimes avoids a seam when the width is under the roll width.',
};

const SEAM_OPTIONS: { value: SeamPolicy; label: string }[] = [
  { value: 'min_seams', label: 'Fewest seams' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'min_waste', label: 'Least waste' },
];
const SEAM_DESCRIPTIONS: Record<SeamPolicy, string> = {
  min_seams: 'Every fill is one full-length strip with no cross joins. Best finish, most carpet.',
  balanced: 'A fill is cut as shorter strips joined end to end only where that saves at least the threshold below.',
  min_waste: 'Fills may be several shorter strips cut side by side from one cut. Least carpet, more seams to make.',
};

const PATTERN_LABELS: Record<LayPattern, string> = {
  straight: 'Straight',
  random_stagger: 'Random stagger',
  brick: 'Brick bond',
  diagonal: 'Diagonal',
  herringbone: 'Herringbone',
  chevron: 'Chevron',
};
const PATTERN_OPTIONS: { value: LayPattern; label: string }[] = (Object.keys(PATTERN_LABELS) as LayPattern[]).map((p) => ({
  value: p,
  label: `${PATTERN_LABELS[p]} (${Math.round(LAY_PATTERN_WASTAGE[p] * 100)}% wastage)`,
}));

export function OptionsEditor() {
  return (
    <>
      <BroadloomOptionsEditor />
      <UnderlayOptionsEditor />
      <AccessoriesOptionsEditor />
      <FloorPrepOptionsEditor />
      <HardFloorOptionsEditor />
    </>
  );
}

// ---------------------------------------------------------------------------

export function BroadloomOptionsEditor() {
  const o = useProjectStore((s) => s.project.options.broadloom);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const updateOptions = useProjectStore((s) => s.updateOptions);
  const set = (patch: Partial<BroadloomPlanningOptions>) =>
    updateOptions({ broadloom: { ...useProjectStore.getState().project.options.broadloom, ...patch } });

  return (
    <Section title="Broadloom planning" collapsible>
      <p className="muted small">How carpet and sheet vinyl are cut from the roll. Rooms can override these under their planning overrides.</p>
      <div className="grid-2">
        <Field label="Default minimum surplus" hint="Minimum extra over net floor area. Existing cutting waste counts towards it; 0% keeps the calculated layout without extra reserve. Products can override this.">
          <PercentInput value={o.wastageAllowance ?? 0} ariaLabel="Default broadloom wastage allowance" onChange={(wastageAllowance) => set({ wastageAllowance })} />
        </Field>
        <Field label="Pile direction" hint={PILE_DESCRIPTIONS[o.pileDirection]}>
          <Select value={o.pileDirection} options={PILE_OPTIONS} ariaLabel="Pile direction" onChange={(pileDirection) => set({ pileDirection })} />
        </Field>
        <Field label="Seam policy" hint={SEAM_DESCRIPTIONS[o.seamPolicy]}>
          <Select value={o.seamPolicy} options={SEAM_OPTIONS} ariaLabel="Seam policy" onChange={(seamPolicy) => set({ seamPolicy })} />
        </Field>
        <Field label="Length allowance" hint="Added to the length of every cut for trimming to the walls; the trade adds 10 cm.">
          <LengthInput value={o.lengthAllowance} unit={unit} ariaLabel="Length allowance" onChange={(lengthAllowance) => set({ lengthAllowance })} />
        </Field>
        <Field label="Width allowance" hint="Added to the width of fills that do not span the full roll, for the seam trim.">
          <LengthInput value={o.widthAllowance} unit={unit} ariaLabel="Width allowance" onChange={(widthAllowance) => set({ widthAllowance })} />
        </Field>
        <Field label="Balanced threshold" hint="A cross join is accepted only if it saves at least this much carpet (balanced policy).">
          <NumberInput value={o.balancedThresholdM2} min={0} step={0.1} suffix="m²" ariaLabel="Balanced threshold" disabled={o.seamPolicy !== 'balanced'} onChange={(balancedThresholdM2) => set({ balancedThresholdM2 })} />
        </Field>
        <Field label="Usable offcut minimum" hint="Offcuts at least this size both ways are listed as usable (stairs, cupboards).">
          <LengthInput value={o.usableOffcutMin} unit={unit} ariaLabel="Usable offcut minimum" onChange={(usableOffcutMin) => set({ usableOffcutMin })} />
        </Field>
        <Field label="Minimum strip length" hint="Never make a cross-joined strip shorter than this; short bits are hard to stretch in.">
          <LengthInput value={o.minCrossJoinStripLength} unit={unit} ariaLabel="Minimum cross-join strip length" onChange={(minCrossJoinStripLength) => set({ minCrossJoinStripLength })} />
        </Field>
        <Field label="Minimum fill width" hint="Never plan a sliver narrower than this; the seam moves so both pieces are practical.">
          <LengthInput value={o.minFillWidth ?? 300} unit={unit} ariaLabel="Minimum fill width" onChange={(minFillWidth) => set({ minFillWidth })} />
        </Field>
        <Field label="Cross joins per fill" hint="Maximum end-to-end joins in one fill run (2 = at most three strips).">
          <NumberInput value={o.maxCrossJoinsPerFill ?? 2} min={0} max={10} integer ariaLabel="Maximum cross joins per fill" onChange={(maxCrossJoinsPerFill) => set({ maxCrossJoinsPerFill })} />
        </Field>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function UnderlayOptionsEditor() {
  const u = useProjectStore((s) => s.project.options.underlay);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const currency = useProjectStore((s) => s.project.prices.currency);
  const updateOptions = useProjectStore((s) => s.updateOptions);
  const set = (patch: Partial<UnderlayOptions>) => updateOptions({ underlay: { ...useProjectStore.getState().project.options.underlay, ...patch } });
  const rollAreaM2 = (u.rollWidth * u.rollLength) / 1_000_000;
  const perM2 = u.pricePerRoll !== undefined && rollAreaM2 > 0 ? u.pricePerRoll / rollAreaM2 : u.pricePerM2;

  return (
    <Section title="Underlay" collapsible>
      <CheckField checked={u.fit} onChange={(fit) => set({ fit })} label="Fit underlay under carpet" hint="Untick for felt-backed or stick-down carpet; hard floors use their own underlay below." />
      {/* A row of buttons, so FieldGroup: a <label> forwards its activation to the first labelable
          child, and clicking the caption would apply the first preset over six stored settings. */}
      <FieldGroup label="Presets" hint="Common UK underlays; pick one then adjust the roll and price.">
        <span className="presets">
          {UNDERLAY_PRESETS.map((p) => (
            <button key={p.id} type="button" title={p.description} disabled={!u.fit} onClick={() => set(p.values)}>
              {p.label}
            </button>
          ))}
        </span>
      </FieldGroup>
      <div className="grid-2">
        <Field label="Roll width" hint="Carpet underlay is 1.37 m wide; laid across the pile direction.">
          <LengthInput value={u.rollWidth} unit={unit} min={100} ariaLabel="Underlay roll width" disabled={!u.fit} onChange={(rollWidth) => set({ rollWidth })} />
        </Field>
        <Field label="Roll length" hint="11 m (15.07 m²) or 15 m rolls; whole rolls are bought.">
          <LengthInput value={u.rollLength} unit={unit} min={1000} ariaLabel="Underlay roll length" disabled={!u.fit} onChange={(rollLength) => set({ rollLength })} />
        </Field>
        <Field label="Thickness" hint={`Over ${MAX_UNDERLAY_THICKNESS_ON_STAIRS} mm is not recommended on stairs (nosing wear, tuck-in).`}>
          <MmInput value={u.thickness} ariaLabel="Underlay thickness" disabled={!u.fit} onChange={(thickness) => set({ thickness })} />
        </Field>
        <Field label="Tog rating" hint={`Thermal resistance; with underfloor heating carpet plus underlay should stay under ${MAX_TOG_WITH_UFH} tog.`}>
          <NumberInput value={u.tog} min={0} step={0.1} suffix="tog" ariaLabel="Underlay tog" disabled={!u.fit} onChange={(tog) => set({ tog })} />
        </Field>
        <Field label="Price per roll" hint="Supply price of one roll, excluding VAT.">
          <MoneyInput value={u.pricePerRoll} per="per roll" ariaLabel="Underlay price per roll" disabled={!u.fit} onChange={(pricePerRoll) => set({ pricePerRoll })} />
        </Field>
        <Field label="Roll figures" hint="Area of one roll and the resulting price per square metre.">
          <span data-testid="underlay-figures">
            {rollAreaM2.toFixed(2)} m² per roll{perM2 !== undefined ? ` · ${formatMoney(perM2, currency)} per m²` : ''}
          </span>
        </Field>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function AccessoriesOptionsEditor() {
  const a = useProjectStore((s) => s.project.options.accessories);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const updateOptions = useProjectStore((s) => s.updateOptions);
  const set = (patch: Partial<AccessoryOptions>) => updateOptions({ accessories: { ...useProjectStore.getState().project.options.accessories, ...patch } });

  return (
    <Section title="Accessories" collapsible defaultOpen={false}>
      <p className="muted small">Gripper, door bars and tapes. Quantities are worked out from room perimeters, doorways and seams.</p>
      <div className="grid-2">
        <Field label="Gripper length" hint="One length of gripper rod; UK standard is 1.52 m (5 ft).">
          <LengthInput value={a.gripperLength} unit={unit} min={100} ariaLabel="Gripper length" onChange={(gripperLength) => set({ gripperLength })} />
        </Field>
        <Field label="Gripper per pack" hint="Lengths per pack: 10 in a retail pack, 100 in a trade box.">
          <NumberInput value={a.gripperPerPack} min={1} integer ariaLabel="Gripper lengths per pack" onChange={(gripperPerPack) => set({ gripperPerPack })} />
        </Field>
        <Field label="Gripper wastage" hint="Extra for cuts at corners and short walls; 10% is the usual allowance.">
          <PercentInput value={a.gripperWastage} ariaLabel="Gripper wastage" onChange={(gripperWastage) => set({ gripperWastage })} />
        </Field>
        <Field label="Door bar length" hint="Standard bar for internal doors: 0.9 m covers any UK door leaf.">
          <LengthInput value={a.doorBarLength} unit={unit} min={100} ariaLabel="Door bar length" onChange={(doorBarLength) => set({ doorBarLength })} />
        </Field>
        <Field label="Long door bar length" hint="Long bar cut for wide or double openings, usually 2.7 m.">
          <LengthInput value={a.doorBarLongLength} unit={unit} min={100} ariaLabel="Long door bar length" onChange={(doorBarLongLength) => set({ doorBarLongLength })} />
        </Field>
        <Field label="Seaming tape roll" hint="Hot-melt seaming tape per roll; one roll covers this much seam.">
          <LengthInput value={a.seamTapeRollLength} unit={unit} min={1000} ariaLabel="Seaming tape roll length" onChange={(seamTapeRollLength) => set({ seamTapeRollLength })} />
        </Field>
        <Field label="Double-sided tape roll" hint="For vinyl perimeters and seams where it is not fully stuck.">
          <LengthInput value={a.doubleSidedTapeRollLength} unit={unit} min={1000} ariaLabel="Double-sided tape roll length" onChange={(doubleSidedTapeRollLength) => set({ doubleSidedTapeRollLength })} />
        </Field>
        <Field label="Underlay tape roll" hint="Single-sided joining tape over underlay seams; 50 m rolls are usual.">
          <LengthInput value={a.underlayTapeRollLength} unit={unit} min={1000} ariaLabel="Underlay tape roll length" onChange={(underlayTapeRollLength) => set({ underlayTapeRollLength })} />
        </Field>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function FloorPrepOptionsEditor() {
  const f = useProjectStore((s) => s.project.options.floorPrep);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const updateOptions = useProjectStore((s) => s.updateOptions);
  const set = (patch: Partial<FloorPrepOptions>) => updateOptions({ floorPrep: { ...useProjectStore.getState().project.options.floorPrep, ...patch } });
  const bagAtThickness = f.latexThickness > 0 ? f.latexBagCoverageM2PerMm / f.latexThickness : undefined;

  return (
    <Section title="Floor preparation" collapsible defaultOpen={false}>
      <p className="muted small">Material coverages used when a room's subfloor calls for smoothing compound, primer, ply, hardboard or a DPM.</p>
      <h4>Smoothing compound (latex)</h4>
      <div className="grid-2">
        <Field label="Thickness" hint="Depth to allow over an uneven floor; 3 mm is a typical skim.">
          <MmInput value={f.latexThickness} ariaLabel="Latex thickness" onChange={(latexThickness) => set({ latexThickness })} />
        </Field>
        <Field label="Bag coverage" hint={`m² covered by one bag at 1 mm${bagAtThickness ? ` (about ${bagAtThickness.toFixed(1)} m² at ${f.latexThickness} mm)` : ''}.`}>
          <NumberInput value={f.latexBagCoverageM2PerMm} min={0.1} step={0.5} suffix="m² per mm" ariaLabel="Latex bag coverage" onChange={(latexBagCoverageM2PerMm) => set({ latexBagCoverageM2PerMm })} />
        </Field>
        <Field label="Wastage" hint="Extra for dips, feathering and what stays in the bucket.">
          <PercentInput value={f.latexWastage} ariaLabel="Latex wastage" onChange={(latexWastage) => set({ latexWastage })} />
        </Field>
      </div>
      <h4>Primer</h4>
      <div className="grid-2">
        <Field label="Coverage" hint="m² per litre of primer, diluted as the tin says, one coat.">
          <NumberInput value={f.primerCoverageM2PerLitre} min={0.1} step={1} suffix="m² per litre" ariaLabel="Primer coverage" onChange={(primerCoverageM2PerLitre) => set({ primerCoverageM2PerLitre })} />
        </Field>
        <Field label="Coats" hint="One coat on most floors; two on very porous or anhydrite screeds.">
          <NumberInput value={f.primerCoats} min={1} max={4} integer ariaLabel="Primer coats" onChange={(primerCoats) => set({ primerCoats })} />
        </Field>
      </div>
      <h4>Plywood overlay</h4>
      <div className="grid-2">
        <Field label="Sheet length" hint="Flooring-grade WBP ply, 2440 x 1220 mm is the standard sheet.">
          <LengthInput value={f.plySheetLength} unit={unit} min={100} ariaLabel="Ply sheet length" onChange={(plySheetLength) => set({ plySheetLength })} />
        </Field>
        <Field label="Sheet width" hint="Sheet width; 6 mm thick is usual under vinyl and LVT.">
          <LengthInput value={f.plySheetWidth} unit={unit} min={100} ariaLabel="Ply sheet width" onChange={(plySheetWidth) => set({ plySheetWidth })} />
        </Field>
        <Field label="Wastage" hint="Extra sheets for cutting round the room.">
          <PercentInput value={f.plyWastage} ariaLabel="Ply wastage" onChange={(plyWastage) => set({ plyWastage })} />
        </Field>
        <Field label="Screws per sheet" hint={`Ring-shank nails or screws on a 150 mm grid; sold in boxes of ${PLY_SCREWS_PER_BOX}.`}>
          <NumberInput value={f.plyScrewsPerSheet} min={0} integer ariaLabel="Ply screws per sheet" onChange={(plyScrewsPerSheet) => set({ plyScrewsPerSheet })} />
        </Field>
      </div>
      <h4>Hardboard</h4>
      <div className="grid-2">
        <Field label="Sheet length" hint="Hardboard for overlaying sound floorboards under carpet or vinyl.">
          <LengthInput value={f.hardboardSheetLength} unit={unit} min={100} ariaLabel="Hardboard sheet length" onChange={(hardboardSheetLength) => set({ hardboardSheetLength })} />
        </Field>
        <Field label="Sheet width" hint="1220 x 610 mm sheets are easiest to handle; 2440 x 1220 also sold.">
          <LengthInput value={f.hardboardSheetWidth} unit={unit} min={100} ariaLabel="Hardboard sheet width" onChange={(hardboardSheetWidth) => set({ hardboardSheetWidth })} />
        </Field>
      </div>
      <h4>Damp-proof membrane</h4>
      <div className="grid-2">
        <Field label="Liquid DPM coverage" hint="m² per kg of two-pack epoxy over two coats.">
          <NumberInput value={f.liquidDpmCoverageM2PerKg} min={0.1} step={0.05} suffix="m² per kg" ariaLabel="Liquid DPM coverage" onChange={(liquidDpmCoverageM2PerKg) => set({ liquidDpmCoverageM2PerKg })} />
        </Field>
        <Field label="Polythene DPM roll" hint="Area of one roll of 1000-gauge polythene (4 x 25 m = 100 m²).">
          <NumberInput value={f.dpmSheetRollAreaM2} min={1} step={1} suffix="m²" ariaLabel="Polythene DPM roll area" onChange={(dpmSheetRollAreaM2) => set({ dpmSheetRollAreaM2 })} />
        </Field>
        <Field label="Polythene overlap" hint="Extra for 200 mm laps, turning up walls and cutting.">
          <PercentInput value={f.dpmOverlap} ariaLabel="Polythene DPM overlap" onChange={(dpmOverlap) => set({ dpmOverlap })} />
        </Field>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

export function HardFloorOptionsEditor() {
  const h = useProjectStore((s) => s.project.options.hardFloor);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const updateOptions = useProjectStore((s) => s.updateOptions);
  const set = (patch: Partial<HardFloorOptions>) => updateOptions({ hardFloor: { ...useProjectStore.getState().project.options.hardFloor, ...patch } });
  const clearWastage = () => {
    const { wastage: _w, ...rest } = useProjectStore.getState().project.options.hardFloor;
    updateOptions({ hardFloor: rest });
  };
  const patternWastage = LAY_PATTERN_WASTAGE[h.layPattern];
  const overriding = h.wastage !== undefined;
  const effective = h.wastage ?? patternWastage;

  return (
    <Section title="Hard floor defaults" collapsible defaultOpen={false}>
      <p className="muted small">Laminate, wood and LVT. Rooms can override the pattern and wastage individually.</p>
      <div className="grid-2">
        <Field label="Lay pattern" hint="Wastage grows with the pattern: straight 7%, diagonal 15%, herringbone and chevron 20%.">
          <Select value={h.layPattern} options={PATTERN_OPTIONS} ariaLabel="Lay pattern" onChange={(layPattern) => set({ layPattern })} />
        </Field>
        <FieldGroup label="Wastage" hint={overriding ? `Overriding the pattern figure (${Math.round(patternWastage * 100)}%).` : `Using the pattern figure: ${Math.round(effective * 100)}% is added to the net area before packing.`}>
          <span className="row">
            <PercentInput value={effective} ariaLabel="Hard floor wastage" onChange={(wastage) => set({ wastage })} />
            {overriding ? (
              <button type="button" className="link" onClick={clearWastage}>
                Use pattern figure
              </button>
            ) : null}
          </span>
        </FieldGroup>
        <Field label="Expansion gap" hint="Gap left at every wall for the floor to move; 10 mm is standard, more in big rooms.">
          <MmInput value={h.expansionGap} ariaLabel="Expansion gap" onChange={(expansionGap) => set({ expansionGap })} />
        </Field>
        <Field label="Cover the gap with" hint={h.useBeading ? 'Beading or scotia is pinned to the skirting over the gap; quicker, adds beading to the list.' : 'Skirting is removed and refitted over the new floor; neater, more labour, no beading.'}>
          <Select
            value={h.useBeading ? 'beading' : 'skirting'}
            options={[
              { value: 'beading', label: 'Beading / scotia' },
              { value: 'skirting', label: 'Remove and refit skirting' },
            ]}
            ariaLabel="Expansion gap cover"
            onChange={(v) => set({ useBeading: v === 'beading' })}
          />
        </Field>
        <Field label="Beading length" hint="One length of scotia or quadrant; 2.4 m is usual.">
          <LengthInput value={h.beadingLength} unit={unit} min={100} ariaLabel="Beading length" disabled={!h.useBeading} onChange={(beadingLength) => set({ beadingLength })} />
        </Field>
        <Field label="Underlay pack coverage" hint="m² in one roll or pack of laminate/LVT underlay (15 m² foam rolls, 10 m² XPS or fibreboard).">
          <NumberInput value={h.underlayPackCoverageM2} min={0.1} step={0.5} suffix="m²" ariaLabel="Hard floor underlay pack coverage" onChange={(underlayPackCoverageM2) => set({ underlayPackCoverageM2 })} />
        </Field>
      </div>
      <CheckField checked={h.underlayHasDpm} onChange={(underlayHasDpm) => set({ underlayHasDpm })} label="Underlay has a built-in damp-proof membrane" hint="If not, a polythene DPM is added on concrete subfloors." />
    </Section>
  );
}
