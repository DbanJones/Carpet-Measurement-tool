import { comparePlanDimensions, correctPlanTextLine, hasUsefulPlanText, readDimensionPairs, readDimensions, readRoomName, readRoomNames, suggestRoomName, suggestRoomText } from './planText';
import type { PlanReading } from '@engine/types';

it('reads metric and imperial lengths while rejecting room areas and unitless guesses', () => {
  const values = readDimensions('LOUNGE 4.35m x 3.10m. Area 13.5m². Bed 2, 12′6″ x 10 ft 3 in. 350 cm. 4350 mm. 1:100. 5.8 m2. 7.2');
  expect(values.map(value => value.mm)).toEqual([4350, 3100, 3810, 3124, 3500]);
  expect(readDimensions('Area 35m² and 12m2; 8 bedrooms; scale 1:100')).toEqual([]);
  expect(readDimensions('435mx3.10m')).toEqual([{ label: '3.10m', mm: 3100 }]);
  expect(readDimensions('43.50m2 2.3.10m 435m')).toEqual([]);
});

it('recognises paired metric, shared metric units and estate-agent feet and inches without inventing units', () => {
  expect(readDimensionPairs('4.20m x 3.10m')).toEqual([{ label: '4.20m × 3.10m', widthMm: 4200, heightMm: 3100 }]);
  expect(readDimensionPairs('4,2 × 3,1 m')[0]).toMatchObject({ widthMm: 4200, heightMm: 3100 });
  expect(readDimensionPairs('4mx3m')[0]).toMatchObject({ widthMm: 4000, heightMm: 3000 });
  expect(readDimensionPairs('12′6″ x 10 ft 3 in')[0]).toMatchObject({ widthMm: 3810, heightMm: 3124 });
  expect(readDimensionPairs('12 ft 6 in × 10′3″')[0]).toMatchObject({ widthMm: 3810, heightMm: 3124 });
  expect(readDimensionPairs('4.2 x 3.1 or 12 x 10 ft or 4m2 x 3m or 430m x 3m')).toEqual([]);
  expect(readDimensionPairs('4.2m x 3.1m (13′9″ x 10′2″)')).toHaveLength(1);
});

const roomPolygon = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
const roomReading: PlanReading = { source: 'ocr', text: 'BEDROOM\n4m x 3m', lines: [
  { text: 'BEDROOM', x: 130, y: 110, width: 100, height: 20, confidence: 95 },
  { text: '4m x 3m', x: 130, y: 140, width: 100, height: 20, confidence: 92 },
  { text: '7m x 8m', x: 480, y: 140, width: 100, height: 20, confidence: 99 },
] };

it('associates names and dimensions only with text inside the outline', () => {
  expect(suggestRoomText(roomReading, roomPolygon)).toMatchObject({ name: 'Bedroom', dimensions: { widthMm: 4000, heightMm: 3000, confidence: 92, ambiguous: false } });
  expect(suggestRoomText(roomReading, roomPolygon.map(point => ({ x: point.x + 1000, y: point.y })))).toEqual({ name: undefined, dimensions: undefined });
  expect(suggestRoomText({ ...roomReading, lines: roomReading.lines.map(line => ({ ...line, confidence: 20 })) }, roomPolygon).dimensions).toBeUndefined();
  expect(suggestRoomText(undefined, []).dimensions).toBeUndefined();
  expect(suggestRoomText({ ...roomReading, lines: [{ ...roomReading.lines[1]!, text: '435mx3.10m' }] }, roomPolygon)).toMatchObject({ dimensions: undefined, dimensionWarning: '435mx3.10m' });
});

it('joins adjacent PDF text items on one baseline but does not join separate rows', () => {
  const reading: PlanReading = { source: 'pdf', text: 'Bedroom\n4.00m x 3.00m', lines: [
    { text: '4.00m', x: 100, y: 140, width: 45, height: 12, confidence: 100 },
    { text: 'x', x: 150, y: 141, width: 6, height: 12, confidence: 100 },
    { text: '3.00m', x: 163, y: 140, width: 45, height: 12, confidence: 100 },
  ] };
  expect(suggestRoomText(reading, roomPolygon).dimensions).toMatchObject({ widthMm: 4000, heightMm: 3000 });
  expect(suggestRoomText({ ...reading, lines: reading.lines.map((line, index) => ({ ...line, y: 30 + index * 60 })) }, roomPolygon).dimensions).toBeUndefined();
});

it('joins a nearby explicit wrapped dimension row but never borrows a value from a different column', () => {
  const reading: PlanReading = { source: 'ocr', text: '', lines: [
    { text: '3.00m (9\'10\") max', x: 100, y: 140, width: 110, height: 12, confidence: 92 },
    { text: 'x 2.67m (8\'9\")', x: 109, y: 156, width: 90, height: 12, confidence: 91 },
  ] };
  expect(suggestRoomText(reading, roomPolygon).dimensions).toMatchObject({ widthMm: 3000, heightMm: 2670, ambiguous: false });
  expect(suggestRoomText({ ...reading, lines: [reading.lines[0]!, { ...reading.lines[1]!, x: 260 }] }, roomPolygon).dimensions).toBeUndefined();
  expect(readDimensionPairs('300m (9\'10\") max x 2.67m')).toEqual([]);
});

