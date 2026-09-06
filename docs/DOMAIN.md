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
| `balancedThresholdM2` | 1.0 m² | What ONE seam has to be worth. In *balanced* mode a seam — side or cross — is only cut if it saves at least this much carpet, so seams are never added to save a scrap. **[U]** |
| `usableOffcutMin` | 500 mm | Offcuts smaller than 0.5 m either way are reported as waste rather than as usable remnants. **[U]** |
| `minCrossJoinStripLength` | 600 mm | Below this a cross-joined segment is not worth cutting. **[U]** |
| `VINYL_MIN_FILL_WIDTH` | 600 mm | Sheet vinyl only. A 300 mm strip of cushioned vinyl curls, will not roll flat into an adhesive bed and puts a seam a footstep from the wall, so vinyl gets twice carpet's minimum fill. **[L]** |
| `VINYL_ALLOWS_CROSS_JOINS` | `false` | Sheet vinyl is never cross-joined. A butt joint across a kitchen or bathroom floor is a route for water under the sheet and cannot be welded flat the way a side seam can, so no saving buys one. **[V]** |
| `DEFAULT_CARPET_THICKNESS` / `DEFAULT_VINYL_THICKNESS` | 10 mm / 2.5 mm | Assumed build-up of a covering whose thickness was not entered, used to decide whether the new floor is thicker than the old one (which drives the door-easing recommendation). **[L]** |

**A seam has to pay for itself.** The planner scores a plan by the LINEAR METRES it takes off the
roll, then by seams, then by piece area — not by piece area alone. A seam that leaves the order the
same length buys nothing but tape, time and a line down the floor for the life of the carpet, so it
is never cut: under *balanced* every seam is charged `balancedThresholdM2` against the material it
saves, and under *min seams* the fewest-piece plan always wins. The same rule applies to cross
joins, per join rather than per run. **[V]**

**Pile direction is chosen for the roll, not the room.** Each room starts on the direction that is
cheapest planned on its own, then the whole roll is re-packed while turning one room at a time for
as long as the combined length keeps falling. A landing that packs beside the hall one way and opens
a whole new cut the other is worth 2 m of carpet, and no per-room decision can see that. **[U]**

**Over-runs.** Whole units — packs of laminate, rolls of underlay, packs of gripper, lengths of
beading — round UP, except when the requirement overruns the last unit by less than
`OVER_RUN_TOLERANCE` (3%, `src/engine/accessories.ts`). 4.02 rolls of underlay is four rolls and
0.22 m made up out of the offcuts, not a whole fifth 15 m² roll to supply 219 mm; 3.008 packs of
laminate is three packs, not four (which would be 42% more material than the floor). The quote says
in the line note exactly how much is being made up. **[L]**

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
| `GRIPPER_PER_STEP` | 2 | One length across the back of the tread, one at the foot of the riser. The TOP step is the exception: its tread is the landing, so only its riser foot is gripped (one length), and a winder's long back edge takes one more. **[V]** |
| `PAD_NOSING_OVERLAP` | 50 mm | Underlay pads go on the TREADS only — the risers are left bare so the carpet pulls tight against them — with the pad running about 50 mm over the nose where the foot lands. `Staircase.underlayRisers` switches to a continuous pad down the whole flight for a waterfall build-up. **[V]** |
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
floor running out to a doorstep an end profile.

A door between two rooms is measured from **both** of them — each room's gripper has to stop at it —
but there is one leaf and one bar to buy. The two entries are joined by an explicit
`Doorway.sharedOpeningId` (the "Shared with" column in the doorway editor), and the opening is then
counted once for the bar AND once for the door easing. Identity is never guessed from the label:
"Door", "Doorway" and "Door to landing" are exactly what people type, so matching on text would buy
one bar for two different doorways in different rooms — a bar short on site — or two bars for one
opening described differently from each side. Where the two sides were measured at different widths
the wider is used and the difference is reported.

## 6. Floor preparation

