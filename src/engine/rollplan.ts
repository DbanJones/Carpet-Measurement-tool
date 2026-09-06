/**
 * Roll plan: everything that comes off one broadloom product's roll — all rooms using it plus any
 * stair / landing pieces — packed together so offcuts from one room serve another.
 */
import type { Mm, Id, CutPiece, RollPlan, Warning, Seam, BroadloomProduct, BroadloomPlanningOptions, Polygon, Doorway } from './types';
import { planRoom, type RoomPlan } from './broadloom';
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

export function buildRollPlan(input: RollPlanInput): RollPlan {
  const rollWidth = input.rollWidth ?? input.product.rollWidth;
  const warnings: Warning[] = [];
  const seamsByRoom: Record<Id, Seam[]> = {};
  let netAreaMm2 = input.extraNetAreaMm2 ?? 0;
  const pieces: CutPiece[] = [];
  const directions: Record<Id, 'along_length' | 'along_width'> = {};
  const optionsByOwner: Record<Id, BroadloomPlanningOptions> = {};

  for (const room of input.rooms) {
    optionsByOwner[room.roomId] = room.options;
    netAreaMm2 += polygonAreaMm2(room.polygon);
    const plan = chooseDirection(room, input.product, rollWidth);
    directions[room.roomId] = plan.pileDirection;
    seamsByRoom[room.roomId] = plan.seams;
    warnings.push(...plan.warnings);
    pieces.push(...plan.pieces);
  }
  pieces.push(...(input.extraPieces ?? []));

  // Cross joins: for 'min_waste' / 'balanced', split narrow fills into k side-by-side segments when
  // that shortens the packed roll length.
  const finalPieces = applyCrossJoins(pieces, rollWidth, input.options, seamsByRoom, optionsByOwner);

  const packed = packOnRoll({ rollWidth, pieces: finalPieces, usableOffcutMin: input.options.usableOffcutMin });
  for (const r of packed.rejected) {
    warnings.push({ level: 'error', code: 'PIECE_TOO_WIDE', message: `${r.ownerName}: piece "${r.label}" (${(r.width / 1000).toFixed(2)} m) is wider than the ${(rollWidth / 1000).toFixed(2)} m roll.`, subjectId: r.ownerId });
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

/** Plan a room in both pile directions when 'auto', keeping the cheaper. */
export function chooseDirection(room: RollPlanRoom, product: BroadloomProduct, rollWidth: Mm): RoomPlan {
  const dirs: ('along_length' | 'along_width')[] =
    room.options.pileDirection === 'auto' ? ['along_length', 'along_width'] : [room.options.pileDirection];
  let best: RoomPlan | null = null;
  let bestScore = Infinity;
  for (const d of dirs) {
    const plan = planRoom({
      roomId: room.roomId,
      roomName: room.roomName,
      polygon: room.polygon,
      doorways: room.doorways,
      product,
      rollWidth,
      options: room.options,
      pileDirection: d,
    });
    if (plan.pieces.length === 0) continue;
    // Score = roll length if this room were packed alone (after cross joins), then seams.
    const alone = applyCrossJoins(plan.pieces, rollWidth, room.options, {});
    const packed = packOnRoll({ rollWidth, pieces: alone, usableOffcutMin: room.options.usableOffcutMin });
    const score = packed.totalLength * 1e6 + plan.seams.length * 1e3 + plan.pieceAreaMm2 / 1e6;
    if (score < bestScore) {
      bestScore = score;
      best = plan;
    }
  }
  return (
    best ?? {
      pileDirection: dirs[0]!,
      pieces: [],
      seams: [],
      warnings: [{ level: 'error', code: 'UNPLANNABLE', message: `${room.roomName}: cannot be planned from a ${(rollWidth / 1000).toFixed(1)} m roll.`, subjectId: room.roomId }],
      pieceAreaMm2: 0,
    }
  );
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
): CutPiece[] {
  let current = [...pieces];
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
      const threshold = options.seamPolicy === 'balanced' ? options.balancedThresholdM2 : 0.01;
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
