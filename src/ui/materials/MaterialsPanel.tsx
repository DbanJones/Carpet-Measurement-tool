/**
 * MaterialsPanel: the "Materials & options" tab. Products (with an inline ProductEditor for the
 * selected one and "add from preset"), project-wide planning options, and the price book.
 */
import { useId, useState } from 'react';
import type { Product } from '@engine/types';
import { useProjectStore } from '@store/projectStore';
import { Section, formatLength, formatMoney } from '@ui/components/inputs';
import { ProductEditor } from './ProductEditor';
import { OptionsEditor } from './OptionsEditor';
import { PricesEditor } from './PricesEditor';
import { KIND_LABELS, PRESET_GROUPS, PRODUCT_PRESETS, findPreset } from './presets';
import './materials.css';

type DisplayUnit = 'metric' | 'imperial';

function supplyLabel(p: Product, unit: DisplayUnit): string {
  if ('rollWidth' in p) {
    const pattern = (p.patternRepeatLength ?? 0) > 0 ? `, ${p.patternRepeatLength} mm repeat` : '';
    return `${formatLength(p.rollWidth, unit)} roll${pattern}`;
  }
  return `${p.packCoverageM2} m² per ${p.kind === 'carpet_tiles' ? 'box' : 'pack'}`;
}

function priceLabel(p: Product, currency: string): string {
  if ('rollWidth' in p && p.priceBasis === 'per_roll') return p.pricePerRoll === undefined ? 'roll price not set' : `${formatMoney(p.pricePerRoll, currency)} per roll`;
  if ('packCoverageM2' in p && p.priceBasis !== 'per_m2' && p.pricePerPack !== undefined) return `${formatMoney(p.pricePerPack, currency)} per ${p.kind === 'carpet_tiles' ? 'box' : 'pack'}`;
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
  const planning = useProjectStore((s) => s.project.options.broadloom);
  const selection = useProjectStore((s) => s.selection);
  const select = useProjectStore((s) => s.select);
  const addProduct = useProjectStore((s) => s.addProduct);
  const { setTab, addRoom, addStaircase, setNewSpaceProduct } = useProjectStore();
  const [presetId, setPresetId] = useState(PRODUCT_PRESETS[0]?.id ?? '');
  const [closedSingle, setClosedSingle] = useState(false);
  const editorId = useId();

  const selectedId = selection.kind === 'product' ? selection.id : products.length === 1 && !closedSingle ? products[0]?.id : undefined;
  const currentProduct = products.find((p) => p.id === selectedId);
  const preset = findPreset(presetId);
  const continueWith = (next: 'room' | 'stairs' | 'plan') => {
    if (!currentProduct) return;
    setNewSpaceProduct(currentProduct.id);
    if (next === 'plan') { setTab('floorplan'); return; }
    if (next === 'room') addRoom({ productId: currentProduct.id });
    else addStaircase({ productId: currentProduct.id });
    setTab('rooms');
  };

  const addFromPreset = () => {
    if (!preset) return;
    const id = addProduct(preset.make());
    select({ kind: 'product', id });
  };

  const usageLabel = (id: string) => {
    const roomCount = rooms.filter((r) => r.productId === id).length;
    const stairsCount = staircases.filter((s) => s.productId === id).length;
    const used = [
      roomCount ? `${roomCount} ${roomCount === 1 ? 'room' : 'rooms'}` : undefined,
      stairsCount ? `${stairsCount} ${stairsCount === 1 ? 'staircase' : 'staircases'}` : undefined,
    ].filter(Boolean).join(' and ');
    return used ? `assigned to ${used}` : 'not assigned yet';
  };

  return (
    <div className="panel materials-panel">
      <div className="eyebrow">1 · CHOOSE YOUR FLOORING</div>
      <h2>Materials &amp; options</h2>
      <p className="muted small intro">
        Start with the carpet and its roll width, or the hard flooring and pack size. Then measure the rooms that will use it. Preset sizes and prices are starting points to check with your supplier.
      </p>

      <Section
        title="Products"
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
          {products.map((p, index) => {
            const isSelected = p.id === selectedId;
            const summaryId = `${editorId}-product-${index}`;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="list-row product-choice"
                  aria-label={`${isSelected ? 'Close' : 'Edit'} ${p.name || 'Untitled product'}`}
                  aria-describedby={summaryId}
                  aria-expanded={isSelected}
                  aria-controls={editorId}
                  onClick={() => {
                    setClosedSingle(isSelected);
                    select(isSelected ? { kind: 'none' } : { kind: 'product', id: p.id });
                  }}
                >
                  <span className="product-main">
                    <span className="product-name">{p.name || 'Untitled product'}</span>
                    <span className="meta" id={summaryId}>
                      {KIND_LABELS[p.kind]} · {supplyLabel(p, unit)} · {priceLabel(p, currency)}
                      {' · '}{usageLabel(p.id)}
                    </span>
                  </span>
                  <span className="product-action" aria-hidden="true">{isSelected ? 'Close' : 'Edit'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div id={editorId}>
          {selectedId ? <div className="product-editor-inline">
            <ProductEditor productId={selectedId} embedded />
          </div> : products.length > 0 ? (
            <p className="field-hint">Choose a product to edit its roll or pack details and price.</p>
          ) : null}
        </div>
      </Section>

      {currentProduct ? <section className="flooring-continue" aria-label="Continue to measurement">
        <div className="eyebrow">2 · MEASURE YOUR SPACES</div>
        <h3>Ready to measure with {currentProduct.name || 'this flooring'}?</h3>
        <p>{supplyLabel(currentProduct, unit)} · {priceLabel(currentProduct, currency)}. Each new space can use this flooring or another product from your list.</p>
        <div className="row"><button type="button" className="primary" onClick={() => continueWith('room')}>Measure a room</button><button type="button" onClick={() => continueWith('plan')}>Use a floor plan</button><button type="button" onClick={() => continueWith('stairs')}>Measure stairs</button></div>
      </section> : null}

      <Section title="Planning & fitting options" collapsible defaultOpen={false} description={`Pile: ${{ auto: 'automatic', along_length: 'along room length', along_width: 'across room width' }[planning.pileDirection]} · Seams: ${{ min_seams: 'fewest seams', balanced: 'balanced', min_waste: 'least waste' }[planning.seamPolicy]} · Length allowance: ${formatLength(planning.lengthAllowance, unit)}`}>
        <p className="field-hint">Adjust project-wide seams, allowances, underlay, accessories and floor preparation when the job needs them.</p>
        <OptionsEditor />
      </Section>

      <Section title="Prices" collapsible defaultOpen={false}>
        <PricesEditor />
      </Section>
    </div>
  );
}
