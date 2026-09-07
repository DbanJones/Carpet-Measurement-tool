# Guided setup and drawing a house without a floor plan

The starting screen now offers **Guide me through setup**. It asks for one flooring product first,
then a way to measure, then the spaces in the house, and finally a review. Existing rooms,
products and plans remain in the project. Quick add is still available outside the guide.

## A short path through the job

1. **Flooring:** choose an existing product or add one. Check its name, roll width or pack coverage,
   supplier price and whether carpet needs underlay. These edits remain a draft until **Use this flooring**.
2. **Starting point:** upload a PDF/image, draw a house on a blank grid, or enter room measurements.
3. **Rooms & stairs:** add a space, check it, and return with **Back to guide**. A list shows the
   spaces already in the project. Advanced details remain in their individual editors.
4. **Review:** check measurements, follow the roll cuts, and open the estimate and client pack.

The guide can be closed and resumed during the current browser session. Confirmed products,
measurements and drawing sheets use normal project autosave and JSON export. Unconfirmed guide
drafts are kept only in memory.

## No floor plan needed

**Draw a house without a plan** is available in the guide, project overview and empty Floor plan
screen. It creates a separate **Ground floor sketch** sheet: 20 m by 16 m, with 1 m large squares
and 100 mm subdivisions. Its scale is known immediately; calibration and image reading are unnecessary.

Use **Rectangle** to mark two opposite corners. Before saving, enter exact length and width in
the inspector. Place neighbouring rooms against their shared walls. Use **Draw outline** for
irregular rooms and **Draw stairs** to locate a staircase footprint. Shape edits in the room editor
stay linked to the house sheet, and overlapping rooms are rejected. Stair footprints locate the
stairs; their step dimensions are entered separately.

**New drawing sheet** creates another level. Rename sheets using Plan options. Removing a sheet
keeps its saved rooms and stairs. The grid is an embedded SVG image, so a saved project needs no
external asset or connection to reopen it. Detector and OCR controls are hidden for drawing sheets.

## A staircase guide for non-specialists

**Guide me through stairs** temporarily replaces the full stair editor with a short assistant:

1. Pick the closest top-down shape: straight, L, U or curving steps.
2. For a turn, choose left/right while walking upstairs, a flat landing or climbing steps,
   and square outside corners or rounded edges. Turn position is optional detail.
3. Check the count of vertical rises, width, rise height and straight tread depth. A small diagram
   explains rise and depth. Straight flights skip the turn questions.
4. Review the numbered top-down preview, then **Apply this staircase**.

The preview uses the same measured preset and geometry as the main diagrams. Final application
replaces the step arrangement and measurements; product, fitting options and house position remain
attached. Existing top landings stay at the new final step when the count changes. The user can
then select individual steps and landings in the top-down editor to refine their shape and sizes.
Turning tread depths produced by a starter are explicitly identified as estimates to measure before ordering.

## Validation

Focused tests cover staged changes, preservation of existing projects, guide return navigation,
blank sheet persistence, exact room dimensions, shared-wall drawing, skipped straight-flight
questions, square/round previews and final staircase application. `scripts/guided-house-smoke.mjs`
exercises the live flow in Chrome, including linked room corner edits and undo, mobile widths,
saved sheet reload and browser error checks.
