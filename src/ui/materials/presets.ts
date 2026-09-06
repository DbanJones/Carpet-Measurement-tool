/**
 * Product and underlay presets for the Materials panel, plus per-kind defaults used when a product
 * is switched between kinds. Every number is indicative UK trade data and is user editable after
 * the preset is added; nothing here is used by the engine directly.
 */
import type { BroadloomProduct, CoveringKind, PackProduct, UnderlayOptions } from '@engine/types';
import {
  CARPET_MAX_ROLL_LENGTH,
  VINYL_MAX_ROLL_LENGTH,
  CUT_INCREMENT,
  DEFAULT_CARPET_THICKNESS,
  DEFAULT_VINYL_THICKNESS,
  CARPET_TILE_SIZE,
  CARPET_TILES_PER_BOX,
  CARPET_PRICE_TIERS,
  DEFAULT_UNDERLAY,
} from '@engine/defaults';

export type BroadloomDraft = Omit<BroadloomProduct, 'id'>;
export type PackDraft = Omit<PackProduct, 'id'>;
export type ProductDraft = BroadloomDraft | PackDraft;

export const KIND_LABELS: Record<CoveringKind, string> = {
  carpet: 'Carpet',
  sheet_vinyl: 'Sheet vinyl',
  laminate: 'Laminate',
  engineered_wood: 'Engineered wood',
  lvt_click: 'LVT (click)',
  lvt_glue: 'LVT (glue-down)',
  carpet_tiles: 'Carpet tiles',
};

export const KIND_OPTIONS: { value: CoveringKind; label: string }[] = (Object.keys(KIND_LABELS) as CoveringKind[]).map((k) => ({
  value: k,
  label: KIND_LABELS[k],
}));

export type PresetGroup = 'Carpet' | 'Sheet vinyl' | 'Hard floor' | 'Carpet tiles';

export interface ProductPreset {
  id: string;
  label: string;
  group: PresetGroup;
  /** One line shown next to the preset explaining what it represents. */
  description: string;
  make: () => ProductDraft;
}

const carpet = (name: string, rollWidth: number, extra: Partial<BroadloomDraft> = {}): BroadloomDraft => ({
  name,
  kind: 'carpet',
  rollWidth,
  alternativeRollWidths: rollWidth === 4000 ? [5000] : [4000],
  maxRollLength: CARPET_MAX_ROLL_LENGTH,
  cutIncrement: CUT_INCREMENT,
  thickness: DEFAULT_CARPET_THICKNESS,
  pricePerM2: CARPET_PRICE_TIERS.mid,
  ...extra,
});

const vinyl = (rollWidth: number): BroadloomDraft => ({
  name: `Sheet vinyl (${rollWidth / 1000} m roll)`,
  kind: 'sheet_vinyl',
  rollWidth,
  alternativeRollWidths: [2000, 3000, 4000].filter((w) => w !== rollWidth),
  maxRollLength: VINYL_MAX_ROLL_LENGTH,
  cutIncrement: CUT_INCREMENT,
  thickness: DEFAULT_VINYL_THICKNESS,
  pricePerM2: 15,
});

const pack = (
  name: string,
  kind: PackDraft['kind'],
  packCoverageM2: number,
  geometry: { boardLength: number; boardWidth: number; boardsPerPack?: number; thickness: number },
  pricePerPack: number,
): PackDraft => ({
  name,
  kind,
  packCoverageM2,
  ...geometry,
  pricePerPack,
  pricePerM2: Math.round((pricePerPack / packCoverageM2) * 100) / 100,
});

