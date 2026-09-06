/**
 * Roll plan: everything that comes off one broadloom product's roll — all rooms using it plus any
 * stair / landing pieces — packed together so offcuts from one room serve another.
 */
import type { Mm, Id, CutPiece, RollPlan, Warning, Seam, BroadloomProduct, BroadloomPlanningOptions, Polygon, Doorway } from './types';
import { planRoom, seamPenaltyMm2, type RoomPlan } from './broadloom';
import { VINYL_ALLOWS_CROSS_JOINS } from './defaults';
import { packOnRoll, splitIntoRolls } from './packer';
import { polygonAreaMm2 } from './geometry';
import { mm2ToM2 } from './units';

export interface RollPlanRoom {
  roomId: Id;
  roomName: string;
  polygon: Polygon;
  doorways: Doorway[];
  options: BroadloomPlanningOptions;
}

export interface RollPlanInput {
  product: BroadloomProduct;
  /** Override the product's roll width (used to compare alternatives). */
  rollWidth?: Mm;
  rooms: RollPlanRoom[];
  /** Pre-shaped pieces with fixed orientation (stairs, landings, runners). */
  extraPieces?: CutPiece[];
  /** Net area (mm²) covered by the extra pieces, for waste reporting. */
  extraNetAreaMm2?: number;
  /** Fallback options (used for extra pieces and cross-join decisions). */
  options: BroadloomPlanningOptions;
}

/** Extra length per cross-joined segment for trimming the join square. */
export const CROSS_JOIN_ALLOWANCE: Mm = 50;

/** How many times the whole roll is re-planned while flipping one room's pile direction at a time. */
export const DIRECTION_PASSES = 3;

/**
 * A seam expressed as roll length (mm) for scoring a whole roll plan: the area a seam has to save
 * before it is worth cutting, divided by the roll width. At the 1 m² 'balanced' threshold on a 4 m
 * roll that is 250 mm of carpet — so a direction that seams a room must save more than 250 mm off
 * the order to be chosen.
 */
export function seamPenaltyLengthMm(options: BroadloomPlanningOptions, rollWidth: Mm): Mm {
  if (!(rollWidth > 0)) return 0;
  return seamPenaltyMm2(options) / rollWidth;
}

export function buildRollPlan(input: RollPlanInput): RollPlan {
  const rollWidth = input.rollWidth ?? input.product.rollWidth;
  const warnings: Warning[] = [];
  const seamsByRoom: Record<Id, Seam[]> = {};
  let netAreaMm2 = input.extraNetAreaMm2 ?? 0;
  const directions: Record<Id, 'along_length' | 'along_width'> = {};
  const optionsByOwner: Record<Id, BroadloomPlanningOptions> = {};
  const extras = input.extraPieces ?? [];

  if (!(rollWidth > 0)) {
    return {
      productId: input.product.id,
      rollWidth,
      pileDirection: 'along_length',
      pieces: [],
      cuts: [],
      orderLength: 0,
      rollsRequired: 0,
      orderedAreaM2: 0,
      netAreaM2: 0,
      wasteFraction: 0,
      offcuts: [],
      seamsByRoom: {},
      warnings: [{ level: 'error', code: 'INVALID_ROLL_WIDTH', message: `${input.product.name}: the roll width must be greater than zero (got ${rollWidth} mm) — nothing can be planned from it.` }],
    };
  }

  for (const room of input.rooms) {
    optionsByOwner[room.roomId] = room.options;
    netAreaMm2 += polygonAreaMm2(room.polygon);
  }

  // Pile direction is chosen for the ROLL, not the room: a room planned alone may pick the
  // direction that packs worst beside its neighbours. Start from each room's own best, then flip
  // one room at a time while the packed total (plus a seam penalty) keeps falling.
  const chosen = chooseDirections(input.rooms, input.product, rollWidth, extras, input.options, optionsByOwner);
  for (const plan of chosen) {
    directions[plan.roomId] = plan.plan.pileDirection;
    seamsByRoom[plan.roomId] = [...plan.plan.seams];
    warnings.push(...plan.plan.warnings);
  }
  const pieces: CutPiece[] = [...chosen.flatMap((c) => c.plan.pieces), ...extras];

  // Cross joins: for 'min_waste' / 'balanced', split narrow fills into k side-by-side segments when
  // that shortens the packed roll length. Never for sheet vinyl (see applyCrossJoins).
  const finalPieces = applyCrossJoins(pieces, rollWidth, input.options, seamsByRoom, optionsByOwner, input.product);

  const packed = packOnRoll({ rollWidth, pieces: finalPieces, usableOffcutMin: input.options.usableOffcutMin });
  for (const r of packed.rejected) {
    warnings.push(rejectWarning(r, rollWidth));
  }
  warnings.push(...pileDirectionWarnings(input.rooms, directions, input.product));
  if (input.product.kind === 'sheet_vinyl') {
    const seamCount = Object.values(seamsByRoom).reduce((s, list) => s + list.length, 0);
    if (seamCount > 1) {
      warnings.push({
        level: 'warning',
        code: 'VINYL_MULTIPLE_SEAMS',
        message: `${input.product.name}: ${seamCount} seams are planned in this sheet vinyl. Every seam has to be welded and is a route for water — compare a wider roll before ordering.`,
      });
    }
  }
  const increment = input.product.cutIncrement ?? 100;
  const { rolls, overlong } = splitIntoRolls(packed.cuts, input.product.maxRollLength, increment);
  for (const c of overlong) {
    warnings.push({ level: 'error', code: 'CUT_TOO_LONG', message: `A cut of ${(c.length / 1000).toFixed(2)} m exceeds the maximum roll length of ${((input.product.maxRollLength ?? 0) / 1000).toFixed(1)} m; a cross seam will be needed.` });
  }
  let orderLength = rolls.reduce((s, r) => s + r, 0);
  if (input.product.minCutLength && orderLength > 0 && orderLength < input.product.minCutLength) {
    warnings.push({ level: 'info', code: 'MIN_CUT', message: `Order rounded up to the supplier's minimum cut of ${(input.product.minCutLength / 1000).toFixed(1)} m.` });
    orderLength = input.product.minCutLength;
  }
  const orderedAreaM2 = mm2ToM2(orderLength * rollWidth);
  const netAreaM2 = mm2ToM2(netAreaMm2);
  const wasteFraction = orderedAreaM2 > 0 ? Math.max(0, (orderedAreaM2 - netAreaM2) / orderedAreaM2) : 0;

  return {
    productId: input.product.id,
    rollWidth,
    pileDirection: dominantDirection(directions),
    pieces: finalPieces,
    cuts: packed.cuts,
    orderLength,
    rollsRequired: rolls.length,
    orderedAreaM2,
    netAreaM2,
    wasteFraction,
    offcuts: packed.offcuts.sort((a, b) => b.areaM2 - a.areaM2),
    seamsByRoom,
    warnings,
  };
}

