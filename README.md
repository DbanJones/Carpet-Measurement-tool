# Flooring Estimator

A browser-based measurement and estimating tool for the flooring trade (UK conventions, metric with
imperial display). Type room dimensions or trace rooms from an uploaded floor plan, add stairs, and
get a priced bill of materials with a roll cutting plan.

What it works out:

- **Carpet and sheet vinyl off the roll** – seam placement and a cut list per roll width (4 m / 5 m
  carpet, 2 / 3 / 4 m vinyl), pile direction, pattern repeats, cross-joined fills, offcut reuse across
  rooms and stairs, linear metres to order, waste percentage, usable offcuts.
- **Odd-shaped rooms** – L-shapes, bays, alcoves, chimney breasts, diagonal walls, or any polygon
  ("walk the walls" or traced from a plan).
- **Stairs** – straight flights, winders, bullnose/curtail steps, landings, open strings (wrap and
  binding), runners with stair rods, cap-and-band vs waterfall fitting, stair nosings for hard floors.
- **Underlay, gripper, door bars** – rolls of 11 m x 1.37 m, 1.52 m gripper lengths with timber or
  concrete pins, door bar type chosen from the transition (carpet–carpet, carpet–hard floor, T-bar, ramp…).
- **Floor preparation** – uplift and disposal, smoothing compound bags, primer, plywood/hardboard
  overlay and fixings, moisture testing and DPMs, door easing, driven by subfloor type and condition.
- **Laminate, engineered wood, LVT (click and glue-down), carpet tiles** – packs with pattern-based
  wastage, underlay and DPM, beading/scotia, thresholds, adhesive, tackifier.
- **Pricing** – editable price book (materials and labour), a minimum job charge, VAT, per-line and
  total costs, CSV export, print-ready estimate with the customer, site and date on it.

Everything runs client-side: no server, no account, projects are saved in the browser and as JSON
files. It installs as a PWA and, once opened online, works offline — which is how it is used: measure
up in an empty house with no signal.

## Quick start

Use Node.js 22.13 or newer (required by the current PDF reader).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + UI unit tests
npm run typecheck
npm run build      # static site in dist/ (relocatable, base "./")
node scripts/smoke.mjs   # browser smoke test: drives the built app in Chromium against `npm run preview` (needs playwright installed; see the script header)
```

Load the **example house** from **Project actions** or **Explore an example project** on the starting screen to see every feature exercised.

For a guided start, choose **Guide me through setup**. It walks through flooring, a floor plan or
blank house drawing, room and stair measurements, then the estimate. **Draw a house without a plan**
opens a scaled grid for arranging rooms; enter exact room sizes before adding them. Inside a
staircase, **Guide me through stairs** starts with the step count and total rotation, then the
turning steps or landing, and three starting measurements. Eight winders can make a full 180-degree
turn without a landing. Check the preview before applying it. See
[guided setup and house sketches](docs/GUIDED_SETUP.md).

Uploaded floor plans automatically read room names and printed measurements. Confirm a suggested
scale when the printed dimensions match the detected walls, or set one known wall length using the
labelled A/B reference. **Detect all rooms** lets you review numbered outlines and
add selected rooms together. Names, corners and recognised text remain editable; printed dimensions
are checked against the measured outlines. See [the floor-plan workflow](docs/FLOOR_PLAN_WORKFLOW.md).

For a new job, start with **Set up flooring & rolls**, enter the supplier's width and price, then choose
**Measure a room**, **Measure stairs** or **Use a floor plan**. Staircases start with an editable
top-down drawing and linked side, front and 3D views. Sketch how the flight wraps, check four
common measurements, then select a tread for individual dimensions or a landing. Further fitting
details are available when needed. See the [stair drawing design](docs/STAIR_DRAWING_DESIGN.md). The estimate shows
each roll separately, with numbered pieces linked to their room or staircase. See the
[simple workflow and cut-view review](docs/SIMPLE_WORKFLOWS.md).

Rooms now have editable wall and corner handles. Stairs support individual and grouped tread
editing, with the optional measured table below the diagrams and an orbitable 3D view. Right-click
a tread or use **Actions** to insert, remove, reshape or enter exact side lengths and corner angles.
**Make rectangular** keeps neighbouring treads connected and the returning U flight aligned.
Drag the sidebar
handles to reorder rooms, stairs and products, or use each item's Actions menu to delete it.
See [direct editing and project organisation](docs/DIRECT_EDITING.md).

See [the product and front-end review](docs/REVIEW.md) for the assessment, implemented improvements and development roadmap. The workspace now includes a project overview, mobile room switching, clearer estimate checks and visible browser-save status.

The [workflow upgrade](docs/WORKFLOW_UPGRADE.md) adds corner and curved stair layouts, room/door editing,
stairs on floor plans, local OCR, product underlay, roll pricing, visible herringbone/waste choices,
hourly labour settings and a client pack. The estimate has separate review views; **Client pack**
downloads a standalone proposal or prints to PDF. **Settings** contains business details and labour
assumptions. See [pricing and labour calculations](docs/COMMERCIAL_SETTINGS.md) for the quantities and defaults.

The floor-plan workspace follows **Upload → Set scale → Add rooms → Review**. Preview a brochure's
page before importing it, set one known distance, then click inside a room to suggest its boundary or
draw a rectangle with two opposite corners. Adjust and confirm each outline before it enters the
estimate. Detection runs on the device and works offline; open-plan areas and unclear drawings may
need manual tracing. See [the floor-plan design review](docs/FLOORPLAN_REDESIGN.md).

Additional browser checks (with Playwright installed and the indicated server running):

```bash
node scripts/responsive-smoke.mjs  # 320–1440px layouts, roll selection, JSON download and print PDF
npm run preview                    # leave running for the offline check in another terminal
node scripts/offline-smoke.mjs     # first-visit offline/PDF use and save-failure recovery
node scripts/floorplan-smoke.mjs   # detection, rectangles, correction, doorways and responsive review (dev server by default)
node scripts/pdf-picker-smoke.mjs  # real multi-page PDF preview, cancellation and chosen-page import
node scripts/floorplan-touch-smoke.mjs # phone taps, room entry and two-finger zoom
node scripts/simple-workflow-smoke.mjs # flooring-first setup, stairs, per-roll destinations and printed cut lists
node scripts/stairs-shapes-smoke.mjs   # corners, curved stairs, duplication and mobile layout
node scripts/stairs-drawing-smoke.mjs  # drawing, point dragging, linked views, landings and persistence
node scripts/stairs-simple-smoke.mjs   # guided eight-winder U without a landing, linked views and phone layouts (dev)
node scripts/stairs-rectangular-smoke.mjs # connected rectangular U tread, Actions menu and exact dimensions (dev required)
node scripts/stair-step-editing-smoke.mjs # step groups, curves, diagram/table edits and U landing
node scripts/stair-resizing-smoke.mjs  # straight/curved tread handles, linked sizes and cancellation
node scripts/stairs-orbit-smoke.mjs    # 3D rotation, zoom, touch and viewing angles
node scripts/sidebar-organising-smoke.mjs # saved mouse/touch ordering and sidebar deletion
node scripts/room-editing-smoke.mjs    # editable room diagrams, linked dimensions and undo
node scripts/commercial-smoke.mjs      # actual roll/pack/underlay costs and hourly settings
node scripts/floorplan-editing-smoke.mjs # editable points, door suggestions, overlaps and stair overlays
node scripts/ocr-client-pack-smoke.mjs # local OCR, text correction, client HTML/PDF and mobile layout
```

These scripts use installed Chrome/Edge on Windows, or Playwright's browser elsewhere. `CHROMIUM_PATH` overrides the browser executable. Screenshots and the sample estimate PDF are written under `test-results/`.
The staircase scripts default to `http://127.0.0.1:5173/`; leave `npm run dev` running in another
terminal. `stairs-rectangular-smoke.mjs` imports the source geometry through Vite, so it requires the
development server. `BASE_URL` overrides the address when a script supports it. For the built-app
checks, run `npm run build` and `npm run preview` first. Browser checks use synthetic example data.

