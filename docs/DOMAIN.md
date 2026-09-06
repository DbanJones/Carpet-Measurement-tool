# Domain reference

Every constant in `src/engine/defaults.ts` is listed here with the trade rule behind it, its source
where one could be verified, and — where sources disagreed — the reasoning for the value chosen.
All of them are editable in the app (Materials & options), so a shop with different suppliers,
allowances or rates can make the tool match its own practice.

Confidence is marked as **[V]** verified against a cited source, **[L]** likely (consistent trade
practice across several secondary sources), **[U]** unverified (trade knowledge or a pragmatic
engine-level choice). BS 5325 (textile floorcoverings), BS 8203 (resilient), BS 8425 (laminate) and
the NICF/CFA guides are paywalled, so rules attributed to them come from manufacturer and fitter
guidance that cites them rather than from the standards themselves.

---

## 1. Broadloom supply — carpet and sheet vinyl

| Constant | Value | Rule |
|---|---|---|
| `CARPET_ROLL_WIDTHS` | 4 m, 5 m | The two UK stock widths. 4 m suits most bedrooms; 5 m avoids a seam in rooms 4.0–4.9 m wide. **[V]** |
| `CARPET_ROLL_WIDTHS_OTHER` | 3.66 m, 4.57 m, 2 m, 3 m | 3.66 m (12 ft) is used for Axminster/Wilton and some budget ranges **[V]**; 2/2.5/3 m appear in multi-width ranges **[V]**; 4.57 m (15 ft) is a US width offered here only because imported goods occasionally arrive on it — no UK stockist was found **[U]**. |
| `VINYL_ROLL_WIDTHS` | 2 m, 3 m, 4 m | Standard UK sheet vinyl widths. Pick the smallest width ≥ short side + allowance to avoid a seam. **[V]** |
| `CARPET_MAX_ROLL_LENGTH` | 30 m | A full roll is typically 30–35 m; a longer requirement needs a second roll or a cross seam. **[L]** |
| `VINYL_MAX_ROLL_LENGTH` | 20 m | Sheet vinyl rolls run 15–25 m. **[L]** |
| `CUT_INCREMENT` | 100 mm | UK retailers cut to the nearest 0.1 m and always round up. **[V]** |
| `minCutLength` (per product) | unset | Retailer policies vary — 1.5 m at Floorlines Direct, 10 m² for some commercial ranges; most residential shops cut from about 1 m. Left unset rather than guessed. **[V]** |

Carpet is bought as **roll width × cut length**, not by floor area: a 3 × 4 m room from a 4 m roll
costs a 3 m cut of the full 4 m width whatever the room's area. The tool therefore reports linear
metres and the ordered area, and shows the waste that the roll width forces.

## 2. Measuring and fitting allowances

| Constant | Value | Rule |
|---|---|---|
| `lengthAllowance`, `widthAllowance` | 100 mm each | "Add 10 cm to each dimension": the carpet runs ~5 cm up each wall and is trimmed in place, covering out-of-square walls. Sources range 50–150 mm. **[V]** |
| `minFillWidth` | 300 mm | Never plan a sliver: professional estimating software keeps a 1 ft minimum fill because narrower strips cannot be seamed and stretched properly. The seam moves so both pieces are practical. **[L]** |
| `maxCrossJoinsPerFill` | 2 | A fill may be at most three strips joined end to end, mirroring the "maximum allowed T-seams" cap in trade software. **[L]** |
| `balancedThresholdM2` | 1.0 m² | In *balanced* mode a cross join is only accepted if it saves at least this much carpet, so seams are not added to save a scrap. **[U]** |
| `usableOffcutMin` | 500 mm | Offcuts smaller than 0.5 m either way are reported as waste rather than as usable remnants. **[U]** |
| `minCrossJoinStripLength` | 600 mm | Below this a cross-joined segment is not worth cutting. **[U]** |

