import { describe, it, expect } from 'vitest';
import {
  parseProject,
  serializeProject,
  PROJECT_SCHEMA_VERSION,
  MAX_WARNINGS,
  FALLBACK_ROOM_LENGTH,
  FALLBACK_ROOM_WIDTH,
  FALLBACK_PROJECT_NAME,
  finiteNumber,
  idOf,
  isRecord,
  isImageDataUrl,
  pickProduct,
  IdSpace,
  type ParseResult,
  type ParsedProject,
} from './serialize';
import { emptyProject, sampleProject, SAMPLE_IDS } from './fixtures';
import { estimateProject } from './estimate';
import { DEFAULT_BROADLOOM_OPTIONS, DEFAULT_PRICES, DEFAULT_HARD_FLOOR, DEFAULT_ACCESSORIES, DEFAULT_FLOOR_PREP, DEFAULT_UNDERLAY, DEFAULT_DOOR_WIDTH } from './defaults';
import type { Project } from './types';

/** Loosely typed view of a project file under test, so a test can corrupt any field it likes. */
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The parse must have succeeded; returns the parsed result. */
function ok(res: ParseResult): ParsedProject {
  if ('error' in res) throw new Error(`expected a project, got an error: ${res.error}`);
  return res;
}

/** The parse must have failed; returns the message. */
function err(res: ParseResult): string {
  if (!('error' in res)) throw new Error('expected an error, got a project');
  return res.error;
}

/** A deep, JSON-safe clone of the sample project that tests can corrupt. */
function looseSample(): Loose {
  return JSON.parse(JSON.stringify(sampleProject())) as Loose;
}

/** Wrap a (possibly corrupt) project in the file envelope. */
function fileOf(project: unknown, schemaVersion: number = PROJECT_SCHEMA_VERSION): string {
  return JSON.stringify({ schemaVersion, savedAt: null, project });
}

/** A minimal valid project as plain data, for tests that corrupt one field at a time. */
function minimal(): Loose {
  return {
    id: 'proj-1',
    name: 'Minimal',
    displayUnit: 'metric',
    products: [{ id: 'carpet', name: 'Carpet', kind: 'carpet', rollWidth: 4000 }],
    rooms: [
      {
        id: 'room-1',
        name: 'Lounge',
        shape: { kind: 'rectangle', length: 4000, width: 3000 },
        doorways: [{ id: 'd1', edgeIndex: 0, offset: 100, width: 838, transition: 'carpet' }],
        productId: 'carpet',
        subfloor: { type: 'floorboards', condition: 'good' },
      },
    ],
    staircases: [],
    floorPlans: [],
    options: {
      broadloom: { ...DEFAULT_BROADLOOM_OPTIONS },
      hardFloor: { ...DEFAULT_HARD_FLOOR },
      underlay: { ...DEFAULT_UNDERLAY },
      accessories: { ...DEFAULT_ACCESSORIES },
      floorPrep: { ...DEFAULT_FLOOR_PREP },
    },
    prices: { ...DEFAULT_PRICES, labour: { ...DEFAULT_PRICES.labour }, materials: { ...DEFAULT_PRICES.materials } },
  };
}

const anyWarning = (warnings: string[], pattern: RegExp): boolean => warnings.some((w) => pattern.test(w));

