/**
 * Fixtures: a realistic sample project and an empty one.
 *
 * `sampleProject()` is a typical UK three-bedroom semi-detached house measured for a full re-floor:
 * carpet in the lounge, hall/landing/stairs and two bedrooms; sheet vinyl in the kitchen/diner;
 * laminate in the box room and glue-down LVT in the bathroom. It exercises every branch of the
 * engine (bays, chimney breasts, L-shapes, recesses, winders, shared doorways, external doors,
 * continuous carpet through openings, uneven concrete, ply overlays) and loads in the UI as the
 * "example house". Every id is a fixed string so the estimate is reproducible run to run — there
 * is no randomness and no clock anywhere in this module.
 *
 * Doorways are entered from BOTH rooms they join, with the same label in each: that way every
 * room's gripper stops at the opening, while the door-bar planner counts the opening once
 * (`DOORWAY_DUPLICATE`, see accessories.planDoorBars).
 */
import type { Project, Room, Staircase, Step, BroadloomProduct, PackProduct } from './types';
import {
  DEFAULT_BROADLOOM_OPTIONS,
  DEFAULT_HARD_FLOOR,
  DEFAULT_UNDERLAY,
  DEFAULT_ACCESSORIES,
  DEFAULT_FLOOR_PREP,
  DEFAULT_PRICES,
  CARPET_MAX_ROLL_LENGTH,
  VINYL_MAX_ROLL_LENGTH,
  CUT_INCREMENT,
  DEFAULT_CARPET_THICKNESS,
  DEFAULT_VINYL_THICKNESS,
  DEFAULT_STEP,
  DEFAULT_NOSING_OVERHANG,
} from './defaults';

/** Stable ids used by the sample project (exported so tests and the UI can refer to them). */
export const SAMPLE_IDS = {
  project: 'proj-sample-semi',
  products: {
    loungeCarpet: 'prod-carpet-lounge',
    hallCarpet: 'prod-carpet-hall',
    bedroomCarpet: 'prod-carpet-bedroom',
    kitchenVinyl: 'prod-vinyl-kitchen',
    laminate: 'prod-laminate-oak',
    lvt: 'prod-lvt-bathroom',
  },
  rooms: {
    lounge: 'room-lounge',
    kitchen: 'room-kitchen',
    hall: 'room-hall',
    landing: 'room-landing',
    bedroom1: 'room-bedroom-1',
    bedroom2: 'room-bedroom-2',
    bedroom3: 'room-bedroom-3',
    bathroom: 'room-bathroom',
  },
  staircase: 'stairs-main',
} as const;

/** Fresh copies of the default option groups (never share the module-level objects with a project). */
function defaultOptions(): Project['options'] {
  return {
    broadloom: { ...DEFAULT_BROADLOOM_OPTIONS },
    hardFloor: { ...DEFAULT_HARD_FLOOR },
    underlay: { ...DEFAULT_UNDERLAY },
    accessories: { ...DEFAULT_ACCESSORIES },
    floorPrep: { ...DEFAULT_FLOOR_PREP },
  };
}

function defaultPrices(): Project['prices'] {
  return { ...DEFAULT_PRICES, labour: { ...DEFAULT_PRICES.labour }, materials: { ...DEFAULT_PRICES.materials } };
}

/**
 * An empty project with the given id: no products, rooms, staircases or floor plans, and every
 * option group and price at its `defaults.ts` value. Deterministic — the same id always yields an
 * identical project.
 *
 * Example: `emptyProject('p1')` -> `{ id: 'p1', name: 'New project', products: [], rooms: [], ... }`.
 */
export function emptyProject(id: string): Project {
  return {
    id,
    name: 'New project',
    displayUnit: 'metric',
    products: [],
    rooms: [],
    staircases: [],
    floorPlans: [],
    options: defaultOptions(),
    prices: defaultPrices(),
  };
}

/** A straight step in the sample house: 200 mm rise, 223 mm going, 860 mm wide. */
function straightStep(n: number): Step {
  return { id: `step-${n}`, ...DEFAULT_STEP };
}

