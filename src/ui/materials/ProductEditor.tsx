/**
 * ProductEditor: one floor covering as it is bought. Broadloom products (carpet, sheet vinyl) are
 * described by their roll; pack products (laminate, wood, LVT, carpet tiles) by pack coverage and
 * board size. Switching kind converts the product sensibly. Used inline in the Materials panel and
 * stand-alone from the sidebar (App.tsx).
 */
import { useState } from 'react';
import type { BroadloomProduct, CoveringKind, Mm, PackProduct, Product } from '@engine/types';
import { isBroadloom } from '@engine/types';
import { CARPET_ROLL_WIDTHS, CARPET_ROLL_WIDTHS_OTHER, VINYL_ROLL_WIDTHS } from '@engine/defaults';
import { roundTo } from '@engine/units';
import { useProjectStore } from '@store/projectStore';
import { Checkbox, Field, LengthInput, NumberInput, Section, Select, formatLength, formatMoney } from '@ui/components/inputs';
import { KIND_LABELS, KIND_OPTIONS, defaultProductForKind, type BroadloomDraft, type PackDraft } from './presets';
import { MmInput, MoneyInput } from './fields';

type DisplayUnit = 'metric' | 'imperial';
type BroadloomKind = BroadloomProduct['kind'];

/** Roll widths a kind is normally stocked in (mm). */
export function rollWidthsForKind(kind: BroadloomKind): Mm[] {
  return kind === 'sheet_vinyl' ? [...VINYL_ROLL_WIDTHS] : [...CARPET_ROLL_WIDTHS, ...CARPET_ROLL_WIDTHS_OTHER];
}

const WIDTH_NOTES: Record<number, string> = { 3660: '12 ft', 4570: '15 ft', 2000: 'narrow', 3000: 'narrow' };

function widthLabel(w: Mm, unit: DisplayUnit): string {
  const note = WIDTH_NOTES[w];
  return note ? `${formatLength(w, unit)} (${note})` : formatLength(w, unit);
}

const CUT_INCREMENTS: { value: string; label: string }[] = [
  { value: '10', label: '10 mm (exact)' },
  { value: '100', label: '100 mm (nearest 10 cm)' },
  { value: '500', label: '500 mm (half metres)' },
  { value: '1000', label: '1000 mm (whole metres)' },
];

/**
 * Convert a product to another kind. Within a family (carpet <-> vinyl, or pack <-> pack) the
 * fields are kept and only the kind-specific defaults are swapped; across families the product is
 * rebuilt from the kind's defaults, carrying the name and the price per m².
 */
export function convertProductKind(p: Product, kind: CoveringKind): Product {
  if (p.kind === kind) return p;
  const wasBroadloom = 'rollWidth' in p;
  const willBeBroadloom = isBroadloom(kind);

  if (wasBroadloom && willBeBroadloom) {
    const bp = p as BroadloomProduct;
    const k = kind as BroadloomKind;
    const widths = rollWidthsForKind(k);
    const next = defaultProductForKind(k);
    const prev = defaultProductForKind(bp.kind);
    const rollWidth = widths.includes(bp.rollWidth) ? bp.rollWidth : next.rollWidth;
    const swap = (cur: number | undefined, from: number | undefined, to: number | undefined) => (cur === undefined || cur === from ? to : cur);
    const out: BroadloomProduct = {
      ...bp,
      kind: k,
      rollWidth,
      alternativeRollWidths: (bp.alternativeRollWidths ?? []).filter((w) => w !== rollWidth && widths.includes(w)),
    };
    const maxRollLength = swap(bp.maxRollLength, prev.maxRollLength, next.maxRollLength);
    const thickness = swap(bp.thickness, prev.thickness, next.thickness);
    if (maxRollLength !== undefined) out.maxRollLength = maxRollLength;
    if (thickness !== undefined) out.thickness = thickness;
    return out;
  }

  if (!wasBroadloom && !willBeBroadloom) {
    return { ...(p as PackProduct), kind: kind as PackProduct['kind'] };
  }

  const perM2 = p.pricePerM2 ?? ('packCoverageM2' in p && p.pricePerPack !== undefined && p.packCoverageM2 > 0 ? p.pricePerPack / p.packCoverageM2 : undefined);
  if (willBeBroadloom) {
    const draft: BroadloomDraft = defaultProductForKind(kind as BroadloomKind, p.name);
    const out: BroadloomProduct = { ...draft, id: p.id };
    if (perM2 !== undefined) out.pricePerM2 = roundTo(perM2, 2);
    return out;
  }
  const draft: PackDraft = defaultProductForKind(kind as PackProduct['kind'], p.name);
  const out: PackProduct = { ...draft, id: p.id };
  if (perM2 !== undefined) {
    out.pricePerM2 = roundTo(perM2, 2);
    out.pricePerPack = roundTo(perM2 * draft.packCoverageM2, 2);
  }
  return out;
}

