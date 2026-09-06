#!/usr/bin/env node
/**
 * Browser smoke test: drives the built app in a real Chromium and fails loudly if anything is
 * broken. It is the last check before a release — the unit tests prove the engine and the
 * components, this proves the whole thing actually loads, renders and reacts to a click.
 *
 *   npm run build && node scripts/smoke.mjs
 *
 * It serves dist/ itself (`vite preview`) unless something is already answering on BASE_URL, in
 * which case it uses that and leaves it running.
 *
 * What it does, in order: loads the page, loads the example house, opens a room and the staircase
 * in the sidebar, walks every tab, edits a room dimension and checks the estimate moves with it,
 * screenshots every view, and exits non-zero on a failed check, a console error, an uncaught page
 * error or a failed request.
 *
 * Environment:
 *   BASE_URL        where the app is served      (default http://127.0.0.1:4173/)
 *   OUT_DIR         where screenshots are put    (default <repo>/test-results/smoke, git-ignored)
 *   PLAYWRIGHT_DIR  a node_modules holding playwright, when it is not installed here
 *   CHROMIUM_PATH   browser executable           (default /opt/pw-browsers/chromium if present)
 *   HEADED=1        watch it run
 *   SLOW_MO         milliseconds between actions (default 0)
 *
 * Playwright is deliberately NOT a dependency of this project: it is a 100 MB browser download
 * that no one building an estimate needs. Install it where you run the smoke test
 * (`npm i --no-save playwright && npx playwright install chromium`) or point PLAYWRIGHT_DIR at a
 * node_modules that already has it.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? path.join(REPO_ROOT, 'test-results', 'smoke'));
const SLOW_MO = Number(process.env.SLOW_MO ?? 0) || 0;
const VIEWPORT = { width: 1440, height: 1000 };

/** Room the dimension edit is made in — a plain rectangle, so "Room length" is the field. */
const EDIT_ROOM = 'Bedroom 1';
const EDIT_LENGTH_M = '6.4';

const TABS = ['Rooms & stairs', 'Floor plan', 'Materials & options', 'Estimate'];

// ---------------------------------------------------------------------------
// Loading playwright from wherever it happens to live
// ---------------------------------------------------------------------------

/** Directories under `root` (bounded, shallow) that hold a `node_modules/playwright`. */
function scratchpadNodeModules(root, maxDepth = 5, budget = 400) {
  const found = [];
  const queue = [[root, 0]];
  while (queue.length && budget > 0) {
    const [dir, depth] = queue.shift();
    budget -= 1;
    if (existsSync(path.join(dir, 'node_modules', 'playwright', 'package.json'))) found.push(path.join(dir, 'node_modules'));
    if (depth >= maxDepth) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) queue.push([path.join(dir, entry.name), depth + 1]);
      }
    } catch {
      /* unreadable directory */
    }
  }
  return found;
}

/** node_modules directories to fall back on when playwright is not installed in this project. */
function playwrightSearchPath() {
  const dirs = [path.join(REPO_ROOT, 'node_modules')];
  if (process.env.PLAYWRIGHT_DIR) dirs.push(path.resolve(process.env.PLAYWRIGHT_DIR));
  for (const dir of [process.env.SCRATCHPAD_DIR, process.env.TMPDIR].filter(Boolean)) {
    dirs.push(path.join(path.resolve(dir), 'node_modules'));
  }
  // Last resort: an agent/CI sandbox keeping one shared playwright in a scratch directory next to
  // (not inside) the checkout. Only reached when nothing above resolved, so it costs nothing
  // in a normal `npm i --no-save playwright` setup.
  const local = dirs.filter((dir) => existsSync(path.join(dir, 'playwright')));
  if (local.length) return local;
  for (const root of ['/tmp/claude-0', os.tmpdir()]) {
    if (existsSync(root)) dirs.push(...scratchpadNodeModules(root));
  }
  return dirs.filter((dir) => existsSync(dir));
}

async function loadChromium() {
  const tried = [];
  for (const dir of playwrightSearchPath()) {
    for (const pkg of ['playwright', 'playwright-core']) {
      try {
        const require = createRequire(path.join(dir, 'noop.cjs'));
        const entry = require.resolve(pkg);
        const mod = await import(pathToFileURL(entry).href);
        const chromium = mod.chromium ?? mod.default?.chromium;
        if (chromium) return { chromium, from: entry };
      } catch (error) {
        tried.push(`${dir}/${pkg}: ${error.code ?? error.message}`);
      }
    }
  }
  throw new Error(
    `Could not load playwright. Install it where you run the smoke test\n` +
      `  npm i --no-save playwright && npx playwright install chromium\n` +
      `or set PLAYWRIGHT_DIR to a node_modules that has it.\nTried:\n  ${tried.join('\n  ')}`,
  );
}

