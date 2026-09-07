import { useRef, useState } from 'react';
import type { Product, UnderlayOptions } from '@engine/types';
import { resolveProductUnderlay } from '@engine/productOptions';
import { roundTo } from '@engine/units';
import { newId } from '@store/ids';
import { useProjectStore } from '@store/projectStore';
import { Field, LengthInput, NumberInput, Section, Select, formatLength, formatMoney } from '@ui/components/inputs';
import { MoneyInput } from '@ui/materials/fields';
import { defaultProductForKind, KIND_LABELS, KIND_OPTIONS, UNDERLAY_PRESETS } from '@ui/materials/presets';
import { UnderlayPricing } from '@ui/materials/UnderlayPricing';
import { useGuidedSetup } from './GuidedSetupState';

export function GuidedSetupFlooring() {
  const panel = useRef<HTMLDivElement>(null);
  const store = useProjectStore(), { project } = store;
  const session = useGuidedSetup();
  const drafts = session.flooringDrafts ?? project.products;
  const draft = drafts.find(product => product.id === session.editingProductId) ?? drafts[0];
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const [error, setError] = useState('');
  const currency = project.prices.currency;
  const setDraft = (value: Product) => useGuidedSetup.setState({ flooringDrafts: drafts.map(product => product.id === value.id ? value : product), productDraft: value });
  const invalidField = () => {
    const invalid = panel.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); return true; }
    return false;
  };
  const choose = (id: string) => {
    if (invalidField()) return;
    useGuidedSetup.setState({ editingProductId: id, productDraft: drafts.find(product => product.id === id) }); setError('');
  };
  const add = () => {
    if (invalidField()) return;
    const product: Product = { id: newId('prod'), ...defaultProductForKind('carpet', `Flooring ${drafts.length + 1}`) };
    useGuidedSetup.setState({ flooringDrafts: [...drafts, product], editingProductId: product.id, productDraft: product }); setError('');
  };
  const effectiveProductId = (id: string) => session.replacements?.[id] ?? id;
  const usage = (id: string) => ({ rooms: project.rooms.filter(room => effectiveProductId(room.productId) === id).length,
    stairs: project.staircases.filter(stair => effectiveProductId(stair.productId) === id).length });
  const applyRemoval = (id: string, replacement: string) => {
    const removed = drafts.find(product => product.id === id);
    if (!removed || drafts.length < 2) return;
    const remaining = drafts.filter(product => product.id !== id);
    const replacements = Object.fromEntries(Object.entries(session.replacements ?? {}).map(([from, to]) => [from, to === id ? replacement : to]));
    replacements[id] = replacement;
    const next = draft?.id === id ? remaining.find(product => product.id === replacement) ?? remaining[0]! : draft;
    useGuidedSetup.setState({ flooringDrafts: remaining, removedDrafts: [...(session.removedDrafts ?? []), removed], replacements,
      removalHistory: [...(session.removalHistory ?? []), { replacements: { ...session.replacements }, defaultProductId: session.defaultProductId, index: drafts.findIndex(product => product.id === id) }],
      defaultProductId: session.defaultProductId === id ? replacement : session.defaultProductId,
      editingProductId: next?.id, productDraft: next,
    });
    setRemoveId(null); setError('');
  };
  const remove = (id: string) => {
    const used = usage(id), others = drafts.filter(product => product.id !== id);
    if (!others.length) return;
    const suitable = others.filter(product => !used.stairs || 'rollWidth' in product);
    if (used.rooms || used.stairs) { setRemoveId(id); setReplacementId(suitable[0]?.id ?? ''); return; }
    applyRemoval(id, others[0]!.id);
  };
  const undoRemoval = () => {
    const removed = session.removedDrafts?.at(-1);
    if (!removed) return;
    const previous = session.removalHistory?.at(-1);
    const replacements = previous?.replacements ?? { ...session.replacements }; delete replacements[removed.id];
    const restored = [...drafts]; restored.splice(previous?.index ?? restored.length, 0, removed);
    useGuidedSetup.setState({ flooringDrafts: restored, removedDrafts: session.removedDrafts!.slice(0, -1), replacements,
      removalHistory: session.removalHistory?.slice(0, -1), defaultProductId: previous?.defaultProductId ?? session.defaultProductId,
      editingProductId: removed.id, productDraft: removed });
  };
  const save = () => {
    if (invalidField()) return;
    const live = useGuidedSetup.getState();
    const products = live.flooringDrafts ?? drafts;
    const invalid = products.find(product => !product.name.trim() || ('rollWidth' in product
      ? !(product.rollWidth > 0) || (product.priceBasis === 'per_roll' && !(product.pricedRollLength && product.pricedRollLength > 0))
      : !(product.packCoverageM2 > 0)));
    if (invalid) { useGuidedSetup.setState({ editingProductId: invalid.id }); setError('Check the product name, supply size and priced roll length before continuing.'); return; }
    const current = useProjectStore.getState().project;
    const removed = new Set(live.removedDrafts?.map(product => product.id));
    const next = products.map(product => {
      const existing = current.products.find(item => item.id === product.id);
      const baseline = live.baselineProducts?.find(item => item.id === product.id);
      return existing && JSON.stringify(product) === JSON.stringify(baseline) ? existing : { ...product, name: product.name.trim() };
    });
    for (const product of current.products) if (!removed.has(product.id) && !next.some(item => item.id === product.id)) next.push(product);
    const defaultId = next.find(product => product.id === live.defaultProductId)?.id ?? next[0]!.id;
    const target = (id: string) => removed.has(id) ? next.find(product => product.id === live.replacements?.[id])?.id ?? defaultId : id;
    store.updateProject({ products: next, rooms: current.rooms.map(room => target(room.productId) === room.productId ? room : { ...room, productId: target(room.productId) }),
      staircases: current.staircases.map(stair => target(stair.productId) === stair.productId ? stair : { ...stair, productId: target(stair.productId) }) });
    store.setNewSpaceProduct(defaultId);
    useGuidedSetup.setState({ flooringDrafts: structuredClone(next), baselineProducts: structuredClone(next), removedDrafts: [], replacements: {}, removalHistory: [],
      defaultProductId: defaultId, productDraft: next.find(product => product.id === live.editingProductId), stage: 1 });
  };
  const summary = (product: Product) => {
    const price = 'rollWidth' in product && product.priceBasis === 'per_roll' ? product.pricePerRoll : 'packCoverageM2' in product && product.priceBasis !== 'per_m2' ? product.pricePerPack : product.pricePerM2;
    const basis = 'rollWidth' in product && product.priceBasis === 'per_roll' ? 'roll' : 'packCoverageM2' in product && product.priceBasis !== 'per_m2' ? 'pack' : 'm²';
    return `${KIND_LABELS[product.kind]} · ${price === undefined ? 'Price not set' : `${formatMoney(price, currency)} / ${basis}`}`;
  };
  const removing = drafts.find(product => product.id === removeId);
  const removingUsage = removing ? usage(removing.id) : null;
  if (!draft) return null;
  return <div className="setup-content setup-flooring" ref={panel}>
    <div className="setup-flooring-heading"><div><h3>Choose the flooring for this job</h3><p>Add each carpet, vinyl or hard floor you need. Keep its supply price separate from underlay.</p></div><button type="button" onClick={add}>Add another flooring</button></div>
    <ul className="setup-flooring-list" aria-label="Flooring in this job">{drafts.map(product => <li key={product.id} className={product.id === draft.id ? 'editing' : ''}>
      <button type="button" className="setup-flooring-card" aria-label={`Edit ${product.name || 'unnamed flooring'}`} aria-pressed={product.id === draft.id} onClick={() => choose(product.id)}>
        <strong>{product.name || 'Name this flooring'}{product.id === session.defaultProductId ? <span className="badge">Default for new spaces</span> : null}</strong><span>{summary(product)}</span>
        {product.kind === 'carpet' ? <span className="setup-underlay-summary">{resolveProductUnderlay(project.options.underlay, product.underlay).fit ? 'Underlay priced separately' : 'No new underlay'}</span> : null}
      </button><button type="button" className="setup-flooring-remove" aria-label={`Remove ${product.name || 'unnamed flooring'}`} disabled={drafts.length < 2} title={drafts.length < 2 ? 'Keep one flooring product to continue' : undefined} onClick={() => remove(product.id)}>Remove</button>
    </li>)}</ul>
    {session.removedDrafts?.length ? <div className="setup-flooring-undo"><span>{session.removedDrafts.at(-1)!.name} removed from this draft.</span><button type="button" className="link" onClick={undoRemoval}>Undo removal</button></div> : null}
    {removing && removingUsage ? <div className="setup-flooring-removal" role="group" aria-label={`Remove ${removing.name} from job`}>
      <strong>Replace {removing.name} in its spaces</strong><p>{removingUsage.rooms} rooms and {removingUsage.stairs} staircases use this flooring. They will switch when you continue.</p>
      <Field label="Replacement flooring"><select aria-label="Guide replacement flooring" value={replacementId} onChange={event => setReplacementId(event.target.value)}>{drafts.filter(product => product.id !== removing.id && (!removingUsage.stairs || 'rollWidth' in product)).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
      {!replacementId ? <p className="field-error">Add another carpet or sheet vinyl before removing the flooring used by stairs.</p> : null}
      <div className="setup-actions"><button type="button" onClick={() => setRemoveId(null)}>Keep flooring</button><button type="button" className="danger" disabled={!replacementId} onClick={() => applyRemoval(removing.id, replacementId)}>Replace and remove</button></div>
    </div> : null}
    <div className="setup-flooring-editor" key={draft.id}>
      <div className="setup-flooring-editor-title"><h4>{project.products.some(product => product.id === draft.id) ? 'Flooring details' : 'New flooring'}</h4><span className="field-hint">Saved when you continue</span></div>
      <div className="grid-2">
        <Field label="Product name"><input type="text" aria-label="Guide product name" value={draft.name} aria-invalid={!draft.name.trim()} onChange={event => setDraft({ ...draft, name: event.target.value })}/></Field>
        {!usage(draft.id).rooms && !usage(draft.id).stairs ? <Field label="Flooring type"><Select ariaLabel="Guide flooring type" value={draft.kind} options={KIND_OPTIONS}
          onChange={kind => setDraft({ id: draft.id, ...defaultProductForKind(kind, draft.name) })}/></Field> : <div className="setup-flooring-kind"><span>Flooring type</span><strong>{KIND_LABELS[draft.kind]}</strong></div>}
      </div>
      <section className="setup-supply-card" aria-label="Flooring supply price"><h4>{draft.kind === 'carpet' ? 'Carpet supply' : 'Flooring supply'}</h4>
        <div className="grid-2">
          {'rollWidth' in draft ? <Field label="Roll width"><LengthInput ariaLabel="Guide roll width" unit={project.displayUnit} value={draft.rollWidth} min={100} onChange={rollWidth => setDraft({ ...draft, rollWidth })}/></Field>
            : <Field label="Coverage in one pack"><NumberInput ariaLabel="Guide pack coverage" value={draft.packCoverageM2} min={.01} suffix="m²" onChange={packCoverageM2 => setDraft({ ...draft, packCoverageM2,
              ...(draft.priceBasis === 'per_m2' ? { pricePerPack: roundTo((draft.pricePerM2 ?? 0) * packCoverageM2, 2) } : { pricePerM2: roundTo((draft.pricePerPack ?? 0) / packCoverageM2, 2) }) })}/></Field>}
          <Field label="Flooring price basis"><select aria-label="Guide flooring price basis" value={draft.priceBasis ?? ('rollWidth' in draft ? 'per_m2' : 'per_pack')} onChange={event => setDraft({ ...draft, priceBasis: event.target.value } as Product)}>
            <option value="per_m2">Per square metre</option><option value={'rollWidth' in draft ? 'per_roll' : 'per_pack'}>{'rollWidth' in draft ? 'Per roll' : 'Per pack'}</option></select></Field>
          {'rollWidth' in draft && draft.priceBasis === 'per_roll' ? <><Field label="Carpet / flooring price per roll"><MoneyInput ariaLabel="Guide price per roll" value={draft.pricePerRoll} per="per roll" onChange={pricePerRoll => setDraft({ ...draft, pricePerRoll })}/></Field>
            <Field label="Length covered by that roll price"><LengthInput ariaLabel="Guide priced roll length" unit={project.displayUnit} value={draft.pricedRollLength} min={100} onChange={pricedRollLength => setDraft({ ...draft, pricedRollLength })}/></Field>
            <Field label="How the supplier charges"><Select ariaLabel="Guide roll charging method" value={draft.rollPricing ?? 'whole_rolls'} options={[{ value: 'whole_rolls', label: 'Buy whole rolls' }, { value: 'cut_length', label: 'Pay for cut lengths' }]} onChange={rollPricing => setDraft({ ...draft, rollPricing })}/></Field></>
            : 'packCoverageM2' in draft && draft.priceBasis !== 'per_m2' ? <Field label="Flooring price per pack"><MoneyInput ariaLabel="Guide price per pack" value={draft.pricePerPack} per="per pack" onChange={pricePerPack => setDraft({ ...draft, pricePerPack, pricePerM2: roundTo(pricePerPack / draft.packCoverageM2, 2) })}/></Field>
              : <Field label={draft.kind === 'carpet' ? 'Carpet price per m²' : 'Flooring price per m²'}><MoneyInput ariaLabel="Guide price per m²" value={draft.pricePerM2} per="per m²" onChange={pricePerM2 => setDraft({ ...draft, pricePerM2, ...('packCoverageM2' in draft ? { pricePerPack: roundTo(pricePerM2 * draft.packCoverageM2, 2) } : {}) })}/></Field>}
        </div><p className="field-hint">Supply price before VAT{draft.kind === 'carpet' ? ', excluding underlay' : ''}. Check your supplier’s price and order size.</p>
      </section>
      {draft.kind === 'carpet' ? <GuidedUnderlay product={draft} onChange={underlay => setDraft({ ...draft, underlay })}/> : null}
      {usage(draft.id).rooms || usage(draft.id).stairs ? <p className="setup-note">This flooring is already assigned to spaces. Saving its prices or supply size also updates their estimate.</p> : null}
    </div>
    {drafts.length > 1 ? <Field label="Default flooring for new rooms"><select aria-label="Guide default flooring" value={session.defaultProductId ?? drafts[0]!.id} onChange={event => useGuidedSetup.setState({ defaultProductId: event.target.value })}>{drafts.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field> : null}
    <p className="field-hint">Each room can use any flooring from this list. Detailed patterns, waste and fitting options remain available in Materials &amp; options.</p>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="setup-actions"><button type="button" className="primary" onClick={save}>{drafts.length === 1 ? 'Use this flooring' : `Continue with ${drafts.length} flooring products`}</button></div>
  </div>;
}

function GuidedUnderlay({ product, onChange }: { product: Extract<Product, { kind: 'carpet' | 'sheet_vinyl' }>; onChange: (value: Partial<UnderlayOptions>) => void }) {
  const project = useProjectStore(store => store.project);
  const value = resolveProductUnderlay(project.options.underlay, product.underlay);
  const set = (patch: Partial<UnderlayOptions>) => onChange({ ...value, ...patch });
  return <section className="setup-supply-card setup-underlay-card" aria-label="Underlay supply price">
    <div className="setup-underlay-title"><div><h4>Underlay</h4><p>Its own price, separate from the carpet.</p></div><label className="checkbox"><input type="checkbox" checked={value.fit} onChange={event => set({ fit: event.target.checked })}/>Include underlay</label></div>
    {value.fit ? <><UnderlayPricing value={value} onChange={set} prefix="Guide"/>
      <Section title="Underlay type & roll details" collapsible defaultOpen={false} description={`${value.thickness} mm · ${formatLength(value.rollWidth, project.displayUnit)} × ${formatLength(value.rollLength, project.displayUnit)} roll`}>
        <Field label="Underlay starting point"><select aria-label="Guide underlay preset" value="" onChange={event => { const preset = UNDERLAY_PRESETS.find(preset => preset.id === event.target.value); if (preset) set({ ...preset.values, fit: true, pricePerM2: undefined }); }}><option value="">Choose a common underlay…</option>{UNDERLAY_PRESETS.filter(preset => preset.id !== 'laminate_pack').map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></Field>
        <div className="grid-2"><Field label="Underlay roll width"><LengthInput ariaLabel="Guide underlay roll width" value={value.rollWidth} unit={project.displayUnit} min={100} onChange={rollWidth => set({ rollWidth })}/></Field><Field label="Underlay roll length"><LengthInput ariaLabel="Guide underlay roll length" value={value.rollLength} unit={project.displayUnit} min={100} onChange={rollLength => set({ rollLength })}/></Field>
          <Field label="Underlay thickness"><NumberInput ariaLabel="Guide underlay thickness" value={value.thickness} min={0} suffix="mm" onChange={thickness => set({ thickness })}/></Field></div>
      </Section></> : <p className="field-hint">No new underlay will be ordered for this carpet. Its saved price is kept if you turn it back on.</p>}
  </section>;
}