| Constant | Value | Rule |
|---|---|---|
| `latexBagCoverageM2PerMm` | 13 m²·mm/bag | Smoothing compound consumes 1.5–1.65 kg/m²/mm, so a 20 kg bag covers about 4.3 m² at 3 mm. **[V]** |
| `latexThickness` | 3 mm | The nominal skim under vinyl and LVT, and over a ply overlay; 5 mm over a poor subfloor. **[V]** |
| `primerCoverageM2PerLitre` | 20 m²/L | Acrylic primer concentrate diluted about 1:4 on porous floors: a 5 L can covers ~100 m². Neat on dense surfaces roughly halves it. **[L]** |
| `primerCanLitres` | 5 L | Primer is sold in sealed cans, so the quote orders whole CANS: 0.8 L of primer is still one can and one price. **[V]** |
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

**Nothing required is left unpriced.** Every item the estimate says must happen either carries a
price of its own or names the labour line that prices it. Gripper removal, board preparation,
skirting off and back and the hygrometer test each have a rate; hard-floor underlay, primer cans and
vinyl seam weld each have a material price; acclimatisation is marked "no charge — allow the time in
the programme".

**Minimum job charge.** `minimumJobLabour` (£180) is the least labour a visit is charged. Pure £/m²
rates under-quote a small room badly — a 2.2 × 1.9 m bathroom in glue-down LVT over a new ply
overlay is most of a day and prices at about £155 — so the shortfall is added as its own line that
says why. It is a JOB minimum, not a room minimum: at £5/m² carpet a per-room minimum would put a
minimum charge on every room under 30 m² of a whole-house job, which no fitter charges. UK minimum
call-out / visit charges are typically £150–£200. **[L]**

**Gripper is quoted the way it is bought.** With `gripperPerPack` above one the line quantity, unit
and price are all per pack (`gripperPerPack` price); the note gives the metres, the lengths and how
many are spare. The per-length price is used only where the pack size is one. The line used to quote
63 lengths at the per-length price and then tell the reader to buy 7 packs of 10.

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

## 10. Appendix: every default at a glance

Values as shipped in `src/engine/defaults.ts`. All of them are editable in the app.

### Constants

| Name | Value |
|---|---|
| `CARPET_ROLL_WIDTHS` | `[4000, 5000]` mm |
| `CARPET_ROLL_WIDTHS_OTHER` | `[3660, 4570, 2000, 3000]` mm |
| `VINYL_ROLL_WIDTHS` | `[2000, 3000, 4000]` mm |
| `CARPET_MAX_ROLL_LENGTH` | 30 000 mm |
| `VINYL_MAX_ROLL_LENGTH` | 20 000 mm |
| `CUT_INCREMENT` | 100 mm |
| `DEFAULT_CARPET_THICKNESS` | 10 mm |
| `DEFAULT_VINYL_THICKNESS` | 2.5 mm |
| `VINYL_MIN_FILL_WIDTH` | 600 mm |
| `VINYL_ALLOWS_CROSS_JOINS` | `false` |
| `UNDERLAY_ROLL_LENGTHS` | `[11000, 15000]` mm |
| `MAX_TOG_WITH_UFH` | 2.5 tog |
| `MAX_UNDERLAY_THICKNESS_ON_STAIRS` | 10 mm |
| `GRIPPER_TRADE_BOX` | 100 lengths |
| `UK_DOOR_WIDTHS` | `[610, 686, 762, 838, 914, 726, 826, 926]` mm |
| `DEFAULT_DOOR_WIDTH` | 838 mm |
| `MAX_SUBFLOOR_RH_RESILIENT` | 75 % RH |
| `MAX_SUBFLOOR_RH_WOOD` | 65 % RH |
| `LAY_PATTERN_WASTAGE` | straight 0.07, random_stagger 0.07, brick 0.08, diagonal 0.15, herringbone 0.20, chevron 0.20 |
| `BEADING_WASTAGE` | 0.10 |
| `LVT_ADHESIVE_M2_PER_KG` / `LVT_ADHESIVE_TUB_KG` | 4 m²/kg / 15 kg |
| `TACKIFIER_M2_PER_LITRE` / `TACKIFIER_TUB_LITRES` | 7 m²/L / 5 L |
| `CARPET_TILE_SIZE` / `CARPET_TILES_PER_BOX` / `CARPET_TILE_WASTAGE` | 500 mm / 20 / 0.07 |
| `VINYL_ADHESIVE_M2_PER_KG` / `VINYL_ADHESIVE_TUB_KG` | 4 m²/kg / 15 kg |
| `DEFAULT_STEP` | straight, rise 200, going 223, width 860 mm |
| `STAIR_REGS` | rise 150–220, going 220–300 mm, pitch ≤ 42° |
| `DEFAULT_NOSING_OVERHANG` | 20 mm |
| `STEP_LENGTH_ALLOWANCE` | 30 mm |
| `CAP_AND_BAND_EXTRA` | 75 mm |
| `STEP_WIDTH_ALLOWANCE` | 100 mm |
| `OPEN_SIDE_WRAP` | 150 mm per open side |
| `BULLNOSE_WRAP_FACTOR` / `BULLNOSE_WRAP_TUCK` | 1.6 / 50 mm |
| `RUNNER_END_ALLOWANCE` | 300 mm |
| `RUNNER_DEFAULT_WIDTH` | 600 mm |
| `GRIPPER_PER_STEP` | 2 lengths |
| `PAD_NOSING_OVERLAP` | 50 mm |
| `PLY_SCREWS_PER_BOX` | 200 |
| `CARPET_PRICE_TIERS` | budget £8, mid £18, premium £35 per m² |

