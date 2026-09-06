/**
 * Broadloom room planner: decides where the seams go in ONE room for ONE pile direction, and
 * produces the rectangular pieces that must come off the roll.
 *
 * Method
 * 1. Orient the room so the roll length (pile) runs along +y; the roll width lies along x.
 * 2. Slice the room into vertical slabs (see geometry.verticalSlabs): each slab is an x-range with
 *    the y-extent the carpet must cover there.
 * 3. Candidate seam positions are the slab boundaries plus positions one roll width in from any
 *    boundary. A dynamic programme picks the set of seams that (a) uses the fewest pieces or (b) the
 *    least carpet, subject to every piece being no wider than the roll, and avoiding seams that would
 *    run through a doorway.
 * 4. Each group of slabs between two seams becomes one piece: width = span + width allowance
 *    (capped at the roll width), length = y-extent + length allowance (+ pattern repeat).
 */
import type { Mm, Polygon, CutPiece, Seam, Doorway, Id, Warning, BroadloomProduct, BroadloomPlanningOptions } from './types';
import { verticalSlabs, extentOverRange, transpose, doorwaySegment, type Slab } from './geometry';
import { VINYL_MIN_FILL_WIDTH } from './defaults';

export interface RoomPlanInput {
  roomId: Id;
  roomName: string;
  /** Room polygon in room coordinates (x along length, y along width). */
  polygon: Polygon;
  doorways: Doorway[];
  product: BroadloomProduct;
  rollWidth: Mm;
  options: BroadloomPlanningOptions;
  /** 'along_length' => pile runs along the room's x axis; 'along_width' => along y. */
  pileDirection: 'along_length' | 'along_width';
}

export interface RoomPlan {
  pileDirection: 'along_length' | 'along_width';
  pieces: CutPiece[];
  seams: Seam[];
  warnings: Warning[];
  /** Sum of piece areas (mm²) — the material the pieces consume before packing waste. */
  pieceAreaMm2: number;
}

interface Group {
  x0: Mm;
  x1: Mm;
  y0: Mm;
  y1: Mm;
}

const BAD_SEAM_PENALTY = 1e12; // mm² — dominates any real area so doorway seams are a last resort

/**
 * What one extra seam is "worth" in the dynamic programme, as an area (mm²) added to the cost of
 * every piece after the first.
 *
 * The DP used to minimise piece area alone, which put a seam anywhere it saved a square millimetre.
 * That is not how a floor is cut: a seam costs tape, time, and a visible line for the life of the
 * carpet, so a fitter only seams a room when it saves real material. Under 'balanced' a seam must
 * therefore pay for itself by `balancedThresholdM2` of carpet (the same threshold the cross-join
 * rule already used); under 'min_waste' material is the only objective, so seams are free; under
 * 'min_seams' the comparison is lexicographic on piece count anyway and the penalty just reinforces it.
 */
export function seamPenaltyMm2(options: BroadloomPlanningOptions): number {
  switch (options.seamPolicy) {
    case 'min_waste':
      return 0;
    case 'min_seams':
      return BAD_SEAM_PENALTY;
    default:
      return Math.max(0, options.balancedThresholdM2) * 1e6;
  }
}

/**
 * The narrowest fill this product may be planned with. A 300 mm sliver is already marginal in
 * carpet; in sheet vinyl it is not fittable at all (it curls, and the joint has to be welded), so
 * vinyl gets a 600 mm floor.
 */
export function minFillWidthFor(product: Pick<BroadloomProduct, 'kind'>, options: BroadloomPlanningOptions): Mm {
  const base = options.minFillWidth ?? 300;
  return product.kind === 'sheet_vinyl' ? Math.max(base, VINYL_MIN_FILL_WIDTH) : base;
}