/** A piece the packer refused, with a message that says WHY it was refused. */
function rejectWarning(r: CutPiece, rollWidth: Mm): Warning {
  const tooWide = r.width > rollWidth + 1e-6;
  const message = tooWide
    ? `${r.ownerName}: piece "${r.label}" (${(r.width / 1000).toFixed(2)} m) is wider than the ${(rollWidth / 1000).toFixed(2)} m roll.`
    : `${r.ownerName}: piece "${r.label}" has no usable size (${r.length} x ${r.width} mm) — check the room's dimensions and allowances.`;
  return { level: 'error', code: tooWide ? 'PIECE_TOO_WIDE' : 'PIECE_NOT_MEASURABLE', message, subjectId: r.ownerId };
}

/**
 * Rooms that must show the same pile direction, and do not.
 *
 * On a hall / stairs / landing the pile has to run the same way throughout or the shading makes it
 * look like two different carpets. Rooms joined by a `continuous` doorway are one run of carpet, and
 * a staircase always runs its pile down the flight, so its rooms should follow.
 */
function pileDirectionWarnings(
  rooms: RollPlanRoom[],
  directions: Record<Id, 'along_length' | 'along_width'>,
  product: BroadloomProduct,
): Warning[] {
  const joined = rooms.filter((r) => (r.doorways ?? []).some((d) => d.continuous));
  const dirs = new Set(joined.map((r) => directions[r.roomId]).filter((d): d is 'along_length' | 'along_width' => d !== undefined));
  if (joined.length < 2 || dirs.size < 2) return [];
  const label = (id: Id) => (directions[id] === 'along_length' ? 'along the length' : 'across the width');
  return [
    {
      level: 'info',
      code: 'PILE_DIRECTION_SPLIT',
      message: `${product.name}: ${joined
        .map((r) => `${r.roomName} runs ${label(r.roomId)}`)
        .join(', ')} — these are joined by an opening where the carpet is continuous, so the pile should run the same way in both or the shading will show. Pin the direction on each room to force it.`,
    },
  ];
}

interface ChosenRoomPlan {
  roomId: Id;
  plan: RoomPlan;
}

/** Every direction worth planning a room in. */
function candidateDirections(room: RollPlanRoom): ('along_length' | 'along_width')[] {
  return room.options.pileDirection === 'auto' ? ['along_length', 'along_width'] : [room.options.pileDirection];
}