describe('serializeProject', () => {
  it('writes a pretty, versioned envelope with no clock reading', () => {
    const text = serializeProject(sampleProject());
    expect(text).toContain('\n  "schemaVersion": 1');
    const parsed = JSON.parse(text) as Loose;
    expect(parsed.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(parsed.savedAt).toBeNull();
    expect(parsed.project.id).toBe(SAMPLE_IDS.project);
  });

  it('is deterministic: the same project always serialises to the same text', () => {
    expect(serializeProject(sampleProject())).toBe(serializeProject(sampleProject()));
  });
});

describe('round trip', () => {
  it('restores the sample project exactly, with no repairs', () => {
    const original = sampleProject();
    const res = ok(parseProject(serializeProject(original)));
    expect(res.warnings).toEqual([]);
    expect(res.project).toEqual(original);
  });

  it('round-trips EVERY numeric option, so a newly added option cannot be silently dropped', () => {
    // `primerCanLitres` was added to FloorPrepOptions and to the defaults but not to the parser's
    // spec map, and mergeGroup only copies keys the spec map names: the saved value was thrown away
    // on load with no repair warning, autosave included. This walks every numeric option instead.
    const original = sampleProject();
    const groups = ['broadloom', 'hardFloor', 'underlay', 'accessories', 'floorPrep'] as const;
    const changed: Record<string, Record<string, number>> = {};
    for (const group of groups) {
      const opts = original.options[group] as unknown as Record<string, unknown>;
      const patch: Record<string, number> = {};
      for (const [key, value] of Object.entries(opts)) {
        if (typeof value !== 'number') continue;
        patch[key] = value + 1; // a value no default would produce
        (opts as Record<string, number>)[key] = value + 1;
      }
      changed[group] = patch;
    }
    const res = ok(parseProject(serializeProject(original)));
    const lost: string[] = [];
    for (const group of groups) {
      const loaded = res.project.options[group] as unknown as Record<string, number>;
      for (const [key, value] of Object.entries(changed[group]!)) {
        // Either the value survives, or the parser says out loud that it changed it (a value out of
        // the field's range is repaired with a warning). What must never happen is a silent reset.
        if (loaded[key] !== value && !anyWarning(res.warnings, new RegExp(key))) {
          lost.push(`${group}.${key}: saved ${value} -> loaded ${String(loaded[key])}`);
        }
      }
    }
    expect(lost).toEqual([]);
  });

  it('restores every optional field and leaves absent ones absent', () => {
    const original = sampleProject();
    const res = ok(parseProject(serializeProject(original)));
    const lounge = res.project.rooms.find((r) => r.id === SAMPLE_IDS.rooms.lounge)!;
    const hall = res.project.rooms.find((r) => r.id === SAMPLE_IDS.rooms.hall)!;
    const bed3 = res.project.rooms.find((r) => r.id === SAMPLE_IDS.rooms.bedroom3)!;
    expect(lounge.shape).toEqual(original.rooms[0]!.shape); // bay + chimney breast survive, negative depth included
    expect(hall.planning).toEqual({ pileDirection: 'along_length' }); // a partial override stays partial
    expect(bed3.hardFloor).toEqual({ layPattern: 'straight', useBeading: true });
    expect('notes' in lounge).toBe(false);
    expect('runner' in res.project.staircases[0]!).toBe(false);
    expect(res.project.staircases[0]!.steps).toHaveLength(13); // 9 straight + 3 winders + the top riser
    expect(res.project.staircases[0]!.steps[9]!.goingNarrow).toBe(120);
  });

  it('produces an identical estimate from the parsed project', () => {
    const original = sampleProject();
    const res = ok(parseProject(serializeProject(original)));
    const before = estimateProject(original);
    const after = estimateProject(res.project);
    expect(JSON.stringify(after.bom)).toBe(JSON.stringify(before.bom));
    expect(JSON.stringify(after.rollPlans)).toBe(JSON.stringify(before.rollPlans));
    expect(after.totals).toEqual(before.totals);
    expect(JSON.stringify(after.warnings)).toBe(JSON.stringify(before.warnings));
  });

  it('restores an empty project', () => {
    const original = emptyProject('p-empty');
    const res = ok(parseProject(serializeProject(original)));
    expect(res.warnings).toEqual([]);
    expect(res.project).toEqual(original);
    expect(res.project.rooms).toEqual([]);
    expect(res.project.prices).not.toBe(DEFAULT_PRICES); // never shares the module-level defaults
  });
});

describe('unreadable files', () => {
  it('reports corrupt JSON instead of throwing', () => {
    expect(err(parseProject('{"schemaVersion": 1, "project": {'))).toMatch(/not valid JSON/i);
    expect(err(parseProject('not json at all'))).toMatch(/not valid JSON/i);
  });

  it('rejects empty, non-object and non-project payloads', () => {
    expect(err(parseProject(''))).toMatch(/empty/i);
    expect(err(parseProject('   '))).toMatch(/empty/i);
    expect(err(parseProject('[1,2,3]'))).toMatch(/does not contain a project/i);
    expect(err(parseProject('"just a string"'))).toMatch(/does not contain a project/i);
    expect(err(parseProject('{"schemaVersion":1,"project":42}'))).toMatch(/not a project object/i);
    expect(err(parseProject('{"hello":"world"}'))).toMatch(/does not look like a flooring project/i);
  });

  it('reads a bare project with no envelope, and says so', () => {
    const res = ok(parseProject(JSON.stringify(minimal())));
    expect(res.project.rooms).toHaveLength(1);
    expect(anyWarning(res.warnings, /bare project/i)).toBe(true);
  });

  it('is fatal only when no product survives an unknown covering kind', () => {
    const dead = minimal();
    dead.products = [{ id: 'a', name: 'Mystery', kind: 'astroturf', rollWidth: 4000 }];
    expect(err(parseProject(fileOf(dead)))).toMatch(/nothing to estimate/i);

    const survivor = minimal();
    survivor.products = [
      { id: 'a', name: 'Mystery', kind: 'astroturf' },
      { id: 'b', name: 'Real carpet', kind: 'carpet', rollWidth: 4000 },
    ];
    const res = ok(parseProject(fileOf(survivor)));
    expect(res.project.products).toHaveLength(1);
    expect(res.project.products[0]!.id).toBe('b');
    expect(anyWarning(res.warnings, /not a floor covering this tool knows/i)).toBe(true);
  });
});

describe('defaults are merged in', () => {
  it('fills missing options and prices from defaults.ts and names what it defaulted', () => {
    const bare: Loose = { id: 'p', name: 'Bare', products: [], rooms: [], staircases: [], floorPlans: [] };
    const res = ok(parseProject(fileOf(bare)));
    expect(res.project.options.broadloom).toEqual(DEFAULT_BROADLOOM_OPTIONS);
    expect(res.project.options.hardFloor).toEqual(DEFAULT_HARD_FLOOR);
    expect(res.project.prices).toEqual(DEFAULT_PRICES);
    expect(res.project.prices.labour).not.toBe(DEFAULT_PRICES.labour);
    expect(anyWarning(res.warnings, /no options/i)).toBe(true);
    expect(anyWarning(res.warnings, /no price book/i)).toBe(true);
  });

  it('loads an older file that predates newer option and price keys, silently', () => {
    const old = minimal();
    delete old.options.broadloom.minFillWidth;
    delete old.options.broadloom.maxCrossJoinsPerFill;
    old.options.broadloom.lengthAllowance = 120;
    delete old.prices.materials.plyScrewsPerBox;
    delete old.options.underlay;
    const res = ok(parseProject(fileOf(old)));
    expect(res.warnings).toEqual([]);
    expect(res.project.options.broadloom.minFillWidth).toBe(DEFAULT_BROADLOOM_OPTIONS.minFillWidth);
    expect(res.project.options.broadloom.maxCrossJoinsPerFill).toBe(DEFAULT_BROADLOOM_OPTIONS.maxCrossJoinsPerFill);
    expect(res.project.options.broadloom.lengthAllowance).toBe(120); // the file's own value is kept
    expect(res.project.prices.materials.plyScrewsPerBox).toBe(DEFAULT_PRICES.materials.plyScrewsPerBox);
    expect(res.project.options.underlay).toEqual(DEFAULT_UNDERLAY);
  });

  it('defaults the top-level identity fields it cannot read', () => {
    const nameless: Loose = { rooms: [], products: [], staircases: [], floorPlans: [] };
    const res = ok(parseProject(fileOf(nameless)));
    expect(res.project.id).toBe('project');
    expect(res.project.name).toBe(FALLBACK_PROJECT_NAME);
    expect(res.project.displayUnit).toBe('metric');
    expect(anyWarning(res.warnings, /project has no id/i)).toBe(true);
    expect(anyWarning(res.warnings, /project name/i)).toBe(true);
  });
});

describe('enum repair', () => {
  it('repairs unknown enum values to a sensible default and says which', () => {
    const bad = looseSample();
    bad.options.broadloom.seamPolicy = 'zigzag';
    bad.options.broadloom.pileDirection = 'diagonal';
    bad.options.hardFloor.layPattern = 'basketweave';
    bad.rooms[0].shape.kind = 'trapezium';
    bad.rooms[1].doorways[0].transition = 'teleporter';
    bad.rooms[2].subfloor.type = 'moon dust';
    bad.rooms[2].subfloor.condition = 'awful';
    bad.staircases[0].steps[0].kind = 'spiral';
    bad.staircases[0].method = 'origami';
    bad.staircases[0].openSides = 'front';
    bad.displayUnit = 'furlongs';
    const res = ok(parseProject(fileOf(bad)));

    expect(res.project.options.broadloom.seamPolicy).toBe('balanced');
    expect(res.project.options.broadloom.pileDirection).toBe(DEFAULT_BROADLOOM_OPTIONS.pileDirection);
    expect(res.project.options.hardFloor.layPattern).toBe('straight');
    expect(res.project.rooms[0]!.shape).toEqual({ kind: 'rectangle', length: FALLBACK_ROOM_LENGTH, width: FALLBACK_ROOM_WIDTH });
    expect(res.project.rooms[1]!.doorways[0]!.transition).toBe('carpet');
    expect(res.project.rooms[2]!.subfloor.type).toBe('concrete');
    expect(res.project.rooms[2]!.subfloor.condition).toBe('good');
    expect(res.project.staircases[0]!.steps[0]!.kind).toBe('straight');
    expect(res.project.staircases[0]!.method).toBe('cap_and_band');
    expect(res.project.staircases[0]!.openSides).toBe('none');
    expect(res.project.displayUnit).toBe('metric');
    expect(anyWarning(res.warnings, /zigzag/)).toBe(true);
    expect(anyWarning(res.warnings, /trapezium|not a room shape/i)).toBe(true);
    expect(estimateProject(res.project).bom.length).toBeGreaterThan(0); // still estimable
  });

  it('drops an unusable optional enum rather than inventing one', () => {
    const bad = minimal();
    bad.rooms[0].subfloor.existingCovering = 'shagpile';
    const res = ok(parseProject(fileOf(bad)));
    expect('existingCovering' in res.project.rooms[0]!.subfloor).toBe(false);
    expect(anyWarning(res.warnings, /existing covering/i)).toBe(true);
  });
});

describe('numeric repair', () => {
  it('replaces a required measurement that is missing, NaN or negative', () => {
    const bad = looseSample();
    bad.rooms[0].shape.length = NaN; // JSON turns NaN into null
    bad.rooms[3].shape.width = -2500;
    bad.products[0].rollWidth = 0;
    bad.rooms[2].doorways[0].width = -900;
    bad.rooms[2].doorways[1].edgeIndex = -3;
    const res = ok(parseProject(fileOf(bad)));
    expect(res.project.rooms[0]!.shape).toMatchObject({ length: FALLBACK_ROOM_LENGTH });
    expect(res.project.rooms[3]!.shape).toMatchObject({ width: FALLBACK_ROOM_WIDTH });
    expect((res.project.products[0] as { rollWidth: number }).rollWidth).toBe(4000);
    expect(res.project.rooms[2]!.doorways[0]!.width).toBe(DEFAULT_DOOR_WIDTH);
    expect(res.project.rooms[2]!.doorways[1]!.edgeIndex).toBe(0);
    expect(anyWarning(res.warnings, /roll width/i)).toBe(true);
  });

  it('drops an optional measurement that is negative or infinite', () => {
    const bad = minimal();
    bad.products[0].pricePerM2 = -5;
    bad.products[0].thickness = '__INF__';
    bad.products[0].maxRollLength = 30000;
    const json = fileOf(bad).replace('"__INF__"', '1e999');
    expect(JSON.parse(json).project.products[0].thickness).toBe(Infinity);
    const res = ok(parseProject(json));
    const product = res.project.products[0] as unknown as Record<string, unknown>;
    expect('pricePerM2' in product).toBe(false);
    expect('thickness' in product).toBe(false);
    expect(product.maxRollLength).toBe(30000);
    expect(anyWarning(res.warnings, /price per m²/i)).toBe(true);
  });

  it('keeps the negative depth of a chimney breast, which is not a length error', () => {
    const res = ok(parseProject(serializeProject(sampleProject())));
    const lounge = res.project.rooms[0]!;
    const shape = lounge.shape as { features: { depth: number }[] };
    expect(shape.features[1]!.depth).toBe(-350);
  });

  it('trims a cut-out that is bigger than the room', () => {
    const bad = minimal();
    bad.rooms[0].shape = { kind: 'l_shape', length: 4000, width: 3000, cutoutLength: 9000, cutoutWidth: 8000, cutoutCorner: 'bottom-right' };
    const res = ok(parseProject(fileOf(bad)));
    expect(res.project.rooms[0]!.shape).toEqual({ kind: 'l_shape', length: 4000, width: 3000, cutoutLength: 4000, cutoutWidth: 3000, cutoutCorner: 'bottom-right' });
    expect(anyWarning(res.warnings, /cut-out is longer/i)).toBe(true);
  });

  it('falls back to a rectangle when a traced outline has too few corners', () => {
    const bad = minimal();
    bad.rooms[0].shape = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1000, y: 'over there' }] };
    const res = ok(parseProject(fileOf(bad)));
    expect(res.project.rooms[0]!.shape.kind).toBe('rectangle');
    expect(anyWarning(res.warnings, /fewer than three corners/i)).toBe(true);
  });
});

