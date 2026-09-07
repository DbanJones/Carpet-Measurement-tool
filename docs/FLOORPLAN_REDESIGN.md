# Floor plan interaction redesign

Design review: 7 September 2026. The user primarily works from estate-agent PDFs and images. This plan is based on the current implementation and the reported difficulty using it. It is a design assessment, not an observed user study.

## The problem

The interface asks the user to understand drawing tools before making the intended task clear. Five tools have equal prominence, calibration instructions compete with upload and plan management, and the user must know how to close a polygon even for an ordinary rectangular bedroom. Rooms exist in both the plan and a separate editor, but clicking a room immediately leaves the plan.

An estate-agent PDF introduces a specific avoidable mistake: opening it immediately adds page 1. If page 1 is a brochure cover, the user must find another page, add it, and then remove the unwanted cover. The old selector does not preview a page before importing it. This makes the interface's first action feel unpredictable.

The existing code already has useful behaviour to retain: imported images enter calibration, successful calibration enters tracing, a created room leaves the user ready for another room, and switching tools preserves an in-progress outline within that plan. Those are existing strengths, not new reductions in clicks.

## Intended journey

1. **Choose the plan.** Upload or drop a PDF/image. Show a page preview for a PDF with multiple pages and import only the page explicitly chosen. Switching the page updates its preview automatically.
2. **Set a known distance.** Guide the user to select the two ends of a printed dimension and enter that distance. Display the two selected points and the entered distance together. Do not present guessed door widths as measurements.
3. **Add the rooms.** Offer a quick way to find an enclosed room, a two-corner rectangle, and manual corners for irregular rooms. Show a distinct proposed outline with dimensions and area. Let the user name and add it, then continue with the same method for the next room.
4. **Review the result.** Keep the plan visible while inspecting rooms and quantities. Make openings and detailed room editing follow-up actions, and provide a clear route to the estimate.

The current step should be explicit, with one primary action. Completed steps remain available to revise. Plan management and less common tools should remain accessible without filling the main task area.

## Unnecessary actions and proposed reductions

These are interaction counts for a room once scale and the chosen drawing method are already set. They exclude naming, selecting a product and correcting an unsuccessful detection; switching methods adds one action.

| Task | Existing flow | Design target |
| --- | --- | --- |
| Add a simple rectangle | Four corners, close outline, create room: six actions | Two opposite corners, review and add: three actions |
| Add a clearly enclosed room | Every corner, close outline, create room | Click inside, review and add: two actions when detection succeeds |
| Choose a brochure's plan page | Page 1 added automatically; choose and add correct page; remove page 1 and confirm | Preview selected page automatically; one import action; no unwanted cover to delete |
| Work from a saved unscaled plan | Discover and choose the scale tool | Open directly in the appropriate calibration step |
| Review before adding | Interpret polygon closure and drawing-tool controls | A visible preview with name, size and one Add action |

The final Add action is deliberate: an automatically proposed boundary needs review before it becomes a measured room. Counting only clicks would miss this important distinction between assistance and a saved estimate input.

## Automatic detection approach

Start with browser-based boundary detection: use the image's dark wall lines as barriers, find the enclosed region around a user's click, and simplify its boundary into an editable polygon. Apply conservative checks before offering a result. Keep the proposed outline separate from saved rooms until the user adds it.

Estate-agent drawings may contain labels, furniture, broken wall lines, door arcs and open-plan areas. A detector must explain failures and offer rectangle/manual drawing immediately. It must not silently convert a region that runs through a doorway into an entire floor. A successful result still needs visual review because printed lines are not a guarantee of a correct internal measurement.

Automatic shape detection does not establish physical scale. Retain one known-distance calibration for each imported plan. Automatically reading dimension text, distinguishing maximum room dimensions from actual walls, recognising room names and importing all rooms are possible later extensions, but require representative documents and separate validation. They should not be implied by the initial detection feature.

## Build order and acceptance checks

