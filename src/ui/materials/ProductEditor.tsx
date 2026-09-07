/**
 * ProductEditor: one floor covering as it is bought. Broadloom products (carpet, sheet vinyl) are
 * described by their roll; pack products (laminate, wood, LVT, carpet tiles) by pack coverage and
 * board size. Switching kind converts the product sensibly. Used inline in the Materials panel and
 * stand-alone from the sidebar (App.tsx).
 */
import { useState } from 'react';
import type { BroadloomProduct, CoveringKind, Mm, PackProduct, Product } from '@engine/types';
import { isBroadloom } from '@engine/types';
import { CARPET_ROLL_WIDTHS, CARPET_ROLL_WIDTHS_OTHER, VINYL_ROLL_WIDTHS, CUT_INCREMENT, DEFAULT_CARPET_THICKNESS, DEFAULT_VINYL_THICKNESS } from '@engine/defaults';
import { roundTo } from '@engine/units';
import { useProjectStore } from '@store/projectStore';
import { Checkbox, Field, LengthInput, NumberInput, Section, Select, formatLength, formatMoney, FieldGroup } from '@ui/components/inputs';
import { KIND_LABELS, KIND_OPTIONS, defaultProductForKind, type BroadloomDraft, type PackDraft } from './presets';
import { MmInput, MoneyInput } from './fields';
import { BroadloomPrice, ProductPattern, ProductUnderlay, ProductWaste } from './ProductCommercial';
import './product-editor.css';

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

  const perM2 = 'rollWidth' in p && p.priceBasis === 'per_roll'
    ? p.pricePerRoll !== undefined && p.pricedRollLength && p.rollWidth > 0 ? p.pricePerRoll / (p.pricedRollLength * p.rollWidth / 1e6) : undefined
    : p.pricePerM2 ?? ('packCoverageM2' in p && p.pricePerPack !== undefined && p.packCoverageM2 > 0 ? p.pricePerPack / p.packCoverageM2 : undefined);
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
          <Field label="Floor covering" hint="Choose how this product is supplied.">
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
  const cutIncrement = product.cutIncrement ?? CUT_INCREMENT;
  const cutOptions = CUT_INCREMENTS.some((option) => option.value === String(cutIncrement))
    ? CUT_INCREMENTS
    : [...CUT_INCREMENTS, { value: String(cutIncrement), label: `${cutIncrement} mm (supplier setting)` }];
  const thickness = product.thickness ?? (product.kind === 'carpet' ? DEFAULT_CARPET_THICKNESS : DEFAULT_VINYL_THICKNESS);
  const wholeRollPurchase = product.priceBasis === 'per_roll' && product.rollPricing !== 'cut_length';
  const supplierSummary = [
    wholeRollPurchase ? product.pricedRollLength ? `${formatLength(product.pricedRollLength, unit)} per purchased roll` : 'Purchased roll length needed above' : product.maxRollLength ? `Up to ${formatLength(product.maxRollLength, unit)} per roll` : 'No roll length limit set',
    `${cutIncrement} mm cut increments`,
    product.minCutLength ? `${formatLength(product.minCutLength, unit)} minimum cut` : 'No minimum cut',
    `${thickness} mm thick${product.thickness === undefined ? ' (default)' : ''}`,
  ].join(' · ');
  const patternSummary = patterned
    ? `${formatLength(product.patternRepeatLength ?? 0, unit)} along the roll · ${formatLength(product.patternRepeatWidth ?? 0, unit)} across. Matching allowances are included.`
    : 'Plain: no pattern repeat allowance.';

  return (
    <>
      <Section title="Roll & price">
        <div className="grid-2">
          <Field label="Roll width" hint="The width you plan to order. Check the supplier's available sizes.">
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
          <BroadloomPrice product={product} onChange={onChange} />
          {showCustom ? (
            <Field label="Custom roll width" hint="Exact width of the roll as supplied.">
              <LengthInput value={product.rollWidth} unit={unit} min={100} ariaLabel="Custom roll width" onChange={(rollWidth) => onChange({ rollWidth, alternativeRollWidths: alternatives.filter((x) => x !== rollWidth) })} />
            </Field>
          ) : null}
        </div>
        <p className="product-supply-summary">
          <span data-testid="roll-width-figure">{formatLength(product.rollWidth, unit)}</span> wide
          {product.priceBasis === 'per_roll' ? <span data-testid="price-per-lm"> · {product.pricePerRoll === undefined ? 'Roll price not set' : `${formatMoney(product.pricePerRoll, currency)} per ${product.pricedRollLength ? formatLength(product.pricedRollLength, unit) : 'unspecified length'} roll`}</span> : product.pricePerM2 !== undefined ? <> · <span data-testid="price-per-lm">{formatMoney((product.pricePerM2 * product.rollWidth) / 1000, currency)}</span> per linear metre</> : <span data-testid="price-per-lm"> · Price not set</span>}
        </p>
        {/* A group of checkboxes, so FieldGroup: a <label> wrapping them would tick the first one
            whenever the caption was clicked, silently adding a roll width to the comparison. */}
        <FieldGroup label="Also available in" hint="Tick other widths this product is stocked in; the estimate reports which width wastes least.">
          <span className="width-checks">
            {altCandidates.map((w) => (
              <Checkbox key={w} checked={alternatives.includes(w)} label={widthLabel(w, unit)} onChange={(on) => toggleAlt(w, on)} />
            ))}
          </span>
        </FieldGroup>
      </Section>

      {product.kind === 'carpet' ? <ProductUnderlay product={product} onChange={onChange} /> : null}
      <ProductWaste product={product} onChange={onChange} />
      <Section title="Supplier & fitting details" description={supplierSummary} collapsible defaultOpen={false}>
        <div className="grid-2">
          <Field label="Maximum roll length" hint={wholeRollPurchase ? 'Whole rolls use the priced roll length above. Change that length in Roll & price.' : 'The longest roll your supplier can deliver. Longer orders need more than one roll.'}>
            <LengthInput value={wholeRollPurchase ? product.pricedRollLength : product.maxRollLength} disabled={wholeRollPurchase} unit={unit} min={1000} ariaLabel="Maximum roll length" onChange={(maxRollLength) => onChange({ maxRollLength })} />
          </Field>
          <Field label="Cut increment" hint="Ordered lengths round up to this supplier increment.">
            <Select value={String(cutIncrement)} options={cutOptions} ariaLabel="Cut increment" onChange={(v) => onChange({ cutIncrement: Number(v) })} />
          </Field>
          <Field label="Minimum cut" hint="The supplier's shortest order length; enter 0 if none.">
            <LengthInput value={product.minCutLength} unit={unit} ariaLabel="Minimum cut length" onChange={(minCutLength) => onChange({ minCutLength })} />
          </Field>
          <Field label="Thickness" hint="Total thickness with backing; sets wrap allowances and door-bar height.">
            <MmInput value={thickness} ariaLabel="Thickness" onChange={(thickness) => onChange({ thickness })} />
          </Field>
        </div>
      </Section>

      <Section title="Pattern matching" description={patternSummary} collapsible defaultOpen={patterned}>
        <div className="grid-2">
          <Field label="Pattern repeat along the roll" hint="Every cut is rounded up to whole repeats so seams match; 0 for plain.">
            <LengthInput value={product.patternRepeatLength ?? 0} unit={unit} ariaLabel="Pattern repeat length" onChange={(patternRepeatLength) => onChange({ patternRepeatLength })} />
          </Field>
          <Field label="Pattern repeat across the roll" hint="Side seams are placed on whole repeats across the width; 0 for plain.">
            <LengthInput value={product.patternRepeatWidth ?? 0} unit={unit} ariaLabel="Pattern repeat width" onChange={(patternRepeatWidth) => onChange({ patternRepeatWidth })} />
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
  const perM2Basis = product.priceBasis === 'per_m2';
  const derivedPerM2 = perM2Basis ? product.pricePerM2 : product.pricePerPack !== undefined && product.packCoverageM2 > 0 ? product.pricePerPack / product.packCoverageM2 : product.pricePerM2;
  const detailSummary = [
    product.boardsPerPack ? `${product.boardsPerPack} ${piece}s per ${unitWord}` : undefined,
    product.boardLength && product.boardWidth ? `${formatLength(product.boardLength, unit)} × ${formatLength(product.boardWidth, unit)}` : undefined,
    product.thickness !== undefined ? `${product.thickness} mm thick` : undefined,
  ].filter(Boolean).join(' · ') || `Optional ${piece} sizes and thickness.`;

  const setCoverage = (packCoverageM2: number) => {
    const patch: Partial<PackProduct> = { packCoverageM2 };
    if (perM2Basis && product.pricePerM2 !== undefined) patch.pricePerPack = roundTo(product.pricePerM2 * packCoverageM2, 2);
    else if (product.pricePerPack !== undefined && packCoverageM2 > 0) patch.pricePerM2 = roundTo(product.pricePerPack / packCoverageM2, 2);
    onChange(patch);
  };
  const setPackPrice = (pricePerPack: number) => {
    const patch: Partial<PackProduct> = { pricePerPack };
    if (product.packCoverageM2 > 0) patch.pricePerM2 = roundTo(pricePerPack / product.packCoverageM2, 2);
    onChange(patch);
  };

  return (
    <>
      <Section title={tiles ? 'Box & price' : 'Pack & price'}>
        <div className="grid-2">
          <Field label={`Coverage per ${unitWord}`} hint={`Square metres in one ${unitWord} as printed on the label; the estimate rounds up to whole ${unitPlural}.`}>
            <NumberInput value={product.packCoverageM2} min={0.01} step={0.01} suffix="m²" ariaLabel="Pack coverage" onChange={setCoverage} />
          </Field>
          <Field label="Price basis"><Select ariaLabel="Product price basis" value={perM2Basis ? 'per_m2' : 'per_pack'} options={[{ value: 'per_pack', label: `Per ${unitWord}` }, { value: 'per_m2', label: 'Per square metre' }]} onChange={priceBasis => onChange({ priceBasis })} /></Field>
          {perM2Basis ? <Field label="Price per m²" hint={`Before VAT; whole ${unitPlural} are ordered and charged.`}><MoneyInput value={product.pricePerM2} ariaLabel="Price per square metre" onChange={pricePerM2 => onChange({ pricePerM2, pricePerPack: roundTo(pricePerM2 * product.packCoverageM2, 2) })} /></Field> : <Field label={`Price per ${unitWord}`} hint={`Supply price of one ${unitWord}, before VAT.`}>
            <MoneyInput value={product.pricePerPack} per={`per ${unitWord}`} ariaLabel="Price per pack" onChange={setPackPrice} />
          </Field>}
        </div>
        <p className="product-supply-summary" data-testid="price-per-m2">
          {derivedPerM2 !== undefined ? `${formatMoney(derivedPerM2, currency)} per m²` : 'Price not set'}
        </p>
        {coverageMismatch ? <p className="field-hint invalid product-coverage-warning">
          The {piece} sizes total {geometryCoverage!.toFixed(2)} m² per {unitWord}; the estimate uses the entered coverage of {product.packCoverageM2.toFixed(2)} m². Check the supplier's label or adjust the {piece} details below.
        </p> : null}
      </Section>

      <ProductPattern product={product} onChange={onChange} />
      <Section title={`${Piece} & fitting details`} description={detailSummary} collapsible defaultOpen={false}>
        <div className="grid-2">
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

    </>
  );
}
