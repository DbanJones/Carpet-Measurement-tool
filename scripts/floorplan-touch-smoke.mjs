/** Touch acceptance test: run against a dev/preview server with installed Chrome and Playwright. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = 'test-results/floorplan-touch';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, locale: 'en-GB', reducedMotion: 'reduce' });
const page = await context.newPage();
const checks = [], issues = [], errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const pass = (message) => { checks.push(message); console.log('PASS', message); };
const inspector = () => page.getByRole('complementary', { name: 'Current floor plan task' });
const roomCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.rooms.length);
async function tapPlan(x, y) {
  const svg = page.getByTestId('floorplan-overlay');
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.touchscreen.tap(box.x + x / 960 * box.width, box.y + y / 700 * box.height);
}
try {
  await page.goto(baseURL);
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).tap();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles('scripts/fixtures/estate-plan.svg');
  await page.getByAltText('Floor plan: estate-plan.svg').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Detect room', exact: true }).count(), 0, 'Calibration hides unrelated drawing tools');
  await page.locator('.floorplan-canvas').scrollIntoViewIfNeeded();
  const positions = await page.evaluate(() => ({
    canvas: document.querySelector('.floorplan-canvas').getBoundingClientRect().toJSON(),
    instruction: document.querySelector('.fp-mobile-task').getBoundingClientRect().toJSON(),
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert(positions.instruction.bottom <= positions.canvas.top, 'Mobile instruction should be above the canvas');
  assert(positions.canvas.height >= 260 && positions.canvas.height <= 440, `Canvas height should use screen space sensibly: ${positions.canvas.height}`);
  assert(positions.horizontalOverflow <= 1, `Page overflow: ${positions.horizontalOverflow}`);
  await page.screenshot({ path: `${output}/01-scale-touch.png` });
  pass('390px touch viewport shows current instruction above the fitted plan without page overflow');

  await tapPlan(86, 90); await tapPlan(434, 90);
  const known = inspector().getByLabel('Known distance');
  assert(await known.evaluate((element) => element === document.activeElement));
  await known.fill('4.35'); await known.press('Enter');
  await page.getByTestId('mode-detect').waitFor();
  const scale = await page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.floorPlans[0].mmPerPx);
  assert(Math.abs(scale - 12.5) < 0.01, `Unexpected calibration: ${scale}`);
  pass('Two touch taps focus known distance; Enter applies scale and advances');

  await page.getByRole('button', { name: 'Rectangle', exact: true }).tap();
  await tapPlan(86, 346); await tapPlan(434, 554);
  await page.getByTestId('mode-review-outline').waitFor();
  assert.equal(await roomCount(), 0);
  const name = inspector().getByLabel('Room name', { exact: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Room name', undefined, { timeout: 1000 });
  await name.fill('Touch bedroom');
  await page.screenshot({ path: `${output}/02-outline-review-touch.png` });
  await inspector().getByRole('button', { name: 'Add room', exact: true }).tap();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.rooms.length === 1);
  pass('Two corner touches produce a reviewable rectangle; Add room confirms it');

  await tapPlan(300, 440);
  assert(await inspector().getByLabel('Selected room name').isVisible());
  assert.equal(await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await roomCount(), 1);
  await page.screenshot({ path: `${output}/03-selected-room-touch.png` });
  pass('A selected room is editable within the floor-plan workspace');

  await page.getByRole('button', { name: 'Rectangle', exact: true }).tap();
  await page.getByTestId('floorplan-overlay').scrollIntoViewIfNeeded();
  const box = await page.getByTestId('floorplan-overlay').boundingBox();
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = await page.getByTestId('zoom-readout').innerText();
  const session = await context.newCDPSession(page);
  const point = (id, delta) => ({ id, x: center.x + delta, y: center.y, radiusX: 5, radiusY: 5, force: 1 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, -25)] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, -25), point(2, 25)] });
  for (let spread = 30; spread <= 60; spread += 5) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, -spread), point(2, spread)] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await page.getByTestId('zoom-readout').innerText();
  assert(Number.parseInt(after) > Number.parseInt(before), `Pinch should increase zoom: ${before} to ${after}`);
  assert.equal(await page.getByTestId('trace-status').innerText(), '0 corners placed');
  assert.equal(await roomCount(), 1);
  await page.screenshot({ path: `${output}/04-pinch-touch.png` });
  pass(`Real two-touch pinch changes zoom ${before} → ${after} without adding corners or rooms`);
  await page.getByRole('button', { name: 'Fit plan', exact: true }).tap();
  await tapPlan(86, 90);
  assert.equal(await page.getByTestId('trace-status').innerText(), '1 corner placed');
  pass('Normal touch input resumes after both pinch contacts lift');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ baseURL, viewport: { width: 390, height: 844 }, checks, issues, errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, issues, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, issues, errors, failure: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
