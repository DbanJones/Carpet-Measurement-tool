import assert from 'node:assert/strict';

/** Geometry checks for development-server detector probes, after real browser rasterisation. */
export async function assertDetectedFloor(page, candidates, label = 'Detected floor') {
  const result = await page.evaluate(async rooms => {
    const { isSimplePolygon } = await import('/src/engine/geometry.ts');
    const { outlinesOverlap } = await import('/src/ui/floorplan/outlineEditing.ts');
    const { nearestEdge, pixelPolygonArea } = await import('/src/ui/floorplan/tracing.ts');
    return {
      rooms: rooms.map(room => ({
        simple: isSimplePolygon(room.polygon),
        area: pixelPolygonArea(room.polygon),
        structuralArea: pixelPolygonArea(room.measurementPolygon ?? room.polygon),
        doors: (room.detectedDoorways ?? []).map(door => ({
          included: door.floorIncluded,
          warning: door.floorWarning,
          onBoundary: [0, .25, .5, .75, 1].every(t => {
            const point = { x: door.a.x + (door.b.x - door.a.x) * t, y: door.a.y + (door.b.y - door.a.y) * t };
            return (nearestEdge(room.polygon, point)?.distance ?? Infinity) < .01;
          }),
        })),
      })),
      overlaps: rooms.some((room, index) => rooms.slice(index + 1).some(other => outlinesOverlap(room.polygon, other.polygon))),
    };
  }, candidates);
  assert.equal(result.overlaps, false, `${label}: actual floor polygons must not overlap`);
  for (const room of result.rooms) {
    assert(room.simple, `${label}: actual floor outline must remain simple`);
    assert(room.area >= room.structuralArea, `${label}: including a threshold cannot remove measured room floor`);
    for (const door of room.doors) {
      if (door.included) {
        assert(door.onBoundary, `${label}: the complete straight threshold must lie on the actual floor boundary`);
        assert(room.area > room.structuralArea, `${label}: included doorway recess must add floor area`);
      } else if (door.included === false) assert(door.warning, `${label}: refused floor expansion must explain what to check`);
    }
  }
}