Measure at the **longest and widest points**, into bays, alcoves and doorways (to the centre of the
closed door), and ignore chimney breasts and other obstructions — the fitter cuts around them. The
room shapes in the tool follow this: a chimney breast is entered as a negative-depth feature so it
shows on the plan and in the area, but it never splits a piece.

**Pile direction.** Every piece in one area must run the same way — cut-pile shading makes the same
carpet look light one way and dark the other, so a rotated piece is instantly visible. Convention is
pile towards the main door, away from the window, and down the stairs. The planner therefore never
rotates a piece; with direction on *auto* it plans the room both ways and keeps the cheaper. **[V]**

**Seams.** Along the length of the room, parallel to the traffic and to the light from the window,
and never across a doorway opening. The planner penalises a seam that would cross an opening on a
wall running across the pile so heavily that it is used only when nothing else fits, and warns when
it happens. **[V]**

**Pattern repeat.** Every piece after the first needs one full length repeat to match; a half-drop
pattern needs 1.5. Patterned goods also need the fill's width rounded to a width repeat. Reported
wastage on patterned work is typically 15–20% against 5–10% plain. **[V]**

## 3. Stairs

Approved Document K (England, private stairs): rise 150–220 mm, going 220–300 mm, pitch ≤ 42°, so
220/220 is not permissible. The archetypal UK flight is 13 risers of ~200 mm (2.6 m floor to floor)
with a 223 mm going at 860 mm wide (800 mm practical minimum in England, 900 mm in Scotland). **[V]**

| Constant | Value | Rule |
|---|---|---|
| `DEFAULT_STEP` | rise 200, going 223, width 860 | Typical UK flight; pitch 41.9°, inside AD K. **[V]** |
| `STAIR_REGS` | 150–220 / 220–300 / 42° | AD K Table 1.1, used for validation warnings only — older houses are often outside it. **[V]** |
| `DEFAULT_NOSING_OVERHANG` | 20 mm | The tread projects past the riser; the carpet wraps over it. **[L]** |
| `STEP_LENGTH_ALLOWANCE` | 30 mm | With the 20 mm nosing this makes the trade's "+50 mm per step" (25 mm nosing wrap + 25 mm tuck). **[V]** |
| `CAP_AND_BAND_EXTRA` | 75 mm | Individual step pieces wrap under the nosing and need 50–100 mm more per step than a waterfall. At 12.5% of a 473 mm step this agrees with the "+10–15%" rule quoted for cap and band. **[L]** |
| `STEP_WIDTH_ALLOWANCE` | 100 mm | 50 mm each side to tuck against closed strings. **[V]** |
| `OPEN_SIDE_WRAP` | 150 mm per open side | Tread thickness plus the return under the step plus fixing and trim, where the carpet wraps an exposed cut string and is bound. Derived from US guidance (50–75 mm per vertical edge) plus tread thickness; no UK numeric source found. **[U]** |
| `BULLNOSE_WRAP_FACTOR` / `BULLNOSE_WRAP_TUCK` | 1.6 × projection + 50 mm | The band follows the curve of the round end: π/2 ≈ 1.571 of the radius for a quarter-round, taken to 1.6 with a tuck each end. **[L]** |
| `RUNNER_END_ALLOWANCE` | 300 mm | Once per continuous (waterfall) run, for the tuck at the top and the finish at the bottom. **[L]** |
| `RUNNER_DEFAULT_WIDTH` | 600 mm | UK runners are sold 600/700/850/900 mm wide; a 5–15 cm reveal each side of an 860 mm stair suits 600–700 mm. **[V]** |
| `GRIPPER_PER_STEP` | 2 | One length across the back of the tread, one at the foot of the riser. **[V]** |
| `MAX_UNDERLAY_THICKNESS_ON_STAIRS` | 10 mm | Thicker underlay will not sit over a nosing; 8 mm dense (heavy domestic) is the usual choice. Sources say 9–10 mm. **[V]** |

