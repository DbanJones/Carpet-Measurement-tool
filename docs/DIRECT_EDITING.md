# Direct editing in rooms and stairs

The workspace now treats diagrams as controls, with measurements and diagrams reading the same
room or staircase records. The editor occupies the full main column; the running estimate follows
below it. This gives diagrams enough space while preserving the project list.

## Stairs

- **Individual steps and turns** appears below the diagrams. Open it for the measured table;
  the numbered buttons select the same steps shown in the diagrams.
- **Guide me through stairs** starts with the total step count and rotation. Choose turning treads
  or a landing, the number of winders, left/right direction and square or curved outside edges,
  then check width, rise and straight-tread depth. A 180-degree U can use eight winders without
  a landing. The guide stays a preview until **Apply this staircase**.
- **Edit route** starts individual step editing. Drag a tread to move it. Shift-click selects a
  consecutive run, Ctrl/Cmd-click toggles selections, and **Select multiple** supports touch.
  Drag any selected tread to move the group together.
- **Curve selected steps** turns a consecutive selection into radial winders, using the specified
  total sweep and inside radius. The measured wide/narrow depths update in the table. Landings
  split flights, so a curve selection cannot span a landing. Check these generated dimensions on site.
- The selected-step toolbar adds or deletes actual tread records. Landing positions and the riser
  count update with the edit. Diagram edits can be undone; subsequent independent measurement edits
  disable a stale undo so it cannot overwrite newer measurements.
- Right-click a tread, landing or selected group to open its context menu. **Actions** provides the
  same controls on touch screens; Shift+F10 or the keyboard Menu key opens them from a focused
  diagram object. Insert before or after a tread, add a landing, edit dimensions or corners, curve
  a group, or delete the selection. Arrow keys navigate the menu; Escape closes it and returns focus.
- **Make rectangular**, also available above the plan, turns a suitable winder into a rectangle
  while adjoining treads absorb its changed shared edges. A central tread in a square U leaves
  the returning flight in place. The result uses the nearby straight-tread depth when it fits;
  a narrow well can require a smaller depth, shown in the measurements and action feedback.
  An existing rectangle stays unchanged. Invalid edits and removal of every turning tread are
  rejected without replacing the saved shape.
- Adding or deleting within an untouched, evenly divided turn redistributes its winders. Within
  an individually edited turn, insertion divides the measured tread and deletion joins neighbouring
  footprints, preserving the outside walls and total turn. A standard straight tread inserted beside
  the central rectangle extends the flight; deleting that added tread restores its previous extent.
- **Position & turn** in each placed step's table row shows its plan coordinates, heading and turn.
  Translation changes placement; it does not invent new carpet dimensions.
- Select a tread in **Top down** to expose its numbered corner handles. Drag any corner; touching
  corners on neighbouring treads move together. Square turns expose their real outer corners,
  while rounded turns keep arc sampling points out of the controls. Arrow keys move 10 mm;
  Shift uses 100 mm. Changes preview in both views, release applies, and Escape cancels.
- **Width & depth** switches the selected tread to size handles. Drag to preview its measured size, release
  to apply, or press Escape to cancel. Arrow keys resize in 10 mm increments; Shift uses 100 mm.
  Changes to step dimensions or landings move the upper flight to retain its connections.
- **Exact sides & angles** sits below the selected tread's basic measurements. Choose a labelled
  side to enter its actual length, edit its corner angle, or use **Set to 90°**. Shared corners
  update together. Curved sides show their length along the edge. An additional point-coordinate
  disclosure supports precise adjustments. Invalid shapes retain their last valid measurements
  and explain why the edit was refused. Width and depth on a custom tread remain its cutting bounds;
  exact side lengths describe the actual outline.
- **Edit walking line** retains the earlier route-sketch workflow. Its points describe a schematic
  route. Applying that sketch replaces individual placements; it does not estimate winder depths.
- Straight, **L-shaped**, **U-shaped** and curved starters use measured geometry. L and U shapes
  offer an explicit flat landing or turning treads, plus left/right direction. Curves offer square
  or rounded borders. Preview before applying; custom step shapes and intermediate landings are
  replaced, while top landings and fitting choices are retained. U landings have a 100 mm centre gap.
- Select a landing in Top down to edit its length, width, rectangle/L-shaped footprint and individual
  corners. The upper flight follows its exit. Custom footprints use conservative rectangular cut
  bounds so the estimate covers the complete shape. Review generated turning measurements on site.
  Net coverage uses the validated polygon area; underlay pads retain their rectangular cutting
  allowance. Custom tread shapes use their corners and cut bounds instead of a separate narrow-depth field.
- In **3D**, drag to orbit, scroll or pinch to zoom, and reset the view at any time. Keyboard
  controls and additional viewing angles include the back, top and underside. Camera changes never
  alter the staircase measurements.

## Project list

Each room, staircase, product and floor plan has a drag handle and a compact three-dot menu. Drag within a category to
change its saved order. Arrow keys on the handle and Move up/down actions provide equivalent
keyboard and touch operation. The selection stays with the item.

Delete is available in the same menu. Inline confirmation names the item, and deleting a product
explains the reassignment of rooms and stairs that use it. The existing store actions keep
references consistent. Floor plans also offer Rename. Deleting a plan retains its measured rooms
and stairs and removes their attachment to the deleted sheet.

## Room overview

The room page leads with area, perimeter and overall dimensions, then an editable plan beside the
core shape controls. Drag a wall or corner, select a wall to enter its exact length, or type in the
dimension fields. Both views update together. Rectangles and L-shaped rooms retain their square
walls and parameter controls. Editing other detailed outlines converts their features to polygon
corners, with a visible explanation.

Add/delete corners, cancel a gesture with Escape, or undo the latest shape change. Doorway
identifiers and shared-door links are retained; wall references are re-anchored after topology
changes. Select a corner for its interior angle, a 90-degree shortcut (270 degrees for an inward
corner), or a custom degree value. Only the selected corner moves; adjacent wall lengths update.
This sets the current angle rather than creating a permanent constraint.
Changing an uploaded traced room's measurements detaches its original floor-plan outline, and
undo restores that link. Rooms on blank house sketches stay attached and update the sheet, with
bounds and overlap checks. Doorways, subfloor, planning and notes remain in
optional sections below the core editor.

## Browser acceptance checks

`scripts/stair-step-editing-smoke.mjs`, `stairs-orbit-smoke.mjs`, `sidebar-organising-smoke.mjs` and
`room-editing-smoke.mjs` cover real pointer/touch interactions, persistence and responsive layouts.
The original staircase drawing journey remains in `stairs-drawing-smoke.mjs`. New coverage is in
`stair-corners-smoke.mjs`, `room-angle-sidebar-smoke.mjs` and `guided-house-smoke.mjs`.
See [Guided setup](GUIDED_SETUP.md) for the new no-plan house and staircase assistants.

With Playwright available, leave `npm run dev` running and use a second terminal:

```bash
node scripts/stairs-simple-smoke.mjs
node scripts/stairs-rectangular-smoke.mjs
```

The first checks an eight-winder 180-degree guide, connected plan edits, physical views and mobile
layouts. The second checks the central rectangular U tread through both its context menu and type
field, later insertion/deletion, exact side measurements and saved reloads. It imports geometry from
Vite and therefore requires the development server. Both default to `http://127.0.0.1:5173/`, accept
`BASE_URL` and `CHROMIUM_PATH`, and save screenshots and reports beneath `test-results/`.