Two more supply rules live beside the code that uses them rather than in `defaults.ts`:
`OVER_RUN_TOLERANCE` (0.03) and `UNDERLAY_PAD_WASTAGE` (0.10) in `src/engine/accessories.ts`,
`STAIR_HARD_FLOOR_WASTAGE` (0.15) in `src/engine/stairs.ts`, and
`VINYL_FULLY_BONDED_MIN_AREA_M2` (20 m²) in `src/engine/estimate.ts`.

### `DEFAULT_BROADLOOM_OPTIONS`

| Key | Value |
|---|---|
| `pileDirection` | `auto` |
| `seamPolicy` | `balanced` |
| `lengthAllowance` / `widthAllowance` | 100 mm / 100 mm |
| `balancedThresholdM2` | 1.0 m² per seam |
| `minCrossJoinStripLength` | 600 mm |
| `usableOffcutMin` | 500 mm |
| `minFillWidth` | 300 mm |
| `maxCrossJoinsPerFill` | 2 |

### `DEFAULT_UNDERLAY`

| Key | Value |
|---|---|
| `fit` | `true` |
| `rollWidth` / `rollLength` | 1370 mm / 11 000 mm |
| `thickness` | 10 mm |
| `tog` | 2.3 |
| `pricePerRoll` | £75 |

### `DEFAULT_ACCESSORIES`

| Key | Value |
|---|---|
| `gripperLength` | 1520 mm |
| `gripperPerPack` | 10 |
| `gripperWastage` | 0.10 |
| `doorBarLength` / `doorBarLongLength` | 900 mm / 2700 mm |
| `seamTapeRollLength` | 20 000 mm |
| `doubleSidedTapeRollLength` | 25 000 mm |
| `underlayTapeRollLength` | 50 000 mm |

### `DEFAULT_FLOOR_PREP`

