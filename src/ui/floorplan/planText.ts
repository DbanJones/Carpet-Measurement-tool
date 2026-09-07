import type { PlanReading, PlanTextLine, Point } from '@engine/types';
import { parseLength } from '@engine/units';

export interface ReadDimension { label: string; mm: number }
export interface ReadDimensionPair { label: string; widthMm: number; heightMm: number }
export interface RoomTextSuggestion {
  name?: string;
  dimensions?: ReadDimensionPair & { confidence: number; ambiguous: boolean };
  dimensionWarning?: string;
}

/** Correct a specific spatial item without guessing how edited or reordered free text maps to rooms. */
export function correctPlanTextLine(reading: PlanReading, index: number, text: string): PlanReading {
  const original = reading.lines[index];
  if (!original) return reading;
  const corrected = text.slice(0, 500);
  const lines = reading.lines.map((line, i) => i === index ? { ...line, text: corrected, reviewed: true } : line);
  // The full transcript is a convenience for review. Rebuild it from these known spatial items;
  // no transcript edit ever gets reassigned to an image box based on line order.
  return { ...reading, lines, text: lines.map(line => line.text).join('\n').slice(0, 50000) };
}

/** Paired dimensions must contain units. A shared metric unit, e.g. 4.2 x 3.1m, is explicit enough. */
export function readDimensionPairs(text: string): ReadDimensionPair[] {
  const normal = text.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201c\u201d\u2033]/g, '"').replace(/\u00d7/g, 'x').replace(/([m'"t])\s*x\s*(?=\d)/gi, '$1 x ')
    // Agents often print each metric length followed by its imperial equivalent. Keep the
    // explicit metric numbers; do not repair malformed digits or infer missing decimal points.
    .replace(/(\d+(?:[.,]\d+)?\s*(?:mm|cm|m))\s*\([^()x×]{1,45}\)/gi, '$1 ')
    .replace(/\b(?:max(?:imum)?|min(?:imum)?)\b/gi, ' ');
  const number = '\\d+(?:[.,]\\d+)?';
  const unit = '(?:mm|cm|m(?![²2\\w])|(?:ft|feet|foot|\')\\s*(?:\\d+(?:[.,]\\d+)?\\s*(?:inches|inch|in|"))?)';
  const pattern = new RegExp(`(?<![\\w.,])(${number}\\s*(?:${unit})?)\\s*x\\s*(${number}\\s*${unit})(?![\\w²])`, 'gi');
  const pairs: ReadDimensionPair[] = [];
  for (const match of normal.matchAll(pattern)) {
    let first = match[1]!.trim();
    const second = match[2]!.trim();
    if (new RegExp(`^${number}$`).test(first)) {
      const sharedUnit = second.match(/(mm|cm|m)$/i)?.[1];
      if (!sharedUnit) continue;
      first += sharedUnit;
    }
    const widthMm = parseLength(first), heightMm = parseLength(second);
    if (widthMm === null || heightMm === null || Math.min(widthMm, heightMm) < 300 || Math.max(widthMm, heightMm) > 50000) continue;
    if (pairs.some(pair => Math.abs(pair.widthMm - widthMm) < 60 && Math.abs(pair.heightMm - heightMm) < 60)) continue;
    pairs.push({ label: match[0].trim().replace(/\s*x\s*/i, ' × '), widthMm, heightMm });
  }
  return pairs;
}

/** Combine only adjacent spatial dimension items, including an explicit x on a wrapped row. */
export function dimensionTextLines(input: readonly PlanTextLine[]): PlanTextLine[] {
  const lines = input.slice(0, 1000), joined: PlanTextLine[] = [];
  const combine = (group: PlanTextLine[]): PlanTextLine => {
    const x = Math.min(...group.map(line => line.x)), y = Math.min(...group.map(line => line.y));
    return { text: group.map(line => line.text).join(' '), x, y,
      width: Math.max(...group.map(line => line.x + line.width)) - x, height: Math.max(...group.map(line => line.y + line.height)) - y,
      confidence: Math.min(...group.map(line => line.reviewed ? 100 : line.confidence)), reviewed: group.every(line => line.reviewed) };
  };
  const remaining = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  while (remaining.length) {
    const first = remaining.shift()!, row = [first];
    for (let i = remaining.length - 1; i >= 0; i--) {
      const next = remaining[i]!;
      if (Math.abs(next.y + next.height / 2 - first.y - first.height / 2) <= Math.max(first.height, next.height) * .55) row.push(...remaining.splice(i, 1));
    }
    row.sort((a, b) => a.x - b.x);
    let group: PlanTextLine[] = [];
    const flush = () => { if (group.length > 1) joined.push(combine(group)); group = []; };
    for (const item of row) {
      const previous = group.at(-1);
      if (previous && item.x - previous.x - previous.width > Math.max(item.height, previous.height) * 3) flush();
      group.push(item);
    }
    flush();
  }
  const rows = [...lines, ...joined];
  for (const next of rows.filter(line => /^[x×]\s*\d/i.test(line.text.trim()))) {
    const above = rows.filter(line => line.y + line.height <= next.y + 1 && next.y - line.y - line.height <= Math.max(line.height, next.height) * 1.3
      && Math.abs(line.x + line.width / 2 - next.x - next.width / 2) <= Math.max(line.width, next.width) * .4
      && readDimensions(line.text).length > 0 && !readDimensionPairs(line.text).length);
    // Multiple preceding rows/columns are ambiguous; do not associate their values by order.
    const distinct = above.filter(line => !above.some(other => other !== line && other.x <= line.x && other.x + other.width >= line.x + line.width && other.width > line.width));
    if (distinct.length === 1) joined.push(combine([distinct[0]!, next]));
  }
  return [...lines, ...joined];
}

/** Only explicitly unit-labelled lengths qualify. Areas and unitless numbers are not distances. */
export function readDimensions(text: string): ReadDimension[] {
  const normal = text.replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/([m'"t])\s*[x×]\s*(?=\d)/gi, '$1 × ');
  const candidates = normal.match(/(?<![\w.,])\d+(?:[.,]\d+)?\s*(?:mm|cm|m(?![²2\w])|(?:ft|feet|')\s*(?:\d+(?:[.,]\d+)?\s*(?:in|inches|"))?)(?![\w²])/gi) ?? [];
  const values = new Map<number, ReadDimension>();
  for (const label of candidates) {
    const mm = parseLength(label);
    if (mm !== null && mm >= 100 && mm <= 100000) values.set(mm, { label: label.trim(), mm });
  }
  return [...values.values()];
}

const roomPattern = /\b(?:living(?:\s+room)?|lounge|dining(?:\s+room)?|kitchen(?:\s*[/&-]\s*(?:dining|breakfast)(?:\s+room)?)?|bedroom\s*\d*|bathroom|shower\s+room|wc|hall(?:way)?|landing|stairs?|utility(?:\s+room)?|study|office|garage|conservatory)\b/i;
export function readRoomName(text: string): string | undefined {
  const match = text.match(roomPattern)?.[0].trim();
  return match?.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bWc\b/, 'WC');
}

export function readRoomNames(reading: PlanReading): string[] {
  return [...new Set(reading.text.split(/[\r\n]+/).flatMap(line => readRoomName(line) ?? []))];
}

/** Marketing footers alone are not useful embedded floor-plan text. */
export function hasUsefulPlanText(reading: PlanReading | undefined): boolean {
  return !!reading && (readRoomNames(reading).length > 0 || readDimensions(reading.text).length > 0);
}

/** Spatial suggestions stay tied to text inside the outline; never create or rename saved rooms. */
export function suggestRoomName(reading: PlanReading | undefined, polygon: readonly Point[]): string | undefined {
  if (!reading || polygon.length < 3) return;
  const inside = (x: number, y: number) => {
    let contained = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!, b = polygon[j]!;
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) contained = !contained;
    }
    return contained;
  };
  return reading.lines.filter(line => (line.reviewed || line.confidence >= 45) && inside(line.x + line.width / 2, line.y + line.height / 2))
    .sort((a, b) => Number(!!b.reviewed) - Number(!!a.reviewed) || b.confidence - a.confidence).map(line => readRoomName(line.text)).find(Boolean);
}

/** Spatial suggestions stay inside this outline; no dimensions are borrowed from neighbouring rooms. */
export function suggestRoomText(reading: PlanReading | undefined, polygon: readonly Point[]): RoomTextSuggestion {
  const name = suggestRoomName(reading, polygon);
  if (!reading || polygon.length < 3) return { name };
  const inside = (x: number, y: number) => {
    let contained = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!, b = polygon[j]!;
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) contained = !contained;
    }
    return contained;
  };
  const lines = reading.lines.filter(line => (line.reviewed || line.confidence >= 25) && inside(line.x + line.width / 2, line.y + line.height / 2)).map(line => line.reviewed ? { ...line, confidence: 100 } : line);
  const candidates = dimensionTextLines(lines).flatMap(line => readDimensionPairs(line.text).map(pair => ({ ...pair, confidence: line.confidence })));
  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  const samePair = (a: ReadDimensionPair, b: ReadDimensionPair) => {
    const aa = [a.widthMm, a.heightMm].sort((x, y) => x - y), bb = [b.widthMm, b.heightMm].sort((x, y) => x - y);
    return aa.every((value, i) => Math.abs(value - bb[i]!) <= Math.max(80, value * .025));
  };
  const unclear = !best ? lines.find(line => /\d[^\n]*[x×]\s*\d/i.test(line.text))?.text : undefined;
  return { name, dimensions: best ? { ...best, ambiguous: candidates.some(candidate => !samePair(best, candidate)) } : undefined,
    ...(unclear ? { dimensionWarning: unclear } : {}) };
}

export interface PlanDimensionComparison {
  printed: ReadDimensionPair & { confidence: number; ambiguous: boolean };
  measured?: { widthMm: number; heightMm: number };
  status: 'unscaled' | 'match' | 'difference' | 'approximate';
  reason?: 'irregular' | 'rotated' | 'uncertain_text' | 'multiple_dimensions';
  differencePercent?: number;
}

/** Compare in a room-aligned frame. A rotated or irregular outline remains an approximate check. */
export function comparePlanDimensions(reading: PlanReading | undefined, polygon: readonly Point[], mmPerPx?: number): PlanDimensionComparison | undefined {
  const printed = suggestRoomText(reading, polygon).dimensions;
  if (!printed) return;
  if (!mmPerPx || !Number.isFinite(mmPerPx) || mmPerPx <= 0) return { printed, status: 'unscaled' };
  const edges = polygon.map((point, index) => ({ x: polygon[(index + 1) % polygon.length]!.x - point.x, y: polygon[(index + 1) % polygon.length]!.y - point.y }));
  const longest = [...edges].sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y))[0]!;
  const angle = Math.atan2(longest.y, longest.x), cosine = Math.cos(angle), sine = Math.sin(angle);
  const aligned = polygon.map(point => ({ x: point.x * cosine + point.y * sine, y: -point.x * sine + point.y * cosine }));
  const widthMm = (Math.max(...aligned.map(point => point.x)) - Math.min(...aligned.map(point => point.x))) * mmPerPx;
  const heightMm = (Math.max(...aligned.map(point => point.y)) - Math.min(...aligned.map(point => point.y))) * mmPerPx;
  const actual = [widthMm, heightMm].sort((a, b) => a - b), expected = [printed.widthMm, printed.heightMm].sort((a, b) => a - b);
  const differences = actual.map((value, i) => Math.abs(value - expected[i]!));
  const match = differences.every((difference, i) => difference <= Math.max(100, expected[i]! * .05));
  const rectangle = polygon.length === 4 && edges.every((edge, i) => {
    const next = edges[(i + 1) % edges.length]!;
    return Math.hypot(edge.x, edge.y) > 0 && Math.hypot(next.x, next.y) > 0 && Math.abs((edge.x * next.x + edge.y * next.y) / (Math.hypot(edge.x, edge.y) * Math.hypot(next.x, next.y))) < .035;
  });
  const rotated = Math.min(Math.abs(sine), Math.abs(cosine)) > Math.sin(2 * Math.PI / 180);
  const reason = printed.ambiguous ? 'multiple_dimensions' : printed.confidence < 70 ? 'uncertain_text' : !rectangle ? 'irregular' : rotated ? 'rotated' : undefined;
  return { printed, measured: { widthMm, heightMm }, status: reason ? 'approximate' : match ? 'match' : 'difference', reason, differencePercent: Math.max(...differences.map((difference, i) => difference / expected[i]! * 100)) };
}
