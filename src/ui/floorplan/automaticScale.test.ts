import type { PlanReading, PlanTextLine } from '@engine/types';
import { inferSuggestedScale } from './automaticScale';
import type { DetectionImage } from './detection';

function fixture(): DetectionImage {
  const width = 640, height = 400;
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}
function fill(image: DetectionImage, x: number, y: number, width: number, height: number) {
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) {
    const i = (yy * image.width + xx) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 20;
  }
}
function room(image: DetectionImage, left: number, top: number, width: number, height: number) {
  fill(image, left - 6, top - 6, width + 12, 6); fill(image, left - 6, top + height, width + 12, 6);
  fill(image, left - 6, top, 6, height); fill(image, left + width, top, 6, height);
}
const line = (text: string, x = 100, y = 150, confidence = 96): PlanTextLine => ({ text, x, y, width: 90, height: 10, confidence });
const reading = (lines: PlanTextLine[], source: 'pdf' | 'ocr' = 'ocr'): PlanReading => ({ source, lines, text: lines.map(line => line.text).join('\n') });
const lounge = () => reading([line('LOUNGE', 120, 120), line('4m x 3m', 120, 155)]);
function oneRoom() { const image = fixture(); room(image, 40, 40, 200, 150); return image; }

it('matches both printed dimensions to real walls and returns a review-only reference segment', () => {
  const input = lounge();
  const result = inferSuggestedScale(oneRoom(), input);
  expect(result.suggestion).toMatchObject({ roomName: 'Lounge', a: { x: 40, y: 40 }, b: { x: 240, y: 40 }, distance: 4000, mmPerPx: 20, matchedRooms: 1 });
  expect(result.suggestion!.checkLabel).toContain('3.00 m');
  expect(result.suggestion!.polygon).toHaveLength(4);
  expect(input).toEqual(lounge());
});

it('uses a spatially split PDF dimension row and supports swapped imperial side order', () => {
  const image = oneRoom();
  const pdf = reading([line('LOUNGE', 120, 100), { ...line('4m', 110, 145), width: 20 }, { ...line('x', 135, 145), width: 8 }, { ...line('3m', 150, 145), width: 20 }], 'pdf');
  expect(inferSuggestedScale(image, pdf).suggestion?.mmPerPx).toBeCloseTo(20);
  const imperial = reading([line('LOUNGE', 110, 100), line('9′10″ x 13′1″', 105, 145)]);
  expect(inferSuggestedScale(image, imperial).suggestion?.mmPerPx).toBeCloseTo(19.94, 1);
});

it('rejects unclear numbers, missing decimal points, area figures and transcript-only text', () => {
  for (const text of ['400m x 3m', '4 x 3', '4m² x 3m', '43.00m2', '4m x 8m']) {
    expect(inferSuggestedScale(oneRoom(), reading([line('LOUNGE', 120, 100), line(text, 110, 145)])).suggestion, text).toBeUndefined();
  }
  expect(inferSuggestedScale(oneRoom(), reading([line('LOUNGE', 120, 100), line('4m x 3m', 110, 145, 32)])).suggestion).toBeUndefined();
  expect(inferSuggestedScale(oneRoom(), { source: 'pdf', text: 'LOUNGE 4m x 3m', lines: [] }).suggestion).toBeUndefined();
});

it('accepts explicit correction of a low-confidence dimension without altering its box or assuming DPI', () => {
  const input = reading([line('LOUNGE', 120, 100), { ...line('4m x 3m', 110, 145, 32), reviewed: true }]);
  expect(inferSuggestedScale(oneRoom(), input).suggestion?.mmPerPx).toBe(20);
});

it('requires a room label inside the measured outline and does not calibrate from exterior/page text', () => {
  expect(inferSuggestedScale(oneRoom(), reading([line('4m x 3m', 110, 145)])).suggestion).toBeUndefined();
  expect(inferSuggestedScale(oneRoom(), reading([line('LOUNGE', 390, 285), line('4m x 3m', 390, 315)])).suggestion).toBeUndefined();
  const image = fixture(); room(image, 15, 15, 610, 370);
  expect(inferSuggestedScale(image, reading([line('LOUNGE', 260, 170), line('6.1m x 3.7m', 260, 200)])).suggestion).toBeUndefined();
});

