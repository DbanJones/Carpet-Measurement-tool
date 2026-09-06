import {
  planFloorPrep,
  matchingRules,
  prepFlags,
  coveringClass,
  latexThicknessFor,
  prepStepQuantity,
  PREP_RULES,
  PREP_ITEM_SPECS,
  PREP_SEQUENCE,
  POOR_SUBFLOOR_MIN_LATEX_THICKNESS,
  PLY_SKIM_LATEX_THICKNESS,
  type PrepRoomInput,
  type PrepItemKind,
} from './floorprep';
import { PLY_SCREWS_PER_BOX } from './defaults';
import type { FloorPrepOptions, Subfloor, CoveringKind } from './types';

/**
 * Test options chosen so the hand derivations below are easy to follow:
 * - latex: 20 kg bag = 13.5 m²·mm, 10 % wastage, 3 mm default
 * - primer: 6 m² per litre, one coat
 * - ply: 2440 x 1220 mm = 2.9768 m² per sheet, 10 % wastage, 120 screws per sheet, boxes of 200
 * - hardboard: 1220 x 610 mm = 0.7442 m² per sheet
 * - liquid DPM: 1.65 m² per kg; polythene: 100 m² rolls, 15 % overlap
 */
const opts: FloorPrepOptions = {
  latexThickness: 3,
  latexBagCoverageM2PerMm: 13.5,
  latexWastage: 0.1,
  primerCoverageM2PerLitre: 6,
  primerCoats: 1,
  plySheetLength: 2440,
  plySheetWidth: 1220,
  plyWastage: 0.1,
  plyScrewsPerSheet: 120,
  hardboardSheetLength: 1220,
  hardboardSheetWidth: 610,
  liquidDpmCoverageM2PerKg: 1.65,
  dpmSheetRollAreaM2: 100,
  dpmOverlap: 0.15,
};

function room(
  id: string,
  covering: CoveringKind,
  subfloor: Partial<Subfloor> & { type: Subfloor['type'] },
  extra: Partial<Omit<PrepRoomInput, 'ownerId' | 'ownerName' | 'covering' | 'subfloor'>> = {},
): PrepRoomInput {
  return {
    ownerId: id,
    ownerName: id.charAt(0).toUpperCase() + id.slice(1),
    areaM2: 20,
    perimeter: 18000,
    doorwayCount: 1,
    covering,
    subfloor: { condition: 'good', ...subfloor },
    ...extra,
  };
}

function plan(rooms: PrepRoomInput[], o: Partial<FloorPrepOptions> = {}) {
  return planFloorPrep({ rooms, options: { ...opts, ...o } });
}

function item(p: ReturnType<typeof planFloorPrep>, kind: PrepItemKind, required?: boolean) {
  return p.items.find((i) => i.kind === kind && (required === undefined || i.required === required));
}

function kinds(p: ReturnType<typeof planFloorPrep>): PrepItemKind[] {
  return p.items.map((i) => i.kind);
}

describe('rule table sanity', () => {
  it('rule ids are unique and every step kind has a quantity spec and a sequence position', () => {
    const ids = PREP_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of PREP_RULES) {
      for (const s of r.steps) {
        expect(PREP_ITEM_SPECS[s.kind]).toBeDefined();
        expect(PREP_SEQUENCE).toContain(s.kind);
      }
    }
    // ply screws are derived, never a rule step
    expect(PREP_RULES.some((r) => r.steps.some((s) => s.kind === 'ply_screws'))).toBe(false);
  });

  it('classes coverings by what they demand of the subfloor', () => {
    expect(coveringClass('carpet')).toBe('carpet');
    expect(coveringClass('carpet_tiles')).toBe('carpet');
    expect(coveringClass('sheet_vinyl')).toBe('resilient');
    expect(coveringClass('lvt_glue')).toBe('resilient');
    expect(coveringClass('lvt_click')).toBe('click');
    expect(coveringClass('laminate')).toBe('click');
    expect(coveringClass('engineered_wood')).toBe('click');
  });

  it('derives flags with sensible defaults for missing optional fields', () => {
    const bare = room('a', 'laminate', { type: 'concrete' });
    expect(prepFlags(bare)).toEqual({
      existingCovering: false,
      existingGripper: false,
      dpmUnknown: false, // undefined is not "unknown": the rule needs an explicit false
      underlayHasDpm: true, // DEFAULT_HARD_FLOOR.underlayHasDpm
      thicknessIncrease: false,
      refitSkirting: false,
      underfloorHeating: false,
    });
    const full = room('b', 'carpet', { type: 'concrete', existingCovering: 'carpet', existingGripper: true, dpmKnown: false, underfloorHeating: true }, { thicknessChange: 4, refitSkirting: true, underlayHasDpm: false });
    expect(prepFlags(full)).toEqual({
      existingCovering: true,
      existingGripper: true,
      dpmUnknown: true,
      underlayHasDpm: false,
      thicknessIncrease: true,
      refitSkirting: true,
      underfloorHeating: true,
    });
    expect(prepFlags(room('c', 'carpet', { type: 'concrete', existingCovering: 'none' })).existingCovering).toBe(false);
  });

  it('matchingRules picks exactly the rows for vinyl on uneven concrete with a doorway', () => {
    const r = room('hall', 'sheet_vinyl', { type: 'concrete', condition: 'uneven' });
    expect(matchingRules(r).map((x) => x.id)).toEqual(['resilient-concrete', 'door-easing-hard']);
  });
});

