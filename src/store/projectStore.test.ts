/**
 * The store's own rules: what a new room's doorway is called, what a duplicate copies, and what
 * happens to whatever localStorage happens to be holding.
 */
import { useProjectStore, usePersistenceStore, makeEmptyProject, STORAGE_KEY } from './projectStore';
import { estimateProject } from '@engine/estimate';
import { PROJECT_SCHEMA_VERSION } from '@engine/serialize';

const state = () => useProjectStore.getState();

beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({ project: makeEmptyProject('Test'), selection: { kind: 'none' }, tab: 'rooms', revision: 0, newSpaceProductId: null });
  usePersistenceStore.setState({ status: 'unsaved', savedAt: null, message: null, restoreWarnings: [] });
});

afterEach(() => vi.restoreAllMocks());

describe('projectStore', () => {
  it('writes the current schema version and restores its own autosave without repair warnings', async () => {
    state().addRoom({ name: 'Saved lounge' });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    vi.resetModules();
    const { useProjectStore: fresh, usePersistenceStore: persistence } = await import('./projectStore');
    expect(fresh.getState().project.rooms[0]?.name).toBe('Saved lounge');
    expect(persistence.getState()).toMatchObject({ status: 'saved', savedAt: stored.savedAt, restoreWarnings: [] });
  });

  it('accepts the legacy internal autosave envelope without a spurious missing-version warning', async () => {
    const project = makeEmptyProject('Legacy browser save');
    const savedAt = '2026-09-07T10:00:00.000Z';
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ project, savedAt }));
    vi.resetModules();
    const { useProjectStore: fresh, usePersistenceStore: persistence } = await import('./projectStore');
    expect(fresh.getState().project.name).toBe(project.name);
    expect(persistence.getState()).toMatchObject({ status: 'saved', savedAt, restoreWarnings: [] });
  });

  it('preserves an explicit future-version warning in browser saves', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ project: makeEmptyProject('Future'), schemaVersion: PROJECT_SCHEMA_VERSION + 1 }));
    vi.resetModules();
    const { usePersistenceStore: persistence } = await import('./projectStore');
    expect(persistence.getState().status).toBe('unsaved');
    expect(persistence.getState().restoreWarnings.some(w => w.includes('later version'))).toBe(true);
  });
  it('uses the chosen flooring for new spaces while preserving existing assignments and explicit choices', () => {
    const original = state().project.products[0]!.id;
    state().addRoom({ name: 'Existing room' });
    const chosen = state().addProduct({ name: 'Wool', kind: 'carpet', rollWidth: 5000 });
    state().setNewSpaceProduct(chosen);
    state().addRoom(); state().addStaircase(); state().addRoom({ productId: original });
    expect(state().project.rooms.map((r) => r.productId)).toEqual([original, chosen, original]);
    expect(state().project.staircases[0]?.productId).toBe(chosen);
    state().removeProduct(chosen);
    state().addRoom();
    expect(state().project.rooms.at(-1)?.productId).toBe(original);
    state().setProject(makeEmptyProject('Another job'));
    expect(state().newSpaceProductId).toBeNull();
  });

  it('retains an explicit top-riser assignment when creating a staircase', () => {
    const id = state().addStaircase({ topRiserByLanding: false });
    expect(state().project.staircases.find((s) => s.id === id)?.topRiserByLanding).toBe(false);
  });
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
    const source = { floorPlanId: 'plan-ground', pixelPolygon: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 50 }, { x: 10, y: 50 }] };
    const id = state().addRoom({ name: 'Bedroom', source });
    state().updateDoorway(id, state().project.rooms[0]!.doorways[0]!.id, { sharedOpeningId: 'op-landing' });
    const copyId = state().duplicateRoom(id)!;
    const copy = state().project.rooms.find((r) => r.id === copyId)!;
    expect(copy.id).not.toBe(id);
    expect(copy.source).toBeUndefined();
    expect(copy.shape).toEqual(state().project.rooms[0]!.shape);
    expect(state().project.rooms[0]!.source).toEqual(source);
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
    return import('./projectStore').then(({ useProjectStore: fresh, usePersistenceStore: persistence }) => {
      const product = fresh.getState().project.products[0]!;
      expect('rollWidth' in product && product.rollWidth > 0).toBe(true);
      const est = estimateProject(fresh.getState().project);
      expect(est.totals.total).toBeGreaterThanOrEqual(0);
      expect(persistence.getState().restoreWarnings.length).toBeGreaterThan(0);
      expect(persistence.getState().restoreWarnings.some(w => w.includes('roll width'))).toBe(true);
      expect(persistence.getState().restoreWarnings.some(w => w.includes('version wrapper') || w.includes('which version'))).toBe(false);
      expect(persistence.getState().status).toBe('unsaved');
    });
  });

  it('falls back to a fresh project when the stored value is not a project at all', () => {
    localStorage.setItem(STORAGE_KEY, '{"project": 42}');
    vi.resetModules();
    return import('./projectStore').then(({ useProjectStore: fresh, usePersistenceStore: persistence }) => {
      expect(fresh.getState().project.rooms).toEqual([]);
      expect(fresh.getState().project.products.length).toBeGreaterThan(0);
      expect(persistence.getState().status).toBe('error');
      expect(persistence.getState().message).toContain('could not be restored');
    });
  });

  it('reports when measurements are saved and when browser quota leaves changes unsaved', () => {
    const id = state().addRoom({ name: 'Saved room' });
    expect(usePersistenceStore.getState().status).toBe('saved');
    const savedAt = usePersistenceStore.getState().savedAt;
    const before = localStorage.getItem(STORAGE_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    state().updateRoom(id, { name: 'Unsaved measurements' });
    expect(state().project.rooms[0]!.name).toBe('Unsaved measurements');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(usePersistenceStore.getState()).toMatchObject({ status: 'error', savedAt });
    expect(usePersistenceStore.getState().message).toContain('storage is full');
    expect(usePersistenceStore.getState().message).toContain('Save file');

    write.mockRestore();
    state().retrySave();
    expect(usePersistenceStore.getState()).toMatchObject({ status: 'saved', message: null });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).project.rooms[0].name).toBe('Unsaved measurements');
  });

  it('reports disabled browser saving while retaining the working project', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Disabled', 'SecurityError');
    });
    state().addRoom({ name: 'Private mode room' });
    expect(state().project.rooms[0]!.name).toBe('Private mode room');
    expect(usePersistenceStore.getState().status).toBe('error');
    expect(usePersistenceStore.getState().message).toContain('Browser saving failed');
  });
});
