# Sketching a staircase walking route

The main editor now uses a guided count-and-rotation setup, measured L/U/curved starters, connected
corner handles, shaped landings, grouped curves and interactive 3D rotation. Select a tread in
**Top down** to reshape it directly. Right-click or open **Actions** for insertion, deletion,
rectangular conversion and exact dimensions. The optional walking-line sketch is described below.
**Edit route** opens step editing; **Walking line and placement tools → Edit walking line** opens
the sketch controls.
See [the current direct-editing workflow](DIRECT_EDITING.md) and [guided setup](GUIDED_SETUP.md).

The staircase editor now starts with a drawing and two connected views. The old flow asked the
user to translate a physical staircase into a shape selector and a turn-settings form before
they could see the result. It also used an unfolded measurement profile as the side view,
which could make a returning flight look straight.

## The interaction

1. Choose **Draw your own** for a walking-line sketch. The shape buttons instead open measured presets.
2. Follow the walking route from bottom to top, placing a point at each change of direction.
   Several corners are supported. Square corners snap while drawing; turn snapping off for diagonals.
3. Drag a point to reshape the route. Select an internal point to make it a **Sharp turn** or
   **Curved turn**. Undo and delete are available beside the drawing.
4. **Finish drawing** or **Use drawing** saves the route. Until then, it remains a preview and
   **Cancel drawing** restores the saved staircase. Unfinished drafts survive navigation within
   the app and are scoped to the project and staircase.
5. Check the four common measurements: riser count, rise, depth and width.
6. Select a numbered tread in either view for its own measurements and type. Radial turning treads
   have widest and narrowest depth fields; custom outlines expose **Exact sides & angles** and
   conservative cutting bounds. Add a flat landing after the selected step, or select an
   existing landing to size it.

The top view explains how the stairs wrap. The adjacent **Side** view projects the same footprint
at the measured heights, so returning flights remain folded. **Front** and **3D** help inspect
turns that overlap in one elevation. Selecting a step highlights it in both views.

The individual step table appears in **Individual steps and turns** below the diagrams. Fitting, runners, preparation and the
old measured-layout presets remain optional. The unfolded profile is explicitly labelled. Applying
a measured-layout preset replaces the custom route; the disclosure explains this before applying.

For an existing measured U, **Make rectangular** changes a suitable central winder and its shared
neighbouring edges together, preserving the returning flight's position and direction. A narrow
well can limit the rectangle's depth; the saved measurement and action message show the result.
Later edits retain a mixed turn's measured boundaries instead of rebuilding it as an even arc.
The guided setup also supports an explicit eight-winder 180-degree U without a turning landing.

## Measurements and drawing have different jobs

The route describes shape, and scales to the total measured walking length. Actual step widths
and cumulative rises produce the schematic surfaces. Sketching a bend does not guess the measured
carpet depth of a winder, change step IDs, add steps, or alter the estimate. Users check the turning
treads and landings using the contextual inspector. The last numbered surface represents the
upper landing level, consistent with the existing riser records.

This is a flooring measurement view, not a structural staircase model: no railings, stringers,
supports or compliance certification are inferred. A flight-clearance hint calls out routes that
are narrower than the measured stair width; a schematic route can still be saved for review.
Self-crossing or backtracking walking routes cannot be saved. Sharp inside bends share a vertex
so their tread outlines do not cross themselves.

## Accessible operation and storage

The route can be created with the visible direction buttons as well as pointer taps. Points are
keyboard focusable: arrow keys move them, Shift increases the distance, Delete removes a point,
and Ctrl/Cmd+Z undoes an edit. The drawing's Enter key saves a valid route. Each tread has an
accessible name and can be selected with Enter or Space. Views stack on narrow screens.

Saved routes belong to the staircase, persist in browser saves and JSON exports, and duplicate as
independent copies. Older projects continue to use their original layout until a route is saved.
Invalid imported routes are dropped with an import warning while retaining measured stair data.

## Verification

Geometry, serialization and component tests cover sharp/curved routes, invalid inputs, measured
quantities, linked selection, landings, cancellation and drafts. `scripts/stairs-drawing-smoke.mjs`
uses real Chrome to draw and drag points, round a corner, edit a selected tread, add a landing,
leave and restore a draft, duplicate, reload, and check layouts from 320 to 1440 pixels.

`scripts/stairs-simple-smoke.mjs` covers the count-and-rotation guide and a U made entirely from
eight winders. `scripts/stairs-rectangular-smoke.mjs` covers a central rectangular tread, connected
type changes and insert/delete, the context menu, exact dimensions and phone layouts. Run these
with Playwright and `npm run dev` at `http://127.0.0.1:5173/`; the rectangular-tread check requires
Vite's source-module imports. `BASE_URL` and `CHROMIUM_PATH` override the server and browser.
Screenshots and reports are written under `test-results/`.
