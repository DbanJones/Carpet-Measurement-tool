# Design

## Goals

1. Produce the numbers a fitter or estimator actually orders: **linear metres off a roll at a given
   width**, rolls of underlay, lengths of gripper, door bars by type, bags of latex, sheets of ply,
   packs of laminate — not just "area + 10%".
2. Accept the two ways people describe a job: **typed dimensions** (rectangles, L-shapes, features,
   wall-by-wall walks) and **floor plans** (image/PDF, calibrated and traced in the browser).
3. Be honest about uncertainty: every allowance and constant is visible and editable; warnings say
   why (seam through a doorway, tight roll width, stairs outside Building Regulations, underlay too
   thick for stairs, unknown DPM…).
4. Run entirely client-side so it can be hosted as a static site and used on a phone on site.

## Architecture

```
┌────────────────────────────┐    ┌──────────────────────────────┐
│ UI (React)                 │    │ Engine (pure TypeScript)     │
│  rooms / stairs / plan /   │───▶│  estimateProject(project)    │
│  materials / results       │    │   ├ geometry (polygons)      │
│                            │◀───│   ├ broadloom (seams, DP)    │
│ Store (zustand, autosave)  │    │   ├ packer (shelf packing)   │
│  Project JSON              │    │   ├ rollplan (rooms+stairs)  │
└────────────────────────────┘    │   ├ stairs                   │
                                  │   ├ accessories (underlay,   │
        floor plan tracing        │   │   gripper, door bars)    │
        (pdf.js + canvas + SVG)   │   ├ floorprep (rule table)   │
                                  │   ├ hardfloor (packs)        │
                                  │   └ estimate (BOM, prices)   │
                                  └──────────────────────────────┘
```

* The **engine is pure** (no DOM, no time, no randomness): a `Project` in, an `Estimate` out. That
  makes it unit-testable with hand-derived trade examples and reusable server-side later (e.g. a
  quoting API) without change.
* The **store** holds exactly one `Project` and UI selection; results are always derived, never stored.
* All lengths are **millimetres** inside the engine; areas are square metres at the boundary. The UI
  converts for display (metres or feet/inches) and parses free text such as `13'9"`, `420cm`, `4.2`.

## The cutting problem

Broadloom is sold by the linear metre at a fixed roll width. Pieces cannot be rotated because the pile
(and any pattern) must run the same way throughout a room and down a staircase. So the question is:
*which rectangles do we cut, in what orientation, and how do they nest on the roll?*

### 1. Room → slabs (`geometry.verticalSlabs`)

Orient the room so the roll length runs along +y. Slice at every vertex x-coordinate; each slab is an
x-range with the y-extent of the room inside it. For rectilinear rooms this is exact; diagonal walls
and bays use the bounding extent of the clipped edges (the carpet is cut to shape on site, the waste is
real and is counted). Adjacent slabs with identical extents merge, so a chimney breast or a diagonal
corner does not create extra pieces.

### 2. Seams → pieces (`broadloom.planRoom`)

Candidate seam positions are the slab boundaries plus positions one roll width (and one usable width,
i.e. roll width minus the trimming allowance) in from any boundary. A dynamic programme over the sorted
candidates chooses seams so that every piece is no wider than the roll and either

* **min seams** – fewest pieces, then least area,
* **min waste** – least piece area, seams free, or
* **balanced** – least piece area with every seam charged `balancedThresholdM2` (1 m² by default).

That charge is the point: the objective used to be piece area alone, which put a seam anywhere it
saved a square millimetre. A 4.6 × 3.7 m lounge came out as three pieces with two seams and ordered
exactly the same 5.4 lm as the single piece it should have been — 9 m of seaming tape and a line down
the floor for £0.00 of carpet. A seam has to pay for itself in material or it is not cut, and the same
rule now applies per cross join rather than per run of them.

A seam that would cross a doorway on a wall running across the pile carries a large penalty on top,
so it is only used when nothing else works (and is then reported). Each group between seams becomes a
piece: width = span + width allowance (capped at the roll), length = extent + length allowance
(+ one pattern repeat for every piece after the first). The widest piece is the "main" one, whichever
side of the room it falls on.

Sheet vinyl has two extra rules: no fill narrower than `VINYL_MIN_FILL_WIDTH` (600 mm — a 300 mm
strip of cushioned vinyl will not lie flat), and a warning when a plan needs more than one seam, to
push the estimator at a wider roll before ordering.

### 3. Pile direction (`rollplan.chooseDirections`)

With direction on *auto* the room is planned both ways and packed; the shorter roll length wins, with
each seam priced in at `balancedThresholdM2 / rollWidth` of roll length. A 5 m x 6 m room from a 4 m
roll therefore runs *across* (2 x 5.1 m = 10.2 lm) rather than along (6.1 + 6.1 = 12.2 lm) — exactly
the call a good estimator makes.

