# Product pricing and labour assumptions

Product setup keeps the purchasing choices beside the covering: roll or pack size, pricing basis, carpet underlay, and cutting waste. Supplier and fitting details remain expandable.

## Purchasing

- Existing broadloom products continue to use their price per square metre. The purchased full-width cut length is charged.
- **Per roll → Buy whole rolls** requires a price and the length covered by that price. The planner allocates cuts to that roll length, buys whole rolls, and includes the uncut remainder in the ordered area, waste and cost. The cutting diagram shows every purchased roll, including any roll held entirely as reserve.
- **Per roll → Pay only for cut length** divides the roll price by its stated length and charges the supplier-rounded cut order. A missing priced length leaves the covering unpriced and marks the estimate incomplete.
- Pack products accept either a pack price or a square-metre price. Both purchase whole packs; the selected price basis controls which price is used.

Prices are before VAT. Supplier prices and underlay presets are editable starting values.

## Waste and patterns

Carpet and sheet-vinyl layouts already account for trimming, seams, pattern repeat, roll width and offcuts. The minimum-surplus percentage is a floor on ordered area relative to net area. Existing cutting surplus is credited first. Setting 10% does **not** add another 10% to a layout already containing 25% surplus. The order rounds to the supplier increment; any added reserve appears as uncut material.

Laminate, wood and LVT expose their laying pattern on the product. Herringbone and chevron start at 20% cutting allowance; straight laying starts at 7%. A custom percentage replaces the pattern starting allowance; unusual room size or shape can add further allowances under the existing planner rules. Product settings apply to its rooms unless a room explicitly overrides them. Patterns calculate quantities and time; the app does not produce a board-by-board herringbone layout. Boards must support the selected installation pattern.

Stair cladding keeps its existing 15% allowance when unspecified. An explicit product cutting-waste percentage also applies to its stair cladding.

## Carpet underlay

A carpet can inherit the project underlay, use a preset or custom roll, or omit new underlay. The choice applies to its rooms and stair pads, including thickness and underfloor-heating checks. Identical effective underlay specifications share an order across carpets. Different specifications have separate quantities and prices. A custom square-metre underlay price replaces an inherited roll price.

## Labour in Settings

Unit-rate pricing is retained for existing projects. Hourly pricing is an explicit choice and replaces the unit-rate labour lines. The existing minimum-job charge applies as a separate top-up where required.

The workload calculation is visible in Settings and the estimate:

1. Each room: net area divided by fitting speed for its covering.
2. Herringbone, chevron and diagonal rooms: multiply room fitting time by the editable pattern factor.
3. Stairs: straight-step minutes plus shaped-step minutes, with landing area divided by landing fitting speed.
4. Preparation and finishing: use the measured activities already selected by the subfloor/uplift planner and multiply their quantities by editable minutes per unit. Optional work remains separate and uncharged.
5. Add setup and clean-up once per measured job, then the site-time allowance.

These are person-hours, not elapsed project duration. Two fitters can share the effort. Drying, acclimatisation and unattended moisture-test waiting periods are excluded. Disposal time covers handling; external disposal fees need separate consideration. Productivity, setup, contingency and rates are estimating assumptions to tune to the team and site, not claimed industry standards.

All settings are saved with the project and round-trip through project files. Optional fields preserve old-project pricing. Local storage and downloaded project files remain the persistence mechanism.

## Verification

`src/engine/commercial.test.ts` covers whole-roll and cut-length arithmetic, waste crediting, underlay pooling/omission, herringbone inheritance, staircase allowances, hourly replacement, optional work and backward-compatible parsing. Component and roll-display tests cover the input flow and visual purchase quantities.

`node scripts/commercial-smoke.mjs` tests the running application at `BASE_URL` (default `http://127.0.0.1:5173/`), verifies the rendered order list and pricing choices, and checks persistence and 1024/768/390/320px layouts. Browser artifacts are written to `test-results/commercial/`.
