/** Verify scale guidance, persistent references and zoom accuracy in the real floor-plan workspace. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = 'test-results/floorplan-scale';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const checks = [];
const pass = (message) => { checks.push(message); console.log('PASS', message); };
const inspector = () => page.getByRole('complementary', { name: 'Current floor plan task' });
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
async function tap(x, y) {
  const box = await page.getByTestId('floorplan-overlay').boundingBox();
  await page.mouse.click(box.x + x / 960 * box.width, box.y + y / 700 * box.height);
}
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles('scripts/fixtures/estate-plan.svg');
  await page.getByAltText('Floor plan: estate-plan.svg').waitFor();
  await page.getByTestId('scale-canvas-instruction').waitFor();
  await page.getByRole('button', { name: 'Set scale manually', exact: true }).click();
  assert.match(await page.getByTestId('scale-canvas-instruction').innerText(), /first end/);
  assert.match(await page.getByTestId('physical-scale-ruler').innerText(), /Scale not set/);
  await page.screenshot({ path: `${output}/01-setting-scale.png`, fullPage: true });
  await tap(86, 90);
  assert.match(await page.getByTestId('scale-canvas-instruction').innerText(), /other end/);
  await tap(434, 90);
  const distance = inspector().getByLabel('Known distance', { exact: true });
  await distance.fill('4.35');
  assert.match(await page.getByTestId('draft-scale-reference').textContent(), /4.35 m · Not saved/);
  await page.screenshot({ path: `${output}/02-distance-preview.png`, fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'Fit plan', exact: true }).click();
    const notice = await page.getByTestId('scale-canvas-instruction').boundingBox();
    const planImage = await page.getByTestId('floorplan-overlay').boundingBox();
    assert(notice.y + notice.height <= planImage.y + 1, 'Scale instructions must not obscure the plan or its reference');
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(scroll <= client + 1, `${width}px calibration page overflows`);
    if (width === 390) await page.screenshot({ path: `${output}/02-distance-preview-mobile.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Fit plan', exact: true }).click();
  await distance.press('Enter');
  await page.getByTestId('confirmed-scale-reference').waitFor();
  assert.match(await page.getByTestId('confirmed-scale-reference').textContent(), /4.35 m · Scale set/);
  assert.equal(await page.getByTestId('scale-canvas-instruction').count(), 0);
  const data = await project();
  assert(Math.abs(data.floorPlans[0].mmPerPx - 12.5) < .01);
  pass('Canvas explains each calibration step, previews the entered length and retains the saved reference');
  await page.getByRole('button', { name: 'Draw outline', exact: true }).click();
  const displayRadius = () => page.locator('.fp-reference-point circle').first().evaluate((circle) => Number(circle.getAttribute('r')) * circle.getScreenCTM().a);
  const originalRadius = await displayRadius();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert(Math.abs(await displayRadius() - originalRadius) < .1);
  const ruler = await page.locator('.fp-ruler-line').evaluate((el) => ({ width: el.getBoundingClientRect().width, text: el.nextElementSibling.textContent }));
  const svg = await page.getByTestId('floorplan-overlay').boundingBox();
  const mm = Number.parseFloat(ruler.text) * 1000;
  assert(Math.abs(ruler.width / (svg.width / 960) * data.floorPlans[0].mmPerPx - mm) < 20);
  pass('Saved endpoint sizes stay stable and the real-world ruler remains accurate after zooming');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('button', { name: 'Fit plan', exact: true }).click();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(scroll <= client + 1, `${width}px: page overflows`);
    assert(await page.getByTestId('confirmed-scale-reference').isVisible());
    if (width === 1440 || width === 390) await page.screenshot({ path: `${output}/03-confirmed-${width}.png`, fullPage: true });
  }
  pass('Saved scale and reference stay visible without horizontal page overflow at 320–1440px');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