/** A winder (kite) step at the top of the sample flight: 380 mm at the wide end, 120 mm at the narrow end. */
function winderStep(n: number): Step {
  return { id: `step-${n}`, kind: 'winder', rise: DEFAULT_STEP.rise, going: 380, width: DEFAULT_STEP.width, goingNarrow: 120 };
}

/**
 * A realistic UK three-bedroom semi, fully specified. Rooms (all mm):
 * - Lounge 4.6 x 3.7 with a 2.0 m wide x 0.7 m deep bay on the left wall and a 1.4 x 0.35 chimney
 *   breast on the bottom wall; 4 m twist carpet over floorboards with an old carpet and gripper.
 * - Kitchen/diner: 5.2 x 3.6 L-shape (2.0 x 1.4 cut out of the bottom-right corner) in 3 m sheet
 *   vinyl on uneven concrete of unknown DPM status, old vinyl to lift. Doors to the hall and outside.
 * - Hall 4.0 x 1.0, pile along the hall, hard-wearing carpet shared with the stairs and landing;
 *   front door, lounge and kitchen doors, and the foot of the stairs as a continuous opening.
 * - Stairs: 13 risers, 860 mm wide, straight steps 1–9, three winders (10–12) at the top and the top
 *   riser onto the landing; cap and band, closed strings, timber.
 * - Landing 3.0 x 2.0 L-shape (1.8 x 1.1 cut out top-right), same carpet as the hall; doors to the
 *   four upstairs rooms and the head of the stairs as a continuous opening.
 * - Bedroom 1 4.2 x 3.5 and Bedroom 2 3.6 x 3.0 with a 1.8 x 0.6 wardrobe recess: bedroom carpet.
 * - Bedroom 3 (box room) 2.6 x 2.4: 8 mm oak laminate, 2.22 m²/pack, click, floating on boards, beading.
 * - Bathroom 2.2 x 1.9: glue-down LVT on floorboards (ply overlay + latex skim).
 * Options and prices are the `defaults.ts` values.
 */