The choice is made for the **roll**, not the room. Each room starts on its own best direction, then
the whole product's piece set — every room plus the stair pieces — is re-packed while turning one
room at a time, for as long as the combined length keeps falling (`DIRECTION_PASSES` rounds). A hall
and an L-shaped landing on one 4 m roll came to 6.2 lm when each room chose alone and 4.1 lm when the
landing turned to sit beside the hall in a single cut: 2.1 lm of carpet thrown away by a decision
taken before the packer ever ran. Each room also offers its fewest-seams plan as a candidate, so a
seam can never survive that does not shorten what is ordered.

Rooms joined by a `continuous` doorway are checked afterwards: if the carpet runs through an opening
but the pile runs different ways either side, the shading will show, and the estimate says so.

### 4. Cross joins (`rollplan.applyCrossJoins`)

A narrow fill (≤ half the roll width) can be made from several shorter strips cut side by side out of
one cross-cut, joined end to end. For the 5 x 6 m room with the pile along the 6 m that turns a 6.1 m
fill (12.2 lm total) into three 2.08 m strips from one 2.1 m cut (8.2 lm total). The planner tries
every k, keeps a split only if it saves more than the policy threshold PER JOIN (1 m² by default in
*balanced*), and records the cross seams for the diagram.

Never in sheet vinyl: a butt joint across a kitchen floor is a route for water under the sheet,
whatever it saves.

### 5. Packing (`packer.packOnRoll`)

All pieces for a product — every room plus stair steps, winders, landings and runners — are packed
together with **best-fit decreasing shelf packing**: sort by length, place each piece in the cross-cut
that leaves the least spare width, otherwise open a new cut. Each shelf is literally one cross-cut a
fitter makes, so the diagram is a real cutting list. Offcuts (spare width of a cut, and the tail beyond
a shorter piece) are reported and flagged usable above a size threshold. Cuts are then split across
physical rolls no longer than the product's maximum, rounded up to the supplier's cut increment.

The ordered area minus the net floor area is the waste; it is reported as a percentage per roll plan
and the tool compares alternative roll widths so the user can see when a 5 m roll pays for itself.

## Stairs

Steps are listed from the bottom; each is a riser plus the tread above it, so the top riser wraps onto
the landing nosing — and because that top step has no tread of its own, it takes one gripper length
(the riser foot) rather than two, and no underlay pad. The wrap length per step is rise + going + nosing overhang. *Cap and band* cuts one
piece per step (length + 50 mm tuck, width + 50 mm for closed strings); *waterfall* makes one piece per
straight run (winders and landings break runs). Open sides add a wrap allowance and binding length;
bullnose steps add 1.6 x projection + tuck for the curve; winders are cut from the bounding rectangle
of the kite. Gripper is two lengths per step, underlay one pad per TREAD (going + 50 mm over the nosing; UK
practice leaves the risers bare, and `underlayRisers` switches to the full flight), stair rods for
runners, and one nosing profile per step for hard floors. Stair pieces go into the same roll plan as
the rooms so hall and landing offcuts are used, and a staircase's own subfloor goes through the same
floor-preparation rules as a room: a flight of old carpet has to be stripped, skipped and its gripper
pulled like any floor.

## Floor plans

Estate-agent plans are "not to scale", so the tool never trusts the image scale: the user clicks two
points of a known dimension (a printed wall length or a standard door) to calibrate mm-per-pixel, then
traces each room with orthogonal snapping and marks doorways on edges. Traced polygons become ordinary
rooms; nothing in the engine knows about pixels. PDFs are rendered with pdf.js in the browser.
Automatic room detection (ML or a vision model) is deliberately out of scope for v1: current
open-source models are unreliable on UK agent plans and would need a server; the calibrated trace
takes under a minute per floor and is auditable.

## Floor preparation

A data-driven rule table maps (covering class, subfloor type, condition, flags) to preparation items:
uplift/disposal, moisture test, primer, smoothing compound (bags from thickness x area x coverage per
mm), liquid or sheet DPM, plywood or hardboard overlay with fixings, securing/sanding boards, door
easing, skirting refit. Items are marked required or recommended with the reason shown on the estimate.

## Quantities, rounding and warnings

Whole units round up, except within a 3% over-run tolerance where the shortfall is made up from the
offcuts and the line says so: 4.02 rolls of underlay is four rolls, not a fifth 15 m² roll to supply
219 mm. Every covering line reports the same three figures — what is bought, the floor area, and the
waste as a fraction of what is bought — so a carpet line and a laminate line on one page can be
compared.

The engine never throws and never drops a line silently. An outline that crosses itself, a doorway on
a wall the shape no longer has, two openings overlapping on one wall, a recess deeper than the room, a
product with no roll width, a quantity that comes out non-finite: each is reported against its room
and left out of the quantities rather than quoted wrongly. A door between two rooms is one physical
opening, linked explicitly by `Doorway.sharedOpeningId` and never matched on its label, so it buys one
bar and one door easing however the two sides were named.

## Extending

* New covering type: add to `CoveringKind`, a product shape, and a planner; `estimate.ts` dispatches.
* New supply format (e.g. 3.66 m carpet): only `defaults.ts` and the product editor presets change.
* Server-side quoting: import `src/engine` in Node; it has no browser dependencies.
* AI-assisted plan reading: a future opt-in that posts the calibrated image to a vision model and
  returns candidate polygons for the user to confirm — the tracing UI already accepts polygons.
