# Product and front-end review

Reviewed 7 September 2026. This assessment is based on repository inspection and local interaction/testing work. It is a developer usability review; testing with working flooring fitters is still needed.

## What the tool does

Flooring Estimator turns typed measurements or calibrated image/PDF traces into flooring quantities, cutting plans and a priced estimate. It supports irregular rooms, doorways, staircases, carpet and sheet vinyl rolls, pack products, underlay, accessories, floor preparation, labour and VAT. Projects can be restored from browser storage, saved as JSON files, and shared as printed estimates or CSV exports.

The application runs in the browser. React presents the workflow, Zustand holds the current project, and a separate TypeScript engine calculates the estimate. See [the domain model](../src/engine/types.ts), [estimate calculation](../src/engine/estimate.ts), [project storage](../src/store/projectStore.ts) and [architecture notes](DESIGN.md).

## Overall assessment

**A capable specialist estimating tool with a stronger calculation model than its original onboarding and presentation.** The original experience was usable for someone who already understood flooring estimates, but a new user had to work out the sequence, distinguish defaults from measured facts, and interpret dense forms and results.

The improvements below make the front end a more coherent professional workspace: clear starting actions, consistent navigation, more readable controls, and visible indications of incomplete estimates or failed saves. It remains a browser application with one current project. A commercial SaaS offering would additionally need accounts, a project library, cross-device recovery, team permissions and an operated backend.

| Question | Assessment |
| --- | --- |
| Is the front end professional enough? | The revised layout, navigation, spacing and status hierarchy provide a credible foundation. A hosted team service and repeated customer usability testing are further product work. |
| Is it user friendly? | The overview now explains where to start, product rows work with a keyboard, and specialist settings are easier to discover without dominating basic measurements. Some flooring terminology still requires trade knowledge. |
| Is it simple to operate? | A basic room has a clear path: choose a product, enter dimensions, check the drawing, review openings and preparation, then review the estimate. Irregular rooms and complex stairs remain inherently detailed workflows. |
| Do the visualisations make sense? | Room outlines show physical geometry; roll diagrams show how purchased material is cut. They answer different practical questions. Legends, dimensions, edge numbers and a direct roll-width selection action improve that distinction. Very complex outlines and long rolls still need evaluation on real site devices. |

## Strengths to preserve

- **Useful trade depth:** shared doorways, pile direction, seam policy, pattern repeats, offcuts, stair variations and preparation rules go beyond a simple area calculator. [Engine modules](../src/engine/estimate.ts).
- **Clear calculation boundaries:** millimetres are stored internally, while the interface accepts metric and imperial measurements. Pure calculation code is separated from presentation, with domain and UI regression tests. [Units](../src/engine/units.ts), [test configuration](../vite.config.ts).
- **Inspectable results:** cut lists, room plans, bill-of-materials lines and warnings expose the basis of an estimate. [Results](../src/ui/results/ResultsPanel.tsx).
- **Useful site workflow:** local operation, plan tracing, JSON backup, CSV and print suit measuring work away from a desk. [Floor-plan tools](../src/ui/floorplan/FloorPlanPanel.tsx), [project actions](../src/ui/layout/TopBar.tsx).

## Prioritised recommendations and implemented changes

P0 protects confidence in saved work and quoted figures. P1 improves everyday task completion. P2 improves comparison and maintainability.

| Priority | Finding and recommendation | Implemented change / evidence |
| --- | --- | --- |
| P0 | A total can appear complete when required items have no prices, or misleading when calculation fails. Show the estimate's state beside its figures and exports. | Added incomplete/unavailable states, explicit unpriced items, partial-total labels, a pricing action and CSV notices. [Status](../src/ui/results/status.ts), [results](../src/ui/results/ResultsPanel.tsx), [bill of materials](../src/ui/results/BomTable.tsx). |
| P0 | Browser autosave can fail; the interface must accurately report the latest write and provide recovery. | Added saved/error state, restore notices, backup download feedback, retry and prominent save-failure actions. Browser storage remains the persistence mechanism. [Store](../src/store/projectStore.ts), [top bar](../src/ui/layout/TopBar.tsx). |
| P1 | A dense initial workspace gives insufficient direction and makes mobile room switching awkward. | Added a new/restored-project overview, measurement workflow, clearer project actions, refreshed visual hierarchy and a mobile space selector. [Overview](../src/ui/layout/ProjectOverview.tsx), [app shell](../src/ui/App.tsx), [workspace styles](../src/ui/workspace.css). |
| P1 | Basic measurements compete with preparation and planning details. Reveal detail when needed while keeping assumptions visible. | Added measurement-entry guidance, collapsible subfloor controls with a visible summary, doorway counts, and automatic expansion of existing planning overrides. Empty room notes now collapse below the measurements; existing notes remain open. [Room editor](../src/ui/rooms/RoomEditor.tsx). |
| P1 | Clickable product list items and generic action names weaken keyboard and screen-reader operation. | Replaced them with named native buttons; associated product details and disclosure states; improved shared section headings and unit descriptions; added Escape to restore a measurement draft. [Materials](../src/ui/materials/MaterialsPanel.tsx), [shared controls](../src/ui/components/inputs.tsx). |
| P1 | Switching tracing tools discards a room outline in progress. Preserve the active draft during that interaction. | Trace points and closure state survive tool changes within the open plan; a continuation message explains how to return. Calibration guidance explains that existing rooms retain their saved dimensions. [Plan editor](../src/ui/floorplan/FloorPlanPanel.tsx). |
| P1 | Caching only requested assets leaves first-use offline paths vulnerable, including PDF tools. | The build injects generated assets into the service-worker precache, including PDF code and its worker. Required-asset failures prevent installation of an incomplete offline version. [Build](../vite.config.ts), [service worker](../public/sw.js). |
| P2 | Roll comparisons require users to leave the result and manually reproduce the selected option. Colour alone is insufficient explanation. | Added “Use width”, marked the current width, explained its product-wide effect, and added cutting-plan legends. [Comparison](../src/ui/results/ResultsPanel.tsx), [roll diagram](../src/ui/results/RollCutDiagram.tsx), [room results](../src/ui/results/RoomResults.tsx). |
| P2 | Several subscribers can repeat expensive calculation for the same project. | Shared the estimate and roll-comparison cache across subscribers for the current project/revision. Calculations still run on the main thread. [Estimate bridge](../src/store/useEstimate.ts). |