// ---------------------------------------------------------------------------
// Serving the built site
// ---------------------------------------------------------------------------

/** Is something already answering on BASE_URL? */
async function reachable(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start `vite preview` on the port in BASE_URL when nothing is serving there, so the smoke test is
 * one command after a build. Returns the child process to kill afterwards, or undefined when a
 * server was already up (someone else's `npm run preview`, a deployed URL) — we never kill that.
 */
async function startPreview() {
  if (await reachable(BASE_URL)) return undefined;
  const dist = path.join(REPO_ROOT, 'dist', 'index.html');
  if (!existsSync(dist)) throw new Error(`Nothing is serving ${BASE_URL} and ${dist} does not exist — run \`npm run build\` first.`);
  const port = new URL(BASE_URL).port || '4173';
  log(`starting    vite preview --port ${port}`);
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', port, '--host', '127.0.0.1'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await reachable(BASE_URL)) return child;
    if (child.exitCode !== null) throw new Error(`vite preview exited with code ${child.exitCode} — is port ${port} in use?`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`vite preview did not come up on ${BASE_URL} within 30s.`);
}

function browserExecutable() {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return explicit;
  // Preinstalled browsers in the container/CI image; otherwise let playwright find its own.
  return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

// ---------------------------------------------------------------------------
// Tiny test harness (no test runner: this runs against a built site, not jsdom)
// ---------------------------------------------------------------------------

const failures = [];
const problems = []; // console errors, page errors, failed requests
let step = 0;

const log = (...args) => console.log(...args);

function check(name, ok, detail) {
  if (ok) {
    log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(detail ? `${name}: ${detail}` : name);
    log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

const checkEqual = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);
const checkAtLeast = (name, actual, min) => check(name, actual >= min, `expected at least ${min}, got ${actual}`);

function heading(text) {
  log(`\n${text}`);
}

/** Screenshot the whole page into OUT_DIR, numbered in the order they were taken. */
async function shot(page, name) {
  step += 1;
  const file = path.join(OUT_DIR, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log(`  shot  ${path.relative(process.cwd(), file)}`);
  return file;
}

/** Poll until `read()` returns something other than `before`, or give up after `timeout` ms. */
async function waitForChange(read, before, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let latest = before;
  while (Date.now() < deadline) {
    latest = await read();
    if (latest !== before) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return latest;
}

/** "£1,234.56" / "12.34 m²" / "47.7%" -> 1234.56 / 12.34 / 47.7 (NaN when there is no number). */
function parseNumber(text) {
  const match = String(text).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

const textOf = (locator) => locator.innerText().then((t) => t.trim());

/** The sidebar section under a given heading ("Rooms", "Stairs", "Products", "Floor plans"). */
function sidebarSection(page, name) {
  return page.locator('aside.sidebar-column .stack > div').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** Body-level horizontal overflow means something is too wide for the layout — a real bug. */
async function checkNoHorizontalOverflow(page, where) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(`${where}: no horizontal page overflow`, scrollWidth <= clientWidth + 1, `scrollWidth ${scrollWidth} vs viewport ${clientWidth}`);
}

// ---------------------------------------------------------------------------
// The walk-through
// ---------------------------------------------------------------------------

async function run(page) {
  heading(`1. Load ${BASE_URL}`);
  const response = await page.goto(BASE_URL, { waitUntil: 'load' });
  check('page responded 200', response?.status() === 200, `status ${response?.status()}`);
  await page.waitForSelector('.app', { timeout: 15000 });
  check('document title', (await page.title()).length > 0, await page.title());
  check('welcome screen shown', await page.getByRole('heading', { name: 'Start measuring' }).isVisible());
  check('empty estimate prompt', await page.getByTestId('results-empty').isVisible());
  await shot(page, 'welcome');

  heading('2. Load example house');
  await page.getByRole('button', { name: 'Load example house' }).click();
  await page.waitForSelector('aside.sidebar-column li', { timeout: 10000 });
  const rooms = sidebarSection(page, 'Rooms').locator('ul.list li');
  const stairs = sidebarSection(page, 'Stairs').locator('ul.list li');
  const products = sidebarSection(page, 'Products').locator('ul.list li');
  checkAtLeast('rooms in the sidebar', await rooms.count(), 5);
  checkAtLeast('staircases in the sidebar', await stairs.count(), 1);
  checkAtLeast('products in the sidebar', await products.count(), 4);

  const compactTotal = page.locator('aside.results-column [data-testid="kpi-total"]');
  const compactArea = page.locator('aside.results-column [data-testid="kpi-net-area"]');
  await compactTotal.waitFor({ timeout: 10000 });
  const totalAtLoad = parseNumber(await textOf(compactTotal));
  const areaAtLoad = parseNumber(await textOf(compactArea));
  check('estimate column prices the example', totalAtLoad > 0, `total ${await textOf(compactTotal)}`);
  check('estimate column has a net area', areaAtLoad > 0, `net area ${await textOf(compactArea)}`);
  checkAtLeast('roll plans summarised in the column', await page.getByTestId('compact-roll-line').count(), 1);
  await shot(page, 'example-loaded');
  await checkNoHorizontalOverflow(page, 'rooms tab');

  heading('3. Open a room in the sidebar');
  await rooms.filter({ hasText: EDIT_ROOM }).first().click();
  await page.waitForSelector('.room-editor', { timeout: 5000 });
  check('room editor heading', (await textOf(page.locator('.room-editor h2'))) === EDIT_ROOM, await textOf(page.locator('.room-editor h2')));
  checkAtLeast('room plan preview drawn', await page.locator('.room-editor .shape-preview svg').count(), 1);
  check('room dimension field present', await page.getByLabel('Room length').isVisible());
  await shot(page, 'room-editor');
  await checkNoHorizontalOverflow(page, 'room editor');

  heading('4. Open the staircase in the sidebar');
  await stairs.first().click();
  await page.waitForSelector('.stairs-editor', { timeout: 5000 });
  const stairsSummary = await textOf(page.getByTestId('stairs-summary'));
  check('stairs summary rendered', stairsSummary.length > 0, stairsSummary.replace(/\s+/g, ' ').slice(0, 120));
  checkAtLeast('stairs preview drawn', await page.locator('.stairs-editor svg').count(), 1);
  await shot(page, 'stairs-editor');
  await checkNoHorizontalOverflow(page, 'stairs editor');

  heading('5. Walk every tab');
  for (const label of TABS) {
    const tab = page.locator('nav.tabs button', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
    await tab.click();
    await page.waitForFunction(
      (name) => {
        const el = [...document.querySelectorAll('nav.tabs button')].find((t) => t.textContent?.trim() === name);
        return el?.getAttribute('aria-current') === 'page';
      },
      label,
      { timeout: 5000 },
    );
    await page.waitForTimeout(150);
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await tabChecks(page, label);
    await shot(page, `tab-${slug}`);
    await checkNoHorizontalOverflow(page, `${label} tab`);
  }

  heading('6. Edit a room dimension and watch the estimate move');
  await page.locator('nav.tabs button', { hasText: /^Rooms & stairs$/ }).click();
  await rooms.filter({ hasText: EDIT_ROOM }).first().click();
  await page.waitForSelector('.room-editor', { timeout: 5000 });
  const beforeArea = await textOf(compactArea);
  const beforeTotal = await textOf(compactTotal);
  const lengthField = page.getByLabel('Room length');
  const beforeLength = await lengthField.inputValue();
  await lengthField.fill(EDIT_LENGTH_M);
  await lengthField.press('Enter');
  const afterArea = await waitForChange(() => textOf(compactArea), beforeArea);
  const afterTotal = await textOf(compactTotal);
  log(`  edit  ${EDIT_ROOM} length ${beforeLength} -> ${EDIT_LENGTH_M} m`);
  check('net area KPI changed', afterArea !== beforeArea, `${beforeArea} -> ${afterArea}`);
  check('net area grew', parseNumber(afterArea) > parseNumber(beforeArea), `${beforeArea} -> ${afterArea}`);
  check('total KPI changed', afterTotal !== beforeTotal, `${beforeTotal} -> ${afterTotal}`);
  check('total grew', parseNumber(afterTotal) > parseNumber(beforeTotal), `${beforeTotal} -> ${afterTotal}`);
  await shot(page, 'room-edited');

  heading('7. Full estimate after the edit');
  await page.locator('nav.tabs button', { hasText: /^Estimate$/ }).click();
  await page.waitForSelector('[data-testid="results-panel"].results-expanded', { timeout: 5000 });
  const expandedArea = await textOf(page.locator('main [data-testid="kpi-net-area"]'));
  check('full estimate shows the edited area', expandedArea === afterArea, `${expandedArea} vs ${afterArea}`);
  await tabChecks(page, 'Estimate');
  await shot(page, 'estimate-after-edit');
  await checkNoHorizontalOverflow(page, 'estimate after edit');
}

/** Per-tab assertions: enough of each view to prove it rendered, not just mounted. */
async function tabChecks(page, label) {
  if (label === 'Rooms & stairs') {
    check('rooms tab shows an editor', (await page.locator('.room-editor, .stairs-editor, .panel').count()) > 0);
    return;
  }
  if (label === 'Floor plan') {
    check('floor plan panel heading', await page.getByRole('heading', { name: 'Floor plan', exact: true }).first().isVisible());
    check('floor plan instructions', await page.locator('.floorplan-steps').isVisible());
    return;
  }
  if (label === 'Materials & options') {
    check('materials panel heading', await page.getByRole('heading', { name: 'Materials & options', exact: true }).first().isVisible());
    checkAtLeast('products listed', await page.getByTestId('product-list').locator('li').count(), 4);
    return;
  }
  if (label === 'Estimate') {
    const rollPlans = await page.getByTestId('roll-plan-section').count();
    const diagrams = await page.getByTestId('roll-cut-diagram').count();
    const bomRows = await page.getByTestId('bom-table').locator('tbody tr').count();
    const roomCards = await page.getByTestId('room-result').count();
    const stairCards = await page.getByTestId('stair-result').count();
    checkAtLeast('cutting plans on the estimate', rollPlans, 1);
    checkAtLeast('roll cut diagrams drawn', diagrams, 1);
    checkAtLeast('pieces drawn in the first diagram', await page.getByTestId('roll-cut-diagram').first().locator('.roll-piece').count(), 1);
    checkAtLeast('cut rows listed', await page.getByTestId('cut-row').count(), 1);
    checkAtLeast('bill of materials rows', bomRows, 10);
    check('bill of materials totals', await page.getByTestId('bom-grand-total').isVisible());
    checkAtLeast('room result cards', roomCards, 5);
    checkAtLeast('stair result cards', stairCards, 1);
    checkAtLeast('roll width comparison rows', await page.getByTestId('compare-row').count(), 2);
    const total = await textOf(page.locator('main [data-testid="kpi-total"]'));
    check('estimate total is money', /[£$€]\s?\d/.test(total), total);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { chromium, from } = await loadChromium();
const executablePath = browserExecutable();
await mkdir(OUT_DIR, { recursive: true });
log(`playwright  ${from}`);
log(`chromium    ${executablePath ?? '(playwright default)'}`);
log(`base url    ${BASE_URL}`);
log(`screenshots ${OUT_DIR}`);
const preview = await startPreview();

const browser = await chromium.launch({ executablePath, headless: process.env.HEADED !== '1', slowMo: SLOW_MO });
const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-GB' });
const page = await context.newPage();

page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
});
page.on('requestfailed', (request) => {
  const failure = request.failure()?.errorText ?? 'failed';
  if (failure !== 'net::ERR_ABORTED') problems.push(`request failed: ${request.url()} (${failure})`);
});
page.on('response', (res) => {
  if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`);
});
// The app confirm()s before a destructive action; a dialog left open would hang the run.
page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

let crash;
try {
  await run(page);
} catch (error) {
  crash = error;
  try {
    await shot(page, 'crash');
  } catch {
    /* the page may be gone */
  }
} finally {
  await context.close();
  await browser.close();
  preview?.kill('SIGTERM');
}

heading('Result');
if (crash) log(`  CRASH ${crash.stack ?? crash.message}`);
for (const problem of problems) log(`  PAGE  ${problem}`);
log(`\n${failures.length} failed check(s), ${problems.length} page problem(s), ${step} screenshot(s) in ${OUT_DIR}`);

if (crash || failures.length || problems.length) {
  log('SMOKE TEST FAILED');
  process.exit(1);
}
log('SMOKE TEST PASSED');