export function sampleProject(): Project {
  const P = SAMPLE_IDS.products;
  const R = SAMPLE_IDS.rooms;

  const loungeCarpet: BroadloomProduct = {
    id: P.loungeCarpet,
    name: 'Lounge twist pile carpet (4 m)',
    kind: 'carpet',
    rollWidth: 4000,
    alternativeRollWidths: [5000],
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: DEFAULT_CARPET_THICKNESS,
    pricePerM2: 18,
  };
  const hallCarpet: BroadloomProduct = {
    id: P.hallCarpet,
    name: 'Hall, stairs & landing heavy-domestic carpet (4 m)',
    kind: 'carpet',
    rollWidth: 4000,
    alternativeRollWidths: [5000],
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: 11,
    pricePerM2: 22,
  };
  const bedroomCarpet: BroadloomProduct = {
    id: P.bedroomCarpet,
    name: 'Bedroom saxony carpet (4 m)',
    kind: 'carpet',
    rollWidth: 4000,
    alternativeRollWidths: [5000],
    maxRollLength: CARPET_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: DEFAULT_CARPET_THICKNESS,
    pricePerM2: 14,
  };
  const kitchenVinyl: BroadloomProduct = {
    id: P.kitchenVinyl,
    name: 'Kitchen cushioned sheet vinyl (3 m)',
    kind: 'sheet_vinyl',
    rollWidth: 3000,
    alternativeRollWidths: [2000, 4000],
    maxRollLength: VINYL_MAX_ROLL_LENGTH,
    cutIncrement: CUT_INCREMENT,
    thickness: DEFAULT_VINYL_THICKNESS,
    pricePerM2: 16,
  };
  const laminate: PackProduct = {
    id: P.laminate,
    name: 'Oak effect laminate 8 mm, 1285 x 192 mm',
    kind: 'laminate',
    packCoverageM2: 2.22, // 9 boards x 1.285 x 0.192 = 2.2205 m²
    boardLength: 1285,
    boardWidth: 192,
    boardsPerPack: 9,
    thickness: 8,
    pricePerPack: 24,
  };
  const lvt: PackProduct = {
    id: P.lvt,
    name: 'Stone effect glue-down LVT 2.5 mm, 1220 x 180 mm',
    kind: 'lvt_glue',
    packCoverageM2: 3.29, // 15 planks x 1.22 x 0.18 = 3.294 m²
    boardLength: 1220,
    boardWidth: 180,
    boardsPerPack: 15,
    thickness: 2.5,
    pricePerPack: 65,
  };

  const lounge: Room = {
    id: R.lounge,
    name: 'Lounge',
    shape: {
      kind: 'rectangle_with_features',
      length: 4600,
      width: 3700,
      features: [
        { id: 'feat-lounge-bay', wall: 'left', offset: 850, width: 2000, depth: 700, label: 'Bay window' },
        { id: 'feat-lounge-chimney', wall: 'bottom', offset: 1600, width: 1400, depth: -350, label: 'Chimney breast' },
      ],
    },
    // the polygon starts on the top wall at the bay's inner line: edge 0 is the top wall
    doorways: [{ id: 'door-lounge-hall', edgeIndex: 0, offset: 3400, width: 838, transition: 'carpet', label: 'Lounge door' }],
    productId: P.loungeCarpet,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true, dpmKnown: true },
  };

  const kitchen: Room = {
    id: R.kitchen,
    name: 'Kitchen / diner',
    shape: { kind: 'l_shape', length: 5200, width: 3600, cutoutLength: 2000, cutoutWidth: 1400, cutoutCorner: 'bottom-right' },
    // polygon: (0,0) (5200,0) (5200,2200) (3200,2200) (3200,3600) (0,3600); edge 4 is the bottom wall, edge 5 the left wall
    doorways: [
      { id: 'door-kitchen-hall', edgeIndex: 5, offset: 2500, width: 762, transition: 'carpet', label: 'Kitchen door' },
      { id: 'door-kitchen-back', edgeIndex: 4, offset: 800, width: 900, transition: 'external', label: 'Back door' },
    ],
    productId: P.kitchenVinyl,
    subfloor: { type: 'concrete', condition: 'uneven', existingCovering: 'vinyl', existingGripper: false, dpmKnown: false },
    notes: 'Units stay in place; vinyl runs under the plinths.',
  };

  const hall: Room = {
    id: R.hall,
    name: 'Hall',
    shape: { kind: 'rectangle', length: 4000, width: 1000 },
    // edge 0 top wall (0,0)-(4000,0); edge 2 bottom wall (4000,1000)-(0,1000); edge 3 left wall (0,1000)-(0,0)
    doorways: [
      { id: 'door-hall-front', edgeIndex: 3, offset: 50, width: 900, transition: 'external', label: 'Front door' },
      { id: 'door-hall-lounge', edgeIndex: 2, offset: 2500, width: 838, transition: 'carpet', label: 'Lounge door' },
      { id: 'door-hall-kitchen', edgeIndex: 0, offset: 3100, width: 762, transition: 'hard_floor', label: 'Kitchen door' },
      { id: 'door-hall-stairs', edgeIndex: 0, offset: 800, width: 860, transition: 'carpet', continuous: true, label: 'Foot of stairs' },
    ],
    productId: P.hallCarpet,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true, dpmKnown: true },
    // the pile runs down the hall towards the front door, the same way as the stairs
    planning: { pileDirection: 'along_length' },
  };

  const landing: Room = {
    id: R.landing,
    name: 'Landing',
    shape: { kind: 'l_shape', length: 3000, width: 2000, cutoutLength: 1800, cutoutWidth: 1100, cutoutCorner: 'top-right' },
    // polygon: (0,0) (1200,0) (1200,1100) (3000,1100) (3000,2000) (0,2000); edge 2 (1200,1100)-(3000,1100), edge 4 bottom, edge 5 left
    doorways: [
      { id: 'door-landing-bed1', edgeIndex: 4, offset: 200, width: 762, transition: 'carpet', label: 'Bedroom 1 door' },
      { id: 'door-landing-bed2', edgeIndex: 4, offset: 1400, width: 762, transition: 'carpet', label: 'Bedroom 2 door' },
      { id: 'door-landing-bed3', edgeIndex: 2, offset: 300, width: 686, transition: 'hard_floor', label: 'Bedroom 3 door' },
      { id: 'door-landing-bath', edgeIndex: 2, offset: 1100, width: 686, transition: 'hard_floor', label: 'Bathroom door' },
      { id: 'door-landing-stairs', edgeIndex: 5, offset: 500, width: 860, transition: 'carpet', continuous: true, label: 'Head of stairs' },
    ],
    productId: P.hallCarpet,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true, dpmKnown: true },
  };

  const bedroom1: Room = {
    id: R.bedroom1,
    name: 'Bedroom 1',
    shape: { kind: 'rectangle', length: 4200, width: 3500 },
    doorways: [{ id: 'door-bed1', edgeIndex: 0, offset: 200, width: 762, transition: 'carpet', label: 'Bedroom 1 door' }],
    productId: P.bedroomCarpet,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true, dpmKnown: true },
  };

  const bedroom2: Room = {
    id: R.bedroom2,
    name: 'Bedroom 2',
    shape: {
      kind: 'rectangle_with_features',
      length: 3600,
      width: 3000,
      features: [{ id: 'feat-bed2-wardrobe', wall: 'right', offset: 300, width: 1800, depth: 600, label: 'Wardrobe recess' }],
    },
    doorways: [{ id: 'door-bed2', edgeIndex: 0, offset: 300, width: 762, transition: 'carpet', label: 'Bedroom 2 door' }],
    productId: P.bedroomCarpet,
    subfloor: { type: 'chipboard', condition: 'good', existingCovering: 'carpet', existingGripper: true, dpmKnown: true },
  };

  const bedroom3: Room = {
    id: R.bedroom3,
    name: 'Bedroom 3 (box room)',
    shape: { kind: 'rectangle', length: 2600, width: 2400 },
    doorways: [{ id: 'door-bed3', edgeIndex: 0, offset: 200, width: 686, transition: 'carpet', label: 'Bedroom 3 door' }],
    productId: P.laminate,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true, dpmKnown: true },
    hardFloor: { layPattern: 'straight', useBeading: true },
  };

  const bathroom: Room = {
    id: R.bathroom,
    name: 'Bathroom',
    shape: { kind: 'rectangle', length: 2200, width: 1900 },
    doorways: [{ id: 'door-bath', edgeIndex: 0, offset: 200, width: 686, transition: 'carpet', label: 'Bathroom door' }],
    productId: P.lvt,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'vinyl', existingGripper: false, dpmKnown: true },
    notes: 'Sanitaryware stays in; cut round the pedestal and WC.',
  };

  const stairs: Staircase = {
    id: SAMPLE_IDS.staircase,
    name: 'Stairs',
    productId: P.hallCarpet,
    steps: [
      ...Array.from({ length: 9 }, (_, i) => straightStep(i + 1)), // steps 1–9
      winderStep(10),
      winderStep(11),
      winderStep(12),
      straightStep(13), // top riser: its tread is the landing
    ],
    landings: [], // the landing is measured as a room (above) so it shares the roll with the hall
    method: 'cap_and_band',
    openSides: 'none',
    nosingOverhang: DEFAULT_NOSING_OVERHANG,
    subfloor: { type: 'floorboards', condition: 'good', existingCovering: 'carpet', existingGripper: true },
  };

  return {
    id: SAMPLE_IDS.project,
    name: 'Example: 3-bed semi, full re-floor',
    displayUnit: 'metric',
    products: [loungeCarpet, hallCarpet, bedroomCarpet, kitchenVinyl, laminate, lvt],
    rooms: [lounge, kitchen, hall, landing, bedroom1, bedroom2, bedroom3, bathroom],
    staircases: [stairs],
    floorPlans: [],
    options: defaultOptions(),
    prices: defaultPrices(),
    notes: 'Sample project — every figure is editable. Prices are indicative UK trade prices.',
  };
}
