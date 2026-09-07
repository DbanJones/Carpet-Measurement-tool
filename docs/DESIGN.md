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
  Save status is held separately: storage failures leave the working project intact and ask the user
  to save a file, and repaired browser saves report their changes. A cache shared by estimate consumers
  holds only the current project revision's estimate and width comparisons.
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
strip of cushioned vinyl will not lie flat), and a warning as soon as a plan needs *any* seam
(`VINYL_SEAM`), naming the wider roll widths the product lists. The first seam is the one worth
avoiding: it is what forces a cold weld and a fully bonded floor.

### 3. Pile direction (`rollplan.chooseDirections`)

With direction on *auto* the room is planned both ways and packed; the shorter roll length wins, with
each seam priced in at `balancedThresholdM2 / rollWidth` of roll length. Take a 5 m x 6 m room on a
4 m roll: across the room is two 5.1 m drops = 10.2 lm; along it is a 6.1 m main piece plus a 6.1 m
fill = 12.2 lm. Under `seamPolicy: 'min_seams'` the planner takes the 10.2 lm across-the-room plan.
Under the shipped default (*balanced*) it goes further, because cross joins are scored inside the
direction choice (section 4): the along-the-room fill is cut as three 2.08 m strips out of one 2.1 m
cross-cut, which brings that plan to **8.2 lm** and wins. Either way the answer is the one a good
estimator gives, and the room reports the seam it bought (`CROSS_JOIN`).

The choice is made for the **roll**, not the room. Each room starts on its own best direction, then
the whole product's piece set — every room plus the stair pieces — is re-packed while turning one
room at a time, for as long as the combined length keeps falling (`DIRECTION_PASSES` rounds). A hall
and an L-shaped landing on one 4 m roll came to 6.2 lm when each room chose alone and 4.1 lm when the
landing turned to sit beside the hall in a single cut: 2.1 lm of carpet thrown away by a decision
taken before the packer ever ran. Each room also offers its fewest-seams plan as a candidate, so a
seam can never survive that does not shorten what is ordered.

Rooms joined *to each other* by a `continuous` opening (they share a `sharedOpeningId` and at least
one side marks it continuous) are checked afterwards: if the carpet runs through the opening but the
pile runs different ways either side, the shading will show, and the estimate says so
(`PILE_DIRECTION_SPLIT`). Two rooms that each run continuously into somewhere *else* are not on the
same run and are left alone.

Turning a room to suit the rest of the roll can also buy it a seam it would not need on its own.
That is usually the right trade, but it is the estimator's trade to make, so the room says what it
bought and what the roll saved (`ROLL_SEAM_TRADE`).

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
piece per step (length + 30 mm tuck + 75 mm cap-and-band wrap, width + 100 mm for closed strings —
50 mm each side — plus 150 mm per open string and the bullnose wrap); *waterfall* makes one piece per
straight run (winders and landings break runs). Open sides add a wrap allowance and binding length;
bullnose steps add 1.6 x projection + tuck for the curve; winders are cut from the bounding rectangle
of the kite. Gripper is two lengths per step — one for the top step, whose tread is the landing, and three on a
winder, whose long back edge takes an extra length — underlay one pad per TREAD (going + 50 mm over the nosing; UK
practice leaves the risers bare, and `underlayRisers` switches to the full flight), stair rods for
runners, and one nosing profile per step for hard floors. Stair pieces go into the same roll plan as
the rooms so hall and landing offcuts are used, and a staircase's own subfloor goes through the same
floor-preparation rules as a room, restricted to the ones that can physically happen on a flight
(`STAIR_PREP_KINDS`: uplift, disposal, gripper removal, securing boards). A flight of old carpet has
to be stripped, skipped and its gripper pulled like any floor; you cannot pour levelling compound
down it or lay a 2440 x 1220 sheet of ply on it.

## Floor plans

The workspace follows Upload → Set scale → Add rooms → Review. Multi-page PDFs are rendered with
pdf.js and previewed before importing the chosen page. The user calibrates two points against a
known dimension; guessed door widths are not offered as measurements. Calibration cannot correct a
distorted or inconsistent drawing, so the Measure tool allows checks against another known length.

Rooms can be detected from a click inside the walls, drawn as a two-corner rectangle, or traced with
optional orthogonal snapping. All three methods produce a draft that supports corner dragging and
requires Add room. Confirmed polygons become ordinary engine rooms in millimetres, retaining the
source pixel polygon for the plan overlay. Recalibrating the plan does not resize existing rooms.
Selecting a saved room opens details beside the plan; doorway marking is an optional follow-up with
a preview constrained to that room's wall. Small drawing drafts survive tab/plan navigation in memory,
but are not included in project backups or browser reloads.

Detection runs locally in a cancellable Web Worker, with a bounded fallback. It thresholds dark lines,
bridges supported short wall gaps using the known scale, finds the clicked enclosed region and
simplifies its contour. Analysis is capped at a 1200-pixel long side. A second pass can remove fine
door/furniture strokes only when the resulting enclosed area remains close to the first candidate.
Open boundaries, tiny regions and invalid or overly complex polygons receive a manual-drawing
fallback. Proposed closing edges are marked for review. This is boundary assistance, without OCR,
automatic scale, room-name recognition or whole-floor import. See [the review and validation](FLOORPLAN_REDESIGN.md).