describe('(1) 20 m² sheet vinyl on uneven concrete', () => {
  const p = plan([room('kitchen', 'sheet_vinyl', { type: 'concrete', condition: 'uneven' })]);

  it('needs 4 L of primer: ceil(20 x 1 / 6) = ceil(3.333)', () => {
    const primer = item(p, 'primer')!;
    expect(primer.quantity).toBe(4);
    expect(primer.exactQuantity).toBe(3.3333);
    expect(primer.unit).toBe('litre');
    expect(primer.required).toBe(true);
    expect(primer.ownerIds).toEqual(['kitchen']);
  });

  it('needs 5 bags of latex at 3 mm: ceil(20 x 1.1 x 3 / 13.5) = ceil(4.889)', () => {
    const latex = item(p, 'latex')!;
    expect(latex.quantity).toBe(5);
    expect(latex.exactQuantity).toBe(4.8889);
    expect(latex.unit).toBe('bag');
    expect(latex.required).toBe(true);
    expect(latex.description).toBe('Latex smoothing compound, 3 mm');
  });

  it('adds recommended door easing for the one doorway and nothing else', () => {
    expect(kinds(p)).toEqual(['primer', 'latex', 'door_easing']);
    const doors = item(p, 'door_easing')!;
    expect(doors.required).toBe(false);
    expect(doors.quantity).toBe(1);
    expect(p.perRoom.kitchen).toEqual(['primer', 'latex', 'door_easing']);
    // no DPM flag given -> no moisture test
    expect(item(p, 'moisture_test')).toBeUndefined();
    expect(p.warnings).toEqual([]);
  });
});

describe('(2) 15 m² glue-down LVT on floorboards', () => {
  const p = plan([room('lounge', 'lvt_glue', { type: 'floorboards' }, { areaM2: 15 })]);

  it('needs 6 sheets of ply: ceil(15 x 1.1 / 2.9768) = ceil(5.543)', () => {
    const ply = item(p, 'ply')!;
    expect(ply.quantity).toBe(6);
    expect(ply.exactQuantity).toBe(5.5429);
    expect(ply.unit).toBe('sheet');
    expect(ply.required).toBe(true);
  });

  it('needs 720 screws = 6 sheets x 120, i.e. 4 boxes of 200 (exact 3.6)', () => {
    const screws = item(p, 'ply_screws')!;
    expect(screws.pieces).toBe(720);
    expect(screws.quantity).toBe(4);
    expect(screws.exactQuantity).toBe(3.6);
    expect(screws.unit).toBe('box');
    expect(screws.required).toBe(true);
    expect(screws.ownerIds).toEqual(['lounge']);
    expect(PLY_SCREWS_PER_BOX).toBe(200);
  });

  it('recommends a 3 mm skim over the ply: ceil(15 x 1.1 x 3 / 13.5) = ceil(3.667) = 4 bags', () => {
    const skim = item(p, 'latex')!;
    expect(skim.required).toBe(false);
    expect(skim.quantity).toBe(4);
    expect(skim.exactQuantity).toBe(3.6667);
    expect(skim.reason).toBe('skim ply joints');
    expect(skim.description).toBe(`Latex smoothing compound, ${PLY_SKIM_LATEX_THICKNESS} mm`);
  });

  it('boards in good condition need no securing or sanding, and there is no primer on ply', () => {
    expect(kinds(p)).toEqual(['ply', 'ply_screws', 'latex', 'door_easing']);
    expect(p.perRoom.lounge).toEqual(['ply', 'ply_screws', 'latex', 'door_easing']);
  });

  it('uneven or poor boards add securing (required) and sanding (recommended)', () => {
    const q = plan([room('lounge', 'lvt_glue', { type: 'chipboard', condition: 'uneven' }, { areaM2: 15 })]);
    expect(kinds(q)).toEqual(['secure_boards', 'sand_boards', 'ply', 'ply_screws', 'latex', 'door_easing']);
    expect(item(q, 'secure_boards')!).toMatchObject({ quantity: 15, unit: 'm²', required: true });
    expect(item(q, 'sand_boards')!).toMatchObject({ quantity: 15, unit: 'm²', required: false });
  });

  it('an existing ply subfloor in good condition only gets the skim; worn ply is overlaid', () => {
    const good = plan([room('a', 'sheet_vinyl', { type: 'plywood' }, { doorwayCount: 0 })]);
    expect(kinds(good)).toEqual(['latex']);
    expect(item(good, 'latex')!.required).toBe(false);
    const worn = plan([room('a', 'sheet_vinyl', { type: 'plywood', condition: 'poor' }, { doorwayCount: 0 })]);
    expect(kinds(worn)).toEqual(['secure_boards', 'sand_boards', 'ply', 'ply_screws', 'latex']);
    expect(item(worn, 'ply')!.required).toBe(true);
  });
});

