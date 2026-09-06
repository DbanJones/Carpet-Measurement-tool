/**
 * PricesEditor: currency, VAT and the unit prices used to cost the bill of materials. Labour rates are
 * per m² / per item; material prices are per pack, roll, sheet or length. Writes via store.updatePrices.
 */
import type { PriceBook } from '@engine/types';
import { DEFAULT_PRICES, GRIPPER_TRADE_BOX, PLY_SCREWS_PER_BOX, LVT_ADHESIVE_TUB_KG, TACKIFIER_TUB_LITRES } from '@engine/defaults';
import { useProjectStore } from '@store/projectStore';
import { Field, Select } from '@ui/components/inputs';
import { CheckField, MoneyInput, PercentInput } from './fields';

type LabourKey = keyof PriceBook['labour'];
type MaterialKey = keyof PriceBook['materials'];

interface Row<K extends string> {
  key: K;
  label: string;
  unit: string;
  hint: string;
}

const LABOUR_ROWS: Row<LabourKey>[] = [
  { key: 'carpetFittingPerM2', label: 'Carpet fitting', unit: 'per m²', hint: 'Fitting on gripper including laying underlay; stairs are priced per step below.' },
  { key: 'vinylFittingPerM2', label: 'Sheet vinyl fitting', unit: 'per m²', hint: 'Loose-lay or stuck; excludes floor preparation.' },
  { key: 'laminateFittingPerM2', label: 'Laminate fitting', unit: 'per m²', hint: 'Floating floor on underlay, including beading.' },
  { key: 'lvtFittingPerM2', label: 'LVT fitting', unit: 'per m²', hint: 'Click or glue-down luxury vinyl; glue-down needs the floor fully prepared.' },
  { key: 'stairsPerStep', label: 'Stairs', unit: 'per step', hint: 'Per riser and tread, including gripper and underlay pads.' },
  { key: 'upliftPerM2', label: 'Uplift old flooring', unit: 'per m²', hint: 'Taking up the existing covering and gripper.' },
  { key: 'disposalPerM2', label: 'Disposal', unit: 'per m²', hint: 'Removing the old covering from site (tip charges).' },
  { key: 'latexPerM2', label: 'Smoothing compound', unit: 'per m²', hint: 'Labour to prime and pour latex; the bags are priced under materials.' },
  { key: 'plyPerM2', label: 'Ply overlay', unit: 'per m²', hint: 'Labour to fix plywood or hardboard; sheets and screws under materials.' },
  { key: 'doorEasingPerDoor', label: 'Door easing', unit: 'per door', hint: 'Planing the bottom of a door that would catch on the thicker floor.' },
  { key: 'bindingPerM', label: 'Binding / whipping', unit: 'per m', hint: 'Finishing an exposed carpet edge (open-sided stairs, runners); taped binding costs about double.' },
  { key: 'gripperRemovalPerM', label: 'Gripper removal', unit: 'per m', hint: 'Pulling old gripper and filling the nail holes; required before a hard floor or vinyl.' },
  { key: 'boardPrepPerM2', label: 'Board preparation', unit: 'per m²', hint: 'Screwing down loose boards or sanding high spots before an overlay.' },
  { key: 'skirtingRefitPerM', label: 'Skirting off and back', unit: 'per m', hint: 'Where the expansion gap is covered by the skirting instead of beading.' },
  { key: 'moistureTestPerTest', label: 'Moisture test', unit: 'each', hint: 'One hygrometer test of the slab, sealed down for at least 72 hours (BS 8203).' },
  {
    key: 'minimumJobLabour',
    label: 'Minimum job charge',
    unit: 'per visit',
    hint: 'The least labour a job is charged, whatever its area — a small room is still most of a day once the floor is prepared. Set 0 to switch it off.',
  },
];