function unplannable(room: RollPlanRoom, rollWidth: Mm): RoomPlan {
  return {
    pileDirection: candidateDirections(room)[0]!,
    pieces: [],
    seams: [],
    warnings: [{ level: 'error', code: 'UNPLANNABLE', message: `${room.roomName}: cannot be planned from a ${(rollWidth / 1000).toFixed(1)} m roll.`, subjectId: room.roomId }],
    pieceAreaMm2: 0,
  };
}

/** Roll length (mm) a set of room plans plus the stair pieces takes, with each seam priced in. */
function scorePlans(
  plans: RoomPlan[],
  extras: CutPiece[],
  rollWidth: Mm,
  options: BroadloomPlanningOptions,
  optionsByOwner: Record<Id, BroadloomPlanningOptions>,
  product: BroadloomProduct,
): number {
  const seams: Record<Id, Seam[]> = {};
  for (const p of plans) {
    const ownerId = p.pieces[0]?.ownerId;
    if (ownerId !== undefined) seams[ownerId] = [...p.seams];
  }
  const pieces = [...plans.flatMap((p) => p.pieces), ...extras];
  const joined = applyCrossJoins(pieces, rollWidth, options, seams, optionsByOwner, product);
  const packed = packOnRoll({ rollWidth, pieces: joined, usableOffcutMin: options.usableOffcutMin });
  const seamCount = Object.values(seams).reduce((s, l) => s + l.length, 0);
  const pieceArea = plans.reduce((s, p) => s + p.pieceAreaMm2, 0);
  return packed.totalLength + seamCount * seamPenaltyLengthMm(options, rollWidth) + pieceArea / 1e9;
}

/**
 * Choose a pile direction for every room in the roll.
 *
 * Each room starts on its own best direction (the one that is cheapest packed alone), then the whole
 * roll is re-packed while flipping one room at a time; a flip is kept only while the combined
 * length falls. That recovers the case a per-room decision cannot see — a landing that packs beside
 * the hall in one direction and opens a whole new cut in the other.
 */