describe('(3) carpet on good concrete', () => {
  it('plans nothing at all when there is no old floor', () => {
    const p = plan([room('bed', 'carpet', { type: 'concrete' })]);
    expect(p.items).toEqual([]);
    expect(p.perRoom.bed).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it('only uplift + disposal when an old carpet is present (18 m² each)', () => {
    const p = plan([room('bed', 'carpet', { type: 'concrete', existingCovering: 'carpet' }, { areaM2: 18 })]);
    expect(kinds(p)).toEqual(['uplift', 'disposal']);
    expect(item(p, 'uplift')!).toMatchObject({ quantity: 18, exactQuantity: 18, unit: 'm²', required: true, reason: 'existing carpet to be lifted' });
    expect(item(p, 'disposal')!).toMatchObject({ quantity: 18, unit: 'm²', required: true });
  });

  it('existing gripper under a new carpet is a recommended removal only: 17.5 m of perimeter', () => {
    const p = plan([room('bed', 'carpet', { type: 'concrete', existingCovering: 'carpet', existingGripper: true }, { areaM2: 18, perimeter: 17500 })]);
    expect(kinds(p)).toEqual(['uplift', 'disposal', 'gripper_removal']);
    const g = item(p, 'gripper_removal')!;
    expect(g.required).toBe(false);
    expect(g.quantity).toBe(17.5);
    expect(g.unit).toBe('m');
    expect(g.reason).toContain('reused');
  });

  it('existing gripper under vinyl or carpet tiles must come up', () => {
    const v = plan([room('k', 'sheet_vinyl', { type: 'concrete', existingGripper: true }, { perimeter: 12340 })]);
    expect(item(v, 'gripper_removal')!).toMatchObject({ required: true, quantity: 12.34 });
    const t = plan([room('o', 'carpet_tiles', { type: 'concrete', existingGripper: true })]);
    expect(item(t, 'gripper_removal')!.required).toBe(true);
  });

  it("'uneven' concrete recommends primer + latex; 'poor' requires them", () => {
    const uneven = plan([room('bed', 'carpet', { type: 'concrete', condition: 'uneven' }, { areaM2: 10 })]);
    expect(kinds(uneven)).toEqual(['primer', 'latex']);
    expect(item(uneven, 'latex')!).toMatchObject({ required: false, quantity: 3, exactQuantity: 2.4444 }); // 10 x 1.1 x 3 / 13.5
    expect(item(uneven, 'latex')!.reason).toBe('recommended for a smooth finish');
    const poor = plan([room('bed', 'carpet', { type: 'concrete', condition: 'poor' }, { areaM2: 10 })]);
    expect(item(poor, 'primer')!.required).toBe(true);
    // poor -> 5 mm: 10 x 1.1 x 5 / 13.5 = 4.074 -> 5 bags
    expect(item(poor, 'latex')!).toMatchObject({ required: true, quantity: 5, exactQuantity: 4.0741, description: 'Latex smoothing compound, 5 mm' });
  });
});

describe('(4) merging across rooms happens before rounding', () => {
  it('two 5 m² vinyl rooms: 1.222 + 1.222 = 2.444 -> 3 bags, not 2 + 2 = 4', () => {
    const p = plan([
      room('wc', 'sheet_vinyl', { type: 'concrete' }, { areaM2: 5, doorwayCount: 0 }),
      room('utility', 'sheet_vinyl', { type: 'concrete' }, { areaM2: 5, doorwayCount: 0 }),
    ]);
    const latex = item(p, 'latex')!;
    expect(latex.quantity).toBe(3);
    expect(latex.exactQuantity).toBe(2.4444);
    expect(latex.ownerIds).toEqual(['wc', 'utility']);
    // primer: 10 m² / 6 = 1.667 -> 2 L
    expect(item(p, 'primer')!).toMatchObject({ quantity: 2, exactQuantity: 1.6667, ownerIds: ['wc', 'utility'] });
    expect(p.items).toHaveLength(2);
    expect(p.perRoom).toEqual({ wc: ['primer', 'latex'], utility: ['primer', 'latex'] });
  });

  it('required and recommended lines of the same kind stay separate', () => {
    const p = plan([
      room('bed', 'carpet', { type: 'concrete', condition: 'uneven' }, { areaM2: 10, doorwayCount: 0 }),
      room('kitchen', 'sheet_vinyl', { type: 'concrete' }, { areaM2: 10, doorwayCount: 0 }),
    ]);
    const latex = p.items.filter((i) => i.kind === 'latex');
    expect(latex).toHaveLength(2);
    expect(latex[0]!).toMatchObject({ required: true, ownerIds: ['kitchen'], quantity: 3 });
    expect(latex[1]!).toMatchObject({ required: false, ownerIds: ['bed'], quantity: 3 });
    expect(p.items.filter((i) => i.kind === 'primer')).toHaveLength(2);
  });

  it('different thicknesses merge into one line with a range: 3 mm + 5 mm', () => {
    const p = plan([
      room('a', 'sheet_vinyl', { type: 'concrete' }, { areaM2: 10, doorwayCount: 0 }),
      room('b', 'sheet_vinyl', { type: 'concrete', condition: 'poor' }, { areaM2: 10, doorwayCount: 0 }),
    ]);
    const latex = item(p, 'latex')!;
    // 10 x 1.1 x 3 / 13.5 = 2.4444 ; 10 x 1.1 x 5 / 13.5 = 4.0741 ; sum 6.5185 -> 7
    expect(latex.exactQuantity).toBe(6.5185);
    expect(latex.quantity).toBe(7);
    expect(latex.description).toBe('Latex smoothing compound, 3–5 mm');
  });

  it('different product variants stay separate (acrylic vs anhydrite primer)', () => {
    const p = plan([
      room('a', 'sheet_vinyl', { type: 'concrete' }, { areaM2: 10, doorwayCount: 0 }),
      room('b', 'sheet_vinyl', { type: 'anhydrite' }, { areaM2: 10, doorwayCount: 0 }),
    ]);
    const primers = p.items.filter((i) => i.kind === 'primer');
    expect(primers.map((x) => x.description).sort()).toEqual(['Primer', 'Primer (anhydrite-specific)']);
    expect(primers.every((x) => x.quantity === 2)).toBe(true); // 10 / 6 = 1.667 -> 2 each
    expect(item(p, 'latex')!.ownerIds).toEqual(['a', 'b']);
  });

  it('uplift merges rooms with different old floors and lists both reasons', () => {
    const p = plan([
      room('bed', 'carpet', { type: 'concrete', existingCovering: 'carpet' }, { areaM2: 12.5 }),
      room('kitchen', 'sheet_vinyl', { type: 'concrete', existingCovering: 'vinyl' }, { areaM2: 7.25 }),
    ]);
    const up = item(p, 'uplift')!;
    expect(up.quantity).toBe(19.75);
    expect(up.ownerIds).toEqual(['bed', 'kitchen']);
    expect(up.reason).toBe('existing carpet to be lifted; existing vinyl to be lifted');
  });

  it('ply screws follow the merged, rounded sheet count', () => {
    // 4 m² + 4 m²: 4.4 / 2.9768 = 1.478 each -> merged 2.956 -> 3 sheets (not 2 + 2)
    const p = plan([
      room('a', 'lvt_glue', { type: 'floorboards' }, { areaM2: 4, doorwayCount: 0 }),
      room('b', 'lvt_glue', { type: 'floorboards' }, { areaM2: 4, doorwayCount: 0 }),
    ]);
    expect(item(p, 'ply')!).toMatchObject({ quantity: 3, exactQuantity: 2.9562 });
    // 3 x 120 = 360 screws -> 1.8 -> 2 boxes
    expect(item(p, 'ply_screws')!).toMatchObject({ pieces: 360, quantity: 2, exactQuantity: 1.8, ownerIds: ['a', 'b'] });
    expect(p.perRoom.a).toContain('ply_screws');
    expect(p.perRoom.b).toContain('ply_screws');
  });
});

describe('(5) moisture: concrete with no known DPM', () => {
  it('laminate with a non-DPM underlay: moisture test + polythene sheet, no liquid DPM', () => {
    const p = plan([room('lounge', 'laminate', { type: 'concrete', dpmKnown: false }, { areaM2: 12, underlayHasDpm: false })]);
    expect(kinds(p)).toEqual(['moisture_test', 'dpm_sheet', 'door_easing', 'acclimatise']);
    expect(item(p, 'moisture_test')!).toMatchObject({ quantity: 1, unit: 'each', required: true });
    // 12 x 1.15 / 100 = 0.138 -> 1 roll
    expect(item(p, 'dpm_sheet')!).toMatchObject({ quantity: 1, exactQuantity: 0.138, unit: 'roll', required: true });
    expect(item(p, 'liquid_dpm')).toBeUndefined();
  });

  it('laminate with a DPM underlay (the default): moisture test + liquid DPM if over 65 % RH', () => {
    const p = plan([room('lounge', 'laminate', { type: 'concrete', dpmKnown: false }, { areaM2: 12 })]);
    expect(kinds(p)).toEqual(['moisture_test', 'liquid_dpm', 'door_easing', 'acclimatise']);
    // 12 / 1.65 = 7.273 -> 8 kg
    const dpm = item(p, 'liquid_dpm')!;
    expect(dpm).toMatchObject({ quantity: 8, exactQuantity: 7.2727, unit: 'kg', required: false });
    expect(dpm.reason).toContain('65% RH');
    expect(item(p, 'dpm_sheet')).toBeUndefined();
  });

  it('sheet vinyl: moisture test + liquid DPM if over 75 % RH (BS 8203)', () => {
    const p = plan([room('kitchen', 'sheet_vinyl', { type: 'anhydrite', dpmKnown: false }, { areaM2: 33 })]);
    expect(item(p, 'moisture_test')!.required).toBe(true);
    // 33 / 1.65 = 20 exactly -> 20 kg (no float creep past the ceiling)
    expect(item(p, 'liquid_dpm')!).toMatchObject({ quantity: 20, exactQuantity: 20, required: false, reason: 'if hygrometer > 75% RH (BS 8203)' });
  });

  it('click LVT switches between liquid DPM and polythene on the underlay flag', () => {
    const withDpm = plan([room('a', 'lvt_click', { type: 'concrete', dpmKnown: false }, { underlayHasDpm: true })]);
    expect(kinds(withDpm)).toEqual(['moisture_test', 'liquid_dpm', 'door_easing']);
    const noDpm = plan([room('a', 'lvt_click', { type: 'concrete', dpmKnown: false }, { underlayHasDpm: false })]);
    expect(kinds(noDpm)).toEqual(['moisture_test', 'dpm_sheet', 'door_easing']);
  });

  it('a known DPM, an unspecified one, timber, or carpet never triggers a test', () => {
    expect(item(plan([room('a', 'laminate', { type: 'concrete', dpmKnown: true })]), 'moisture_test')).toBeUndefined();
    expect(item(plan([room('a', 'laminate', { type: 'concrete' })]), 'moisture_test')).toBeUndefined();
    expect(item(plan([room('a', 'laminate', { type: 'floorboards', dpmKnown: false })]), 'moisture_test')).toBeUndefined();
    expect(item(plan([room('a', 'carpet', { type: 'concrete', dpmKnown: false })]), 'moisture_test')).toBeUndefined();
  });

  it('one test per room, merged: three rooms -> 3', () => {
    const p = plan([
      room('a', 'sheet_vinyl', { type: 'concrete', dpmKnown: false }),
      room('b', 'sheet_vinyl', { type: 'concrete', dpmKnown: false }),
      room('c', 'lvt_glue', { type: 'concrete', dpmKnown: false }),
    ]);
    expect(item(p, 'moisture_test')!).toMatchObject({ quantity: 3, ownerIds: ['a', 'b', 'c'] });
  });
});

describe('(6) door easing', () => {
  it('counts the doorways for a hard floor (recommended)', () => {
    const p = plan([room('hall', 'laminate', { type: 'concrete' }, { doorwayCount: 3 })]);
    expect(item(p, 'door_easing')!).toMatchObject({ quantity: 3, exactQuantity: 3, unit: 'each', required: false });
    expect(item(p, 'door_easing')!.reason).toBe('doors may need trimming for the new floor height');
  });

  it('carpet only when the new floor is thicker than the old one', () => {
    expect(item(plan([room('hall', 'carpet', { type: 'concrete' }, { doorwayCount: 3 })]), 'door_easing')).toBeUndefined();
    expect(item(plan([room('hall', 'carpet', { type: 'concrete' }, { doorwayCount: 3, thicknessChange: 0 })]), 'door_easing')).toBeUndefined();
    expect(item(plan([room('hall', 'carpet', { type: 'concrete' }, { doorwayCount: 3, thicknessChange: 4 })]), 'door_easing')!.quantity).toBe(3);
  });

  it('no doorways -> no item; doorways merge across rooms', () => {
    expect(item(plan([room('a', 'sheet_vinyl', { type: 'plywood' }, { doorwayCount: 0 })]), 'door_easing')).toBeUndefined();
    const p = plan([room('a', 'sheet_vinyl', { type: 'plywood' }, { doorwayCount: 2 }), room('b', 'lvt_click', { type: 'plywood' }, { doorwayCount: 1 })]);
    expect(item(p, 'door_easing')!).toMatchObject({ quantity: 3, ownerIds: ['a', 'b'] });
  });
});

describe('(7) underfloor heating', () => {
  it('warns UFH_PRODUCTS against the room', () => {
    const p = plan([room('lounge', 'carpet', { type: 'concrete', underfloorHeating: true })]);
    expect(p.items).toEqual([]);
    expect(p.warnings).toHaveLength(1);
    const w = p.warnings[0]!;
    expect(w.code).toBe('UFH_PRODUCTS');
    expect(w.level).toBe('warning');
    expect(w.subjectId).toBe('lounge');
    expect(w.message).toContain('Lounge');
    expect(w.message).toContain('2.5 tog');
  });

  it('is silent without UFH', () => {
    expect(plan([room('lounge', 'sheet_vinyl', { type: 'concrete', underfloorHeating: false })]).warnings).toEqual([]);
  });
});

describe('carpet on boards', () => {
  it('good boards: nothing, with a note that the underlay covers them', () => {
    const p = plan([room('bed', 'carpet', { type: 'floorboards' })]);
    expect(p.items).toEqual([]);
    expect(p.warnings).toEqual([{ level: 'info', code: 'UNDERLAY_ON_BOARDS', message: 'Bed: no preparation planned — a good underlay takes up minor board irregularities.', subjectId: 'bed' }]);
  });

  it('uneven boards: hardboard recommended — 14 m²: ceil(14 x 1.1 / 0.7442) = ceil(20.69) = 21 sheets', () => {
    const p = plan([room('bed', 'carpet', { type: 'floorboards', condition: 'uneven' }, { areaM2: 14 })]);
    expect(kinds(p)).toEqual(['hardboard']);
    expect(item(p, 'hardboard')!).toMatchObject({ quantity: 21, exactQuantity: 20.6934, unit: 'sheet', required: false });
  });

  it('poor boards: hardboard and securing required', () => {
    const p = plan([room('bed', 'carpet', { type: 'chipboard', condition: 'poor' }, { areaM2: 14 })]);
    expect(kinds(p)).toEqual(['secure_boards', 'hardboard']);
    expect(item(p, 'hardboard')!).toMatchObject({ quantity: 21, required: true });
    expect(item(p, 'secure_boards')!).toMatchObject({ quantity: 14, unit: 'm²', required: true });
  });
});

describe('click floors', () => {
  it('on good concrete laminate only acclimatises (48 h, one per room) and eases doors', () => {
    const p = plan([room('lounge', 'laminate', { type: 'concrete' }), room('dining', 'engineered_wood', { type: 'concrete' }, { doorwayCount: 0 })]);
    expect(kinds(p)).toEqual(['door_easing', 'acclimatise']);
    const acc = item(p, 'acclimatise')!;
    expect(acc).toMatchObject({ quantity: 2, unit: 'each', required: true, ownerIds: ['lounge', 'dining'] });
    expect(acc.description).toContain('48 h');
    // click LVT does not need it
    expect(item(plan([room('a', 'lvt_click', { type: 'concrete' })]), 'acclimatise')).toBeUndefined();
  });

  it('on uneven concrete: primer + latex required, citing 3 mm over 2 m', () => {
    const p = plan([room('lounge', 'laminate', { type: 'concrete', condition: 'uneven' }, { areaM2: 10, doorwayCount: 0 })]);
    expect(kinds(p)).toEqual(['primer', 'latex', 'acclimatise']);
    expect(item(p, 'primer')!).toMatchObject({ quantity: 2, required: true }); // 10 / 6 = 1.667
    const latex = item(p, 'latex')!;
    expect(latex).toMatchObject({ quantity: 3, required: true }); // 10 x 1.1 x 3 / 13.5 = 2.444
    expect(latex.reason).toContain('3 mm over 2 m');
  });

  it('on uneven boards: sanding or ply, both recommended; poor boards: ply required', () => {
    const uneven = plan([room('a', 'lvt_click', { type: 'floorboards', condition: 'uneven' }, { areaM2: 10, doorwayCount: 0 })]);
    expect(kinds(uneven)).toEqual(['sand_boards', 'ply', 'ply_screws']);
    expect(uneven.items.every((i) => !i.required)).toBe(true);
    // 10 x 1.1 / 2.9768 = 3.695 -> 4 sheets; 4 x 120 = 480 screws -> 2.4 -> 3 boxes
    expect(item(uneven, 'ply')!).toMatchObject({ quantity: 4, exactQuantity: 3.6952 });
    expect(item(uneven, 'ply_screws')!).toMatchObject({ quantity: 3, pieces: 480, required: false });

    const poor = plan([room('a', 'lvt_click', { type: 'floorboards', condition: 'poor' }, { areaM2: 10, doorwayCount: 0 })]);
    expect(kinds(poor)).toEqual(['secure_boards', 'ply', 'ply_screws']);
    expect(poor.items.every((i) => i.required)).toBe(true);
  });
});

describe('special subfloors', () => {
  it('anhydrite needs a specific primer and a note about laitance', () => {
    const p = plan([room('k', 'sheet_vinyl', { type: 'anhydrite' })]);
    const primer = item(p, 'primer')!;
    expect(primer.description).toBe('Primer (anhydrite-specific)');
    expect(primer.reason).toContain('laitance');
    expect(item(p, 'latex')).toBeDefined();
  });

  it('asphalt gets a compatible latex and no primer', () => {
    const p = plan([room('k', 'sheet_vinyl', { type: 'asphalt' })]);
    expect(kinds(p)).toEqual(['latex', 'door_easing']);
    const latex = item(p, 'latex')!;
    expect(latex.description).toBe('Latex smoothing compound (asphalt-compatible), 3 mm');
    expect(latex.reason).toContain('compatible');
  });

  it('existing tiles / vinyl under a resilient floor are primed and smoothed', () => {
    expect(kinds(plan([room('k', 'lvt_glue', { type: 'existing_tiles' }, { doorwayCount: 0 })]))).toEqual(['primer', 'latex']);
    expect(kinds(plan([room('k', 'sheet_vinyl', { type: 'existing_vinyl' }, { doorwayCount: 0 })]))).toEqual(['primer', 'latex']);
  });
});

describe('poor subfloor thickness', () => {
  it('raises the latex to at least 5 mm: 20 m² -> 20 x 1.1 x 5 / 13.5 = 8.15 -> 9 bags', () => {
    const p = plan([room('k', 'sheet_vinyl', { type: 'concrete', condition: 'poor' })]);
    expect(item(p, 'latex')!).toMatchObject({ quantity: 9, exactQuantity: 8.1481, description: 'Latex smoothing compound, 5 mm' });
    expect(POOR_SUBFLOOR_MIN_LATEX_THICKNESS).toBe(5);
  });

  it('keeps a user thickness that is already higher: 6 mm -> 20 x 1.1 x 6 / 13.5 = 9.78 -> 10 bags', () => {
    const p = plan([room('k', 'sheet_vinyl', { type: 'concrete', condition: 'poor' })], { latexThickness: 6 });
    expect(item(p, 'latex')!).toMatchObject({ quantity: 10, exactQuantity: 9.7778, description: 'Latex smoothing compound, 6 mm' });
  });

  it('latexThicknessFor: skim thickness is fixed, poor minimum only applies when set', () => {
    const o = { ...opts, latexThickness: 3 };
    expect(latexThicknessFor({ kind: 'latex', required: true, reason: '', poorMinThickness: 5 }, 'poor', o)).toBe(5);
    expect(latexThicknessFor({ kind: 'latex', required: true, reason: '', poorMinThickness: 5 }, 'uneven', o)).toBe(3);
    expect(latexThicknessFor({ kind: 'latex', required: true, reason: '' }, 'poor', o)).toBe(3);
    expect(latexThicknessFor({ kind: 'latex', required: false, reason: '', thickness: 2 }, 'poor', o)).toBe(2);
    expect(latexThicknessFor({ kind: 'latex', required: true, reason: '', poorMinThickness: 5 }, 'poor', { ...o, latexThickness: 6 })).toBe(6);
  });
});

describe('skirting', () => {
  it('refit skirting is measured on the perimeter: 15 200 mm -> 15.2 m', () => {
    const p = plan([room('lounge', 'laminate', { type: 'concrete' }, { perimeter: 15200, refitSkirting: true, doorwayCount: 0 })]);
    expect(kinds(p)).toEqual(['skirting_refit', 'acclimatise']);
    expect(item(p, 'skirting_refit')!).toMatchObject({ quantity: 15.2, exactQuantity: 15.2, unit: 'm', required: true });
    expect(item(plan([room('lounge', 'laminate', { type: 'concrete' }, { refitSkirting: false })]), 'skirting_refit')).toBeUndefined();
  });
});

describe('edge cases', () => {
  it('no rooms -> empty plan', () => {
    expect(plan([])).toEqual({ items: [], warnings: [], perRoom: {} });
  });

  it('a room with no area is skipped with a warning', () => {
    const p = plan([room('cupboard', 'sheet_vinyl', { type: 'concrete', existingCovering: 'vinyl' }, { areaM2: 0 })]);
    expect(p.items).toEqual([]);
    expect(p.perRoom).toEqual({ cupboard: [] });
    expect(p.warnings).toEqual([{ level: 'warning', code: 'NO_AREA', message: 'Cupboard: no floor area — floor preparation skipped.', subjectId: 'cupboard' }]);
    expect(plan([room('x', 'carpet', { type: 'concrete' }, { areaM2: -3 })]).warnings[0]!.code).toBe('NO_AREA');
  });

  it('a tiny 0.5 m² room still buys one litre and one bag', () => {
    const p = plan([room('wc', 'sheet_vinyl', { type: 'concrete' }, { areaM2: 0.5, doorwayCount: 0 })]);
    expect(item(p, 'primer')!).toMatchObject({ quantity: 1, exactQuantity: 0.0833 }); // 0.5 / 6
    expect(item(p, 'latex')!).toMatchObject({ quantity: 1, exactQuantity: 0.1222 }); // 0.5 x 1.1 x 3 / 13.5
  });

  it('a huge 500 m² poor slab: 204 bags at 5 mm and 84 L of primer', () => {
    const p = plan([room('hall', 'sheet_vinyl', { type: 'concrete', condition: 'poor' }, { areaM2: 500, perimeter: 90000, doorwayCount: 6 })]);
    // 500 x 1.1 x 5 / 13.5 = 203.70 -> 204 ; 500 / 6 = 83.33 -> 84
    expect(item(p, 'latex')!).toMatchObject({ quantity: 204, exactQuantity: 203.7037 });
    expect(item(p, 'primer')!).toMatchObject({ quantity: 84, exactQuantity: 83.3333 });
    expect(item(p, 'door_easing')!.quantity).toBe(6);
  });

  it('two primer coats double the litres: 20 m² x 2 / 6 = 6.67 -> 7 L', () => {
    const p = plan([room('k', 'sheet_vinyl', { type: 'concrete' })], { primerCoats: 2 });
    expect(item(p, 'primer')!).toMatchObject({ quantity: 7, exactQuantity: 6.6667 });
  });

  it('a zero coverage option produces an error warning instead of Infinity', () => {
    const p = plan([room('k', 'sheet_vinyl', { type: 'concrete' }, { doorwayCount: 0 })], { latexBagCoverageM2PerMm: 0 });
    expect(kinds(p)).toEqual(['primer']);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]!).toMatchObject({ level: 'error', code: 'INVALID_PREP_OPTION' });
    expect(p.warnings[0]!.message).toContain('latex');
    const q = plan([room('k', 'lvt_glue', { type: 'floorboards' }, { doorwayCount: 0 })], { plySheetLength: 0 });
    expect(item(q, 'ply')).toBeUndefined();
    expect(item(q, 'ply_screws')).toBeUndefined();
    expect(q.warnings.map((w) => w.code)).toEqual(['INVALID_PREP_OPTION']);
  });

  it('fractional / negative doorway counts are clamped to whole doors', () => {
    const p = plan([room('k', 'sheet_vinyl', { type: 'plywood' }, { doorwayCount: 2.7 })]);
    expect(item(p, 'door_easing')!.quantity).toBe(2);
    expect(item(plan([room('k', 'sheet_vinyl', { type: 'plywood' }, { doorwayCount: -1 })]), 'door_easing')).toBeUndefined();
  });

  it('prepStepQuantity reports the unit and thickness used', () => {
    const r = room('k', 'sheet_vinyl', { type: 'concrete', condition: 'poor' }, { areaM2: 10 });
    expect(prepStepQuantity({ kind: 'latex', required: true, reason: '', poorMinThickness: 5 }, r, opts)).toEqual({ exact: (10 * 1.1 * 5) / 13.5, unit: 'bag', thickness: 5 });
    // a non-latex step reports the default thickness (unused): no poorMinThickness on the step
    expect(prepStepQuantity({ kind: 'gripper_removal', required: true, reason: '' }, r, opts)).toEqual({ exact: 18, unit: 'm', thickness: 3 });
  });
});

