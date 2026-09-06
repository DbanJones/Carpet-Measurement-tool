/**
 * Roll packer: places rectangular pieces onto a roll of fixed width and unbounded length.
 *
 * Pieces are NEVER rotated (pile / pattern direction). The algorithm is Best-Fit Decreasing Height
 * shelf packing: pieces are sorted by length (the dimension along the roll), each piece goes into
 * the existing "cut across the roll" (shelf) that leaves the least spare width, else it opens a new
 * cut whose length is the piece's length. This mirrors how a fitter cuts: one cross-cut per shelf,
 * then the pieces are cut side by side out of that length.
 */
import type { Mm, CutPiece, RollCut, Offcut } from './types';
import { ceilToStep } from './units';
import { mm2ToM2 } from './units';

export interface PackInput {
  rollWidth: Mm;
  pieces: CutPiece[];
  /** Offcuts at least this size in both dimensions count as usable. */
  usableOffcutMin: Mm;
}

export interface PackResult {
  cuts: RollCut[];
  /** Sum of cut lengths before rounding to the supplier's increment. */
  totalLength: Mm;
  offcuts: Offcut[];
  /** Pieces that could not be placed because they are wider than the roll. */
  rejected: CutPiece[];
}

export function packOnRoll(input: PackInput): PackResult {
  const { rollWidth } = input;
  const rejected: CutPiece[] = [];
  // `!(x > 0)` also rejects NaN: a piece whose length came out non-finite (a broken allowance) must
  // not be silently packed as a zero-length shelf and disappear from the order.
  const pieces = input.pieces.filter((p) => {
    if (p.width > rollWidth + 1e-6 || !(p.length > 0) || !(p.width > 0)) {
      rejected.push(p);
      return false;
    }
    return true;
  });
  // longest first; ties: widest first (keeps big pieces at the left of a cut)
  const sorted = [...pieces].sort((a, b) => b.length - a.length || b.width - a.width || a.id.localeCompare(b.id));

  interface Shelf {
    length: Mm;
    used: Mm;
    items: { piece: CutPiece; x: Mm }[];
  }
  const shelves: Shelf[] = [];
  for (const piece of sorted) {
    let best: Shelf | null = null;
    let bestSpare = Infinity;
    for (const s of shelves) {
      const spare = rollWidth - s.used - piece.width;
      if (spare >= -1e-6 && spare < bestSpare) {
        best = s;
        bestSpare = spare;
      }
    }
    if (!best) {
      best = { length: piece.length, used: 0, items: [] };
      shelves.push(best);
    }
    best.items.push({ piece, x: best.used });
    best.used += piece.width;
  }

  const cuts: RollCut[] = [];
  const offcuts: Offcut[] = [];
  let totalLength = 0;
  shelves.forEach((s, index) => {
    const spareWidth = rollWidth - s.used;
    const cut: RollCut = {
      index,
      length: s.length,
      pieces: s.items.map((it) => ({ pieceId: it.piece.id, x: it.x, width: it.piece.width, length: it.piece.length })),
    };
    if (spareWidth > 1e-6) {
      cut.offcut = { width: spareWidth, length: s.length };
      offcuts.push(makeOffcut(spareWidth, s.length, index, input.usableOffcutMin));
    }
    // tail offcuts: pieces shorter than the shelf leave a strip at the end of the cut
    for (const it of s.items) {
      const tail = s.length - it.piece.length;
      if (tail > 1e-6) offcuts.push(makeOffcut(it.piece.width, tail, index, input.usableOffcutMin));
    }
    cuts.push(cut);
    totalLength += s.length;
  });

  return { cuts, totalLength, offcuts, rejected };
}

function makeOffcut(width: Mm, length: Mm, fromCutIndex: number, usableMin: Mm): Offcut {
  return {
    width,
    length,
    areaM2: mm2ToM2(width * length),
    usable: width >= usableMin && length >= usableMin,
    fromCutIndex,
  };
}

/**
 * Split a list of cuts into physical rolls no longer than `maxRollLength` (first-fit in cut order).
 * Returns the ordered length per roll, each rounded up to `increment`.
 */
export function splitIntoRolls(cuts: RollCut[], maxRollLength: Mm | undefined, increment: Mm): { rolls: Mm[]; overlong: RollCut[] } {
  const inc = increment > 0 ? increment : 1;
  if (!maxRollLength || maxRollLength <= 0) {
    const total = cuts.reduce((s, c) => s + c.length, 0);
    return { rolls: total > 0 ? [ceilToStep(total, inc)] : [], overlong: [] };
  }
  const rolls: Mm[] = [];
  const overlong: RollCut[] = [];
  for (const c of cuts) {
    if (c.length > maxRollLength + 1e-6) {
      overlong.push(c);
      rolls.push(ceilToStep(c.length, inc));
      continue;
    }
    let placed = false;
    for (let i = 0; i < rolls.length; i++) {
      if (rolls[i]! + c.length <= maxRollLength + 1e-6) {
        rolls[i] = rolls[i]! + c.length;
        placed = true;
        break;
      }
    }
    if (!placed) rolls.push(c.length);
  }
  return { rolls: rolls.map((r) => ceilToStep(r, inc)), overlong };
}