describe('ids and references', () => {
  it('synthesises missing ids deterministically by index', () => {
    const bad = minimal();
    delete bad.rooms[0].id;
    bad.rooms.push({ name: 'Kitchen', shape: { kind: 'rectangle', length: 3000, width: 3000 }, doorways: [], productId: 'carpet', subfloor: { type: 'concrete', condition: 'good' } });
    const first = ok(parseProject(fileOf(bad)));
    const second = ok(parseProject(fileOf(bad)));
    expect(first.project.rooms.map((r) => r.id)).toEqual(['room-1', 'room-2']);
    expect(second.project.rooms.map((r) => r.id)).toEqual(first.project.rooms.map((r) => r.id));
    expect(anyWarning(first.warnings, /had no id/i)).toBe(true);
  });

  it('suffixes duplicate ids and keeps references pointing at the survivor', () => {
    const dupes = minimal();
    dupes.products.push({ id: 'carpet', name: 'Carpet B', kind: 'carpet', rollWidth: 5000 });
    dupes.rooms.push({ ...dupes.rooms[0], name: 'Bedroom' });
    const res = ok(parseProject(fileOf(dupes)));
    expect(res.project.products.map((p) => p.id)).toEqual(['carpet', 'carpet-2']);
    expect(res.project.rooms.map((r) => r.id)).toEqual(['room-1', 'room-1-2']);
    expect(res.project.rooms.map((r) => r.productId)).toEqual(['carpet', 'carpet']);
    expect(anyWarning(res.warnings, /used twice/i)).toBe(true);
  });

  it('remaps numeric ids to strings, and every reference with them', () => {
    const numeric = minimal();
    numeric.products = [
      { id: 1, name: 'Carpet one', kind: 'carpet', rollWidth: 4000 },
      { id: 2, name: 'Carpet two', kind: 'carpet', rollWidth: 5000 },
    ];
    numeric.rooms[0].productId = 2;
    numeric.floorPlans = [{ id: 7, name: 'Ground floor', imageDataUrl: 'data:image/png;base64,AAAA', widthPx: 800, heightPx: 600 }];
    numeric.rooms[0].source = { floorPlanId: 7, pixelPolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    numeric.staircases = [{ id: 3, name: 'Stairs', productId: 1, steps: [], landings: [], method: 'cap_and_band', openSides: 'none' }];
    const res = ok(parseProject(fileOf(numeric)));
    expect(res.project.products.map((p) => p.id)).toEqual(['1', '2']);
    expect(res.project.rooms[0]!.productId).toBe('2');
    expect(res.project.rooms[0]!.source!.floorPlanId).toBe('7');
    expect(res.project.staircases[0]!.productId).toBe('1');
    expect(res.project.staircases[0]!.id).toBe('3');
  });

  it('points a room at a compatible product when its own was deleted', () => {
    const orphaned = looseSample();
    orphaned.products = orphaned.products.filter((p: Loose) => p.id !== SAMPLE_IDS.products.loungeCarpet);
    const res = ok(parseProject(fileOf(orphaned)));
    const lounge = res.project.rooms.find((r) => r.id === SAMPLE_IDS.rooms.lounge)!;
    expect(lounge.productId).toBe(SAMPLE_IDS.products.hallCarpet);
    expect(res.project.products.some((p) => p.id === lounge.productId)).toBe(true);
    expect(anyWarning(res.warnings, /is not in this file/i)).toBe(true);
    // the estimate no longer complains about a missing product
    expect(estimateProject(res.project).warnings.some((w) => w.code === 'MISSING_PRODUCT')).toBe(false);
  });

  it('prefers the same covering kind when the deleted product is still described in the file', () => {
    const broken = minimal();
    broken.products = [
      { id: 'laminate', name: 'Oak laminate', kind: 'laminate', packCoverageM2: 2.22 },
      { id: 'vinyl', name: 'Kitchen vinyl', kind: 'sheet_vinyl', rollWidth: 3000 },
      { id: 'gone', name: 'Broken carpet', kind: 'not-a-covering', rollWidth: 4000 },
      { id: 'spare', name: 'Spare carpet', kind: 'carpet', rollWidth: 4000 },
    ];
    broken.rooms[0].productId = 'gone';
    const res = ok(parseProject(fileOf(broken)));
    // the dropped product had a roll width, so a broadloom stand-in is chosen over the laminate
    expect(res.project.rooms[0]!.productId).toBe('vinyl');

    delete broken.products[2].rollWidth;
    const blind = ok(parseProject(fileOf(broken)));
    expect(blind.project.rooms[0]!.productId).toBe('laminate'); // nothing to go on: the first product
  });

  it('leaves a dangling reference alone when the file has no products at all', () => {
    const empty = minimal();
    empty.products = [];
    const res = ok(parseProject(fileOf(empty)));
    expect(res.project.rooms[0]!.productId).toBe('carpet');
    expect(anyWarning(res.warnings, /no other to use/i)).toBe(true);
  });
});

describe('schema versions', () => {
  it('loads a file from a later version with a warning', () => {
    const res = ok(parseProject(fileOf(minimal(), PROJECT_SCHEMA_VERSION + 5)));
    expect(res.project.rooms).toHaveLength(1);
    expect(anyWarning(res.warnings, /later version of the tool/i)).toBe(true);
  });

  it('loads a file with no version at all', () => {
    const res = ok(parseProject(JSON.stringify({ project: minimal() })));
    expect(anyWarning(res.warnings, /does not say which version/i)).toBe(true);
    expect(res.project.name).toBe('Minimal');
  });

  it('says nothing about the version when it matches', () => {
    const res = ok(parseProject(fileOf(minimal())));
    expect(anyWarning(res.warnings, /version/i)).toBe(false);
  });
});

describe('floor plans', () => {
  it('drops a plan whose image is a URL rather than embedded data, and unlinks the rooms', () => {
    const remote = minimal();
    remote.floorPlans = [
      { id: 'plan-remote', name: 'Ground floor', imageDataUrl: 'https://example.com/plan.png', widthPx: 800, heightPx: 600 },
      { id: 'plan-ok', name: 'First floor', imageDataUrl: 'data:image/png;base64,AAAA', widthPx: 800, heightPx: 600 },
    ];
    remote.rooms[0].source = { floorPlanId: 'plan-remote', pixelPolygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] };
    const res = ok(parseProject(fileOf(remote)));
    expect(res.project.floorPlans.map((p) => p.id)).toEqual(['plan-ok']);
    expect('source' in res.project.rooms[0]!).toBe(false);
    expect(anyWarning(res.warnings, /nothing is ever downloaded/i)).toBe(true);
    expect(JSON.stringify(res.project)).not.toContain('https://example.com');
  });

  it('keeps an embedded plan and drops only an incomplete calibration', () => {
    const plans = minimal();
    plans.floorPlans = [
      { id: 'plan-1', name: 'Ground floor', imageDataUrl: 'data:image/jpeg;base64,ZZZZ', widthPx: 1024, heightPx: 768, mmPerPx: 12.5, calibration: { a: { x: 0, y: 0 }, b: { x: 100 }, distance: 1000 } },
    ];
    const res = ok(parseProject(fileOf(plans)));
    expect(res.project.floorPlans[0]!.mmPerPx).toBe(12.5);
    expect('calibration' in res.project.floorPlans[0]!).toBe(false);
    expect(anyWarning(res.warnings, /calibration is incomplete/i)).toBe(true);
  });
});

