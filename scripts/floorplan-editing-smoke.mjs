/** Floor plan editing, doorway assumptions and stair footprint checks against a running app. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const output = 'test-results/floorplan-editing';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = []; const checks = [];
page.on('pageerror', error => errors.push(error.message));
const task = () => page.getByRole('complementary', { name: 'Current floor plan task' });
const button = name => page.getByRole('button', { name, exact: true });
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const pass = message => { checks.push(message); console.log('PASS', message); };
async function tap(x, y) {
  const box = await page.getByTestId('floorplan-overlay').boundingBox();
  await page.mouse.click(box.x + x / 960 * box.width, box.y + y / 700 * box.height);
}
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles('scripts/fixtures/estate-plan.svg');
  await page.getByAltText('Floor plan: estate-plan.svg').waitFor();
  await tap(86, 90); await tap(434, 90);
  await task().getByLabel('Known distance').fill('4.35');
  await task().getByLabel('Known distance').press('Enter');
  await tap(135, 240); await page.getByTestId('mode-review-outline').waitFor();
  const opening = task().getByRole('checkbox', { name: /Opening 1/ });
  assert(await opening.isVisible(), 'Door gap should produce a reviewable doorway');
  assert(!(await opening.isChecked()));
  await opening.check();
  await task().getByLabel('Room name', { exact: true }).fill('Lounge');
  await button('Add room').click();
  assert.equal((await project()).rooms[0].doorways.length, 1);
  pass('Real detection worker suggests a doorway which is added only after review');
  await tap(135, 240); await button('Edit room outline').click();
  await task().getByLabel('Selected corner').selectOption('0');
  await button('Add corner after').click();
  assert.equal(await task().getByLabel('Selected corner').inputValue(), '1');
  await button('Delete selected corner').click();
  await button('Save outline changes').click();
  assert.equal((await project()).rooms.length, 1);
  assert.equal((await project()).rooms[0].doorways.length, 1);
  assert.equal((await project()).rooms[0].source.pixelPolygon.length, 4);
  pass('Saved outlines support selected-point insertion/deletion and preserve matching doorways');
  await button('Rectangle').click(); await tap(40, 40); await tap(200, 180);
  assert(await button('Add room').isDisabled());
  assert.match(await task().getByRole('alert').innerText(), /overlaps.*Lounge/);
  await page.screenshot({ path: `${output}/overlap-desktop.png` });
  await button('Discard outline').click();
  await tap(434, 86); await tap(794, 334);
  assert(!(await button('Add room').isDisabled()));
  await task().getByLabel('Room name', { exact: true }).fill('Adjacent room');
  await button('Add room').click();
  assert.equal((await project()).rooms.length, 2);
  pass('Overlap is blocked; a neighbouring room sharing the boundary is accepted');
  await button('Draw stairs').click(); await tap(105, 365); await tap(190, 520);
  await task().getByLabel('Staircase name', { exact: true }).fill('First floor stairs');
  await button('Add staircase').click();
  const stair = (await project()).staircases[0];
  assert(await page.getByTestId(`stairs-overlay-${stair.id}`).isVisible());
  assert.equal((await project()).rooms.length, 2);
  await page.screenshot({ path: `${output}/stairs-desktop.png` });
  pass('Stairs have a separate footprint, tread overlay and dimensions action');
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await button('Fit plan').click();
    const size = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(size[0] <= size[1] + 1, `Horizontal overflow at ${width}: ${size}`);
    if (width === 390) await page.screenshot({ path: `${output}/stairs-mobile.png`, fullPage: true });
  }
  await button('Stair dimensions & turns').click();
  assert.equal(await page.locator('nav.tabs').getByRole('button', { name: /Rooms/ }).getAttribute('aria-current'), 'page');
  pass('Responsive plan workspace opens the selected staircase details');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
