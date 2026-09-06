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

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + UI unit tests
npm run typecheck
npm run build      # static site in dist/ (relocatable, base "./")
node scripts/smoke.mjs   # browser smoke test: drives the built app in Chromium against `npm run preview` (needs playwright installed; see the script header)
```

Load the **example house** from the top bar to see every feature exercised.

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
