import { create } from 'zustand';
import type { Product } from '@engine/types';
import { useProjectStore } from '@store/projectStore';
import { newId } from '@store/ids';
import { defaultProductForKind } from '@ui/materials/presets';

export type SetupStage = 0 | 1 | 2 | 3;
export type SetupPath = 'plan' | 'sketch' | 'measure';
interface SetupSession {
  projectId: string; active: boolean; stage: SetupStage; path: SetupPath;
  productDraft?: Product;
  flooringDrafts?: Product[];
  baselineProducts?: Product[];
  editingProductId?: string;
  defaultProductId?: string;
  removedDrafts?: Product[];
  replacements?: Record<string, string>;
  removalHistory?: { replacements: Record<string, string>; defaultProductId?: string; index: number }[];
}
export const useGuidedSetup = create<SetupSession>(() => ({ projectId: '', active: false, stage: 0, path: 'sketch' }));

/** Refresh unchanged drafts after visiting the full product editor, keeping unsaved work. */
export function refreshGuidedFlooring() {
  const { project } = useProjectStore.getState(), session = useGuidedSetup.getState();
  if (session.projectId !== project.id || !session.flooringDrafts) return;
  const removed = new Set(session.removedDrafts?.map(product => product.id));
  const drafts = session.flooringDrafts.map(draft => {
    const baseline = session.baselineProducts?.find(product => product.id === draft.id);
    const current = project.products.find(product => product.id === draft.id);
    return current && JSON.stringify(draft) === JSON.stringify(baseline) ? structuredClone(current) : draft;
  });
  for (const product of project.products) if (!removed.has(product.id) && !drafts.some(draft => draft.id === product.id)) drafts.push(structuredClone(product));
  useGuidedSetup.setState({ flooringDrafts: drafts, baselineProducts: structuredClone(project.products) });
}

export function startGuidedSetup() {
  const store = useProjectStore.getState(), session = useGuidedSetup.getState();
  if (session.projectId === store.project.id && session.flooringDrafts?.length) {
    refreshGuidedFlooring(); useGuidedSetup.setState({ active: true }); return;
  }
  const drafts: Product[] = structuredClone(store.project.products.length ? store.project.products : [{ id: newId('prod'), ...defaultProductForKind('carpet') }]);
  const first = drafts.find(product => product.id === store.newSpaceProductId) ?? drafts[0]!;
  useGuidedSetup.setState({ projectId: store.project.id, active: true, stage: 0, path: 'sketch', productDraft: undefined,
    flooringDrafts: drafts, baselineProducts: structuredClone(store.project.products), editingProductId: first.id, defaultProductId: first.id,
    removedDrafts: [], replacements: {}, removalHistory: [],
  });
}