**Per step** the carpet wraps rise + going + nosing. The **top step has no going** — its tread is the
landing floor — so it takes rise + nosing only. Where the landing carpet runs over the top nosing
instead (`topRiserByLanding`), the flight stops one riser short and the landing piece gains
rise + nosing + tuck. Sources genuinely differ on this ("13 steps" in retailer examples counts all
13 risers on the flight), so it is a per-staircase option rather than a fixed rule. **[V]**

**Winders** are measured individually at their widest and deepest points and cut from the bounding
rectangle of the kite; three winders normally turn a 90° corner (30° each). They cannot be matched
into a continuous run, so they are always separate pieces and they break a waterfall flight into
runs. A three-winder corner uses about 1.8× the carpet of three straight steps. **[V]**

## 4. Underlay

| Constant | Value | Rule |
|---|---|---|
| `rollWidth` / `rollLength` | 1370 mm × 11 m (15.07 m²) | The universal UK carpet underlay roll across PU foam, crumb rubber and felt. **[V]** |
| `thickness` | 10 mm | 10–12 mm PU in rooms, 8 mm dense on stairs and in halls. **[V]** |
| `tog` | 2.3 | Typical 10 mm PU. Wool felt 42 oz ≈ 3.4 tog; 6.5 mm crumb rubber ≈ 1.1 tog. **[V]** |
| `MAX_TOG_WITH_UFH` | 2.5 tog | Carpet **and** underlay combined over underfloor heating; 1.5 tog where the UFH is fed by a heat pump. **[V]** |
| `underlayTapeRollLength` | 50 m | 50 mm × 50 m single-sided joining tape; one roll does about four average rooms. **[V]** |
| Hard floor `underlayPackCoverageM2` | 15 m² | Foam/foil underlay for floating floors is 1 m wide in 15 m² (or 10 m²) rolls; fibreboard comes in ~10 m² packs. **[V]** |

Underlay is planned as **1.37 m strips**, not by area, because the width never divides into a room
neatly: a 4.0 m wide room needs three strips = 4.11 m of underlay width. Strips run at 90° to the
carpet seams, are butt-joined and taped. The same strip planner as the carpet is used, with no
allowances, so offcuts from one room serve the next.

## 5. Gripper, door bars and tapes

| Constant | Value | Rule |
|---|---|---|
| `gripperLength` | 1.52 m | The standard 5 ft length (0.76 m half lengths also sold). **[V]** |
| `gripperPerPack` | 10 | Retail pack; the trade box is 100 lengths = 152 m. **[V]** |
| `gripperWastage` | 10% | UK calculators add 10% for cuts and corners (15% for bays and angled walls). **[V]** |
| `doorBarLength` / `doorBarLongLength` | 900 mm / 2.7 m | A 900 mm bar covers every imperial leaf up to 838 mm; 926 mm metric doors and double or patio openings take a cut-to-size bar. **[V]** |
| `UK_DOOR_WIDTHS` | 610, 686, 762, 838, 914 (imperial); 726, 826, 926 (metric) | Standard UK internal door leaves. **[V]** |
| `seamTapeRollLength` | 20 m | 100 mm hot-melt seaming tape. **[V]** |
| `doubleSidedTapeRollLength` | 25 m | 50 mm double-sided tape for perimeter-fixed vinyl. **[V]** |

Gripper goes round the room's perimeter **less the door openings**, with timber pins on boards and
masonry pins on concrete, anhydrite, tiles or asphalt. Sheet vinyl and hard floors take none. Sound
existing gripper can often be reused — the tool says so rather than silently charging for new.

Door bar type comes from the transition, not from a menu: carpet→carpet takes a double-sided bar,
carpet→hard floor a single-edge, hard→same-level-hard a T-bar, hard→different height a ramp, and a
floor running out to a doorstep an end profile. A doorway entered from both of its rooms is counted
**once**, so a whole-house job does not order two bars per door.

## 6. Floor preparation

