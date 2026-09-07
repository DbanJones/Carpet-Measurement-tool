/** Browser acceptance checks for the complete floor-plan journey. Requires Playwright and a running app. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = 'test-results/floorplan-redesign';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const checks = [];
const pass = (message) => { checks.push(message); console.log('PASS', message); };
async function tap(x, y) {
  const box = await page.getByTestId('floorplan-overlay').boundingBox();
  await page.mouse.click(box.x + x / 960 * box.width, box.y + y / 700 * box.height);
}
const inspector = () => page.getByRole('complementary', { name: 'Current floor plan task' });
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
async function saveRoom(name) {
  await inspector().getByLabel('Room name', { exact: true }).fill(name);
  await inspector().getByRole('button', { name: 'Add room', exact: true }).click();
}
try {
  await page.goto(url);
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles('scripts/fixtures/estate-plan.svg');
  await page.getByAltText('Floor plan: estate-plan.svg').waitFor();
  const workspace = await page.locator('.floorplan-canvas').boundingBox();
  assert(workspace.y < 430, `Plan should be visible high in the workspace (${workspace.y})`);
  assert.equal(await page.getByRole('button', { name: 'Detect room', exact: true }).count(), 0, 'Calibration hides unrelated drawing tools');
  await page.screenshot({ path: `${output}/01-scale-desktop.png` });
  pass('Upload starts scale setup with canvas visible and room tools gated');
  await tap(86, 90); await tap(434, 90);
  assert(await inspector().getByLabel('Known distance').evaluate((el) => el === document.activeElement));
  await inspector().getByLabel('Known distance').fill('4.35');
  await inspector().getByLabel('Known distance').press('Enter');
  assert(Math.abs((await project()).floorPlans[0].mmPerPx - 12.5) < .01);
  assert.equal(await page.getByRole('button', { name: 'Detect room', exact: true }).getAttribute('aria-pressed'), 'true');
  pass('Two scale points focus distance; Enter applies and advances');
  await tap(135, 240);
  await page.getByTestId('mode-review-outline').waitFor({ timeout: 15000 });
  assert.equal((await project()).rooms.length, 0);
  await page.screenshot({ path: `${output}/02-detected-outline-desktop.png` });
  await saveRoom('Lounge');
  assert.equal((await project()).rooms.length, 1);
  pass('Detect room proposes a boundary and only adds it after review');
  await tap(135, 240);
  assert(await inspector().getByLabel('Selected room name').isVisible());
  assert.equal(await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).getAttribute('aria-current'), 'page');
  await inspector().getByRole('button', { name: 'Mark doorway', exact: true }).click();
  await tap(214, 340); await tap(266, 340);
  assert.equal((await project()).rooms[0].doorways.length, 0);
  await inspector().getByRole('button', { name: 'Add doorway', exact: true }).click();
  assert.equal((await project()).rooms[0].doorways.length, 1);
  await inspector().getByRole('button', { name: 'Done with doorways' }).click();
  pass('Room selection stays on plan; doorway preview targets selected room');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await tap(86, 346); await tap(434, 554);
  await saveRoom('Bedroom');
  pass('Rectangle uses two clicks, then Add room');
  await page.getByRole('button', { name: 'Draw outline', exact: true }).click();
  await tap(446, 86); await tap(794, 86); await tap(794, 554); await tap(446, 554);
  await inspector().getByRole('button', { name: 'Finish outline' }).click();
  await inspector().getByLabel('Room name', { exact: true }).fill('Kitchen');
  await inspector().getByRole('button', { name: 'Continue outline' }).click();
  await inspector().getByRole('button', { name: 'Finish outline' }).click();
  assert.equal(await inspector().getByLabel('Room name', { exact: true }).inputValue(), 'Kitchen');
  const before = await inspector().getByTestId('trace-area').innerText();
  const box = await page.getByTestId('floorplan-overlay').boundingBox();
  await page.mouse.move(box.x + 794 / 960 * box.width, box.y + 86 / 700 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + 780 / 960 * box.width, box.y + 86 / 700 * box.height, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(await inspector().getByTestId('trace-area').innerText(), before);
  await saveRoom('Kitchen');
  assert.equal((await project()).rooms.length, 3);
  pass('Manual trace retains name during correction; dragging corners updates area');
  await page.getByRole('button', { name: 'Review rooms', exact: true }).click();
  assert(await inspector().getByRole('button', { name: 'View estimate' }).isVisible());
  await page.screenshot({ path: `${output}/03-review-desktop.png` });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'Fit plan', exact: true }).click();
    const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(size[0] <= size[1] + 1, `Overflow at ${width}: ${size}`);
    if (width === 390) await page.screenshot({ path: `${output}/04-review-mobile.png`, fullPage: true });
    pass(`${width}px workspace has no horizontal page overflow`);
  }
  await inspector().getByRole('button', { name: 'View estimate' }).click();
  assert(await page.getByTestId('results-panel').isVisible());
  assert.equal((await project()).rooms.length, 3);
  pass('Review continues to the estimate with the three measured rooms');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log('Floor-plan browser checks passed.');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