export function ProductEditor({ productId, embedded }: { productId: string; embedded?: boolean }) {
  const product = useProjectStore((s) => s.project.products.find((p) => p.id === productId));
  const rooms = useProjectStore((s) => s.project.rooms);
  const staircases = useProjectStore((s) => s.project.staircases);
  const unit = useProjectStore((s) => s.project.displayUnit);
  const currency = useProjectStore((s) => s.project.prices.currency);
  const selection = useProjectStore((s) => s.selection);
  const updateProduct = useProjectStore((s) => s.updateProduct);
  const updateProject = useProjectStore((s) => s.updateProject);
  const addProduct = useProjectStore((s) => s.addProduct);
  const removeProduct = useProjectStore((s) => s.removeProduct);
  const select = useProjectStore((s) => s.select);

  if (!product) {
    return (
      <div className={embedded ? 'product-editor' : 'panel product-editor'}>
        <div className="empty">This product no longer exists. Pick another product from the list, or add one from a preset.</div>
      </div>
    );
  }

  const roomsUsing = rooms.filter((r) => r.productId === product.id).length;
  const stairsUsing = staircases.filter((s) => s.productId === product.id).length;
  const usage = [roomsUsing ? `${roomsUsing} room${roomsUsing === 1 ? '' : 's'}` : '', stairsUsing ? `${stairsUsing} staircase${stairsUsing === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' and ');

  /** Replace the whole product (needed when a kind change removes fields; the store's patch merges). */
  const replaceProduct = (next: Product) => {
    const products = useProjectStore.getState().project.products;
    updateProject({ products: products.map((p) => (p.id === next.id ? next : p)) });
  };

  const onKindChange = (kind: CoveringKind) => {
    if (kind === product.kind) return;
    replaceProduct(convertProductKind(product, kind));
  };

  const duplicate = () => {
    const { id: _id, ...rest } = product;
    const id = addProduct({ ...rest, name: `${product.name} (copy)` });
    select({ kind: 'product', id });
  };

  const remove = () => {
    const others = useProjectStore.getState().project.products.filter((p) => p.id !== product.id);
    const fallback = others[0];
    const consequence = usage
      ? fallback
        ? ` ${usage.charAt(0).toUpperCase()}${usage.slice(1)} using it will switch to "${fallback.name}".`
        : ` ${usage.charAt(0).toUpperCase()}${usage.slice(1)} using it will be left without a product.`
      : '';
    if (!window.confirm(`Delete "${product.name}"?${consequence} This cannot be undone.`)) return;
    removeProduct(product.id);
    if (selection.kind === 'product' && selection.id === product.id) select({ kind: 'none' });
  };

  const Heading = embedded ? 'h3' : 'h2';

  return (
    <div className={embedded ? 'product-editor' : 'panel product-editor'} key={product.id}>
      <div className="product-title">
        <Heading>
          {product.name || 'Untitled product'} <span className="badge">{KIND_LABELS[product.kind]}</span>
        </Heading>
        <span className="section-actions">
          <button type="button" onClick={duplicate}>
            Duplicate
          </button>
          <button type="button" className="danger" onClick={remove}>
            Delete
          </button>
        </span>
      </div>

      <Section title="Product">
        <div className="grid-2">
          <Field label="Product name" hint="As it should read on the quote, e.g. range and colour.">
            <input type="text" aria-label="Product name" value={product.name} onChange={(e) => updateProduct(product.id, { name: e.target.value })} />
          </Field>
          <Field label="Kind" hint="Carpet and sheet vinyl are cut from a roll; everything else is sold by the pack or box.">
            <Select value={product.kind} options={KIND_OPTIONS} ariaLabel="Product kind" onChange={onKindChange} />
          </Field>
        </div>
        <p className="field-hint">{usage ? `Used by ${usage}.` : 'Not used by any room or staircase yet.'}</p>
      </Section>

      {'rollWidth' in product ? (
        <BroadloomFields product={product} unit={unit} currency={currency} onChange={(patch) => updateProduct(product.id, patch)} />
      ) : (
        <PackFields product={product} unit={unit} currency={currency} onChange={(patch) => updateProduct(product.id, patch)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broadloom (carpet / sheet vinyl)
// ---------------------------------------------------------------------------

function BroadloomFields({
  product,
  unit,
  currency,
  onChange,
}: {
  product: BroadloomProduct;
  unit: DisplayUnit;
  currency: string;
  onChange: (patch: Partial<BroadloomProduct>) => void;
}) {
  const widths = rollWidthsForKind(product.kind);
  const listed = widths.includes(product.rollWidth);
  const [customWidth, setCustomWidth] = useState(!listed);
  const showCustom = customWidth || !listed;
  const widthOptions = [...widths.map((w) => ({ value: String(w), label: widthLabel(w, unit) })), { value: 'custom', label: 'Custom width…' }];
  const alternatives = product.alternativeRollWidths ?? [];
  const altCandidates = Array.from(new Set([...widths, ...alternatives])).filter((w) => w !== product.rollWidth).sort((a, b) => a - b);
  const toggleAlt = (w: Mm, on: boolean) => {
    const next = on ? Array.from(new Set([...alternatives, w])) : alternatives.filter((x) => x !== w);
    onChange({ alternativeRollWidths: next.sort((a, b) => a - b) });
  };
  const patterned = (product.patternRepeatLength ?? 0) > 0 || (product.patternRepeatWidth ?? 0) > 0;

  return (
    <>
      <Section title="Roll">
        <div className="grid-2">
          <Field label="Roll width" hint={product.kind === 'carpet' ? 'UK carpet comes 4 m or 5 m wide; 12 ft and 15 ft rolls are still around.' : 'Sheet vinyl comes 2, 3 or 4 m wide; pick the width that avoids a seam.'}>
            <Select
              value={showCustom ? 'custom' : String(product.rollWidth)}
              options={widthOptions}
              ariaLabel="Roll width"
              onChange={(v) => {
                if (v === 'custom') {
                  setCustomWidth(true);
                  return;
                }
                setCustomWidth(false);
                const w = Number(v);
                onChange({ rollWidth: w, alternativeRollWidths: alternatives.filter((x) => x !== w) });
              }}
            />
          </Field>
          {showCustom ? (
            <Field label="Custom roll width" hint="Exact width of the roll as supplied.">
              <LengthInput value={product.rollWidth} unit={unit} min={100} ariaLabel="Custom roll width" onChange={(rollWidth) => onChange({ rollWidth, alternativeRollWidths: alternatives.filter((x) => x !== rollWidth) })} />
            </Field>
          ) : (
            <Field label="Roll width in use" hint="Every cut is charged at the full roll width times its length.">
              <span data-testid="roll-width-figure">{formatLength(product.rollWidth, unit)}</span>
            </Field>
          )}
        </div>
        <Field label="Also available in" hint="Tick other widths this product is stocked in; the estimate reports which width wastes least.">
          <span className="width-checks">
            {altCandidates.map((w) => (
              <Checkbox key={w} checked={alternatives.includes(w)} label={widthLabel(w, unit)} onChange={(on) => toggleAlt(w, on)} />
            ))}
          </span>
        </Field>
        <div className="grid-2">
          <Field label="Maximum roll length" hint="A requirement longer than one roll is split across rolls (carpet about 30 m, vinyl 20 m).">
            <LengthInput value={product.maxRollLength} unit={unit} min={1000} ariaLabel="Maximum roll length" onChange={(maxRollLength) => onChange({ maxRollLength })} />
          </Field>
          <Field label="Cut increment" hint="Suppliers sell cut lengths rounded up to this step; most UK retailers use 10 cm.">
            <Select value={String(product.cutIncrement ?? 100)} options={CUT_INCREMENTS} ariaLabel="Cut increment" onChange={(v) => onChange({ cutIncrement: Number(v) })} />
          </Field>
          <Field label="Minimum cut" hint="Shortest length the supplier will cut off the roll (leave blank if none).">
            <LengthInput value={product.minCutLength} unit={unit} ariaLabel="Minimum cut length" onChange={(minCutLength) => onChange({ minCutLength })} />
          </Field>
          <Field label="Thickness" hint="Total thickness with backing; sets wrap allowances and door-bar height.">
            <MmInput value={product.thickness} ariaLabel="Thickness" onChange={(thickness) => onChange({ thickness })} />
          </Field>
        </div>
      </Section>

      <Section title="Pattern" collapsible defaultOpen={patterned}>
        <div className="grid-2">
          <Field label="Pattern repeat along the roll" hint="Every cut is rounded up to whole repeats so seams match; 0 for plain.">
            <LengthInput value={product.patternRepeatLength ?? 0} unit={unit} ariaLabel="Pattern repeat length" onChange={(patternRepeatLength) => onChange({ patternRepeatLength })} />
          </Field>
          <Field label="Pattern repeat across the roll" hint="Side seams are placed on whole repeats across the width; 0 for plain.">
            <LengthInput value={product.patternRepeatWidth ?? 0} unit={unit} ariaLabel="Pattern repeat width" onChange={(patternRepeatWidth) => onChange({ patternRepeatWidth })} />
          </Field>
        </div>
      </Section>

      <Section title="Price">
        <div className="grid-2">
          <Field label="Price per m²" hint="Supply price per square metre of roll bought (full width x cut length), excluding VAT.">
            <MoneyInput value={product.pricePerM2} per="per m²" ariaLabel="Price per square metre" onChange={(pricePerM2) => onChange({ pricePerM2 })} />
          </Field>
          <Field label="Price per linear metre" hint="What one metre off the roll costs at this width.">
            <span data-testid="price-per-lm">{product.pricePerM2 !== undefined ? formatMoney((product.pricePerM2 * product.rollWidth) / 1000, currency) : '—'}</span>
          </Field>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pack products (laminate, wood, LVT, carpet tiles)
// ---------------------------------------------------------------------------

function PackFields({
  product,
  unit,
  currency,
  onChange,
}: {
  product: PackProduct;
  unit: DisplayUnit;
  currency: string;
  onChange: (patch: Partial<PackProduct>) => void;
}) {
  const tiles = product.kind === 'carpet_tiles';
  const unitWord = tiles ? 'box' : 'pack';
  const unitPlural = tiles ? 'boxes' : 'packs';
  const piece = tiles ? 'tile' : 'board';
  const Piece = tiles ? 'Tile' : 'Board';
  const boardAreaM2 = product.boardLength && product.boardWidth ? (product.boardLength * product.boardWidth) / 1_000_000 : undefined;
  const geometryCoverage = boardAreaM2 !== undefined && product.boardsPerPack ? roundTo(boardAreaM2 * product.boardsPerPack, 3) : undefined;
  const coverageMismatch = geometryCoverage !== undefined && Math.abs(geometryCoverage - product.packCoverageM2) > 0.05;
  const derivedPerM2 = product.pricePerPack !== undefined && product.packCoverageM2 > 0 ? product.pricePerPack / product.packCoverageM2 : product.pricePerM2;

  const setCoverage = (packCoverageM2: number) => {
    const patch: Partial<PackProduct> = { packCoverageM2 };
    if (product.pricePerPack !== undefined && packCoverageM2 > 0) patch.pricePerM2 = roundTo(product.pricePerPack / packCoverageM2, 2);
    onChange(patch);
  };
  const setPackPrice = (pricePerPack: number) => {
    const patch: Partial<PackProduct> = { pricePerPack };
    if (product.packCoverageM2 > 0) patch.pricePerM2 = roundTo(pricePerPack / product.packCoverageM2, 2);
    onChange(patch);
  };

  return (
    <>
      <Section title={tiles ? 'Box' : 'Pack'}>
        <div className="grid-2">
          <Field label={`Coverage per ${unitWord}`} hint={`Square metres in one ${unitWord} as printed on the label; the estimate rounds up to whole ${unitPlural}.`}>
            <NumberInput value={product.packCoverageM2} min={0.01} step={0.01} suffix="m²" ariaLabel="Pack coverage" onChange={setCoverage} />
          </Field>
          <Field label={`${Piece}s per ${unitWord}`} hint={`Used for ${piece} counts and pattern maths; leave blank if unknown.`}>
            <NumberInput value={product.boardsPerPack} min={1} integer ariaLabel="Boards per pack" onChange={(boardsPerPack) => onChange({ boardsPerPack })} />
          </Field>
          <Field label={`${Piece} length`} hint={tiles ? 'Tile size along one side.' : 'Plank length; long boards need more cutting waste in small rooms.'}>
            <LengthInput value={product.boardLength} unit={unit} ariaLabel="Board length" onChange={(boardLength) => onChange({ boardLength })} />
          </Field>
          <Field label={`${Piece} width`} hint={tiles ? 'Tile size along the other side.' : 'Plank width; drives the number of rows and the last-row rip.'}>
            <LengthInput value={product.boardWidth} unit={unit} ariaLabel="Board width" onChange={(boardWidth) => onChange({ boardWidth })} />
          </Field>
          <Field label="Thickness" hint="Board thickness excluding underlay; sets door easing and threshold heights.">
            <MmInput value={product.thickness} ariaLabel="Thickness" onChange={(thickness) => onChange({ thickness })} />
          </Field>
          <Field label="Check" hint={`${piece}s per ${unitWord} x ${piece} area should match the coverage on the label.`}>
            <span data-testid="coverage-check" className={coverageMismatch ? 'field-hint invalid' : undefined}>
              {geometryCoverage !== undefined ? `${product.boardsPerPack} x ${boardAreaM2!.toFixed(3)} m² = ${geometryCoverage.toFixed(2)} m²${coverageMismatch ? ' (does not match)' : ' ✓'}` : '—'}
            </span>
          </Field>
        </div>
      </Section>

      <Section title="Price">
        <div className="grid-2">
          <Field label={`Price per ${unitWord}`} hint={`Supply price of one ${unitWord}, excluding VAT; whole ${unitPlural} are bought.`}>
            <MoneyInput value={product.pricePerPack} per={`per ${unitWord}`} ariaLabel="Price per pack" onChange={setPackPrice} />
          </Field>
          <Field label="Price per m²" hint={`Derived from the ${unitWord} price and coverage.`}>
            <span data-testid="price-per-m2">{derivedPerM2 !== undefined ? `${formatMoney(derivedPerM2, currency)} per m²` : '—'}</span>
          </Field>
        </div>
      </Section>
    </>
  );
}
