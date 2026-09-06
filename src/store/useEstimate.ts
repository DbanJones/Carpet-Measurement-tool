/**
 * The bridge between the store and the pure estimating engine.
 *
 * The engine is a pure function of the project, so results are never held in the store: components
 * call `useEstimate()` and get a `ProjectEstimate` memoised on the project object and the store's
 * revision counter (bumped on every mutation), so typing in a room re-estimates once, not once per
 * subscribed component.
 *
 * Every call is wrapped in try/catch. An exception anywhere in the engine would otherwise blank the
 * whole results column mid-quote; instead the UI gets a valid, empty estimate carrying a single
 * `ENGINE_ERROR` warning with the message, so the panel still renders and the user can see (and
 * report) what went wrong.
 */
import { useMemo } from 'react';
import { useProjectStore } from './projectStore';
import { estimateProject, compareRollWidths, type ProjectEstimate, type RollWidthComparison } from '@engine/estimate';
import { DOOR_BAR_TYPES, type DoorBarType } from '@engine/accessories';
import type { Id, Project, Warning } from '@engine/types';

/** Warning code used for an exception thrown out of the engine. */
export const ENGINE_ERROR_CODE = 'ENGINE_ERROR';

/** The message of a thrown value, whatever was thrown. */
export function engineErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = typeof error === 'string' ? error : String(error);
  return text && text !== 'undefined' ? text : 'unknown error';
}

/** The `ENGINE_ERROR` warning shown in place of an estimate that could not be calculated. */
export function engineErrorWarning(error: unknown): Warning {
  return {
    level: 'error',
    code: ENGINE_ERROR_CODE,
    message: `The estimate could not be calculated: ${engineErrorMessage(error)}. Please check the rooms and materials, and report this if it persists.`,
  };
}

/**
 * A valid, structurally complete `ProjectEstimate` with nothing in it — every collection empty and
 * every total zero — optionally carrying warnings. Used as the fallback when the engine throws, and
 * safe to render: `estimate.bom.length === 0`, `estimate.rooms[id]` is undefined, and the panels
 * already handle both.
 */
export function emptyEstimate(warnings: Warning[] = []): ProjectEstimate {
  const totalsByType = Object.fromEntries(DOOR_BAR_TYPES.map((t) => [t, 0])) as Record<DoorBarType, number>;
  return {
    rollPlans: [],
    bom: [],
    warnings,
    totals: { netAreaM2: 0, materialsCost: 0, labourCost: 0, subtotal: 0, vat: 0, total: 0 },
    rooms: {},
    staircases: {},
    details: {
      stairPlans: {},
      hardFloorPlans: {},
      doorBars: { bars: [], totalsByType, standardBars: 0, longBars: 0, warnings: [] },
      tapes: { seamTapeLength: 0, seamTapeRolls: 0, doubleSidedTapeLength: 0, doubleSidedTapeRolls: 0 },
      vinylSundries: {},
      floorPrep: { items: [], warnings: [], perRoom: {} },
      productByOwner: {},
    },
  };
}

/** `estimateProject` that never throws: on an exception, an empty estimate with an `ENGINE_ERROR` warning. */
export function estimateOrEmpty(project: Project): ProjectEstimate {
  try {
    return estimateProject(project);
  } catch (error) {
    return emptyEstimate([engineErrorWarning(error)]);
  }
}

/** `compareRollWidths` that never throws: on an exception, no rows (the table simply does not show). */
export function compareRollWidthsOrEmpty(project: Project, productId: Id | undefined): RollWidthComparison[] {
  if (!productId) return [];
  try {
    return compareRollWidths(project, productId);
  } catch {
    return [];
  }
}

/**
 * The estimate for the project in the store, recalculated whenever the project changes.
 *
 * Example: `const estimate = useEstimate();` then `estimate.totals.total`, `estimate.rollPlans`,
 * `estimate.rooms[room.id]`.
 */
export function useEstimate(): ProjectEstimate {
  const project = useProjectStore((s) => s.project);
  const revision = useProjectStore((s) => s.revision);
  // `revision` is part of the key on purpose: it changes on every mutation, even one that mutated in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => estimateOrEmpty(project), [project, revision]);
}

/**
 * Roll widths this broadloom product could be ordered in, with the order length, ordered area,
 * waste, seams and rolls for each — the "would a 5 m roll be cheaper?" table. Empty for a pack
 * product, an unknown id, or when nothing is planned in that product.
 */
export function useRollWidthComparison(productId: Id | undefined): RollWidthComparison[] {
  const project = useProjectStore((s) => s.project);
  const revision = useProjectStore((s) => s.revision);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => compareRollWidthsOrEmpty(project, productId), [project, revision, productId]);
}
