import { makeEmptyProject, STORAGE_KEY, useProjectStore } from './projectStore';
import { parseProject } from '@engine/serialize';

const state = () => useProjectStore.getState();
beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({ project: makeEmptyProject(), revision: 0, selection: { kind: 'none' }, newSpaceProductId: null });
});

describe('ordering the project lists', () => {
  it.each(['rooms', 'staircases', 'products'] as const)('persists %s order without changing identities or the current selection', key => {
    const ids = ['First', 'Second', 'Third'].map(name => key === 'rooms' ? state().addRoom({ name })
      : key === 'staircases' ? state().addStaircase({ name }) : state().addProduct({ name, kind: 'carpet', rollWidth: 4000 }));
    const reorder = key === 'rooms' ? state().reorderRoom : key === 'staircases' ? state().reorderStaircase : state().reorderProduct;
    const before = state().project[key];
    const selection = state().selection;
    const revision = state().revision;
    reorder(ids[2]!, 0);
    expect(state().project[key][0]).toBe(before.find(item => item.id === ids[2]));
    expect(state().project[key].map(item => item.id)).toEqual([ids[2], ...before.filter(item => item.id !== ids[2]).map(item => item.id)]);
    expect(before.at(-1)?.id).toBe(ids[2]); // Existing arrays have not been spliced in place.
    expect(state().selection).toEqual(selection);
    expect(state().revision).toBe(revision + 1);
    const restored = parseProject(localStorage.getItem(STORAGE_KEY)!);
    expect('error' in restored).toBe(false);
    if (!('error' in restored)) expect(restored.project[key].map(item => item.id)).toEqual(state().project[key].map(item => item.id));
  });

  it('clamps move destinations, and ignores missing entities, invalid indices and no-op moves', () => {
    const first = state().addRoom(); const second = state().addRoom();
    state().reorderRoom(first, 100);
    expect(state().project.rooms.map(room => room.id)).toEqual([second, first]);
    state().reorderRoom(first, -100);
    expect(state().project.rooms.map(room => room.id)).toEqual([first, second]);
    const revision = state().revision;
    state().reorderRoom(first, 0); state().reorderRoom('missing', 1); state().reorderRoom(first, NaN);
    expect(state().revision).toBe(revision);
  });

  it('removing the selected product clears selection and assigns spaces to the first remaining product', () => {
    const original = state().project.products[0]!.id;
    const fallback = state().addProduct({ name: 'Replacement carpet', kind: 'carpet', rollWidth: 5000 });
    state().addRoom({ productId: original }); state().addStaircase({ productId: original });
    state().select({ kind: 'product', id: original }); state().setNewSpaceProduct(original);
    state().removeProduct(original);
    expect(state().selection).toEqual({ kind: 'none' });
    expect(state().newSpaceProductId).toBeNull();
    expect(state().project.rooms[0]!.productId).toBe(fallback);
    expect(state().project.staircases[0]!.productId).toBe(fallback);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).project.products.map((product: { id: string }) => product.id)).toEqual([fallback]);
  });

  it('removing the last product clears its assignments without deleting the measured spaces', () => {
    const product = state().project.products[0]!.id;
    const room = state().addRoom(); state().addStaircase(); state().select({ kind: 'room', id: room });
    state().removeProduct(product);
    expect(state().project.rooms[0]!.productId).toBe('');
    expect(state().project.staircases[0]!.productId).toBe('');
    expect(state().selection).toEqual({ kind: 'room', id: room });
  });
});