describe('scale and robustness', () => {
  it('parses a large project quickly and without repairs', () => {
    const big: Project = emptyProject('big');
    big.products = [{ id: 'carpet', name: 'Contract carpet', kind: 'carpet', rollWidth: 4000, cutIncrement: 100, maxRollLength: 30000 }];
    for (let i = 0; i < 250; i += 1) {
      big.rooms.push({
        id: `room-${i}`,
        name: `Room ${i}`,
        shape: { kind: 'rectangle', length: 3000 + (i % 7) * 250, width: 2500 + (i % 5) * 300 },
        doorways: [{ id: `door-${i}`, edgeIndex: 0, offset: 200, width: 838, transition: 'carpet' }],
        productId: 'carpet',
        subfloor: { type: 'chipboard', condition: 'good' },
      });
    }
    for (let i = 0; i < 20; i += 1) {
      big.staircases.push({
        id: `stairs-${i}`,
        name: `Stairs ${i}`,
        productId: 'carpet',
        steps: Array.from({ length: 13 }, (_, s) => ({ id: `step-${s}`, kind: 'straight' as const, rise: 200, going: 223, width: 860 })),
        landings: [],
        method: 'cap_and_band',
        openSides: 'none',
      });
    }
    const text = serializeProject(big);
    expect(text.length).toBeGreaterThan(50_000);
    const res = ok(parseProject(text));
    expect(res.warnings).toEqual([]);
    expect(res.project.rooms).toHaveLength(250);
    expect(res.project.staircases[19]!.steps).toHaveLength(13);
    expect(res.project).toEqual(big);
  });

  it('caps the warning list on a thoroughly corrupt file', () => {
    const rubbish: Loose = { id: 'p', name: 'Rubbish', products: [], rooms: [], staircases: [], floorPlans: [] };
    for (let i = 0; i < MAX_WARNINGS + 40; i += 1) rubbish.rooms.push({ id: `r-${i}`, name: `R${i}`, shape: { kind: 'blob' }, doorways: [], productId: 'x', subfloor: {} });
    const res = ok(parseProject(fileOf(rubbish)));
    expect(res.warnings.length).toBe(MAX_WARNINGS + 1);
    expect(res.warnings[MAX_WARNINGS]).toMatch(/further repairs/);
    expect(res.project.rooms).toHaveLength(MAX_WARNINGS + 40);
  });

  it('survives lists that are not lists and entries that are not objects', () => {
    const junk: Loose = {
      id: 'p',
      name: 'Junk',
      products: 'a carpet, probably',
      rooms: [null, 42, { id: 'r1', name: 'Real room', shape: { kind: 'rectangle', length: 3000, width: 3000 }, doorways: 'none', productId: 'x', subfloor: { type: 'concrete', condition: 'good' } }],
      staircases: {},
      floorPlans: null,
      options: 'default please',
      prices: [],
    };
    const res = ok(parseProject(fileOf(junk)));
    expect(res.project.products).toEqual([]);
    expect(res.project.rooms).toHaveLength(1);
    expect(res.project.rooms[0]!.doorways).toEqual([]);
    expect(res.project.staircases).toEqual([]);
    expect(res.project.floorPlans).toEqual([]);
    expect(res.project.options.accessories).toEqual(DEFAULT_ACCESSORIES);
    expect(res.project.prices.materials).toEqual(DEFAULT_PRICES.materials);
    expect(() => estimateProject(res.project)).not.toThrow();
  });
});