export const PRODUCT_PRESETS: ProductPreset[] = [
  {
    id: 'carpet_4m',
    label: 'Carpet, 4 m roll',
    group: 'Carpet',
    description: 'Plain broadloom carpet on the standard 4 m wide roll; 5 m width available for comparison.',
    make: () => carpet('Carpet (4 m roll)', 4000),
  },
  {
    id: 'carpet_5m',
    label: 'Carpet, 5 m roll',
    group: 'Carpet',
    description: 'Plain broadloom carpet on a 5 m roll: fewer seams in wide rooms, more waste in narrow ones.',
    make: () => carpet('Carpet (5 m roll)', 5000),
  },
  {
    id: 'carpet_4m_patterned',
    label: 'Carpet, 4 m patterned (640 mm repeat)',
    group: 'Carpet',
    description: 'Patterned carpet: every cut is rounded up to a whole 640 mm repeat so the pattern matches at seams.',
    make: () => carpet('Patterned carpet (4 m roll)', 4000, { name: 'Patterned carpet (4 m roll)', patternRepeatLength: 640, pricePerM2: 28 }),
  },
  {
    id: 'vinyl_2m',
    label: 'Sheet vinyl, 2 m roll',
    group: 'Sheet vinyl',
    description: 'Cushioned sheet vinyl on a 2 m roll (bathrooms, small kitchens).',
    make: () => vinyl(2000),
  },
  {
    id: 'vinyl_3m',
    label: 'Sheet vinyl, 3 m roll',
    group: 'Sheet vinyl',
    description: 'Sheet vinyl on a 3 m roll: the common width for kitchens without a seam.',
    make: () => vinyl(3000),
  },
  {
    id: 'vinyl_4m',
    label: 'Sheet vinyl, 4 m roll',
    group: 'Sheet vinyl',
    description: 'Sheet vinyl on a 4 m roll for larger rooms in one piece.',
    make: () => vinyl(4000),
  },
  {
    id: 'laminate_8mm',
    label: 'Laminate, 8 mm click',
    group: 'Hard floor',
    description: '8 mm click laminate, 1285 x 192 mm boards, 9 per pack (2.22 m²).',
    make: () => pack('Laminate 8 mm click', 'laminate', 2.22, { boardLength: 1285, boardWidth: 192, boardsPerPack: 9, thickness: 8 }, 22),
  },
  {
    id: 'engineered_oak',
    label: 'Engineered oak, 14 mm',
    group: 'Hard floor',
    description: 'Engineered oak, 1900 x 190 mm boards, 6 per pack (2.16 m²); tongue-and-groove or click.',
    make: () => pack('Engineered oak', 'engineered_wood', 2.16, { boardLength: 1900, boardWidth: 190, boardsPerPack: 6, thickness: 14 }, 90),
  },
  {
    id: 'lvt_click',
    label: 'LVT, click',
    group: 'Hard floor',
    description: 'Click luxury vinyl plank, 1220 x 180 mm, 2.5 m² per pack; floated over underlay.',
    make: () => pack('LVT click', 'lvt_click', 2.5, { boardLength: 1220, boardWidth: 180, thickness: 5 }, 65),
  },
  {
    id: 'lvt_glue',
    label: 'LVT, glue-down',
    group: 'Hard floor',
    description: 'Glue-down luxury vinyl plank, 1219 x 184 mm, 15 per pack (3.34 m²); needs a smooth, primed subfloor.',
    make: () => pack('LVT glue-down', 'lvt_glue', 3.34, { boardLength: 1219, boardWidth: 184, boardsPerPack: 15, thickness: 2.5 }, 75),
  },
  {
    id: 'carpet_tiles_500',
    label: 'Carpet tiles, 500 x 500',
    group: 'Carpet tiles',
    description: '500 x 500 mm carpet tiles, box of 20 (5 m²); laid with tackifier, no underlay.',
    make: () =>
      pack(
        'Carpet tiles 500 x 500',
        'carpet_tiles',
        (CARPET_TILE_SIZE * CARPET_TILE_SIZE * CARPET_TILES_PER_BOX) / 1_000_000,
        { boardLength: CARPET_TILE_SIZE, boardWidth: CARPET_TILE_SIZE, boardsPerPack: CARPET_TILES_PER_BOX, thickness: 6 },
        60,
      ),
  },
];

