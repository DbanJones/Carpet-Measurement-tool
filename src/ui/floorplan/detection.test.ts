import { describe, expect, it } from 'vitest';
import { detectAllRooms, detectRoom, mapAllRoomsDetectionResult, mapDetectionResult, type AllRoomsDetectionResult, type DetectionImage, type DetectionResult } from './detection';
import { pixelPolygonArea, pointInPixelPolygon, type Px } from './tracing';
import { outlinesOverlap } from './outlineEditing';

function blank(width = 220, height = 180, transparent = false): DetectionImage {
  const data = new Uint8ClampedArray(width * height * 4);
  if (!transparent) data.fill(255);
  return { width, height, data };
}
function rect(image: DetectionImage, x: number, y: number, width: number, height: number, value = 0) {
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
    const i = (row * image.width + col) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
}
function walls(image: DetectionImage, points: Px[], thickness = 4) {
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!;
    rect(image, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(thickness, Math.abs(b.x - a.x)), Math.max(thickness, Math.abs(b.y - a.y)));
  });
  return image;
}
const rectangle = (transparent = false) => walls(blank(220, 180, transparent), [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 140 }, { x: 20, y: 140 }]);
function bottomDoorSwing(image: DetectionImage, x: number, radius = 30, leafRatio = 1) {
  rect(image, x, 140, radius, 4, 255);
  const leafLength = Math.round(radius * leafRatio);
  rect(image, x, 140 - leafLength, 2, leafLength);
  for (let i = 0; i <= 180; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 360;
    rect(image, Math.round(x + radius * Math.cos(angle)), Math.round(140 + leafLength * Math.sin(angle)), 2, 2);
  }
}
function success(result: DetectionResult) {
  expect(result.ok, !result.ok ? result.reason : undefined).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('local room detection', () => {
  it('finds the inner wall faces of a sealed rectangular room', () => {
    const result = success(detectRoom(rectangle(), { x: 60, y: 60 }, { mmPerPx: 25 }));
    expect(result.polygon).toHaveLength(4);
    expect(pixelPolygonArea(result.polygon)).toBe(156 * 116);
    expect(Math.min(...result.polygon.map((p) => p.x))).toBe(24);
    expect(Math.max(...result.polygon.map((p) => p.x))).toBe(180);
    expect(result.inferredGaps).toEqual([]);
  });

  it('preserves a concave L-shaped room rather than replacing it with a rectangle', () => {
    const image = walls(blank(), [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 80 }, { x: 100, y: 80 }, { x: 100, y: 150 }, { x: 20, y: 150 }]);
    const result = success(detectRoom(image, { x: 50, y: 60 }, { mmPerPx: 25 }));
    expect(result.polygon).toHaveLength(6);
    expect(pointInPixelPolygon({ x: 150, y: 60 }, result.polygon)).toBe(true);
    expect(pointInPixelPolygon({ x: 50, y: 130 }, result.polygon)).toBe(true);
    expect(pointInPixelPolygon({ x: 150, y: 130 }, result.polygon)).toBe(false);
  });

  it('closes a supported door-width gap and returns the inferred opening for visible review', () => {
    const image = rectangle();
    rect(image, 80, 20, 25, 4, 255);
    const result = success(detectRoom(image, { x: 60, y: 60 }, { mmPerPx: 25 }));
    expect(pixelPolygonArea(result.polygon)).toBe(156 * 116);
    expect(result.inferredGaps).toHaveLength(1);
    expect(result.inferredGaps[0]!.a.x).toBe(80);
    expect(result.inferredGaps[0]!.b.x).toBe(105);
    expect(result.message).toMatch(/possible door openings/);
  });

  it('does not assume a door width before calibration', () => {
    const image = rectangle();
    rect(image, 80, 20, 25, 4, 255);
    const result = detectRoom(image, { x: 60, y: 60 });
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/escapes/) });
  });

  it('removes a fine inward door swing from the suggested floor boundary', () => {
    const image = rectangle();
    bottomDoorSwing(image, 80);
    const result = success(detectRoom(image, { x: 50, y: 50 }, { mmPerPx: 25 }));
    expect(result.measurementPolygon).toHaveLength(4);
    expect(result.polygon).toHaveLength(8);
    expect(pixelPolygonArea(result.polygon)).toBe(156 * 116 + 30 * 2);
    expect(pointInPixelPolygon({ x: 85, y: 135 }, result.polygon)).toBe(true);
    expect(pointInPixelPolygon({ x: 95, y: 141 }, result.polygon)).toBe(true);
    expect(pointInPixelPolygon({ x: 75, y: 141 }, result.polygon)).toBe(false);
    expect(result.inferredGaps.length).toBeGreaterThan(0);
    expect(result.detectedDoorways).toMatchObject([{ evidence: 'swing-arc', confidence: 'high', floorIncluded: true }]);
  });

  it('recognizes an exterior door beside a corner using the perpendicular wall as jamb support', () => {
    const image = rectangle();
    bottomDoorSwing(image, 24);
    const result = success(detectRoom(image, { x: 70, y: 70 }, { mmPerPx: 25 }));
    expect(result.measurementPolygon).toHaveLength(4);
    expect(result.detectedDoorways).toMatchObject([{ evidence: 'swing-arc', confidence: 'high', floorIncluded: true }]);
    expect(pointInPixelPolygon({ x: 40, y: 141 }, result.polygon)).toBe(true);
    expect(Math.abs(result.detectedDoorways![0]!.a.x - 24)).toBeLessThanOrEqual(2);
    expect(result.detectedDoorways![0]!.b.x).toBeCloseTo(54, 0);
  });

  it('keeps light teal door-symbol evidence through the wall-cleanup pass', () => {
    const image = rectangle();
    bottomDoorSwing(image, 80);
    // Light symbols remain visible to the symbol mask even when wall analysis removes them.
    for (let y = 105; y < 140; y++) for (let x = 78; x < 114; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i] === 0) { image.data[i] = 161; image.data[i + 1] = 211; image.data[i + 2] = 204; }
    }
    const result = success(detectRoom(image, { x: 50, y: 50 }, { mmPerPx: 25 }));
    expect(result.measurementPolygon).toHaveLength(4);
    expect(result.polygon).toHaveLength(8);
    expect(result.detectedDoorways).toMatchObject([{ evidence: 'swing-arc', confidence: 'high' }]);
  });

  it('finds the short teal elliptical leaf-and-arc symbol beside a corner', () => {
    const image = rectangle();
    bottomDoorSwing(image, 24, 30, 0.8);
    for (let y = 112; y < 140; y++) for (let x = 24; x < 58; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i] === 0) { image.data[i] = 133; image.data[i + 1] = 194; image.data[i + 2] = 184; }
    }
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 25 }));
    expect(result.candidates).toHaveLength(1);
    const doors = result.candidates[0]!.detectedDoorways;
    expect(doors, JSON.stringify(result)).toMatchObject([{ evidence: 'swing-arc', confidence: 'high', floorIncluded: true }]);
    expect(pointInPixelPolygon({ x: 40, y: 141 }, result.candidates[0]!.polygon)).toBe(true);
    const leafLength = Math.hypot(doors![0]!.leafEnd!.x - doors![0]!.hinge!.x, doors![0]!.leafEnd!.y - doors![0]!.hinge!.y);
    expect(Math.abs(leafLength - 24)).toBeLessThan(5);
  });

  it('does not close a near-corner gap without the extra door-symbol evidence', () => {
    const image = rectangle();
    rect(image, 24, 140, 30, 4, 255);
    expect(detectRoom(image, { x: 70, y: 70 }, { mmPerPx: 25 })).toMatchObject({ ok: false });
  });

  it('maps symbol geometry back from a downsampled raster', () => {
    const small = rectangle();
    bottomDoorSwing(small, 80);
    const image = blank(2400, 1600);
    for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) {
      if (small.data[(y * small.width + x) * 4] === 0) rect(image, x * 4, y * 4, 4, 4);
    }
    const result = success(detectRoom(image, { x: 200, y: 200 }, { mmPerPx: 6.25 }));
    expect(result.detectedDoorways, JSON.stringify(result)).toMatchObject([{ evidence: 'swing-arc', confidence: 'high', floorIncluded: true }]);
    expect(pointInPixelPolygon({ x: 380, y: 564 }, result.polygon)).toBe(true);
    expect(Math.abs(result.detectedDoorways![0]!.a.x - 320)).toBeLessThanOrEqual(8);
    expect(Math.abs(result.detectedDoorways![0]!.b.x - 440)).toBeLessThanOrEqual(8);
    expect(Math.abs(result.detectedDoorways![0]!.hinge!.y - 560)).toBeLessThanOrEqual(10);
  });

  it('keeps a fine partition when removing decorative strokes would merge neighbouring rooms', () => {
    const image = rectangle();
    rect(image, 100, 20, 2, 120);
    bottomDoorSwing(image, 50);
    const result = success(detectRoom(image, { x: 40, y: 50 }, { mmPerPx: 25 }));
    expect(Math.max(...result.polygon.map((p) => p.x))).toBe(100);
    expect(pointInPixelPolygon({ x: 130, y: 70 }, result.polygon)).toBe(false);
  });

  it('rejects an opening wider than the physical gap budget', () => {
    const image = rectangle();
    rect(image, 70, 20, 60, 4, 255);
    expect(detectRoom(image, { x: 60, y: 60 }, { mmPerPx: 25 })).toMatchObject({ ok: false, reason: expect.stringMatching(/escapes/) });
  });

  it('rejects outside clicks, blank pages and seeds beyond the image', () => {
    expect(detectRoom(rectangle(), { x: 5, y: 5 })).toMatchObject({ ok: false });
    expect(detectRoom(blank(), { x: 60, y: 60 })).toMatchObject({ ok: false });
    expect(detectRoom(rectangle(), { x: 220, y: 60 })).toMatchObject({ ok: false });
    expect(detectRoom(rectangle(), { x: NaN, y: 60 })).toMatchObject({ ok: false });
  });

  it('rejects wall and label clicks without silently moving the seed into another room', () => {
    const image = rectangle();
    rect(image, 60, 60, 4, 12);
    expect(detectRoom(image, { x: 20, y: 70 })).toMatchObject({ ok: false, reason: expect.stringMatching(/wall, label or furniture/) });
    expect(detectRoom(image, { x: 61, y: 61 })).toMatchObject({ ok: false });
  });

  it('ignores isolated text inside the room when tracing its outer boundary', () => {
    const image = rectangle();
    for (let i = 0; i < 6; i++) rect(image, 70 + i * 7, 65, 3, 10);
    const result = success(detectRoom(image, { x: 45, y: 45 }, { mmPerPx: 25 }));
    expect(pixelPolygonArea(result.polygon)).toBe(156 * 116);
  });

  it('rejects a small enclosed symbol rather than creating a room from it', () => {
    const image = rectangle();
    walls(image, [{ x: 60, y: 60 }, { x: 75, y: 60 }, { x: 75, y: 75 }, { x: 60, y: 75 }], 2);
    expect(detectRoom(image, { x: 65, y: 65 }, { mmPerPx: 25 })).toMatchObject({ ok: false, reason: expect.stringMatching(/too small/) });
  });

  it('composites transparent black PNG pixels onto white before detecting walls', () => {
    const result = success(detectRoom(rectangle(true), { x: 60, y: 60 }, { mmPerPx: 25 }));
    expect(pixelPolygonArea(result.polygon)).toBe(156 * 116);
  });

  it('maps downsampled large images back to original image pixels', () => {
    const image = walls(blank(2400, 1200), [{ x: 200, y: 100 }, { x: 2200, y: 100 }, { x: 2200, y: 1000 }, { x: 200, y: 1000 }], 8);
    const result = success(detectRoom(image, { x: 500, y: 400 }, { mmPerPx: 2 }));
    expect(Math.min(...result.polygon.map((p) => p.x))).toBe(208);
    expect(Math.max(...result.polygon.map((p) => p.x))).toBe(2200);
    expect(Math.min(...result.polygon.map((p) => p.y))).toBe(108);
    expect(Math.max(...result.polygon.map((p) => p.y))).toBe(1000);
  });

  it('maps inferred spans as well as polygon coordinates with independently rounded axes', () => {
    const result = success(mapDetectionResult({ ok: true, polygon: [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 5 }], measurementPolygon: [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }], inferredGaps: [{ a: { x: 1, y: 2 }, b: { x: 4, y: 2 } }],
      detectedDoorways: [{ a: { x: 1, y: 2 }, b: { x: 4, y: 2 }, hinge: { x: 1, y: 2 }, leafEnd: { x: 1, y: 5 }, evidence: 'swing-arc', confidence: 'high' }] }, 3, 2));
    expect(result.polygon[0]).toEqual({ x: 3, y: 4 });
    expect(result.inferredGaps[0]).toEqual({ a: { x: 3, y: 4 }, b: { x: 12, y: 4 } });
    expect(result.detectedDoorways).toEqual([{ a: { x: 3, y: 4 }, b: { x: 12, y: 4 }, hinge: { x: 3, y: 4 }, leafEnd: { x: 3, y: 10 }, evidence: 'swing-arc', confidence: 'high' }]);
    expect(result.measurementPolygon).toEqual([{ x: 3, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 8 }]);
  });

  it('rejects malformed rasters without unbounded allocation', () => {
    expect(detectRoom({ width: 100000, height: 100000, data: new Uint8ClampedArray() }, { x: 1, y: 1 })).toMatchObject({ ok: false });
    expect(detectRoom({ width: 10, height: 10, data: new Uint8ClampedArray(4) }, { x: 1, y: 1 })).toMatchObject({ ok: false });
  });
});