const MATERIAL_ROWS: Row<MaterialKey>[] = [
  { key: 'gripperPerLength', label: 'Gripper, single length', unit: 'per length', hint: `One 1.52 m length; used only when gripper is not sold by the pack. Trade boxes hold ${GRIPPER_TRADE_BOX}.` },
  { key: 'gripperPerPack', label: 'Gripper, pack', unit: 'per pack', hint: 'A retail pack of gripper (10 lengths by default). Gripper is quoted and priced by the pack when the pack size is more than one.' },
  { key: 'doorBarPerBar', label: 'Door bar', unit: 'per bar', hint: 'Standard 0.9 m carpet-to-carpet or carpet-to-hard-floor bar.' },
  { key: 'latexPerBag', label: 'Smoothing compound', unit: 'per bag', hint: '20 kg bag of latex or fibre-reinforced compound.' },
  { key: 'primerPerCan', label: 'Primer', unit: 'per can', hint: 'A sealed can of acrylic primer concentrate (5 L by default) — the unit it is sold in.' },
  { key: 'plyPerSheet', label: 'Plywood', unit: 'per sheet', hint: '6 mm flooring-grade WBP, 2440 x 1220 mm.' },
  { key: 'hardboardPerSheet', label: 'Hardboard', unit: 'per sheet', hint: '3 mm hardboard, 1220 x 610 mm.' },
  { key: 'liquidDpmPerKg', label: 'Liquid DPM', unit: 'per kg', hint: 'Two-pack epoxy surface damp-proof membrane.' },
  { key: 'dpmSheetPerRoll', label: 'Polythene DPM', unit: 'per roll', hint: '1000-gauge polythene roll, about 100 m².' },
  { key: 'seamTapePerRoll', label: 'Seaming tape', unit: 'per roll', hint: 'Hot-melt carpet seaming tape.' },
  { key: 'doubleSidedTapePerRoll', label: 'Double-sided tape', unit: 'per roll', hint: 'For vinyl perimeters and seams.' },
  { key: 'underlayTapePerRoll', label: 'Underlay tape', unit: 'per roll', hint: 'Single-sided joining tape for underlay seams.' },
  { key: 'hardFloorUnderlayPerPack', label: 'Hard floor underlay', unit: 'per pack', hint: 'Foam or foil underlay for a floating floor (15 m² roll by default).' },
  { key: 'vinylSeamWeldPerM', label: 'Vinyl seam weld', unit: 'per m', hint: 'Cold weld or seam sealer along every seam in a bonded sheet vinyl.' },
  { key: 'beadingPerLength', label: 'Beading / scotia', unit: 'per length', hint: 'One 2.4 m length of scotia or quadrant.' },
  { key: 'thresholdPerItem', label: 'Threshold strip', unit: 'each', hint: 'Ramp or T-bar profile between hard floors.' },
  { key: 'stairNosingPerItem', label: 'Stair nosing', unit: 'each', hint: 'Nosing profile per step on hard-floored stairs.' },
  { key: 'stairRodPerItem', label: 'Stair rod', unit: 'each', hint: 'Decorative rod per step for runners.' },
  { key: 'adhesivePerTub', label: 'Adhesive', unit: 'per tub', hint: `${LVT_ADHESIVE_TUB_KG} kg tub of pressure-sensitive adhesive for glue-down LVT and vinyl.` },
  { key: 'tackifierPerTub', label: 'Tackifier', unit: 'per tub', hint: `${TACKIFIER_TUB_LITRES} L tub of tackifier for carpet tiles.` },
  { key: 'plyScrewsPerBox', label: 'Ply screws', unit: 'per box', hint: `Box of ${PLY_SCREWS_PER_BOX} screws or ring-shank nails.` },
];

const CURRENCY_OPTIONS = [
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'USD', label: 'USD ($)' },
];

export function PricesEditor() {
  const prices = useProjectStore((s) => s.project.prices);
  const updatePrices = useProjectStore((s) => s.updatePrices);
  const setLabour = (key: LabourKey, value: number) => updatePrices((p) => ({ ...p, labour: { ...p.labour, [key]: value } }));
  const setMaterial = (key: MaterialKey, value: number) => updatePrices((p) => ({ ...p, materials: { ...p.materials, [key]: value } }));
  const reset = () => {
    if (window.confirm('Reset every price and rate to the built-in UK defaults?')) updatePrices(() => structuredClone(DEFAULT_PRICES));
  };

  return (
    <div className="prices-editor">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted small" style={{ margin: 0 }}>
          Indicative UK trade prices excluding VAT. Change any figure; the estimate updates immediately.
        </p>
        <button type="button" onClick={reset}>
          Reset to defaults
        </button>
      </div>
      <div className="grid-2">
        <Field label="Currency" hint="Symbol used on the quote; changing it does not convert the figures.">
          <Select value={prices.currency} options={CURRENCY_OPTIONS} ariaLabel="Currency" onChange={(currency) => updatePrices({ currency })} />
        </Field>
        <Field label="VAT rate" hint="UK standard rate is 20%; added on top of the subtotal when applied.">
          <PercentInput value={prices.vatRate} ariaLabel="VAT rate" disabled={!prices.applyVat} onChange={(vatRate) => updatePrices({ vatRate })} />
        </Field>
      </div>
      <CheckField checked={prices.applyVat} onChange={(applyVat) => updatePrices({ applyVat })} label="Add VAT to the estimate" hint="Untick for a VAT-exclusive trade quote or a non-registered fitter." />

      <h4>Labour rates</h4>
      <div className="table-scroll">
        <table className="data prices-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Unit</th>
              <th scope="col">Rate</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {LABOUR_ROWS.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="muted">{r.unit}</td>
                <td>
                  <MoneyInput value={prices.labour[r.key]} ariaLabel={`${r.label} rate`} onChange={(v) => setLabour(r.key, v)} />
                </td>
                <td className="note">{r.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Material prices</h4>
      <div className="table-scroll">
        <table className="data prices-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Unit</th>
              <th scope="col">Price</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {MATERIAL_ROWS.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="muted">{r.unit}</td>
                <td>
                  <MoneyInput value={prices.materials[r.key]} ariaLabel={`${r.label} price`} onChange={(v) => setMaterial(r.key, v)} />
                </td>
                <td className="note">{r.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-hint">Floor covering and underlay prices are set on each product and under Underlay above.</p>
    </div>
  );
}