describe('helpers', () => {
  it('finiteNumber rejects NaN, Infinity, negatives and non-numbers', () => {
    expect(finiteNumber(4000)).toBe(4000);
    expect(finiteNumber(0)).toBe(0);
    expect(finiteNumber(NaN)).toBeUndefined();
    expect(finiteNumber(Infinity)).toBeUndefined();
    expect(finiteNumber(-1)).toBeUndefined();
    expect(finiteNumber('4000')).toBeUndefined();
    expect(finiteNumber(0, { min: 0, exclusive: true })).toBeUndefined();
    expect(finiteNumber(1.5, { min: 0, integer: true })).toBeUndefined();
    expect(finiteNumber(-350, { min: -Infinity })).toBe(-350);
  });

  it('idOf accepts trimmed strings and finite numbers only', () => {
    expect(idOf(' room-1 ')).toBe('room-1');
    expect(idOf(7)).toBe('7');
    expect(idOf('')).toBeUndefined();
    expect(idOf('   ')).toBeUndefined();
    expect(idOf(null)).toBeUndefined();
    expect(idOf({})).toBeUndefined();
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it('isImageDataUrl accepts only embedded images', () => {
    expect(isImageDataUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isImageDataUrl('DATA:IMAGE/JPEG;base64,AAAA')).toBe(true);
    expect(isImageDataUrl('https://example.com/plan.png')).toBe(false);
    expect(isImageDataUrl('data:text/html,<script>')).toBe(false);
    expect(isImageDataUrl('/plans/ground.png')).toBe(false);
    expect(isImageDataUrl(undefined)).toBe(false);
  });

  it('IdSpace suffixes duplicates and remembers where a reference should point', () => {
    const space = new IdSpace();
    expect(space.claim('hall')).toBe('hall');
    expect(space.claim('hall')).toBe('hall-2');
    expect(space.claim('hall')).toBe('hall-3');
    expect(space.resolve('hall')).toBe('hall');
    expect(space.resolve('landing')).toBeUndefined();
    expect(space.has('hall-2')).toBe(true);
  });

  it('pickProduct prefers the wanted kind, then its family, then whatever there is', () => {
    const products = sampleProject().products;
    expect(pickProduct(products, 'lvt_glue')!.id).toBe(SAMPLE_IDS.products.lvt);
    expect(pickProduct(products, 'lvt_click')!.id).toBe(SAMPLE_IDS.products.laminate); // same family
    expect(pickProduct(products, 'sheet_vinyl')!.id).toBe(SAMPLE_IDS.products.kitchenVinyl);
    expect(pickProduct(products, undefined)!.id).toBe(SAMPLE_IDS.products.loungeCarpet);
    expect(pickProduct([], 'carpet')).toBeUndefined();
  });
});

describe('the public API (index.ts)', () => {
  it('re-exports a working engine: fixture -> file -> project -> estimate', async () => {
    const engine = await import('./index');
    const text = engine.serializeProject(engine.sampleProject());
    const res = engine.parseProject(text);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    const estimate = engine.estimateProject(res.project);
    expect(estimate.bom.length).toBeGreaterThan(0);
    expect(estimate.rollPlans.length).toBeGreaterThan(0);
    expect(estimate.totals.netAreaM2).toBeGreaterThan(0);
    expect(engine.PROJECT_SCHEMA_VERSION).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('exposes the planners, geometry, units, defaults and fixtures the UI needs', async () => {
    const engine = await import('./index');
    const expected = [
      'planRoom', 'buildRollPlan', 'packOnRoll', 'planStaircase', 'planUnderlay', 'planGripper', 'planDoorBars',
      'planTapes', 'planFloorPrep', 'planHardFloor', 'planSheetVinylSundries', 'wastageFor', 'estimateProject',
      'compareRollWidths', 'shapeToPolygon', 'polygonAreaM2', 'polygonPerimeter', 'boundingBox', 'fixingPerimeter',
      'walkToPolygon', 'normalizePolygon', 'doorwaySegment', 'edgeLength', 'toMm', 'fromMm', 'parseLength', 'formatM',
      'sampleProject', 'emptyProject', 'serializeProject', 'parseProject', 'isBroadloom', 'isHardFloor',
    ];
    for (const name of expected) expect(typeof (engine as Record<string, unknown>)[name]).toBe('function');
    expect(engine.DEFAULT_BROADLOOM_OPTIONS).toEqual(DEFAULT_BROADLOOM_OPTIONS);
    expect(engine.DEFAULT_PRICES).toEqual(DEFAULT_PRICES);
    expect(engine.CUT_INCREMENT).toBe(100);
    expect(engine.SAMPLE_IDS.project).toBe(SAMPLE_IDS.project);
  });
});
