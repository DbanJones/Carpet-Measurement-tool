/**
 * Application state: one Project plus UI selection state. Persisted to localStorage on every change.
 * The estimating engine is pure, so the store never holds results — components derive them with
 * `useEstimate()` (see ./useEstimate).
 */
import { create } from 'zustand';
import type { Project, Room, Staircase, Product, FloorPlanDocument, Doorway, Step, PriceBook } from '@engine/types';
import { DEFAULT_BROADLOOM_OPTIONS, DEFAULT_HARD_FLOOR, DEFAULT_UNDERLAY, DEFAULT_ACCESSORIES, DEFAULT_FLOOR_PREP, DEFAULT_PRICES, DEFAULT_STEP, CARPET_MAX_ROLL_LENGTH, CUT_INCREMENT, DEFAULT_CARPET_THICKNESS, DEFAULT_DOOR_WIDTH } from '@engine/defaults';
import { newId } from './ids';

export const STORAGE_KEY = 'flooring-estimator:project:v1';

/** Omit that distributes over a union (plain Omit collapses `Product` to its common keys). */
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

export type Selection =
  | { kind: 'none' }
  | { kind: 'room'; id: string }
  | { kind: 'staircase'; id: string }
  | { kind: 'product'; id: string }
  | { kind: 'floorplan'; id: string };

export type Tab = 'rooms' | 'floorplan' | 'materials' | 'results';

export interface ProjectState {
  project: Project;
  selection: Selection;
  tab: Tab;
  /** Bumped on every project mutation, handy for memoisation. */
  revision: number;

  // project-level
  setProject: (p: Project) => void;
  updateProject: (patch: Partial<Project>) => void;
  setTab: (tab: Tab) => void;
  select: (s: Selection) => void;
  resetProject: () => void;

  // products
  addProduct: (p: DistributiveOmit<Product, 'id'> & { id?: string }) => string;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  removeProduct: (id: string) => void;

  // rooms
  addRoom: (partial?: Partial<Room>) => string;
  updateRoom: (id: string, patch: Partial<Room> | ((r: Room) => Room)) => void;
  duplicateRoom: (id: string) => string | null;
  removeRoom: (id: string) => void;
  addDoorway: (roomId: string, d?: Partial<Doorway>) => string;
  updateDoorway: (roomId: string, doorwayId: string, patch: Partial<Doorway>) => void;
  removeDoorway: (roomId: string, doorwayId: string) => void;

  // staircases
  addStaircase: (partial?: Partial<Staircase>) => string;
  updateStaircase: (id: string, patch: Partial<Staircase> | ((s: Staircase) => Staircase)) => void;
  removeStaircase: (id: string) => void;

  // floor plans
  addFloorPlan: (doc: Omit<FloorPlanDocument, 'id'> & { id?: string }) => string;
  updateFloorPlan: (id: string, patch: Partial<FloorPlanDocument>) => void;
  removeFloorPlan: (id: string) => void;

  // options & prices
  updateOptions: (patch: Partial<Project['options']>) => void;
  updatePrices: (patch: Partial<PriceBook> | ((p: PriceBook) => PriceBook)) => void;
}

export function makeEmptyProject(name = 'New project'): Project {
  const carpetId = newId('prod');
  return {
    id: newId('proj'),
    name,
    displayUnit: 'metric',
    products: [
      {
        id: carpetId,
        name: 'Carpet (4 m roll)',
        kind: 'carpet',
        rollWidth: 4000,
        alternativeRollWidths: [5000],
        maxRollLength: CARPET_MAX_ROLL_LENGTH,
        cutIncrement: CUT_INCREMENT,
        thickness: DEFAULT_CARPET_THICKNESS,
        pricePerM2: 18,
      },
    ],
    rooms: [],
    staircases: [],
    floorPlans: [],
    options: {
      broadloom: { ...DEFAULT_BROADLOOM_OPTIONS },
      hardFloor: { ...DEFAULT_HARD_FLOOR },
      underlay: { ...DEFAULT_UNDERLAY },
      accessories: { ...DEFAULT_ACCESSORIES },
      floorPrep: { ...DEFAULT_FLOOR_PREP },
    },
    prices: structuredClone(DEFAULT_PRICES),
  };
}