## Floor preparation

A data-driven rule table maps (covering class, subfloor type, condition, flags) to preparation items:
uplift/disposal, moisture test, primer, smoothing compound (bags from thickness x area x coverage per
mm), liquid or sheet DPM, plywood or hardboard overlay with fixings, securing/sanding boards, door
easing, skirting refit. Items are marked required or recommended with the reason shown on the estimate.

Two rules exist to keep the quote consistent with itself:

* **Gripper.** New gripper is ordered for every carpet room, and it cannot be nailed down on top of
  the old, so where the BOM buys gripper for a floor (`newGripper`), lifting the old gripper is
  *required* work in the totals — not the "reuse it if it is sound" recommendation it is when no new
  gripper is on the order.
* **Stairs.** A staircase goes through the same table, restricted to `STAIR_PREP_KINDS` — uplift,
  disposal, gripper removal, securing boards. The rest of the table is quantified over a floor area a
  flight does not have.

## Quantities, rounding and warnings

Whole units round up. Continuous goods that carry their own cutting allowance and leave offcuts —
packs of gripper, lengths of beading, rolls of floating-floor foam — may round DOWN within a 3%
over-run tolerance, with the line saying what is to be made up from the offcuts: 4.02 packs is four
packs, not a fifth bought to supply half a length.

Two things are deliberately outside that tolerance:

* **Carpet underlay.** The strip planner adds no allowances and cuts at full roll width, so the strip
  length IS the requirement and there are no side offcuts to make a shortfall up from. 11.1 m of
  strip off an 11 m roll leaves 0.1 m of floor bare, so the roll count rounds up.
* **Rigid pack goods** (laminate, LVT, tiles). "The last 0.02 m² comes out of the offcuts" needs a
  whole plank of the right length to exist already; 3.008 packs is four packs. A spare pack for
  repairs is offered as a separate, optional line rather than hidden in the rounding.

Every covering line reports the same three figures — what is bought, the floor area, and the waste as
a fraction of what is bought — so a carpet line and a laminate line on one page can be compared. The
minimum job charge is absorbed rather than printed when the shortfall is under `MINIMUM_JOB_DE_MINIMIS`
(£5): a 20p line item with a paragraph of explanation is not something anyone sends a customer.

The engine never throws and never drops a line silently. An outline that crosses itself, a doorway on
a wall the shape no longer has, two openings overlapping on one wall, a recess deeper than the room, a
product with no roll width, a quantity that comes out non-finite: each is reported against its room
and left out of the quantities rather than quoted wrongly. A door between two rooms is one physical
opening, linked explicitly by `Doorway.sharedOpeningId` and never matched on its label, so it buys one
bar and one door easing however the two sides were named — sized from the WIDER of the two
measurements (a long bar cuts down; a short one cannot be stretched) and eased if EITHER side needs
it, so pairing an opening can never delete work rather than merge it.

## Offline shell

`public/sw.js` is registered from `src/main.tsx` in production builds only. The build injects the
complete generated asset list, including the PDF reader and worker, into the service worker. The rules:

* **Installation caches the shell and every generated asset.** This makes the app available offline
  after its first successful installation, even when PDF import was not opened while online. A failed
  required asset prevents the new worker from replacing the working installation; icons are optional.

* **The shell — navigations and `index.html` — is network-first**, with the cache as the offline
  fallback. This is what lets a redeployed fix reach a returning user: `index.html` names the hashed
  bundles, so serving a cached copy for ever would pin an installed app to the build it first cached.
  For a tool that carries prices and trade rules, that is the wrong way to fail.
* **Everything else same-origin is cache-first**, then network, caching what comes back. Vite names
  those files by content hash, so a cached one can never be the wrong version.
* **`activate` deletes only older caches for this app's URL scope.** Other apps and another copy of
  the estimator on the same origin retain their data. The cache name carries `CACHE_VERSION`, which
  the `sw-build-id` plugin in `vite.config.ts` derives from the built `index.html` and asset list, so a
  deployment gets a fresh cache without a manual version bump. Cache writes extend the worker's
  lifetime, and a server error uses the last working shell when one is available.

`src/offline/sw.test.ts` loads the real file into a fake worker global and drives its `fetch` handler
against stub caches and a stub network, so the redeploy and offline paths are covered by the suite.
The PWA manifest ships the SVG icon plus 192/512 PNGs and a maskable variant, and `index.html` carries
an `apple-touch-icon`, because iOS ignores SVG manifest icons — and installing on a phone is the
normal way this tool is used.

## Extending

* New covering type: add to `CoveringKind`, a product shape, and a planner; `estimate.ts` dispatches.
* New supply format (e.g. 3.66 m carpet): only `defaults.ts` and the product editor presets change.
* Server-side quoting: import `src/engine` in Node; it has no browser dependencies.
* AI-assisted plan reading: a future opt-in that posts the calibrated image to a vision model and
  returns candidate polygons for the user to confirm — the tracing UI already accepts polygons.