export function planRoom(input: RoomPlanInput): RoomPlan {
  const { options, rollWidth, product } = input;
  // `!(x > 0)` also rejects NaN. The candidate-seam search below steps in multiples of the roll
  // width, so a zero or negative width would never terminate; this is a hard stop, not a warning.
  if (!(rollWidth > 0)) {
    return {
      pileDirection: input.pileDirection,
      pieces: [],
      seams: [],
      warnings: [{ level: 'error', code: 'INVALID_ROLL_WIDTH', message: `${input.roomName}: the roll width must be greater than zero (got ${rollWidth} mm) — check the product.`, subjectId: input.roomId }],
      pieceAreaMm2: 0,
    };
  }
  // Orient: we want the pile along +y. If pile is along the room's length (x), transpose.
  const oriented = input.pileDirection === 'along_length' ? transpose(input.polygon) : input.polygon;
  const slabs = verticalSlabs(oriented);
  const warnings: Warning[] = [];
  if (slabs.length === 0) {
    return { pileDirection: input.pileDirection, pieces: [], seams: [], warnings: [{ level: 'error', code: 'EMPTY_ROOM', message: `${input.roomName}: room has no area.`, subjectId: input.roomId }], pieceAreaMm2: 0 };
  }
  const minX = slabs[0]!.x0;
  const maxX = slabs[slabs.length - 1]!.x1;
  const span = maxX - minX;

  // usable width of a piece that needs a trimming allowance on both sides
  const usable = Math.max(1, rollWidth - options.widthAllowance);
  const minFill = minFillWidthFor(product, options);
  const seamPenalty = seamPenaltyMm2(options);

  // ---- candidate seam positions --------------------------------------------------------------
  const cand = new Set<number>();
  const boundaries = [minX, ...slabs.map((s) => s.x1)];
  const addCand = (x: number) => {
    if (x > minX && x < maxX) cand.add(round1(x));
  };
  for (const b of boundaries) {
    cand.add(b);
    // a seam exactly the minimum fill away from a boundary (so the sliver rule can be satisfied)
    addCand(b + minFill);
    addCand(b - minFill);
    for (const w of [rollWidth, usable]) {
      if (!(w > 0)) continue; // belt and braces: a non-positive step would loop forever
      for (let k = 1; k * w < span + w; k++) {
        addCand(b + k * w);
        addCand(b - k * w);
        addCand(b + k * w - minFill);
        addCand(b - k * w + minFill);
      }
    }
  }
  const positions = Array.from(cand).sort((a, b) => a - b);

  // doorway x-ranges (seams along y must not cross an opening on a wall that runs along x)
  const badRanges = doorwaySeamRanges(oriented, input.doorways, input.pileDirection);
  const isBad = (x: Mm) => badRanges.some(([a, b]) => x > a + 1 && x < b - 1);

  // ---- DP over positions ------------------------------------------------------------------------
  const n = positions.length;
  const INF = Number.POSITIVE_INFINITY;
  const bestCost: number[] = new Array(n).fill(INF);
  const bestPieces: number[] = new Array(n).fill(INF);
  const prev: number[] = new Array(n).fill(-1);
  bestCost[0] = 0;
  bestPieces[0] = 0;
  for (let j = 1; j < n; j++) {
    const xj = positions[j]!;
    for (let i = j - 1; i >= 0; i--) {
      const xi = positions[i]!;
      const w = xj - xi;
      if (w > rollWidth + 1e-6) break;
      if (bestCost[i] === INF) continue;
      // no slivers: a piece narrower than the minimum fill is only allowed if it is the whole room
      if (w < minFill - 1e-6 && !(i === 0 && j === n - 1)) continue;
      const ext = extentOverRange(slabs, xi, xj);
      if (!ext) continue;
      const pieceWidth = Math.min(w + options.widthAllowance, rollWidth);
      const pieceLength = ext.y1 - ext.y0 + options.lengthAllowance;
      let cost = pieceWidth * pieceLength;
      if (i > 0) cost += seamPenalty; // this piece starts at a seam
      if (j < n - 1 && isBad(xj)) cost += BAD_SEAM_PENALTY;
      const pieces = bestPieces[i]! + 1;
      const total = bestCost[i]! + cost;
      const better =
        options.seamPolicy === 'min_seams'
          ? pieces < bestPieces[j]! || (pieces === bestPieces[j] && total < bestCost[j]! - 1e-6)
          : total < bestCost[j]! - 1e-6 || (Math.abs(total - bestCost[j]!) <= 1e-6 && pieces < bestPieces[j]!);
      if (better) {
        bestCost[j] = total;
        bestPieces[j] = pieces;
        prev[j] = i;
      }
    }
  }

  const groups: Group[] = [];
  if (bestCost[n - 1] === INF) {
    warnings.push({ level: 'error', code: 'UNPLANNABLE', message: `${input.roomName}: could not plan pieces (room wider than any combination of roll widths?).`, subjectId: input.roomId });
  } else {
    let j = n - 1;
    while (j > 0) {
      const i = prev[j]!;
      const ext = extentOverRange(slabs, positions[i]!, positions[j]!)!;
      groups.unshift({ x0: positions[i]!, x1: positions[j]!, y0: ext.y0, y1: ext.y1 });
      j = i;
    }
  }

  // ---- pieces & seams -----------------------------------------------------------------------------
  const pieces: CutPiece[] = [];
  const seams: Seam[] = [];
  const repeatL = product.patternRepeatLength ?? 0;
  const repeatW = product.patternRepeatWidth ?? 0;
  let pieceArea = 0;
  // The MAIN piece is the widest one — the drop that covers most of the floor — not simply the
  // first: a room whose left-hand strip is the narrow one used to label a 1.7 m sliver "Main piece"
  // and the 3 m drop beside it "Fill 1".
  let mainIdx = 0;
  groups.forEach((g, idx) => {
    if (g.x1 - g.x0 > groups[mainIdx]!.x1 - groups[mainIdx]!.x0 + 1e-6) mainIdx = idx;
  });
  let fillNo = 0;
  groups.forEach((g, idx) => {
    const spanW = g.x1 - g.x0;
    const fullWidth = spanW + options.widthAllowance >= rollWidth - 1e-6;
    let width = Math.min(spanW + options.widthAllowance, rollWidth);
    let length = g.y1 - g.y0 + options.lengthAllowance;
    if (repeatL > 0 && idx > 0) length += repeatL; // every additional piece needs a repeat to match
    if (repeatW > 0 && !fullWidth) width = Math.min(Math.ceil(width / repeatW) * repeatW, rollWidth);
    const isMain = idx === mainIdx;
    if (!isMain) fillNo += 1;
    const placementOriented: Polygon = [
      { x: g.x0, y: g.y0 },
      { x: g.x1, y: g.y0 },
      { x: g.x1, y: g.y1 },
      { x: g.x0, y: g.y1 },
    ];
    const placement = input.pileDirection === 'along_length' ? transpose(placementOriented) : placementOriented;
    pieces.push({
      id: `${input.roomId}:p${idx + 1}`,
      ownerId: input.roomId,
      ownerName: input.roomName,
      label: isMain ? 'Main piece' : `Fill ${fillNo}`,
      length,
      width,
      role: isMain ? 'main' : 'fill',
      placement: { polygon: placement },
    });
    pieceArea += length * width;
    if (spanW > rollWidth - 50 && spanW <= rollWidth) {
      warnings.push({
        level: 'warning',
        code: 'TIGHT_WIDTH',
        message: `${input.roomName}: a piece spans ${(spanW / 1000).toFixed(2)} m against a ${(rollWidth / 1000).toFixed(2)} m roll — less than 50 mm trim. Check the actual roll width before ordering.`,
        subjectId: input.roomId,
      });
    }
    if (idx > 0) {
      const x = g.x0;
      const ext = overlapExtent(slabs, groups[idx - 1]!, g);
      const a = { x, y: ext.y0 };
      const b = { x, y: ext.y1 };
      const from = input.pileDirection === 'along_length' ? { x: a.y, y: a.x } : a;
      const to = input.pileDirection === 'along_length' ? { x: b.y, y: b.x } : b;
      seams.push({ from, to, kind: 'side' });
      if (isBad(x)) {
        warnings.push({ level: 'warning', code: 'SEAM_IN_DOORWAY', message: `${input.roomName}: a seam runs through a doorway; consider a wider roll or the other pile direction.`, subjectId: input.roomId });
      }
    }
  });
  if (repeatL > 0 && groups.length > 1) {
    warnings.push({ level: 'info', code: 'PATTERN_MATCH', message: `${input.roomName}: patterned product — ${groups.length - 1} extra pattern repeat(s) of ${(repeatL / 1000).toFixed(2)} m added for matching.`, subjectId: input.roomId });
  }

  return { pileDirection: input.pileDirection, pieces, seams, warnings, pieceAreaMm2: pieceArea };
}

