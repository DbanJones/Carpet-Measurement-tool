import type { PlanReading, Point } from '@engine/types';
import { detectStaircases } from './staircaseDetection';
import type { DetectionImage } from './detection';

function image(width = 640, height = 400): DetectionImage { return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) }; }
function stroke(image: DetectionImage, a: Point, b: Point, thickness = 1, shade = 90) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
  for (let i = 0; i <= steps; i++) for (let dy = 0; dy < thickness; dy++) for (let dx = 0; dx < thickness; dx++) {
    const x = Math.round(a.x + (b.x - a.x) * i / steps) + dx, y = Math.round(a.y + (b.y - a.y) * i / steps) + dy;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
    const index = (y * image.width + x) * 4; image.data[index] = image.data[index + 1] = image.data[index + 2] = shade;
  }
}
function flight(img: DetectionImage, options: { count?: number; rotated?: boolean; fan?: boolean; rails?: boolean; x?: number; y?: number; gap?: number; width?: number; thickness?: number } = {}) {
  const { count = 8, rotated = false, fan = false, rails = true, x = 90, y = 100, gap = 11, width = 40, thickness = 1 } = options;
  const p = (across: number, along: number) => rotated ? { x: x + along, y: y + across } : { x: x + across, y: y + along };
  for (let i = 0; i < count; i++) stroke(img, p(0, i * gap), p(width, i * gap), thickness);
  if (rails) { stroke(img, p(0, 0), p(0, (count - 1) * gap), thickness); stroke(img, p(width, 0), p(width, (count - 1) * gap), thickness); }
  if (fan) { stroke(img, p(width, 0), p(0, -width * .45)); stroke(img, p(width, 0), p(0, -width * .9)); }
}
const options = { mmPerPx: 20 };

it('finds repeated tread lines without requiring an OCR stairs label and returns review-only measurements', () => {
  const input = image(); flight(input);
  const before = input.data.slice(); const result = detectStaircases(input, options);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({ widthMm: 800, goingMm: 220, visibleTreads: 8, estimatedRisers: 9, layout: 'straight', confidence: 'medium', headingDegrees: 90 });
  expect(result.candidates[0]!.message).toMatch(/Confirm.*risers.*direction/);
  expect(input.data.every((value, index) => value === before[index])).toBe(true);
});

it('finds horizontal flights and connected fan lines using geometry, with no assumed rise', () => {
  const input = image(); flight(input, { count: 4, fan: true, rotated: true });
  const result = detectStaircases(input, options);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({ layout: 'turning', headingDegrees: 0 });
  expect(result.candidates[0]!.visibleTreads).toBeGreaterThanOrEqual(6);
  expect(Math.min(...result.candidates[0]!.polygon.map(p => p.x))).toBeLessThan(90);
  expect(result.candidates[0]).not.toHaveProperty('riseMm');
});

it('keeps distinct stairs on a multi-floor sheet separate, without duplicates from individual tread seeds', () => {
  const input = image(); flight(input); flight(input, { x: 280, rotated: true }); flight(input, { x: 490 });
  expect(detectStaircases(input, options).candidates).toHaveLength(3);
});

it('rejects plain labels, beds/windows, loose hatching, thick walls and unscaled or implausibly small drawings', () => {
  const reading: PlanReading = { source: 'ocr', text: 'STAIRS UP', lines: [{ text: 'STAIRS UP', x: 90, y: 100, width: 80, height: 15, confidence: 99 }] };
  expect(detectStaircases(image(), { ...options, reading }).candidates).toHaveLength(0);
  for (const shape of [{ count: 3 }, { count: 8, rails: false }, { thickness: 6 }, { width: 10 }]) {
    const input = image(); flight(input, shape); expect(detectStaircases(input, options).candidates, JSON.stringify(shape)).toHaveLength(0);
  }
  const input = image(); flight(input); expect(detectStaircases(input, { mmPerPx: 0 }).candidates).toHaveLength(0);
});

it('uses a nearby recognised label to strengthen a long flight, but masks its text strokes', () => {
  const input = image(); flight(input);
  const reading: PlanReading = { source: 'ocr', text: 'UP', lines: [{ text: 'UP', x: 138, y: 130, width: 18, height: 10, confidence: 94 }] };
  expect(detectStaircases(input, { ...options, reading }).candidates[0]).toMatchObject({ name: 'Stairs', confidence: 'high' });
});

it('handles transparent pixels, cancellation and oversized images without fabricating staircases', () => {
  const input = image(); input.data.fill(0); expect(detectStaircases(input, options).candidates).toHaveLength(0);
  expect(detectStaircases(image(), options, { cancelled: () => true }).message).toMatch(/cancelled/);
  expect(detectStaircases({ width: 2000, height: 2000, data: new Uint8ClampedArray(0) }, options).candidates).toHaveLength(0);
});

it('bounds a realistic full-page raster pass without per-pixel room flood fills', () => {
  const input = image(1200, 900);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) flight(input, { x: 50 + col * 190, y: 30 + row * 170 });
  const started = performance.now(); const result = detectStaircases(input, options);
  expect(result.candidates.length).toBeLessThanOrEqual(20);
  expect(result.candidates.length).toBeGreaterThan(0);
  expect(performance.now() - started).toBeLessThan(2500);
});