it('checks scale and outline dimensions with tolerance, without applying printed values', () => {
  expect(comparePlanDimensions(roomReading, roomPolygon)?.status).toBe('unscaled');
  expect(comparePlanDimensions(roomReading, roomPolygon, 10)?.status).toBe('match');
  expect(comparePlanDimensions(roomReading, roomPolygon, 10.4)?.status).toBe('match');
  expect(comparePlanDimensions(roomReading, roomPolygon, 12)).toMatchObject({ status: 'difference', differencePercent: 20 });
  const lowConfidence = { ...roomReading, lines: roomReading.lines.map(line => ({ ...line, confidence: 60 })) };
  expect(comparePlanDimensions(lowConfidence, roomPolygon, 10)).toMatchObject({ status: 'approximate', reason: 'uncertain_text' });
  expect(comparePlanDimensions({ ...roomReading, lines: [{ ...roomReading.lines[1]!, confidence: 33 }] }, roomPolygon, 10)).toMatchObject({ status: 'approximate', reason: 'uncertain_text' });
});

it('marks rotated and irregular outlines as approximate instead of reporting a misleading pass or failure', () => {
  const angle = Math.PI / 6;
  const rotate = (point: { x: number; y: number }) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
  const rotatedReading = { ...roomReading, lines: [{ text: '4m x 3m', ...rotate({ x: 150, y: 130 }), width: 1, height: 1, confidence: 99 }] };
  const check = comparePlanDimensions(rotatedReading, roomPolygon.map(rotate), 10)!;
  expect(check).toMatchObject({ status: 'approximate', reason: 'rotated' });
  expect(check.measured?.widthMm).toBeCloseTo(4000);
  expect(check.measured?.heightMm).toBeCloseTo(3000);
  expect(comparePlanDimensions(roomReading, [roomPolygon[0]!, roomPolygon[1]!, { x: 330, y: 300 }, roomPolygon[3]!], 10)).toMatchObject({ status: 'approximate', reason: 'irregular' });
});

it('flags conflicting printed pairs but accepts equivalent metric and imperial pairs', () => {
  const extra = { text: '6m x 3m', x: 130, y: 180, width: 100, height: 20, confidence: 98 };
  expect(comparePlanDimensions({ ...roomReading, lines: [...roomReading.lines, extra] }, roomPolygon, 10)).toMatchObject({ status: 'approximate', reason: 'multiple_dimensions' });
  expect(comparePlanDimensions({ ...roomReading, lines: [...roomReading.lines, { ...extra, text: '13′1″ x 9′10″' }] }, roomPolygon, 10)?.status).toBe('match');
  expect(hasUsefulPlanText({ source: 'pdf', text: 'Estate Agents Ltd. Not to scale.', lines: [] })).toBe(false);
  expect(hasUsefulPlanText(roomReading)).toBe(true);
});

it('corrects a decimal at its original spatial position, updates the check, and leaves neighbouring text untouched', () => {
  const malformed = { ...roomReading, text: '7m x 8m\n400mx3m\nBEDROOM', lines: roomReading.lines.map((line, index) => index === 1 ? { ...line, text: '400mx3m', confidence: 48 } : line) };
  expect(suggestRoomText(malformed, roomPolygon).dimensionWarning).toBe('400mx3m');
  const corrected = correctPlanTextLine(malformed, 1, '4.00m x 3m');
  expect(comparePlanDimensions(corrected, roomPolygon, 10)?.status).toBe('match');
  expect(corrected.lines[1]).toEqual({ ...malformed.lines[1], text: '4.00m x 3m', reviewed: true });
  expect(corrected.lines[2]).toEqual(malformed.lines[2]);
  expect(corrected.lines[0]).toEqual(malformed.lines[0]);
  expect(corrected.text).toContain('4.00m x 3m');
  expect(correctPlanTextLine(malformed, 99, 'wrong')).toBe(malformed);
});

it('normalises estate-plan labels and suggests the label inside the outlined room', () => {
  const reading: PlanReading = { source: 'ocr', text: 'BEDROOM 2\nWC\n4.3m\nProperty details', lines: [
    { text: 'BEDROOM 2', x: 15, y: 15, width: 60, height: 20, confidence: 90 },
    { text: 'KITCHEN', x: 200, y: 100, width: 50, height: 20, confidence: 99 },
  ] };
  expect(readRoomName('MASTER BEDROOM 2')).toBe('Bedroom 2');
  expect(readRoomNames(reading)).toEqual(['Bedroom 2', 'WC']);
  expect(suggestRoomName(reading, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }])).toBe('Bedroom 2');
  expect(suggestRoomName(reading, [{ x: 110, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }])).toBeUndefined();
  expect(suggestRoomName(undefined, [])).toBeUndefined();
});