describe('a whole house is ordered in trade sequence and is deterministic', () => {
  const rooms: PrepRoomInput[] = [
    room('lounge', 'engineered_wood', { type: 'concrete', condition: 'uneven', dpmKnown: false, existingCovering: 'carpet', existingGripper: true }, { areaM2: 22, perimeter: 19000, doorwayCount: 2, refitSkirting: true }),
    room('kitchen', 'sheet_vinyl', { type: 'floorboards', condition: 'uneven', existingCovering: 'vinyl' }, { areaM2: 11, perimeter: 13500 }),
    room('bed', 'carpet', { type: 'floorboards', existingCovering: 'carpet', existingGripper: true }, { areaM2: 14, perimeter: 15000 }),
  ];

  it('lists every kind once per (required, variant) in the order the work happens', () => {
    const p = plan(rooms);
    expect(kinds(p)).toEqual([
      'uplift',
      'disposal',
      'gripper_removal', // lounge: required (wood floor)
      'gripper_removal', // bed: recommended (carpet can reuse it)
      'moisture_test',
      'secure_boards',
      'sand_boards',
      'ply',
      'ply_screws',
      'primer',
      'latex', // lounge: required, 3 mm
      'latex', // kitchen: recommended skim, 3 mm
      'liquid_dpm',
      'door_easing',
      'skirting_refit',
      'acclimatise',
    ]);
    expect(item(p, 'uplift')!.quantity).toBe(47); // 22 + 11 + 14
    expect(item(p, 'gripper_removal', true)!).toMatchObject({ quantity: 19, ownerIds: ['lounge'] });
    expect(item(p, 'gripper_removal', false)!).toMatchObject({ quantity: 15, ownerIds: ['bed'] });
    expect(p.perRoom).toEqual({
      lounge: ['uplift', 'disposal', 'gripper_removal', 'moisture_test', 'primer', 'latex', 'liquid_dpm', 'door_easing', 'skirting_refit', 'acclimatise'],
      kitchen: ['uplift', 'disposal', 'secure_boards', 'sand_boards', 'ply', 'ply_screws', 'latex', 'door_easing'],
      bed: ['uplift', 'disposal', 'gripper_removal'],
    });
    expect(p.warnings.map((w) => w.code)).toEqual(['UNDERLAY_ON_BOARDS']);
  });

  it('gives identical output for identical input and never mutates the input', () => {
    const snapshot = JSON.stringify(rooms);
    const a = plan(rooms);
    const b = plan(rooms);
    expect(a).toEqual(b);
    expect(JSON.stringify(rooms)).toBe(snapshot);
  });
});