The running estimate now puts its main action beside the totals and limits the initial warning list to two items. The full estimate keeps errors and warnings visible while collapsing background notes; printing includes those notes. Browser testing also exposed a `Vary: Origin` cache mismatch on offline JavaScript/CSS requests. The service worker now ignores that variation only for the immutable assets listed by the build.

## Remaining weaknesses and development roadmap

1. **Confirm measurements and prices:** add explicit measured/reviewed states, a pre-quote checklist, and supplier or job templates. Default room sizes, subfloor assumptions and indicative prices still need human confirmation. The current change provides guidance; it does not implement approval tracking.
2. **Improve project durability:** move plan images/PDF-derived assets to IndexedDB and add a local project library with recovery/version history. Current autosave serialises the whole project to localStorage. Error visibility helps recovery but does not remove capacity limits. See the [MDN storage reference](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
3. **Develop SaaS capabilities if commercially required:** accounts, cloud projects, organisation roles, sync/conflict handling and customer/job history. Define data ownership and offline behaviour before choosing the backend. These features are not implemented.
4. **Reduce repetitive work:** saved material catalogues, reusable room/stair templates, search, and undo/redo for measured edits. The subsequent floor-plan redesign retains drafts across tool, tab and plan changes in memory; durable draft recovery after reload remains future work.
5. **Scale computation and validate installation choices:** profile larger jobs, then consider a Web Worker with progress/cancellation. The roll packer uses best-fit decreasing shelf packing; its result should not be described as a proven global optimum. Compare representative outputs with experienced fitters. [Packer](../src/engine/packer.ts).
6. **Run structured field usability sessions:** observe first-room entry, irregular-room tracing, staircase editing, resolving missing prices, roll-width choice, offline reopening and backup recovery on phones/tablets. Measure completion, errors and points of confusion before choosing the next redesign.

The form organisation follows the concern addressed by [W3C guidance on grouping related controls](https://www.w3.org/WAI/tutorials/forms/grouping/). Offline asset planning is documented further in [web.dev's PWA assets and data guidance](https://web.dev/learn/pwa/assets-and-data/). These references inform implementation decisions; they are not an accessibility certification or a guarantee of browser-storage durability.

## Subsequent floor-plan redesign

Following feedback that the plan tool was counter-intuitive, the dedicated [floor-plan review](FLOORPLAN_REDESIGN.md)
records the proposed sequence, removed interactions, implementation and additional checks. It replaces
the crowded plan panel with Upload → Set scale → Add rooms → Review, previews PDF pages before import,
adds two-corner rectangles and local room detection, and keeps room inspection beside the plan.

## Initial review validation

Further feedback on input complexity is addressed in the [simple workflow and roll-destination review](SIMPLE_WORKFLOWS.md):
flooring setup comes first, stairs start with six inputs, specialist settings are optional, and physical
roll diagrams connect numbered pieces to their destination spaces. The validation below records the
initial review; the linked document records the subsequent changes and checks.

Final integrated validation passed:

- **599 tests in 24 files**, covering the engine, store, controls, results, tracing and service worker.
- **TypeScript and production build** passed.
- **Chromium workflow smoke:** example house, room/stair editors, all four sections, changing dimensions and recalculating the full estimate; no page errors or failed checks.
- **Responsive browser checks:** all four sections at 320, 390, 768, 1024 and 1440 pixels; no horizontal page overflow. Also verified mobile room switching, applying a roll width, JSON backup download and the printed estimate PDF.
- **Six offline/recovery checks in Chrome:** first-visit asset precaching/cache isolation; offline reload with saved measurements; first-use PDF import offline; visible storage-quota failure with a backup containing unsaved edits; successful retry/reload recovery; repaired-autosave notice. No browser errors or failed requests.

Reproduce with `npm test`, `npm run build`, `npm run smoke`, `node scripts/responsive-smoke.mjs` and, with `npm run preview` running, `node scripts/offline-smoke.mjs`. Browser scripts require an optional local Playwright installation. No cloud services are required.

Local review artifacts (generated, git-ignored): [desktop workspace](../test-results/smoke/03-room-editor.png), [phone workspace](../test-results/responsive/390-rooms-stairs.png), [estimate overview](../test-results/responsive/1440-estimate.png), [sample printed estimate](../test-results/responsive/sample-estimate.pdf), [offline test report](../test-results/offline-smoke/report.json).

These checks cover the supplied fixtures and tested browser paths. They do not replace fitter validation of real measurements, supplier prices, or a field usability study, and they are not a cross-browser accessibility certification.
