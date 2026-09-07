import { describe, expect, it } from 'vitest';
import { makeEmptyProject } from '@store/projectStore';
import type { DetectedDoorway } from './detection';
import { detectedDoorwayPlacement, doorwayThresholdCovered, prepareDetectedDoorways, reconcileDetectedDoorways } from './doorwaySuggestions';
import type { RoomSuggestion } from './roomSuggestions';
import { traceToPolygon } from './tracing';

const top = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
const bottom = top.map(p => ({ x: p.x, y: p.y + 310 }));
const door: DetectedDoorway = { a: { x: 150, y: 300 }, b: { x: 230, y: 300 }, evidence: 'swing-arc', confidence: 'high', hinge: { x: 150, y: 300 }, leafEnd: { x: 150, y: 220 } };
const candidate = (id: string, polygon = top, doors = [door]): RoomSuggestion => ({ id, name: id, polygon, detectedDoorways: doors, inferredGaps: [], included: true });
const products = makeEmptyProject().products;
const productId = products[0]!.id;

describe('measured doorway suggestions', () => {
  it('projects a symbol onto its room wall at the calibrated width, including reverse wall direction', () => {
    expect(detectedDoorwayPlacement(door, top, 10)).toMatchObject({ edgeIndex: 2, offset: 1700, width: 800 });
    expect(detectedDoorwayPlacement(door, bottom, 10)).toMatchObject({ edgeIndex: 0, offset: 1500, width: 800 });
    expect(detectedDoorwayPlacement(door, top, 12.5)?.width).toBe(1000);
  });

  it('keeps doors on untouched walls and drops a door whose original wall moved away', () => {
    const other: DetectedDoorway = { ...door, a: { x: 400, y: 100 }, b: { x: 400, y: 180 } };
    const edited = top.map(p => ({ ...p, y: p.y === 300 ? 240 : p.y }));
    const result = reconcileDetectedDoorways([door, other], [1], edited, 10);
    expect(result.detectedDoorways).toEqual([other]);
    expect(result.excludedDoorways).toEqual([0]);
    expect(detectedDoorwayPlacement(door, edited, 10)).toBeNull();
    expect(detectedDoorwayPlacement(door, top, Number.NaN)).toBeNull();
  });

  it('saves checked symbols, skips generic gaps, and deduplicates repeated detections on the same wall', () => {
    const input = { ...candidate('one', top, [door, { ...door }]), inferredGaps: [{ a: { x: 0, y: 90 }, b: { x: 0, y: 170 } }] };
    const result = prepareDetectedDoorways([input], 10, productId, [], products);
    expect(result.byCandidate.get('one')).toHaveLength(1);
    expect(result.byCandidate.get('one')![0]).toMatchObject({ width: 800, transition: 'carpet' });
    expect(prepareDetectedDoorways([{ ...input, excludedDoorways: [0, 1] }], 10, productId, [], products).byCandidate.get('one')).toEqual([]);
  });

  it('treats carpet tiles as carpet when setting the doorway transition', () => {
    const tiles = { id: 'tiles', name: 'Carpet tiles', kind: 'carpet_tiles' as const, packCoverageM2: 5 };
    const result = prepareDetectedDoorways([candidate('one')], 10, tiles.id, [], [tiles]);
    expect(result.byCandidate.get('one')![0]!.transition).toBe('carpet');
  });

  it('links the two sides of one physical opening without linking nearby separate doors', () => {
    const result = prepareDetectedDoorways([candidate('one'), candidate('two', bottom)], 10, productId, [], products);
    const a = result.byCandidate.get('one')![0]!, b = result.byCandidate.get('two')![0]!;
    expect(a.id).not.toBe(b.id);
    expect(a.sharedOpeningId).toBeTruthy();
    expect(a.sharedOpeningId).toBe(b.sharedOpeningId);
    const shifted = { ...door, a: { x: 245, y: 300 }, b: { x: 325, y: 300 } };
    const separate = prepareDetectedDoorways([candidate('one'), candidate('two', bottom, [shifted])], 10, productId, [], products);
    expect(separate.byCandidate.get('one')![0]!.sharedOpeningId).not.toBe(separate.byCandidate.get('two')![0]!.sharedOpeningId);
  });

  it('reuses the shared opening when the next room is accepted in a later batch', () => {
    const first = prepareDetectedDoorways([candidate('one')], 10, productId, [], products).byCandidate.get('one')!;
    const saved = { id: 'saved', productId, shape: { kind: 'polygon' as const, points: traceToPolygon(top, 10) }, source: { floorPlanId: 'plan', pixelPolygon: top }, doorways: first };
    const result = prepareDetectedDoorways([candidate('two', bottom)], 10, productId, [saved], products);
    expect(result.byCandidate.get('two')![0]!.sharedOpeningId).toBe(first[0]!.sharedOpeningId);
    expect(result.links).toEqual([]);
    const withoutLink = { ...saved, doorways: first.map(d => ({ ...d, sharedOpeningId: undefined })) };
    const linked = prepareDetectedDoorways([candidate('two', bottom)], 10, productId, [withoutLink], products);
    expect(linked.links).toEqual([{ roomId: 'saved', doorwayId: first[0]!.id, sharedOpeningId: linked.byCandidate.get('two')![0]!.sharedOpeningId }]);
    expect(withoutLink.doorways[0]!.sharedOpeningId).toBeUndefined();
  });

  it('links a wrapping hallway from the local doorway sides even when both room centres lie on the same side', () => {
    const room = [{ x: 0, y: 1100 }, { x: 400, y: 1100 }, { x: 400, y: 1400 }, { x: 0, y: 1400 }];
    const hall = [{ x: 0, y: 1410 }, { x: 410, y: 1410 }, { x: 410, y: 100 }, { x: 510, y: 100 }, { x: 510, y: 1510 }, { x: 0, y: 1510 }];
    const roomDoor = { ...door, a: { x: 150, y: 1400 }, b: { x: 230, y: 1400 } };
    const hallDoor = { ...door, a: { x: 150, y: 1410 }, b: { x: 230, y: 1410 } };
    const result = prepareDetectedDoorways([candidate('room', room, [roomDoor]), candidate('hall', hall, [hallDoor])], 10, productId, [], products);
    expect(result.byCandidate.get('room')![0]!.sharedOpeningId).toBe(result.byCandidate.get('hall')![0]!.sharedOpeningId);
  });
});

