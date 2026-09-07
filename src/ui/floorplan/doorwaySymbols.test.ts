import { describe, expect, it } from 'vitest';
import { recognizeDoorwaySymbols, type DoorwayRaster } from './doorwaySymbols';
import type { Px } from './tracing';

function raster(): DoorwayRaster { return { width: 220, height: 220, ink: new Uint8Array(220 * 220), mmPerPx: 20 }; }
function stroke(image: DoorwayRaster, a: Px, b: Px, thickness = 1) {
  const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
  for (let i = 0; i <= count; i++) {
    const x = Math.round(a.x + (b.x - a.x) * i / count), y = Math.round(a.y + (b.y - a.y) * i / count);
    for (let dy = 0; dy < thickness; dy++) for (let dx = 0; dx < thickness; dx++) {
      if (x + dx >= 0 && y + dy >= 0 && x + dx < image.width && y + dy < image.height) image.ink[(y + dy) * image.width + x + dx] = 1;
    }
  }
}
function door({ rotation = 0, mirror = false, arc = true, leaf = true, leafRatio = 1 } = {}) {
  const image = raster();
  const transform = (p: Px): Px => {
    const x = (p.x - 100) * (mirror ? -1 : 1), y = p.y - 100;
    const angle = rotation * Math.PI / 180;
    return { x: 100 + x * Math.cos(angle) - y * Math.sin(angle), y: 100 + x * Math.sin(angle) + y * Math.cos(angle) };
  };
  const line = (a: Px, b: Px, thickness = 1) => stroke(image, transform(a), transform(b), thickness);
  line({ x: 20, y: 100 }, { x: 79, y: 100 }, 4);
  line({ x: 121, y: 100 }, { x: 180, y: 100 }, 4);
  if (leaf) line({ x: 80, y: 100 }, { x: 80, y: 100 - 40 * leafRatio });
  if (arc) for (let degree = 0; degree < 90; degree++) {
    const point = (angle: number) => ({ x: 80 + Math.cos(angle * Math.PI / 180) * 40, y: 100 - Math.sin(angle * Math.PI / 180) * 40 * leafRatio });
    line(point(degree), point(degree + 1));
  }
  return { image, gap: { a: transform({ x: 80, y: 100 }), b: transform({ x: 120, y: 100 }) }, transform, line };
}

describe('evidence-qualified doorway symbols', () => {
  it.each([0, 90, 180, 270].flatMap(rotation => [false, true].map(mirror => ({ rotation, mirror }))))(
    'recognizes a quarter-circle plus radial leaf at rotation $rotation, mirrored $mirror', options => {
      const fixture = door(options);
      const found = recognizeDoorwaySymbols(fixture.image, [fixture.gap]);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ evidence: 'swing-arc', confidence: 'high', a: fixture.gap.a, b: fixture.gap.b });
      expect(Math.hypot(found[0]!.hinge!.x - fixture.transform({ x: 80, y: 100 }).x,
        found[0]!.hinge!.y - fixture.transform({ x: 80, y: 100 }).y)).toBeLessThan(4);
    },
  );

  it('keeps a plain supported opening unclassified', () => {
    const fixture = door({ arc: false, leaf: false });
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap])).toEqual([]);
  });

  it.each([0.8, 1.2])('recognizes a scan-stretched quarter ellipse with leaf ratio %s from strong arc evidence', leafRatio => {
    const fixture = door({ leafRatio, rotation: 90, mirror: true });
    const found = recognizeDoorwaySymbols(fixture.image, [fixture.gap]);
    expect(found).toMatchObject([{ evidence: 'swing-arc', confidence: 'high' }]);
    expect(Math.abs(Math.hypot(found[0]!.leafEnd!.x - found[0]!.hinge!.x, found[0]!.leafEnd!.y - found[0]!.hinge!.y) - 40 * leafRatio)).toBeLessThan(5);
  });

  it('requires a radial leaf as well as an isolated curve', () => {
    const fixture = door({ leaf: false });
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap])).toEqual([]);
  });

  it('accepts a clean leaf with no swing arc only as medium-confidence evidence', () => {
    const fixture = door({ arc: false });
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap])).toMatchObject([{ evidence: 'door-leaf', confidence: 'medium' }]);
  });

  it('rejects a thin line continuing well beyond a door-width leaf', () => {
    const fixture = door({ arc: false });
    fixture.line({ x: 80, y: 60 }, { x: 80, y: 25 });
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap])).toEqual([]);
  });

  it('rejects parallel window bars and short jamb crossbars', () => {
    const fixture = door({ arc: false, leaf: false });
    fixture.line({ x: 80, y: 97 }, { x: 120, y: 97 });
    fixture.line({ x: 80, y: 104 }, { x: 120, y: 104 });
    fixture.line({ x: 80, y: 97 }, { x: 80, y: 104 });
    fixture.line({ x: 120, y: 97 }, { x: 120, y: 104 });
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap])).toEqual([]);
  });

  it('rejects furniture frames whose side resembles a leaf', () => {
    const fixture = door({ arc: false });
    fixture.line({ x: 80, y: 60 }, { x: 120, y: 60 });
    fixture.line({ x: 120, y: 60 }, { x: 120, y: 100 });
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap])).toEqual([]);
  });

  it('does not report every parallel pixel row as a separate door', () => {
    const fixture = door();
    const duplicate = { a: { x: fixture.gap.a.x, y: fixture.gap.a.y + 1 }, b: { x: fixture.gap.b.x, y: fixture.gap.b.y + 1 } };
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap, duplicate])).toHaveLength(1);
  });

  it('does not call a tiny text-sized curved symbol a physical doorway', () => {
    const fixture = door();
    fixture.image.mmPerPx = 2;
    expect(recognizeDoorwaySymbols(fixture.image, [fixture.gap])).toEqual([]);
  });
});
