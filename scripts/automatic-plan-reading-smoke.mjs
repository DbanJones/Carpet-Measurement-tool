/** Real local OCR: untouched names, live printed-dimension checks, and persistence. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.OUT_DIR ?? 'test-results/automatic-plan-reading';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const checks = [], errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) external.push(request.url()); });
const pass = message => { checks.push(message); console.log('PASS', message); };
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const button = name => page.getByRole('button', { name, exact: true });
async function position(x, y) {
  const overlay = page.getByTestId('floorplan-overlay');
  await overlay.scrollIntoViewIfNeeded();
  const box = await overlay.boundingBox();
  return { x: box.x + x / 960 * box.width, y: box.y + y / 700 * box.height };
}
async function tap(x, y) { const p = await position(x, y); await page.mouse.click(p.x, p.y); }
async function drag(x, y, xx, yy) {
  const start = await position(x, y), end = await position(xx, yy);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
}
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="700"><rect width="960" height="700" fill="white"/><rect x="80" y="80" width="400" height="300" fill="none" stroke="#111" stroke-width="8"/><g font-family="Arial" font-size="32" text-anchor="middle" fill="black"><text x="280" y="210">LOUNGE</text><text x="280" y="260">4 m x 3 m</text></g></svg>';
try {
  await page.goto(base);
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles({ name: 'clear-room.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(fixture) });
  await page.getByAltText('Floor plan: clear-room.svg').waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.floorPlans[0]?.reading?.source === 'ocr', null, { timeout: 65000 });
  const reading = (await project()).floorPlans[0].reading;
  assert.match(reading.text, /lounge/i);
  assert.match(reading.text, /4\s*m\s*[x×]\s*3\s*m/i);
  assert.equal((await project()).floorPlans[0].mmPerPx, undefined);
  assert(await page.getByText('Plan text ready', { exact: true }).isVisible());
  assert.equal(await button('Read image again').isVisible(), false, 'Advanced reading options start collapsed');
  pass('An uploaded image is read automatically with collapsed options and no automatic calibration');

  await tap(80, 80); await tap(480, 80);
  await page.getByLabel('Known distance', { exact: true }).fill('4m');
  await page.getByLabel('Known distance', { exact: true }).press('Enter');
  await button('Rectangle').click(); await tap(80, 80); await tap(480, 380);
  assert.equal(await page.getByLabel('Room name', { exact: true }).inputValue(), 'Lounge');
  const dimensionIndex = reading.lines.findIndex(line => /4\s*m\s*[x×]\s*3\s*m/i.test(line.text));
  assert(dimensionIndex >= 0, 'Real OCR has spatial evidence for the printed measurement');
  if (reading.lines[dimensionIndex].confidence < 70) await page.getByText('Approximate dimension check', { exact: true }).waitFor();
  await page.getByTestId('plan-reader').locator('summary').first().click();
  await page.getByText('Review or correct recognised text', { exact: true }).click();
  await page.getByLabel(`Correct plan line ${dimensionIndex + 1}`, { exact: true }).fill('4 m x 3 m');
  await page.getByText('Checked by you', { exact: true }).waitFor();
  await page.getByTestId('plan-reader').locator('summary').first().click();
  const reviewedReading = (await project()).floorPlans[0].reading;
  await page.getByText('Dimensions look consistent', { exact: true }).waitFor();
  await page.getByLabel('Room name', { exact: true }).fill('Client lounge');
  await button('Add room').click();
  await button('Select room').click(); await tap(200, 170);
  await page.getByText('Dimensions look consistent', { exact: true }).waitFor();
  pass('A spatial label fills an untouched draft and printed dimensions check both draft and saved outlines');

  await button('Edit room outline').click();
  await drag(480, 80, 600, 80); await drag(480, 380, 600, 380);
  await page.getByText('Check these dimensions', { exact: true }).waitFor();
  assert.match(await page.getByTestId('plan-dimension-check').innerText(), /30%/);
  await button('Save outline changes').click();
  assert.equal((await project()).rooms[0].name, 'Client lounge');
  await page.getByText('Check these dimensions', { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/dimension-difference-desktop.png`, fullPage: true });
  pass('Dragging corners updates dimension checks immediately while preserving a manually named room');
  await page.setViewportSize({ width: 390, height: 1000 });
  await button('Fit plan').click();
  const sizes = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert(sizes[0] <= sizes[1] + 1, `Mobile overflow: ${sizes}`);
  await page.screenshot({ path: `${output}/dimension-difference-phone.png`, fullPage: true });
  await page.reload();
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  assert.equal((await project()).rooms[0].name, 'Client lounge');
  assert.deepEqual((await project()).floorPlans[0].reading, reviewedReading);
  pass('Reading, edited geometry and custom names survive reload; the workspace fits a phone');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, external, reading }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message, project: await project() }, null, 2));
  throw error;
} finally { await browser.close(); }
