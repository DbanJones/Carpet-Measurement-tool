# Flooring workflow upgrade

The main design decision is to keep the purchasing choices next to the product, the geometry next to the space, and project-wide pricing assumptions in Settings. The estimate is a review workspace with separate client output.

## Implemented requests

| Request | Where it now lives |
| --- | --- |
| Corners and curved stairs | Staircase shape cards: straight, quarter turn, half turn and curved. Turning options appear only when needed. Apply layout updates actual step/landing records and a schematic plan. |
| Price per m² or roll | Product setup. Roll pricing explicitly distinguishes buying complete rolls from paying for a cut length. |
| Waste assumptions | Product setup and project planning settings. Carpet minimum surplus credits existing cutting waste; hard-floor pattern allowances and overrides feed pack quantities. |
| Herringbone laminate/LVT | Visible laying-pattern choice on the product, inherited by its rooms. Pattern affects wastage and labour time. |
| Door detection and editable points | Detect room presents possible openings with measured widths to accept. Outline corners can be selected, dragged, deleted, nudged and inserted. Saved room outlines can be edited. |
| Prevent overlapping rooms | Positive-area overlap checks block saving and highlight the conflicting room. Shared walls are allowed and drawing can snap to their boundaries. |
| Floor-plan OCR | Read plan text in the floor-plan task panel. Text-based PDF pages supply native text automatically; image OCR runs locally. Names and printed lengths are reviewable suggestions. |
| Underlay during carpet setup | Each carpet can inherit project underlay, use a preset/custom specification or omit new underlay. Quantities and prices follow the selection. |
| Stairs on plans | Draw a footprint with the Stairs tool, then use Stair dimensions to enter actual steps and turns. A clipped schematic overlay shows the flight inside its footprint. |
| Duplicate products, rooms, stairs | Each editor provides duplication. Copies receive new IDs; room/stair copies keep dimensions but require a new position on a plan. |
| Hourly costs and hours estimate | Settings offers unit-rate or hourly pricing, setup time, site allowance, fitting speeds, shaped-step minutes and preparation activity assumptions. |
| Estimate and client pack | Overview, Cutting plans, Rooms & stairs, Order list & costs and Client pack views. The pack includes business/client details, scope, category prices, annotated plans and terms. |

Commercial arithmetic and labour assumptions are described in [COMMERCIAL_SETTINGS.md](COMMERCIAL_SETTINGS.md).

## OCR and measurement boundaries

English recognition uses Tesseract.js in local dedicated workers. PDF text extraction uses PDF.js. Images and text stay in the browser; neither requires an external recognition service. `npm run dev` and `npm run build` copy the locked OCR worker, WebAssembly and English language assets into `public/ocr`; the production service worker caches them for first use offline. Generated OCR assets are excluded from source control and recreated from the npm lockfile.

OCR does not establish scale, create measured rooms or infer stair rises. Choose two points, review a printed length, then apply the scale. Spatial room-name suggestions fill only an unnamed draft. Recognised text is editable, so a missed decimal can be corrected before using a dimension.

Real small-print testing found `4.35 m` misread as `435m`, even with a high confidence score. Upscaling, alternative segmentation, thresholds and cropping did not reliably repair that example. The parser rejects implausible lengths and area labels and never inserts a decimal by guessing. Low-resolution, blurred or annotated estate-agent plans still need manual review and site measurements. Native PDF text avoids raster recognition when a usable text layer is present.

Door gaps are possibilities, not proof of a doorway. Accept only relevant openings, then adjust them in the room details if needed. The staircase overlay is schematic: a footprint cannot establish riser count, tread depth, inner radius or floor-to-floor height. Herringbone currently estimates quantities and time; it does not draw every board.

The implementation follows the [Tesseract local installation guide](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md) and [API documentation](https://github.com/naptha/tesseract.js/blob/master/docs/api.md). OCR work has explicit cancellation, error handling and stale-result protection, including cancellation during language initialization.

## Sharing and storage

Client pack downloads are standalone HTML files with embedded plan images and styles. Print / save PDF uses the browser's PDF print output. The client view prints only the proposal; other estimate views print the full technical estimate. Missing prices and calculation errors remain marked as an incomplete draft in exports. Optional work is separate from the total.

Business details, assumptions, prices and recognised text are saved with the project and included in JSON backups. This is still a local browser application: it does not yet provide shared accounts, a hosted client portal or synchronisation between devices.

## Verification

Run `npm test` and `npm run build`. Browser journeys use an installed Chrome/Edge and the optional Playwright package. Set `BASE_URL` to test the production preview; the default is the local dev server on port 5173.

- `scripts/stairs-shapes-smoke.mjs`: turning/curved geometry, duplication, persistence and responsive layout.
- `scripts/commercial-smoke.mjs`: actual purchase totals, underlay, inherited herringbone, hourly settings and mobile layout.
- `scripts/floorplan-editing-smoke.mjs`: doors, points, overlaps, shared walls and stair overlays.
- `scripts/ocr-client-pack-smoke.mjs`: real image OCR, explicit text correction, scale review, spatial naming, client HTML/PDF export, matching totals and mobile layout.
- `scripts/pdf-picker-smoke.mjs`: PDF page selection and native text extraction.
- `scripts/offline-smoke.mjs`: first-use PDF/detection/OCR without a network, browser save failure, backup and recovery.

Artifacts are written to ignored `test-results` directories. The fixtures are synthetic; they are not a substitute for testing representative customer plans.