describe('door threshold coverage after editing', () => {
  it('covers a boundary threshold or an interior segment, including reversed direction', () => {
    expect(doorwayThresholdCovered(door, top)).toBe(true);
    expect(doorwayThresholdCovered({ a: door.b, b: door.a }, top)).toBe(true);
    expect(doorwayThresholdCovered({ a: { x: 100, y: 100 }, b: { x: 300, y: 250 } }, top)).toBe(true);
  });

  it('detects a narrow concavity even when the endpoints and overall midpoint are covered', () => {
    const notched = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 },
      { x: 211, y: 300 }, { x: 211, y: 280 }, { x: 210.5, y: 280 }, { x: 210.5, y: 300 }, { x: 0, y: 300 }];
    expect(doorwayThresholdCovered(door, notched)).toBe(false);
  });

  it('re-evaluates a missing recess without changing the original detected door evidence', () => {
    const evidence = { ...door, floorIncluded: true };
    const before = JSON.stringify(evidence);
    const retreat = top.map(point => ({ ...point, y: point.y === 300 ? 295 : point.y }));
    expect(doorwayThresholdCovered(evidence, retreat)).toBe(false);
    expect(JSON.stringify(evidence)).toBe(before);
    expect(doorwayThresholdCovered(evidence, top)).toBe(true);
  });

  it('allows hundredth-pixel outline rounding but does not hide a moved threshold', () => {
    const rounded = top.map(point => ({ ...point, y: point.y === 300 ? 299.985 : point.y }));
    const moved = top.map(point => ({ ...point, y: point.y === 300 ? 299.9 : point.y }));
    expect(doorwayThresholdCovered(door, rounded)).toBe(true);
    expect(doorwayThresholdCovered(door, moved)).toBe(false);
  });

  it('handles a boundary split over several collinear edges and refuses an uncovered endpoint', () => {
    const split = [top[0]!, top[1]!, top[2]!, { x: 200, y: 300 }, top[3]!];
    expect(doorwayThresholdCovered(door, split)).toBe(true);
    expect(doorwayThresholdCovered({ a: door.a, b: { x: 410, y: 300 } }, split)).toBe(false);
  });

  it('returns false for invalid, collapsed or self-crossing geometry', () => {
    expect(doorwayThresholdCovered({ a: door.a, b: door.a }, top)).toBe(false);
    expect(doorwayThresholdCovered({ a: { x: Number.NaN, y: 0 }, b: door.b }, top)).toBe(false);
    expect(doorwayThresholdCovered(door, [])).toBe(false);
    expect(doorwayThresholdCovered(door, [{ x: 0, y: 300 }, { x: 200, y: 300 }, { x: 400, y: 300 }])).toBe(false);
    expect(doorwayThresholdCovered(door, [top[0]!, top[2]!, top[1]!, top[3]!])).toBe(false);
  });
});