| Constant | Value | Rule |
|---|---|---|
| `latexBagCoverageM2PerMm` | 13 m²·mm/bag | Smoothing compound consumes 1.5–1.65 kg/m²/mm, so a 20 kg bag covers about 4.3 m² at 3 mm. **[V]** |
| `latexThickness` | 3 mm | The nominal skim under vinyl and LVT, and over a ply overlay; 5 mm over a poor subfloor. **[V]** |
| `primerCoverageM2PerLitre` | 20 m²/L | Acrylic primer concentrate diluted about 1:4 on porous floors: a 5 L can covers ~100 m². Neat on dense surfaces roughly halves it. **[L]** |
| `plySheet` | 2440 × 1220 mm, 6 mm | Flooring-grade (BS EN 636-2) overlay under resilient coverings on timber; 9–12 mm where boards are badly cupped. **[V]** |
| `plyScrewsPerSheet` | 150 | Screws or 25 mm ring-shank nails at 150 mm centres both ways (17 × 9 on a full sheet). **[L]** |
| `hardboardSheet` | 1220 × 610 mm, 3.2 mm | Under carpet only — never under vinyl or LVT — and conditioned with water 24–48 h before fixing. **[V]** |
| `liquidDpmCoverageM2PerKg` | 1.65 m²/kg | Two-pack epoxy surface DPM at ~0.3 kg/m² per coat, two coats. **[L]** |
| `dpmSheetRollAreaM2` / `dpmOverlap` | 100 m² (4 × 25 m) / 15% | 1000 gauge (250 µm) polythene, 200 mm laps plus wall turn-ups. **[V]** |
| `MAX_SUBFLOOR_RH_RESILIENT` / `_WOOD` | 75% / 65% RH | BS 8203:2017 Annex B hygrometer limits, box sealed to the floor for at least 72 hours. **[V]** |

Preparation is decided by a **rule table** over (covering class, subfloor type, condition, flags),
not by a percentage: resilient coverings on concrete get primer and latex; on boards they get a ply
overlay and a skim; carpet on good boards gets nothing beyond underlay; unknown-DPM ground-floor
concrete under a resilient or floating floor gets a moisture test and a provisional surface DPM.
Quantities are summed across rooms **before** rounding, so a project buys bags, not rooms.
Recommended (as opposed to required) work is priced in the notes but kept out of the totals.

## 7. Hard flooring

| Constant | Value | Rule |
|---|---|---|
| `LAY_PATTERN_WASTAGE` | straight 7%, brick 8%, diagonal 15%, herringbone/chevron 20% | Trade figures; consumer calculators use a flat 10% for straight lay. Herringbone needs balanced A/B planks and its edge triangles are unusable. **[V]** |
| Large-room / odd-shape extras | +2% over 40 m², +3% non-rectilinear | More cuts in big rooms; diagonal walls waste board ends. **[U]** |
| `expansionGap` | 10 mm | Manufacturers specify 8–12 mm for laminate; rigid-core click LVT 5–10 mm; glue-down is fitted tight. An intermediate joint is needed beyond ~8 m (laminate) or ~10 m (LVT). **[V]** |
| `beadingLength` / `BEADING_WASTAGE` | 2.4 m / 10% | Scotia or quadrant covers the expansion gap; mitres and short returns waste about 10%. **[V]** |
| `LVT_ADHESIVE_M2_PER_KG` / tub | 4 m²/kg / 15 kg | Pressure-sensitive acrylic at 3–5 m²/kg: a 15 kg tub covers about 60 m². **[V]** |
| `VINYL_ADHESIVE_M2_PER_KG` / tub | 4 m²/kg / 15 kg | F. Ball F44-class adhesive at 3.5–5 m²/kg. **[V]** |
| `CARPET_TILE_SIZE` / per box / wastage | 500 mm / 20 (5 m²) / 7% | Standard tile and box; 5% in simple rectangles, 10% for angled rooms or directional lay. **[V]** |
| `TACKIFIER_M2_PER_LITRE` / tub | 7 m²/L / 5 L | Rollered tackifier covers 6–10 m²/L. **[V]** |
| Acclimatisation | 48 h | Laminate 48 h, engineered 72 h, LVT and carpet 24 h, unopened in the room. **[V]** |