export function chooseDirections(
  rooms: RollPlanRoom[],
  product: BroadloomProduct,
  rollWidth: Mm,
  extras: CutPiece[],
  options: BroadloomPlanningOptions,
  optionsByOwner: Record<Id, BroadloomPlanningOptions>,
): ChosenRoomPlan[] {
  const candidates = rooms.map((room) => {
    const plans: RoomPlan[] = [];
    for (const pileDirection of candidateDirections(room)) {
      // The room's own policy, AND the fewest-seams plan for the same direction. The DP scores
      // pieces by area (plus a per-seam penalty); the fewest-seams plan is the safety net for a
      // room where the seamed plan happens to save area without shortening what is ordered — the
      // scoring below then prefers it, because a seam that does not shorten the roll buys nothing.
      const forPolicy = (options: BroadloomPlanningOptions) =>
        planRoom({ roomId: room.roomId, roomName: room.roomName, polygon: room.polygon, doorways: room.doorways, product, rollWidth, options, pileDirection });
      plans.push(forPolicy(room.options));
      if (room.options.seamPolicy !== 'min_seams') plans.push(forPolicy({ ...room.options, seamPolicy: 'min_seams' }));
    }
    return { room, plans: plans.filter((p) => p.pieces.length > 0) };
  });

  const chosen: RoomPlan[] = candidates.map(({ room, plans }) => {
    if (plans.length === 0) return unplannable(room, rollWidth);
    let best = plans[0]!;
    let bestScore = Infinity;
    for (const plan of plans) {
      const score = scorePlans([plan], [], rollWidth, room.options, optionsByOwner, product);
      if (score < bestScore - 1e-6) {
        bestScore = score;
        best = plan;
      }
    }
    return best;
  });

  // Improvement pass over the whole roll.
  if (candidates.some((c) => c.plans.length > 1)) {
    let current = scorePlans(chosen, extras, rollWidth, options, optionsByOwner, product);
    for (let pass = 0; pass < DIRECTION_PASSES; pass++) {
      let improved = false;
      for (let i = 0; i < candidates.length; i++) {
        const { plans } = candidates[i]!;
        if (plans.length < 2) continue;
        for (const plan of plans) {
          if (plan === chosen[i]) continue;
          const trial = [...chosen];
          trial[i] = plan;
          const score = scorePlans(trial, extras, rollWidth, options, optionsByOwner, product);
          if (score < current - 1e-6) {
            chosen[i] = plan;
            current = score;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
  }

  return candidates.map(({ room }, i) => ({ roomId: room.roomId, plan: chosen[i]! }));
}

/** Plan a room in both pile directions when 'auto', keeping the cheaper (the room on its own). */
export function chooseDirection(room: RollPlanRoom, product: BroadloomProduct, rollWidth: Mm): RoomPlan {
  return chooseDirections([room], product, rollWidth, [], room.options, { [room.roomId]: room.options })[0]!.plan;
}

/**
 * Try splitting each narrow fill into k equal segments cut side by side (cross joins). Keep a split
 * only if it reduces the packed roll length by more than the policy threshold.
 */
export function applyCrossJoins(
  pieces: CutPiece[],
  rollWidth: Mm,
  baseOptions: BroadloomPlanningOptions,
  seamsByRoom: Record<Id, Seam[]>,
  optionsByOwner: Record<Id, BroadloomPlanningOptions> = {},
  product?: Pick<BroadloomProduct, 'kind'>,
): CutPiece[] {
  let current = [...pieces];
  // Sheet vinyl is never cross-joined. A butt join across a kitchen or bathroom floor is a route for
  // water under the sheet and cannot be welded flat the way a side seam can, so no amount of saved
  // material buys one.
  if (product?.kind === 'sheet_vinyl' && !VINYL_ALLOWS_CROSS_JOINS) return current;
  const candidates = current
    .filter((p) => p.role === 'fill' && p.width <= rollWidth / 2)
    .sort((a, b) => b.length - a.length);
  for (const fill of candidates) {
    const options = optionsByOwner[fill.ownerId] ?? baseOptions;
    if (options.seamPolicy === 'min_seams') continue;
    const base = packOnRoll({ rollWidth, pieces: current, usableOffcutMin: options.usableOffcutMin }).totalLength;
    const kMax = Math.min(Math.floor(rollWidth / fill.width), (options.maxCrossJoinsPerFill ?? 2) + 1);
    let bestK = 1;
    let bestLen = base;
    let bestPieces = current;
    for (let k = 2; k <= kMax; k++) {
      const segLen = Math.ceil(fill.length / k) + CROSS_JOIN_ALLOWANCE;
      if (segLen < options.minCrossJoinStripLength) break;
      const segs: CutPiece[] = Array.from({ length: k }, (_, i) => ({
        ...fill,
        id: `${fill.id}.${i + 1}`,
        label: `${fill.label} (segment ${i + 1}/${k})`,
        length: segLen,
        crossJoinGroup: fill.id,
        placement: fill.placement ? { polygon: segmentPlacement(fill.placement.polygon, i, k) } : undefined,
      }));
      const trial = current.filter((p) => p.id !== fill.id).concat(segs);
      const len = packOnRoll({ rollWidth, pieces: trial, usableOffcutMin: options.usableOffcutMin }).totalLength;
      const savingM2 = ((bestLen - len) * rollWidth) / 1e6;
      // k segments mean k-1 cross joins, so the saving is judged PER SEAM: the threshold is what one
      // join has to be worth, not what a whole run of them costs between them.
      const threshold = (options.seamPolicy === 'balanced' ? options.balancedThresholdM2 : 0.01) * (k - 1);
      if (savingM2 > threshold) {
        bestK = k;
        bestLen = len;
        bestPieces = trial;
      }
    }
    if (bestK > 1) {
      current = bestPieces;
      // record cross seams for the diagram
      if (fill.placement) {
        const poly = fill.placement.polygon;
        const seams = seamsByRoom[fill.ownerId] ?? (seamsByRoom[fill.ownerId] = []);
        for (let i = 1; i < bestK; i++) {
          const seg = segmentPlacement(poly, i, bestK);
          const a = seg[0]!;
          const b = seg[1]!;
          seams.push({ from: a, to: b, kind: 'cross' });
        }
      }
    }
  }
  return current;
}

/** Split a rectangle placement along its longer axis (the pile direction) into k equal parts; return part i. */
function segmentPlacement(poly: Polygon, i: number, k: number): Polygon {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if (x1 - x0 >= y1 - y0) {
    const step = (x1 - x0) / k;
    return [
      { x: x0 + i * step, y: y0 },
      { x: x0 + i * step, y: y1 },
      { x: x0 + (i + 1) * step, y: y1 },
      { x: x0 + (i + 1) * step, y: y0 },
    ];
  }
  const step = (y1 - y0) / k;
  return [
    { x: x0, y: y0 + i * step },
    { x: x1, y: y0 + i * step },
    { x: x1, y: y0 + (i + 1) * step },
    { x: x0, y: y0 + (i + 1) * step },
  ];
}

function dominantDirection(dirs: Record<Id, 'along_length' | 'along_width'>): 'along_length' | 'along_width' {
  const vals = Object.values(dirs);
  const n = vals.filter((v) => v === 'along_length').length;
  return n >= vals.length / 2 ? 'along_length' : 'along_width';
}