function fourRooms(): DetectionImage {
  const image = walls(blank(420, 300), [{ x: 20, y: 20 }, { x: 390, y: 20 }, { x: 390, y: 270 }, { x: 20, y: 270 }]);
  rect(image, 205, 20, 4, 250);
  rect(image, 20, 145, 370, 4);
  // One internal doorway and an external entrance must be closed from supported wall runs.
  rect(image, 205, 75, 4, 28, 255);
  rect(image, 95, 270, 28, 4, 255);
  return image;
}
function allSuccess(result: AllRoomsDetectionResult) {
  expect(result.ok, !result.ok ? result.reason : undefined).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('detect all rooms', () => {
  it('finds separate rooms, infers shared/external door closures, and never includes exterior', () => {
    const result = allSuccess(detectAllRooms(fourRooms(), { mmPerPx: 25 }));
    expect(result.candidates).toHaveLength(4);
    for (const seed of [{ x: 60, y: 60 }, { x: 250, y: 60 }, { x: 60, y: 210 }, { x: 250, y: 210 }]) {
      expect(result.candidates.filter(room => pointInPixelPolygon(seed, room.polygon))).toHaveLength(1);
    }
    expect(result.candidates.filter(room => room.inferredGaps.length > 0)).toHaveLength(3);
    expect(result.candidates.some(room => pointInPixelPolygon({ x: 5, y: 5 }, room.polygon))).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.candidates.every(candidate => candidate.detectedDoorways?.length === 0)).toBe(true);
  });

  it('filters text counters and nested furniture outlines without losing the actual room', () => {
    const image = fourRooms();
    walls(image, [{ x: 60, y: 50 }, { x: 115, y: 50 }, { x: 115, y: 100 }, { x: 60, y: 100 }], 4);
    for (let n = 0; n < 5; n++) walls(image, [{ x: 240 + n * 12, y: 70 }, { x: 247 + n * 12, y: 70 }, { x: 247 + n * 12, y: 79 }, { x: 240 + n * 12, y: 79 }], 1);
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 25 }));
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates[0]!.polygon).toHaveLength(4);
  });

  it('skips a closed page border surrounding several rooms', () => {
    const image = fourRooms();
    walls(image, [{ x: 3, y: 3 }, { x: 415, y: 3 }, { x: 415, y: 295 }, { x: 3, y: 295 }], 1);
    expect(allSuccess(detectAllRooms(image, { mmPerPx: 25 })).candidates).toHaveLength(4);
  });

  it('excludes existing room or stair polygons, including a partial overlap, on repeated scans', () => {
    const image = fourRooms();
    const first = allSuccess(detectAllRooms(image, { mmPerPx: 25 }));
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 25, excludePolygons: [first.candidates[0]!.polygon,
      [{ x: 250, y: 180 }, { x: 300, y: 180 }, { x: 300, y: 230 }, { x: 250, y: 230 }]] }));
    expect(result.candidates).toHaveLength(2);
    expect(result.omitted).toBeGreaterThanOrEqual(2);
    const again = allSuccess(detectAllRooms(image, { mmPerPx: 25, excludePolygons: first.candidates.map(room => room.polygon) }));
    expect(again.candidates).toEqual([]);
    expect(again.message).toMatch(/No new enclosed rooms/);
  });

  it('leaves an unsafe recess unexpanded and explains when another measured space occupies it', () => {
    const image = rectangle();
    bottomDoorSwing(image, 80);
    const occupied = [{ x: 84, y: 141 }, { x: 108, y: 141 }, { x: 108, y: 145 }, { x: 84, y: 145 }];
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 25, excludePolygons: [occupied] }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.detectedDoorways).toMatchObject([{ floorIncluded: false, floorWarning: expect.stringMatching(/another room/) }]);
    expect(pixelPolygonArea(result.candidates[0]!.polygon)).toBe(156 * 116);
    expect(outlinesOverlap(result.candidates[0]!.polygon, occupied)).toBe(false);
  });

  it('keeps fine partitions while simplifying a door swing in one room', () => {
    const image = rectangle();
    rect(image, 100, 20, 2, 120);
    bottomDoorSwing(image, 50);
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 25 }));
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every(room => !(pointInPixelPolygon({ x: 40, y: 50 }, room.polygon)
      && pointInPixelPolygon({ x: 130, y: 50 }, room.polygon)))).toBe(true);
  });

  it('cleans a fine door swing without tracing it as another room', () => {
    const image = rectangle();
    bottomDoorSwing(image, 80);
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 25 }));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.measurementPolygon).toHaveLength(4);
    expect(result.candidates[0]!.polygon).toHaveLength(8);
  });

  it('attaches the same shared door to both rooms even when its swing is drawn on only one side', () => {
    const image = walls(blank(220, 280), [{ x: 20, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 260 }, { x: 20, y: 260 }]);
    rect(image, 20, 140, 180, 4);
    bottomDoorSwing(image, 80);
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 25 }));
    expect(result.candidates).toHaveLength(2);
    for (const room of result.candidates) {
      expect(room.detectedDoorways).toMatchObject([{ evidence: 'swing-arc', confidence: 'high', floorIncluded: true }]);
      expect(Math.abs(room.detectedDoorways![0]!.a.x - 80)).toBeLessThanOrEqual(2);
      expect(Math.abs(room.detectedDoorways![0]!.b.x - 110)).toBeLessThanOrEqual(2);
    }
    const [upper, lower] = result.candidates;
    expect(upper!.detectedDoorways![0]!.a).toEqual(lower!.detectedDoorways![0]!.a);
    expect(upper!.detectedDoorways![0]!.b).toEqual(lower!.detectedDoorways![0]!.b);
    expect(outlinesOverlap(upper!.polygon, lower!.polygon)).toBe(false);
    expect(pixelPolygonArea(upper!.polygon) + pixelPolygonArea(lower!.polygon)).toBe(2 * 176 * 116 + 30 * 4);
    for (const y of [140.5, 141.5, 142.5, 143.5]) expect(result.candidates.filter(room => pointInPixelPolygon({ x: 95, y }, room.polygon))).toHaveLength(1);
    const single = success(detectRoom(image, { x: 60, y: 70 }, { mmPerPx: 25 }));
    expect(single.polygon).toEqual(upper!.polygon);
  });

  it('bounds review batches and permits another pass after adding the first batch', () => {
    const image = fourRooms();
    const first = allSuccess(detectAllRooms(image, { mmPerPx: 25, maxRooms: 2 }));
    expect(first.candidates).toHaveLength(2);
    expect(first.truncated).toBe(true);
    const second = allSuccess(detectAllRooms(image, { mmPerPx: 25, maxRooms: 2, excludePolygons: first.candidates.map(room => room.polygon) }));
    expect(second.candidates).toHaveLength(2);
    expect(second.truncated).toBe(false);
  });

  it('finds remaining rooms beyond the trace cap after previously reviewed regions are excluded', () => {
    const image = blank(360, 360);
    const existing: Px[][] = [];
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
      const left = 10 + x * 30, top = 10 + y * 30;
      walls(image, [{ x: left, y: top }, { x: left + 26, y: top }, { x: left + 26, y: top + 26 }, { x: left, y: top + 26 }], 4);
      if (x !== 10 || y !== 10) existing.push([{ x: left + 4, y: top + 4 }, { x: left + 26, y: top + 4 },
        { x: left + 26, y: top + 26 }, { x: left + 4, y: top + 26 }]);
    }
    const result = allSuccess(detectAllRooms(image, { mmPerPx: 100, maxRooms: 1, excludePolygons: existing }));
    expect(result.candidates).toHaveLength(1);
    expect(pointInPixelPolygon({ x: 320, y: 320 }, result.candidates[0]!.polygon)).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('has cooperative cancellation during a large connected-component pass', () => {
    let checks = 0;
    const result = detectAllRooms(blank(1200, 1200), {}, { cancelled: () => ++checks > 3 });
    expect(result).toEqual({ ok: false, reason: 'Detection cancelled.' });
    expect(checks).toBeLessThan(10);
  });

  it('maps every candidate and inferred doorway when a worker uses a smaller raster', () => {
    const result = allSuccess(detectAllRooms(fourRooms(), { mmPerPx: 25 }));
    const mapped = allSuccess(mapAllRoomsDetectionResult(result, 2, 3));
    expect(mapped.candidates[0]!.polygon[0]).toEqual({ x: result.candidates[0]!.polygon[0]!.x * 2, y: result.candidates[0]!.polygon[0]!.y * 3 });
    const originalDoor = result.candidates.find(room => room.inferredGaps.length)!.inferredGaps[0]!;
    const mappedDoor = mapped.candidates.find(room => room.inferredGaps.length)!.inferredGaps[0]!;
    expect(mappedDoor.a).toEqual({ x: originalDoor.a.x * 2, y: originalDoor.a.y * 3 });
  });

  it('returns a useful empty review batch for blank pages and rejects malformed rasters', () => {
    expect(allSuccess(detectAllRooms(blank())).candidates).toEqual([]);
    expect(detectAllRooms({ width: 100000, height: 100000, data: new Uint8ClampedArray() })).toMatchObject({ ok: false });
  });
});