it('finds the enclosing room instead of a small furniture box near its text', () => {
  const image = oneRoom();
  room(image, 50, 55, 50, 45);
  expect(inferSuggestedScale(image, lounge()).suggestion?.mmPerPx).toBe(20);
  const furniture = fixture();
  fill(furniture, 150, 120, 100, 2); fill(furniture, 150, 195, 100, 2);
  fill(furniture, 150, 120, 2, 77); fill(furniture, 248, 120, 2, 77);
  const overFurniture = reading([{ ...line('BEDROOM', 165, 140), width: 65, height: 7 }, { ...line('4m x 3m', 170, 165), width: 60, height: 7 }]);
  expect(inferSuggestedScale(furniture, overFurniture).suggestion).toBeUndefined();
});

it('cross-checks multiple rooms and refuses conflicting scales or competing lengths inside one room', () => {
  const image = oneRoom(); room(image, 330, 40, 200, 150);
  const shared = [...lounge().lines, line('BEDROOM', 375, 105), line('4m x 3m', 375, 145)];
  expect(inferSuggestedScale(image, reading(shared)).suggestion).toMatchObject({ mmPerPx: 20, matchedRooms: 2 });
  const conflict = reading([...lounge().lines, line('BEDROOM', 375, 105), line('8m x 6m', 375, 145)]);
  expect(inferSuggestedScale(image, conflict)).toMatchObject({ reason: expect.stringMatching(/different scales/) });
  expect(inferSuggestedScale(image, conflict).suggestion).toBeUndefined();
  expect(inferSuggestedScale(image, conflict, { maxVerifications: 1 })).toMatchObject({ reason: expect.stringMatching(/Not all/) });
  expect(inferSuggestedScale(oneRoom(), reading([...lounge().lines, line('8m x 6m', 120, 175)])).suggestion).toBeUndefined();
});

it('supports cancellation and bounded verification without returning a half-finished scale', () => {
  expect(inferSuggestedScale(oneRoom(), lounge(), { cancelled: () => true })).toEqual({});
  expect(inferSuggestedScale({ width: 2000, height: 2000, data: new Uint8ClampedArray(0) }, lounge()).suggestion).toBeUndefined();
});

it('measures beside a central window instead of requiring an uninterrupted wall through the dimension label', () => {
  const image = oneRoom();
  // A single thin window line closes the room but cannot serve as a thick wall bootstrap.
  for (let y = 190; y < 196; y++) for (let x = 110; x < 180; x++) {
    const index = (y * image.width + x) * 4; image.data[index] = image.data[index + 1] = image.data[index + 2] = 255;
  }
  fill(image, 110, 190, 70, 1);
  expect(inferSuggestedScale(image, reading([line('BEDROOM', 90, 100), line('4m x 3m', 100, 135)])).suggestion?.mmPerPx).toBeCloseTo(20);
});

it('supports a wrapped pair with parenthetical imperial equivalents without guessing malformed decimals', () => {
  const wrapped = reading([line('BEDROOM', 90, 100), { ...line('4.00m (13\'1\") max', 100, 130), width: 100 }, { ...line('x 3.00m (9\'10\")', 105, 143), width: 90 }]);
  expect(inferSuggestedScale(oneRoom(), wrapped).suggestion?.mmPerPx).toBeCloseTo(20);
  wrapped.lines[1] = { ...wrapped.lines[1]!, text: '400m (13\'1\") max' };
  expect(inferSuggestedScale(oneRoom(), wrapped).suggestion).toBeUndefined();
});

it('accepts a small inward door-leaf recess while rejecting a large connected irregular space', () => {
  const small = oneRoom();
  // A thick notch stands in for a stubborn closed swing outline that cleanup cannot erase.
  fill(small, 185, 40, 20, 20);
  expect(inferSuggestedScale(small, lounge()).suggestion?.mmPerPx).toBeCloseTo(20);
  const large = oneRoom(); fill(large, 180, 40, 60, 75);
  expect(inferSuggestedScale(large, lounge()).suggestion).toBeUndefined();
});
