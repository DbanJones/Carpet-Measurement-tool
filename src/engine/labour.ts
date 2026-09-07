import type { BomLine, CoveringKind, Id, LabourActivity, LabourModel, Project } from './types';
import { polygonAreaMm2, shapeToPolygon } from './geometry';
import { roundTo } from './units';

/** Editable starting assumptions, not surveyed productivity or a trade standard. */
export const DEFAULT_LABOUR_MODEL: LabourModel = {
  mode: 'unit_rates', hourlyRate: 40, setupHours: 1, allowance: 0.1,
  fittingM2PerHour: { carpet: 12, sheet_vinyl: 8, laminate: 5, engineered_wood: 4, lvt_click: 5, lvt_glue: 3, carpet_tiles: 10 },
  patternMultiplier: 1.75, straightStepMinutes: 15, shapedStepMinutes: 25, landingM2PerHour: 5,
  activityMinutes: { uplift: 4, disposal: 2, latex: 5, ply: 10, gripper_removal: 2, moisture_test: 30, secure_boards: 4, sand_boards: 5, skirting_refit: 8, door_easing: 20, binding: 6 },
};

export interface LabourHoursLine {
  id: string; description: string; hours: number; calculation: string; subjectIds: Id[]; optional?: boolean;
}
export interface LabourHoursEstimate {
  mode: LabourModel['mode']; hourlyRate: number; baseHours: number; allowanceHours: number; totalHours: number; optionalHours: number; lines: LabourHoursLine[];
}

/** Repairs direct runtime input too: every divisor must be finite and positive. */
export function resolveLabourModel(input: Partial<LabourModel> | undefined): LabourModel {
  const d = DEFAULT_LABOUR_MODEL;
  const nonnegative = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
  const positive = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    mode: input?.mode === 'hourly' ? 'hourly' : 'unit_rates', hourlyRate: nonnegative(input?.hourlyRate, d.hourlyRate),
    setupHours: nonnegative(input?.setupHours, d.setupHours), allowance: nonnegative(input?.allowance, d.allowance),
    fittingM2PerHour: Object.fromEntries(Object.entries(d.fittingM2PerHour).map(([kind, v]) => [kind, positive(input?.fittingM2PerHour?.[kind as CoveringKind], v)])) as LabourModel['fittingM2PerHour'],
    patternMultiplier: positive(input?.patternMultiplier, d.patternMultiplier), straightStepMinutes: nonnegative(input?.straightStepMinutes, d.straightStepMinutes),
    shapedStepMinutes: nonnegative(input?.shapedStepMinutes, d.shapedStepMinutes), landingM2PerHour: positive(input?.landingM2PerHour, d.landingM2PerHour),
    activityMinutes: Object.fromEntries(Object.entries(d.activityMinutes).map(([kind, v]) => [kind, nonnegative(input?.activityMinutes?.[kind as LabourActivity], v)])) as LabourModel['activityMinutes'],
  };
}

/** Uses validated owner IDs from the planner and its preparation BOM, preserving optional work. */
export function estimateLabourHours(project: Project, legacyLabour: BomLine[], plannedOwnerIds: Set<Id>): LabourHoursEstimate {
  const model = resolveLabourModel(project.prices.labourModel);
  const lines: LabourHoursLine[] = [];
  const add = (line: LabourHoursLine) => { if (Number.isFinite(line.hours) && line.hours > 0) lines.push({ ...line, hours: roundTo(line.hours, 4) }); };
  for (const room of project.rooms) {
    if (!plannedOwnerIds.has(room.id)) continue;
    const product = project.products.find(p => p.id === room.productId);
    if (!product) continue;
    const area = polygonAreaMm2(shapeToPolygon(room.shape)) / 1e6;
    const pattern = room.hardFloor?.layPattern ?? ('packCoverageM2' in product ? product.hardFloor?.layPattern : undefined) ?? project.options.hardFloor.layPattern;
    const multiplier = 'packCoverageM2' in product && ['herringbone', 'chevron', 'diagonal'].includes(pattern) ? model.patternMultiplier : 1;
    const rate = model.fittingM2PerHour[product.kind];
    add({ id: `fitting:${room.id}`, description: `${room.name} — fitting`, hours: area / rate * multiplier, calculation: `${roundTo(area, 2)} m² ÷ ${rate} m²/hour${multiplier !== 1 ? ` × ${multiplier} for ${pattern}` : ''}`, subjectIds: [room.id] });
  }
  for (const stairs of project.staircases) {
    if (!plannedOwnerIds.has(stairs.id)) continue;
    const steps = stairs.steps ?? [];
    const straight = steps.filter(s => s.kind === 'straight').length;
    const shaped = steps.length - straight;
    const landingArea = (stairs.landings ?? []).reduce((sum, l) => sum + l.length * l.width / 1e6, 0);
    add({ id: `stairs:${stairs.id}`, description: `${stairs.name} — stair fitting`, hours: (straight * model.straightStepMinutes + shaped * model.shapedStepMinutes) / 60 + landingArea / model.landingM2PerHour,
      calculation: `${straight} straight × ${model.straightStepMinutes} min + ${shaped} shaped × ${model.shapedStepMinutes} min + ${roundTo(landingArea, 2)} m² landings ÷ ${model.landingM2PerHour} m²/hour`, subjectIds: [stairs.id] });
  }
  for (const line of legacyLabour) {
    const key = line.id.replace('bom:labour:', '').replace(':recommended', '') as LabourActivity;
    const minutes = model.activityMinutes[key];
    if (minutes === undefined) continue;
    add({ id: key + (line.optional ? ':optional' : ''), description: line.description, hours: line.quantity * minutes / 60,
      calculation: `${roundTo(line.quantity, 2)} ${line.unit} × ${minutes} min/${line.unit}`, subjectIds: line.subjectIds, ...(line.optional ? { optional: true } : {}) });
  }
  if (lines.some(l => !l.optional)) add({ id: 'setup', description: 'Site setup and clean-up', hours: model.setupHours, calculation: `${model.setupHours} hours per job`, subjectIds: [...plannedOwnerIds] });
  const baseHours = lines.filter(l => !l.optional).reduce((sum, l) => sum + l.hours, 0);
  const allowanceHours = baseHours * model.allowance;
  add({ id: 'allowance', description: 'Site time allowance', hours: allowanceHours, calculation: `${roundTo(baseHours, 2)} hours × ${roundTo(model.allowance * 100, 2)}%`, subjectIds: [...plannedOwnerIds] });
  return { mode: model.mode, hourlyRate: model.hourlyRate, baseHours: roundTo(baseHours, 4), allowanceHours: roundTo(allowanceHours, 4), totalHours: roundTo(baseHours + allowanceHours, 4), optionalHours: roundTo(lines.filter(l => l.optional).reduce((sum, l) => sum + l.hours, 0), 4), lines };
}
