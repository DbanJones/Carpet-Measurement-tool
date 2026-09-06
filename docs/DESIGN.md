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

* **min seams** – fewest pieces, then least area, or
* **min waste / balanced** – least piece area, then fewest pieces.

A seam that would cross a doorway on a wall running across the pile carries a large penalty, so it is
only used when nothing else works (and is then reported). Each group between seams becomes a piece:
width = span + width allowance (capped at the roll), length = extent + length allowance (+ one pattern
repeat for every piece after the first).

### 3. Pile direction (`rollplan.chooseDirection`)

With direction on *auto* the room is planned both ways and packed alone; the shorter roll length wins,
ties broken by seam count. A 5 m x 6 m room from a 4 m roll therefore runs *across* (2 x 5.1 m = 10.2 lm)
rather than along (6.1 + 6.1 = 12.2 lm) — exactly the call a good estimator makes.

### 4. Cross joins (`rollplan.applyCrossJoins`)

A narrow fill (≤ half the roll width) can be made from several shorter strips cut side by side out of
one cross-cut, joined end to end. For the 5 x 6 m room with the pile along the 6 m that turns a 6.1 m
fill (12.2 lm total) into three 2.08 m strips from one 2.1 m cut (8.2 lm total). The planner tries
every k, keeps a split only if it saves more than the policy threshold (1 m² by default in *balanced*),
and records the cross seams for the diagram.

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
the landing nosing. The wrap length per step is rise + going + nosing overhang. *Cap and band* cuts one
piece per step (length + 50 mm tuck, width + 50 mm for closed strings); *waterfall* makes one piece per
straight run (winders and landings break runs). Open sides add a wrap allowance and binding length;
bullnose steps add 1.6 x projection + tuck for the curve; winders are cut from the bounding rectangle
of the kite. Gripper is two lengths per step, underlay one pad per step, stair rods for runners, and
one nosing profile per step for hard floors. Stair pieces go into the same roll plan as the rooms so
hall and landing offcuts are used.

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

## Extending

* New covering type: add to `CoveringKind`, a product shape, and a planner; `estimate.ts` dispatches.
* New supply format (e.g. 3.66 m carpet): only `defaults.ts` and the product editor presets change.
* Server-side quoting: import `src/engine` in Node; it has no browser dependencies.
* AI-assisted plan reading: a future opt-in that posts the calibrated image to a vision model and
  returns candidate polygons for the user to confirm — the tracing UI already accepts polygons.