function overlapExtent(slabs: Slab[], a: Group, b: Group): { y0: Mm; y1: Mm } {
  const ea = extentOverRange(slabs, a.x1 - 1e-3, a.x1) ?? { y0: a.y0, y1: a.y1 };
  const eb = extentOverRange(slabs, b.x0, b.x0 + 1e-3) ?? { y0: b.y0, y1: b.y1 };
  return { y0: Math.max(ea.y0, eb.y0), y1: Math.min(ea.y1, eb.y1) };
}

/**
 * x-ranges (in the oriented frame) where a seam running along y would cross a doorway opening on a
 * wall that runs along x. Only doorways on x-parallel edges matter: a seam along y meeting a
 * y-parallel wall simply ends at that wall.
 */
function doorwaySeamRanges(oriented: Polygon, doorways: Doorway[], pile: 'along_length' | 'along_width'): [Mm, Mm][] {
  const out: [Mm, Mm][] = [];
  for (const d of doorways) {
    // doorway segment in original coordinates -> oriented frame
    const seg = doorwaySegment(pile === 'along_length' ? transpose(oriented) : oriented, d);
    const from = pile === 'along_length' ? { x: seg.from.y, y: seg.from.x } : seg.from;
    const to = pile === 'along_length' ? { x: seg.to.y, y: seg.to.x } : seg.to;
    if (Math.abs(from.y - to.y) < Math.abs(from.x - to.x)) {
      out.push([Math.min(from.x, to.x), Math.max(from.x, to.x)]);
    }
  }
  return out;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