## Project layout

```
src/engine/      pure TypeScript estimating engine (no DOM, fully unit tested)
  types.ts       domain model – rooms, stairs, products, options, results
  defaults.ts    UK trade constants and indicative prices (all user-editable)
  geometry.ts    polygons, slab decomposition, doorways
  broadloom.ts   seam placement for one room (dynamic programme over candidate seams)
  packer.ts      shelf packing of pieces onto a fixed-width roll
  rollplan.ts    per-product roll plan: rooms + stairs, cross joins, rolls, offcuts, waste
  stairs.ts      stair pieces, binding, gripper, underlay, nosings
  accessories.ts underlay, gripper, door bars, tapes
  floorprep.ts   subfloor rule table -> preparation items and quantities
  hardfloor.ts   pack-sold floors, beading, thresholds, adhesive
  estimate.ts    project -> Estimate (roll plans, BOM, prices, summaries, warnings)
src/store/       zustand project store with localStorage autosave
src/ui/          React UI: rooms, stairs, floor plan tracing, materials/options, results
src/offline/     tests for the offline shell in public/sw.js
public/          static files copied into the build
  sw.js          service worker: the offline shell (network-first shell, cache-first assets)
  manifest.webmanifest  PWA manifest and icons
  favicon.svg    the icon, plus the PNG sizes exported from it for install prompts
scripts/         smoke.mjs — the browser smoke test that drives the built app
docs/            design notes and the domain reference behind the defaults
```

See `docs/DESIGN.md` for the architecture and the cutting algorithm, and `docs/DOMAIN.md` for the
trade rules and sources behind every default.

## Hosting

`npm run build` produces a static site. The included GitHub Actions workflow builds and tests on
every push, and publishes to GitHub Pages when the repository's **default branch** is pushed —
whatever that branch is called (enable Pages → Source: GitHub Actions). Any static host (Netlify,
Cloudflare Pages, S3) works the same way.

The build has no source maps, so what is published is the app and nothing else. A returning user
picks up a new deployment on the next online load: the service worker serves the shell network-first
and only the content-hashed assets from the cache, and each build gets its own cache name (see
"Offline shell" in `docs/DESIGN.md`).

Licensed under the MIT licence (see `LICENSE`).