Sheet vinyl is **fully bonded** above about 20 m² or wherever it is seamed, and perimeter-fixed with
double-sided tape below that; all seams are chemically sealed.

## 8. Prices and labour — indicative only

`DEFAULT_PRICES` exists so the estimate reads as a quote out of the box. **Every figure is an
indicative UK 2025/26 mid-range and is meant to be replaced with the shop's own.** Ranges found in
research: carpet fitting £3–12/m²; vinyl £7–12/m²; laminate £12–15/m²; LVT £18–22/m²; stairs
£8–20 per step (a straight flight £150–250 + VAT, winders and open sides at the top of the range);
uplift £2–6/m² by covering and disposal £2–4/m²; smoothing compound £5–10/m² labour plus ~£20 a bag;
6 mm ply supplied and fixed £10–18/m²; whipping £4.50–8/m and taped binding from £8/m; door easing
£10–25 a door; gripper £0.60 a length in a trade box of 100 against about £1.20 retail; door bars
£4–13 material or £12–18 supplied and fitted; stair rods £9–32 each; laminate stair nosings £15–45.
VAT is applied at 20% and can be turned off for a trade price.

## 9. Where the sources disagreed

The research surfaced two dozen genuine conflicts between retailers, fitters' guides and trade
software. The ones that change a number are resolved as follows.

- **Per-step carpet length.** AD K-derived dimensions give rise 200 + going 223 + 50 = 473 mm; the
  retailers' worked examples use 250 + 200 + 50 = 500 mm and quote "13 steps ≈ 6.5 m". Both are the
  same rule with different assumed dimensions, so the tool asks for the real rise and going and
  defaults to the AD K figures.
- **Top riser.** Counted on the flight by default (matching the retailers' "13 steps"), with the
  landing able to take it as an option (matching fitters' practice with a carpeted landing).
- **Straight-lay hard floor wastage.** 7% (trade) against 10% (Wickes, B&Q and other consumer
  calculators). 7% is used because the engine also adds the large-room and odd-shape increments; the
  retail 10% is a preset in the options.
- **Smoothing compound.** 1.5–1.65 kg/m²/mm across manufacturers; 13 m²·mm per 20 kg bag is the
  mid-point (4.3 m² at 3 mm).
- **Ply fixings.** 150 per sheet at 150 mm centres both ways, rather than 120 at 200 mm field
  spacing.
- **Underlay wastage.** None added — the engine plans the actual 1.37 m strips and pools offcuts,
  which is more accurate than the retailers' flat 5%.
- **Loose-lay vinyl threshold.** Sources give 12 m² and 25 m²; the tool bonds at 20 m² or at the
  first seam, whichever comes first.
- **Gripper price.** £1.20 per length (retail pack) is the default; a trade box works out at £0.60.
- **15 ft (4.57 m) carpet.** Offered as an "other" width only; no UK stockist was found.
- **Minimum cut length.** No major UK chain publishes one, so it is left unset per product rather
  than assumed.

## 10. What the tool deliberately does not do

- **Read a floor plan automatically.** Estate-agent plans carry a "not to scale, illustrative only"
  disclaimer and are drawn to about ±2% of area and ±50 mm a wall. Automatic room detection would
  need a server and would still have to be checked wall by wall, so the tool calibrates on a printed
  dimension or a known door width and has the user trace the rooms — under a minute a floor, and
  auditable.
- **Price the goods for you.** It computes what to order; the price book is yours.
- **Replace a site visit.** Its warnings say when a measurement needs confirming — a tight roll
  width, a seam forced through a doorway, an unknown damp-proof membrane, stairs outside the
  Building Regulations, underlay too thick for a nosing.