export const PRESET_GROUPS: PresetGroup[] = ['Carpet', 'Sheet vinyl', 'Hard floor', 'Carpet tiles'];

export function findPreset(id: string): ProductPreset | undefined {
  return PRODUCT_PRESETS.find((p) => p.id === id);
}

const KIND_DEFAULT_PRESET: Record<CoveringKind, string> = {
  carpet: 'carpet_4m',
  sheet_vinyl: 'vinyl_2m',
  laminate: 'laminate_8mm',
  engineered_wood: 'engineered_oak',
  lvt_click: 'lvt_click',
  lvt_glue: 'lvt_glue',
  carpet_tiles: 'carpet_tiles_500',
};

/** A sensible starting product for a kind; used when a product's kind is changed to a different family. */
export function defaultProductForKind(kind: 'carpet' | 'sheet_vinyl', name?: string): BroadloomDraft;
export function defaultProductForKind(kind: PackProduct['kind'], name?: string): PackDraft;
export function defaultProductForKind(kind: CoveringKind, name?: string): ProductDraft;
export function defaultProductForKind(kind: CoveringKind, name?: string): ProductDraft {
  const preset = findPreset(KIND_DEFAULT_PRESET[kind])!;
  const draft = preset.make();
  return name ? { ...draft, name } : draft;
}

// ---------------------------------------------------------------------------
// Underlay presets
// ---------------------------------------------------------------------------

export interface UnderlayPreset {
  id: string;
  label: string;
  description: string;
  values: Pick<UnderlayOptions, 'rollWidth' | 'rollLength' | 'thickness' | 'tog' | 'pricePerRoll'>;
}

export const UNDERLAY_PRESETS: UnderlayPreset[] = [
  {
    id: 'pu10',
    label: '10 mm PU 11 m roll',
    description: 'The standard UK carpet underlay: 10 mm polyurethane foam, 1.37 x 11 m (15.07 m²), about 2.3 tog.',
    values: { rollWidth: DEFAULT_UNDERLAY.rollWidth, rollLength: DEFAULT_UNDERLAY.rollLength, thickness: 10, tog: DEFAULT_UNDERLAY.tog, pricePerRoll: DEFAULT_UNDERLAY.pricePerRoll },
  },
  {
    id: 'pu8',
    label: '8 mm PU',
    description: 'Thinner PU foam for stairs and busy areas; firmer underfoot, about 1.9 tog.',
    values: { rollWidth: 1370, rollLength: 11000, thickness: 8, tog: 1.9, pricePerRoll: 60 },
  },
  {
    id: 'pu11_heavy',
    label: '11 mm heavy domestic',
    description: 'High-density 11 mm PU for lounges and bedrooms; about 2.9 tog, too thick for stairs.',
    values: { rollWidth: 1370, rollLength: 11000, thickness: 11, tog: 2.9, pricePerRoll: 95 },
  },
  {
    id: 'felt',
    label: 'Felt',
    description: 'Wool/jute felt, 9 mm: firm, breathable, good under natural-fibre carpet; about 2.4 tog.',
    values: { rollWidth: 1370, rollLength: 11000, thickness: 9, tog: 2.4, pricePerRoll: 70 },
  },
  {
    id: 'ufh_low_tog',
    label: 'UFH low tog (1.0 tog)',
    description: 'Dense 6 mm underlay for underfloor heating; carpet plus underlay must stay under 2.5 tog.',
    values: { rollWidth: 1370, rollLength: 11000, thickness: 6, tog: 1.0, pricePerRoll: 70 },
  },
  {
    id: 'laminate_pack',
    label: 'Laminate 10 m² pack',
    description: '3 mm foam/foil underlay, 1 x 10 m pack, for floated laminate or click LVT; negligible tog.',
    values: { rollWidth: 1000, rollLength: 10000, thickness: 3, tog: 0.4, pricePerRoll: 15 },
  },
];