export function makeSteps(count: number, base: Omit<Step, 'id'> = DEFAULT_STEP): Step[] {
  return Array.from({ length: count }, () => ({ id: newId('step'), ...base }));
}

function loadPersisted(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { project?: Project };
    return parsed.project ?? null;
  } catch {
    return null;
  }
}

function persist(project: Project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ project, savedAt: new Date().toISOString() }));
  } catch {
    /* storage unavailable (private mode, quota) — the app still works */
  }
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const mutate = (fn: (p: Project) => Project) =>
    set((state) => {
      const project = fn(state.project);
      persist(project);
      return { project, revision: state.revision + 1 };
    });

  return {
    project: loadPersisted() ?? makeEmptyProject(),
    selection: { kind: 'none' },
    tab: 'rooms',
    revision: 0,

    setProject: (p) => {
      persist(p);
      set((s) => ({ project: p, selection: { kind: 'none' }, revision: s.revision + 1 }));
    },
    updateProject: (patch) => mutate((p) => ({ ...p, ...patch })),
    setTab: (tab) => set({ tab }),
    select: (selection) => set({ selection }),
    resetProject: () => {
      const p = makeEmptyProject();
      persist(p);
      set((s) => ({ project: p, selection: { kind: 'none' }, tab: 'rooms', revision: s.revision + 1 }));
    },

    addProduct: (p) => {
      const id = p.id ?? newId('prod');
      mutate((proj) => ({ ...proj, products: [...proj.products, { ...p, id } as Product] }));
      return id;
    },
    updateProduct: (id, patch) =>
      mutate((proj) => ({ ...proj, products: proj.products.map((p) => (p.id === id ? ({ ...p, ...patch } as Product) : p)) })),
    removeProduct: (id) =>
      mutate((proj) => {
        const remaining = proj.products.filter((p) => p.id !== id);
        const fallback = remaining[0]?.id ?? '';
        return {
          ...proj,
          products: remaining,
          rooms: proj.rooms.map((r) => (r.productId === id ? { ...r, productId: fallback } : r)),
          staircases: proj.staircases.map((s) => (s.productId === id ? { ...s, productId: fallback } : s)),
        };
      }),

    addRoom: (partial) => {
      const id = partial?.id ?? newId('room');
      const state = get();
      const room: Room = {
        id,
        name: partial?.name ?? `Room ${state.project.rooms.length + 1}`,
        shape: partial?.shape ?? { kind: 'rectangle', length: 4000, width: 3000 },
        doorways: partial?.doorways ?? [
          { id: newId('door'), edgeIndex: 0, offset: 100, width: DEFAULT_DOOR_WIDTH, transition: 'carpet', label: 'Door' },
        ],
        productId: partial?.productId ?? state.project.products[0]?.id ?? '',
        subfloor: partial?.subfloor ?? { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true },
        ...(partial?.planning ? { planning: partial.planning } : {}),
        ...(partial?.hardFloor ? { hardFloor: partial.hardFloor } : {}),
        ...(partial?.notes ? { notes: partial.notes } : {}),
        ...(partial?.source ? { source: partial.source } : {}),
      };
      mutate((proj) => ({ ...proj, rooms: [...proj.rooms, room] }));
      set({ selection: { kind: 'room', id } });
      return id;
    },
    updateRoom: (id, patch) =>
      mutate((proj) => ({
        ...proj,
        rooms: proj.rooms.map((r) => (r.id === id ? (typeof patch === 'function' ? patch(r) : { ...r, ...patch }) : r)),
      })),
    duplicateRoom: (id) => {
      const src = get().project.rooms.find((r) => r.id === id);
      if (!src) return null;
      const copy: Room = structuredClone(src);
      copy.id = newId('room');
      copy.name = `${src.name} (copy)`;
      copy.doorways = copy.doorways.map((d) => ({ ...d, id: newId('door') }));
      mutate((proj) => ({ ...proj, rooms: [...proj.rooms, copy] }));
      set({ selection: { kind: 'room', id: copy.id } });
      return copy.id;
    },
    removeRoom: (id) => {
      mutate((proj) => ({ ...proj, rooms: proj.rooms.filter((r) => r.id !== id) }));
      const sel = get().selection;
      if (sel.kind === 'room' && sel.id === id) set({ selection: { kind: 'none' } });
    },
    addDoorway: (roomId, d) => {
      const id = d?.id ?? newId('door');
      mutate((proj) => ({
        ...proj,
        rooms: proj.rooms.map((r) =>
          r.id === roomId
            ? {
                ...r,
                doorways: [
                  ...r.doorways,
                  { edgeIndex: 0, offset: 100, width: DEFAULT_DOOR_WIDTH, transition: 'carpet', label: `Door ${r.doorways.length + 1}`, ...d, id },
                ],
              }
            : r,
        ),
      }));
      return id;
    },
    updateDoorway: (roomId, doorwayId, patch) =>
      mutate((proj) => ({
        ...proj,
        rooms: proj.rooms.map((r) =>
          r.id === roomId ? { ...r, doorways: r.doorways.map((d) => (d.id === doorwayId ? { ...d, ...patch } : d)) } : r,
        ),
      })),
    removeDoorway: (roomId, doorwayId) =>
      mutate((proj) => ({
        ...proj,
        rooms: proj.rooms.map((r) => (r.id === roomId ? { ...r, doorways: r.doorways.filter((d) => d.id !== doorwayId) } : r)),
      })),

    addStaircase: (partial) => {
      const id = partial?.id ?? newId('stairs');
      const state = get();
      const stairs: Staircase = {
        id,
        name: partial?.name ?? 'Stairs',
        productId: partial?.productId ?? state.project.products.find((p) => p.kind === 'carpet')?.id ?? state.project.products[0]?.id ?? '',
        steps: partial?.steps ?? makeSteps(13),
        landings: partial?.landings ?? [],
        method: partial?.method ?? 'cap_and_band',
        openSides: partial?.openSides ?? 'none',
        nosingOverhang: partial?.nosingOverhang ?? 20,
        ...(partial?.runner ? { runner: partial.runner } : {}),
        ...(partial?.subfloor ? { subfloor: partial.subfloor } : {}),
        ...(partial?.notes ? { notes: partial.notes } : {}),
      };
      mutate((proj) => ({ ...proj, staircases: [...proj.staircases, stairs] }));
      set({ selection: { kind: 'staircase', id } });
      return id;
    },
    updateStaircase: (id, patch) =>
      mutate((proj) => ({
        ...proj,
        staircases: proj.staircases.map((s) => (s.id === id ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)),
      })),
    removeStaircase: (id) => {
      mutate((proj) => ({ ...proj, staircases: proj.staircases.filter((s) => s.id !== id) }));
      const sel = get().selection;
      if (sel.kind === 'staircase' && sel.id === id) set({ selection: { kind: 'none' } });
    },

    addFloorPlan: (doc) => {
      const id = doc.id ?? newId('plan');
      mutate((proj) => ({ ...proj, floorPlans: [...proj.floorPlans, { ...doc, id }] }));
      set({ selection: { kind: 'floorplan', id }, tab: 'floorplan' });
      return id;
    },
    updateFloorPlan: (id, patch) =>
      mutate((proj) => ({ ...proj, floorPlans: proj.floorPlans.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
    removeFloorPlan: (id) => mutate((proj) => ({ ...proj, floorPlans: proj.floorPlans.filter((f) => f.id !== id) })),

    updateOptions: (patch) => mutate((proj) => ({ ...proj, options: { ...proj.options, ...patch } })),
    updatePrices: (patch) =>
      mutate((proj) => ({ ...proj, prices: typeof patch === 'function' ? patch(proj.prices) : { ...proj.prices, ...patch } })),
  };
});

/** Convenience selectors. */
export const selectRoom = (id: string) => (s: ProjectState) => s.project.rooms.find((r) => r.id === id);
export const selectStaircase = (id: string) => (s: ProjectState) => s.project.staircases.find((r) => r.id === id);
export const selectProduct = (id: string) => (s: ProjectState) => s.project.products.find((p) => p.id === id);
