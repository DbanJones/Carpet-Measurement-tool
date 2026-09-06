/**
 * MaterialsPanel: the "Materials & options" tab. Products (with an inline ProductEditor for the
 * selected one and "add from preset"), project-wide planning options, and the price book.
 */
import { useState } from 'react';
import type { Product } from '@engine/types';
import { useProjectStore } from '@store/projectStore';
import { Section, formatLength, formatMoney } from '@ui/components/inputs';
import { ProductEditor } from './ProductEditor';
import { OptionsEditor } from './OptionsEditor';
import { PricesEditor } from './PricesEditor';
import { KIND_LABELS, PRESET_GROUPS, PRODUCT_PRESETS, findPreset } from './presets';

type DisplayUnit = 'metric' | 'imperial';

function supplyLabel(p: Product, unit: DisplayUnit): string {
  if ('rollWidth' in p) {
    const pattern = (p.patternRepeatLength ?? 0) > 0 ? `, ${p.patternRepeatLength} mm repeat` : '';
    return `${formatLength(p.rollWidth, unit)} roll${pattern}`;
  }
  return `${p.packCoverageM2} m² per ${p.kind === 'carpet_tiles' ? 'box' : 'pack'}`;
}

function priceLabel(p: Product, currency: string): string {
  if (p.pricePerM2 !== undefined) return `${formatMoney(p.pricePerM2, currency)} per m²`;
  if ('packCoverageM2' in p && p.pricePerPack !== undefined && p.packCoverageM2 > 0) return `${formatMoney(p.pricePerPack / p.packCoverageM2, currency)} per m²`;
  return 'no price';
}

export function MaterialsPanel() {
  const products = useProjectStore((s) => s.project.products);
  const rooms = useProjectStore((s) => s.project.rooms);
  const staircases = useProjectStore((s) => s.project.staircases);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const currency = useProjectStore((s) => s.project.prices.currency);
  const selection = useProjectStore((s) => s.selection);
  const select = useProjectStore((s) => s.select);
  const addProduct = useProjectStore((s) => s.addProduct);
  const [presetId, setPresetId] = useState(PRODUCT_PRESETS[0]?.id ?? '');

  const selectedId = selection.kind === 'product' ? selection.id : undefined;
  const preset = findPreset(presetId);

  const addFromPreset = () => {
    if (!preset) return;
    const id = addProduct(preset.make());
    select({ kind: 'product', id });
  };

  const usageCount = (id: string) => rooms.filter((r) => r.productId === id).length + staircases.filter((s) => s.productId === id).length;

  return (
    <div className="panel materials-panel">
      <h2>Materials &amp; options</h2>
      <p className="muted small intro">
        Products are the floor coverings as you buy them. The options below set how they are planned; prices cost the bill of materials.
      </p>

      <Section
        title="Products"
        collapsible
        actions={
          <span className="preset-add">
            <label className="sr-only" htmlFor="product-preset">
              Preset
            </label>
            <select id="product-preset" aria-label="Product preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {PRESET_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {PRODUCT_PRESETS.filter((p) => p.group === g).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="button" className="primary" onClick={addFromPreset} disabled={!preset}>
              + Add product
            </button>
          </span>
        }
      >
        {preset ? <p className="field-hint">{preset.description}</p> : null}
        {products.length === 0 ? <div className="empty">No products yet. Add one from a preset above; rooms and stairs then pick from this list.</div> : null}
        <ul className="list product-list" data-testid="product-list">
          {products.map((p) => {
            const used = usageCount(p.id);
            const isSelected = p.id === selectedId;
            return (
              <li key={p.id} aria-selected={isSelected} onClick={() => select({ kind: 'product', id: p.id })}>
                <span className="product-main">
                  {p.name}
                  <div className="meta">
                    {KIND_LABELS[p.kind]} · {supplyLabel(p, unit)} · {priceLabel(p, currency)}
                    {used ? ` · used by ${used}` : ''}
                  </div>
                </span>
                <button
                  type="button"
                  className={isSelected ? 'link' : undefined}
                  aria-pressed={isSelected}
                  onClick={(e) => {
                    e.stopPropagation();
                    select(isSelected ? { kind: 'none' } : { kind: 'product', id: p.id });
                  }}
                >
                  {isSelected ? 'Close' : 'Edit'}
                </button>
              </li>
            );
          })}
        </ul>
        {selectedId ? (
          <div className="product-editor-inline">
            <ProductEditor productId={selectedId} embedded />
          </div>
        ) : products.length > 0 ? (
          <p className="field-hint">Choose a product to edit its roll or pack details and price.</p>
        ) : null}
      </Section>

      <OptionsEditor />

      <Section title="Prices" collapsible defaultOpen={false}>
        <PricesEditor />
      </Section>
    </div>
  );
}
