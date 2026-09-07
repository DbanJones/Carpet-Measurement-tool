# Simple inputs, optional detail and roll destinations

Design and implementation review, 7 September 2026.

## Findings and approach

The staircase editor put its individual-step table and specialist fitting choices ahead of the
preview. A routine 13-riser staircase exposed roughly 90 controls, even when every step had the same
measurements. The starting screen also asked for rooms before introducing the carpet and roll width.
Those choices affect the subsequent cutting plan, and a product chosen during setup did not become
the choice for new measurements. Finally, the cutting diagram combined multiple supplier rolls in
one sequence and mainly coloured pieces by their type, making destinations hard to follow.

The revised approach is **choose flooring → measure spaces → follow the cuts → review the estimate**.
Keep essential measurements visible, show the current assumptions, and reveal specialised fields
when the user asks for them. Expanding a section must never reset measured values or simplify the
underlying staircase geometry.

## Changes

- The overview leads with flooring and rolls, and the Materials tab comes first. A single product
  opens for editing immediately. From its width/price setup the user can start a room, staircase or
  floor plan directly. The selected flooring carries into new measurements in the current session;
  existing room assignments are retained. Each space can still choose another product.
- Carpet setup shows roll width, price and alternative available widths. Supplier constraints and
  thickness sit inside an optional section with a live summary. Patterned products expose matching
  settings. Pack products show coverage and price before optional board/tile details. Project-wide
  fitting options and the price book are secondary sections. The Materials workspace provides the
  full editing area, without duplicating its product list in a sidebar or competing with an estimate.
- Staircases initially show six controls: name, flooring, riser count, rise, tread depth and width,
  followed by the drawing and totals. Individual steps/turns, landings and fitting/preparation/notes
  are expandable. Their summaries expose existing variations, openings, runner and landing choices.
  Shared dimensions explicitly apply to every step; “varies” preserves individual measurements.
- Cutting plans show each supplier roll separately, with numbered pieces and destination colours
  shared by the diagram and room/stair lists. Selecting a destination highlights its pieces on that roll;
  selecting a piece reveals its destination, cut and dimensions. The destination can be opened for
  measurement review. Cut dimensions, offcut inventories and roll-width comparisons remain available
  as detail. Cutting rectangles include fitting allowances: they are material blanks, not the exact
  installed room outline.

## Limits and validation

These changes simplify presentation and navigation. The estimate still depends on measured dimensions,
the selected fitting assumptions and checked supplier prices. Product presets and new-space dimensions
are starting values. Selecting a product for new spaces is session UI state; it is reset when opening
another project or reloading. Confirmed room assignments are stored in the project as before.

Validation covers detail disclosure without data loss, preserved complex stairs, product selection
through the three measurement paths, cut-to-roll allocation, destination interaction, narrow layouts
and printed detail. Browser checks use synthetic fixtures and the example project, not a field study.
Run `npm test`, `npm run build` and `node scripts/simple-workflow-smoke.mjs` with the dev server running.
Additional existing browser checks cover responsive estimates, backups, printing and offline use.

Final results: **686 tests in 31 files pass**, together with TypeScript and the production build.
The final production workflow passes 11 Chrome checks, including both new/existing plan product
selection, individual stair measurements, two physical rolls, linked destinations, layouts down to
320px, and an actual A4 PDF whose extracted text includes both rolls and full cutting dimensions.
The existing application smoke, responsive/export/print and seven offline/recovery checks also pass.

Generated review artifacts are under `test-results/simple-workflow/`: desktop/mobile flooring and
stair screenshots, cropped cut diagrams, `report.json` and `estimate-with-cut-lists.pdf`.