1. **Import reliability:** implement preview-before-import, recoverable preview errors and race-safe page changes. Cancellation must add no plan and parent code must release the PDF handle. Component regression checks are implemented in `PdfPagePicker.test.tsx`.
2. **Guided workspace:** reorder import, calibration, room creation and review. Select the appropriate starting state from the plan's calibration; preserve existing room dimensions and drawing drafts during routine tool changes.
3. **Faster room entry:** add two-corner rectangles and assisted boundary detection, sharing the same preview/name/add flow as manual outlines. Keep correction and cancellation visible, and retain the active method after saving a room.
4. **Regression and browser review:** cover failed/stale PDF renders, scale requirements, detection rejection, duplicate rooms, polygon validity, tool switching and the existing measurement/doorway workflows. Check desktop and narrow layouts with representative estate-agent-style PDFs/images.

## Implemented result

The four-step workspace is implemented, including the page picker, automatic progression after scale
setup, two-corner rectangles and local room detection. The plan takes the full application width with
the current task alongside it. Selecting an existing room stays in this workspace; a separate action
opens its full editor. Doorways are optional after room creation and previewed before saving.

The preview uses red shading and draggable corner handles; added rooms use teal shading and names.
Dashed amber edges show where detection closed a possible doorway gap. Area and perimeter are shown
before adding. Detection never creates an estimate input without the user's Add action. After adding,
the same method and floor covering remain ready for the next room. Drafts survive routine tool, tab
and plan changes in memory; they are not restored after reload.

Touch support includes pinch zoom, panning, larger corner targets and controls, an automatically fitted
plan and task instructions above the canvas on phones. The canvas adapts to the plan's proportions to
avoid pushing the task form below a large blank area. Detection failures point to Rectangle or Draw
outline. One known scale remains required; dimension OCR, room-name recognition and whole-floor
import are future work.

## Validation and limits

- **647 tests in 28 files** and the TypeScript production build pass. Component checks include
  detection rejection and cancellation, stale results, polygon validity, draft recovery, scale gating,
  doorway targeting, PDF preview races and touch gesture handling.
- Chrome exercises upload, scale entry with Enter, a detected room, a rectangle, an irregular edited
  outline, room selection, doorway preview and the final estimate. The supplied estate-agent-style
  fixture includes wall gaps, door swings, labels and furniture. Its three room boundaries are also
  checked directly through the real worker.
- A generated two-page brochure verifies preview-before-import, automatic page preview, cancellation,
  the exact selected raster and a narrow-screen picker.
- Production offline checks verify first-use PDF rendering and a successful first-use detection worker
  response after disconnecting, then room persistence, save-failure backup and recovery.
- The final production build passes 11 floor-plan browser checks at widths down to 320px, five PDF
  picker checks, seven offline/recovery checks, and six touch checks in Chrome at 390×844. The touch
  test uses real two-finger input and confirms zoom creates no accidental corners or rooms. Existing
  application smoke, responsive layouts, JSON export and estimate printing checks also pass.

Reproduce with `npm test`, `npm run build`, `node scripts/floorplan-smoke.mjs`,
`node scripts/pdf-picker-smoke.mjs`, `node scripts/floorplan-touch-smoke.mjs` and
`node scripts/offline-smoke.mjs`. The floor-plan script defaults
to the dev server at port 5173; set `BASE_URL=http://127.0.0.1:4173/` to check the production preview.
Browser checks require the optional local Playwright package. Artifacts are saved under `test-results/`.

Synthetic fixtures demonstrate defined cases; claims about success rates on real estate-agent
documents require a representative sample and field testing. A calibrated drawing can still contain
distortion or inaccurate printed dimensions. Use Measure to check another known distance. Detection
may include furniture or merge areas through large openings, so every suggested boundary needs review.

## Design references

The explicit sequence and contextual controls are informed by [W3C guidance on multi-page forms](https://www.w3.org/WAI/tutorials/forms/multi-page/)
and [clear steps](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p04-clear-steps/).
The local image-processing approach uses established operations described in the primary OpenCV
references for [morphology](https://docs.opencv.org/4.12.0/d9/d61/tutorial_py_morphological_ops.html)
and [contour processing](https://docs.opencv.org/4.10.0/d3/dc0/group__imgproc__shape.html).
The implementation is TypeScript and adds no OpenCV runtime dependency. These references explain
the approach; they do not establish detection accuracy on estate-agent drawings.
