/**
 * The store's own rules: what a new room's doorway is called, what a duplicate copies, and what
 * happens to whatever localStorage happens to be holding.
 */
import { useProjectStore, makeEmptyProject, STORAGE_KEY } from './projectStore';
import { estimateProject } from '@engine/estimate';

const state = () => useProjectStore.getState();

beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' }, tab: 'rooms', revision: 0 });
});

describe('projectStore', () => {
  it('names each room\'s first doorway after the room, so four rooms are four openings', () => {
    // Every room used to start with a doorway called "Door", and the estimate matched openings on
    // that label: four bedrooms bought ONE door bar between them.
    const ids = ['A', 'B', 'C', 'D'].map((n) => state().addRoom({ name: `Room ${n}` }));
    const labels = ids.map((id) => state().project.rooms.find((r) => r.id === id)!.doorways[0]!.label);
    expect(new Set(labels).size).toBe(4);
    const est = estimateProject(state().project);
    expect(est.details.doorBars.standardBars).toBe(4);
  });

  it('a duplicated room gets its own openings, not a link to the original\'s', () => {
    const id = state().addRoom({ name: 'Bedroom' });
    state().updateDoorway(id, state().project.rooms[0]!.doorways[0]!.id, { sharedOpeningId: 'op-landing' });
    const copyId = state().duplicateRoom(id)!;
    const copy = state().project.rooms.find((r) => r.id === copyId)!;
    expect(copy.doorways[0]!.id).not.toBe(state().project.rooms[0]!.doorways[0]!.id);
    expect(copy.doorways[0]!.sharedOpeningId).toBeUndefined();
    // so the copy buys a bar of its own
    expect(estimateProject(state().project).details.doorBars.bars).toHaveLength(2);
  });

  it('repairs whatever is in localStorage instead of handing it straight to the engine', () => {
    // A zero roll width used to make the planner's seam search run forever, freezing the tab; an
    // imported FILE was validated but the autosave was read back with a bare JSON.parse.
    const broken = {
      ...makeEmptyProject('Persisted'),
      products: [{ id: 'p', name: 'Broken carpet', kind: 'carpet', rollWidth: 0 }],
      rooms: [{ id: 'r', name: 'Room', shape: { kind: 'rectangle', length: 4000, width: 3000 }, doorways: [], productId: 'p', subfloor: { type: 'floorboards', condition: 'good' } }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ project: broken }));
    // re-create the store the way a page load does
    vi.resetModules();
    return import('./projectStore').then(({ useProjectStore: fresh }) => {
      const product = fresh.getState().project.products[0]!;
      expect('rollWidth' in product && product.rollWidth > 0).toBe(true);
      const est = estimateProject(fresh.getState().project);
      expect(est.totals.total).toBeGreaterThanOrEqual(0);
    });
  });

  it('falls back to a fresh project when the stored value is not a project at all', () => {
    localStorage.setItem(STORAGE_KEY, '{"project": 42}');
    vi.resetModules();
    return import('./projectStore').then(({ useProjectStore: fresh }) => {
      expect(fresh.getState().project.rooms).toEqual([]);
      expect(fresh.getState().project.products.length).toBeGreaterThan(0);
    });
  });
});