| Key | Value |
|---|---|
| `latexThickness` | 3 mm |
| `latexBagCoverageM2PerMm` | 13 m²·mm per bag |
| `latexWastage` | 0.10 |
| `primerCoverageM2PerLitre` | 20 m²/L |
| `primerCoats` | 1 |
| `primerCanLitres` | 5 L |
| `plySheetLength` / `plySheetWidth` | 2440 mm / 1220 mm |
| `plyWastage` | 0.10 |
| `plyScrewsPerSheet` | 150 |
| `hardboardSheetLength` / `hardboardSheetWidth` | 1220 mm / 610 mm |
| `liquidDpmCoverageM2PerKg` | 1.65 m²/kg |
| `dpmSheetRollAreaM2` | 100 m² |
| `dpmOverlap` | 0.15 |

### `DEFAULT_HARD_FLOOR`

| Key | Value |
|---|---|
| `layPattern` | `straight` |
| `expansionGap` | 10 mm |
| `useBeading` | `true` |
| `beadingLength` | 2400 mm |
| `underlayPackCoverageM2` | 15 m² |
| `underlayHasDpm` | `true` |

### `DEFAULT_PRICES` (GBP, VAT 20 %, applied)

Labour:

| Key | Value | Key | Value |
|---|---|---|---|
| `carpetFittingPerM2` | £5.00 | `doorEasingPerDoor` | £15.00 |
| `vinylFittingPerM2` | £7.00 | `bindingPerM` | £6.50 |
| `laminateFittingPerM2` | £12.00 | `minimumJobLabour` | £180.00 |
| `lvtFittingPerM2` | £18.00 | `gripperRemovalPerM` | £1.50 |
| `stairsPerStep` | £12.00 | `boardPrepPerM2` | £4.00 |
| `upliftPerM2` | £2.00 | `skirtingRefitPerM` | £6.00 |
| `disposalPerM2` | £3.00 | `moistureTestPerTest` | £25.00 |
| `latexPerM2` | £7.50 | `plyPerM2` | £14.00 |

Materials:

| Key | Value | Key | Value |
|---|---|---|---|
| `gripperPerLength` | £1.20 | `underlayTapePerRoll` | £5.00 |
| `gripperPerPack` | £11.00 | `hardFloorUnderlayPerPack` | £22.00 |
| `doorBarPerBar` | £8.00 | `beadingPerLength` | £6.00 |
| `latexPerBag` | £20.00 | `thresholdPerItem` | £15.00 |
| `primerPerCan` | £30.00 | `stairNosingPerItem` | £30.00 |
| `plyPerSheet` | £20.00 | `stairRodPerItem` | £15.00 |
| `hardboardPerSheet` | £8.00 | `adhesivePerTub` | £45.00 |
| `liquidDpmPerKg` | £12.00 | `tackifierPerTub` | £30.00 |
| `dpmSheetPerRoll` | £30.00 | `plyScrewsPerBox` | £8.00 |
| `seamTapePerRoll` | £10.00 | `vinylSeamWeldPerM` | £3.00 |
| `doubleSidedTapePerRoll` | £8.00 | | |

## 11. What the tool deliberately does not do

- **Read a floor plan automatically.** Estate-agent plans carry a "not to scale, illustrative only"
  disclaimer and are drawn to about ±2% of area and ±50 mm a wall. Automatic room detection would
  need a server and would still have to be checked wall by wall, so the tool calibrates on a printed
  dimension or a known door width and has the user trace the rooms — under a minute a floor, and
  auditable.
- **Price the goods for you.** It computes what to order; the price book is yours.
- **Replace a site visit.** Its warnings say when a measurement needs confirming — a tight roll
  width, a seam forced through a doorway, an unknown damp-proof membrane, stairs outside the
  Building Regulations, underlay too thick for a nosing.
- **Allow for the carpet running out into the doorways.** `lengthAllowance` and `widthAllowance` add
  100 mm to each dimension (50 mm of trim at each end). The room outline stops at the wall face, so
  nothing extra is added for the covering running out to the middle of a door bar — another 50–100 mm
  at each opening. Raise the allowances, or measure into the doorways, on a job with several
  openings on one wall.
- **Undo.** Actions that replace the whole project confirm first, and so do the row deletes that
  discard a measured value, but there is no history. Save the file before a big change.
