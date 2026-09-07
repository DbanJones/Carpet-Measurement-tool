/** Actual OCR + detect-all worker -> included/excluded door suggestions -> saved doorways. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.OUT_DIR ?? 'test-results/doorway-batch';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
await page.addInitScript(() => {
  window.doorWorkerReplies = [];
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, options) {
      super(url, options);
      if (String(url).includes('detection.worker')) this.addEventListener('message', event => { if (event.data.kind !== 'progress') window.doorWorkerReplies.push(event.data); });
    }
  };
});
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const pass = message => { checks.push(message); console.log('PASS', message); };
const button = name => page.getByRole('button', { name, exact: true });
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const overlay = () => page.getByTestId('floorplan-overlay');
async function point(x, y) {
  await overlay().scrollIntoViewIfNeeded();
  const at = await overlay().evaluate((svg, p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; }, { x, y });
  await page.mouse.click(at.x, at.y);
}
try {
  await page.goto(base);
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles('scripts/fixtures/estate-plan.svg');
  await page.getByTestId('mode-scale').waitFor();
  await point(86, 86); await point(434, 86);
  await page.getByLabel('Known distance', { exact: true }).fill('4.35m');
  await button('Set scale & continue').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.floorPlans[0]?.reading?.source === 'ocr', null, { timeout: 65000 });
  await button('Detect all rooms').click(); await page.getByTestId('mode-detected-rooms').waitFor();
  const reply = await page.evaluate(() => window.doorWorkerReplies.find(reply => reply.ok && reply.candidates));
  assert(reply, 'Actual detect-all worker must return the room candidates');
  assert.equal(reply.candidates.length, 3);
  assert(reply.candidates.flatMap(room => room.detectedDoorways ?? []).length >= 3, 'Drawn swing symbols must generate evidenced doorways');
  assert.equal((await project()).rooms.length, 0, 'Room and doorway suggestions are reviewed before saving');

  const expected = [];
  for (let index = 0; index < 3; index++) {
    await page.locator('.fp-suggestion-list li > button').nth(index).click();
    const name = await page.getByLabel('Detected room name', { exact: true }).inputValue();
    const group = page.getByRole('group', { name: `Detected doorways in ${name}`, exact: true });
    const doors = group.getByRole('checkbox');
    const count = await doors.count();
    assert(count > 0, `The real drawing supplies a doorway in ${name}`);
    for (let doorIndex = 0; doorIndex < count; doorIndex++) assert(await doors.nth(doorIndex).isChecked(), 'Evidenced doors are included by default');
    expected.push({ name, count });
  }
  pass('Actual worker detects door symbols in all three rooms; measured suggestions are included by default');

  // Exclude the standalone kitchen opening, retaining both sides of the shared Lounge/Bedroom door.
  const excludedIndex = reply.candidates.findIndex(room => Math.min(...(room.measurementPolygon ?? room.polygon).map(point => point.x)) > 440);
  assert(excludedIndex >= 0, 'The fixture contains the separate full-height room');
  await page.locator('.fp-suggestion-list li > button').nth(excludedIndex).click();
  const excludedName = expected[excludedIndex].name;
  await page.getByRole('checkbox', { name: `Include doorway D1 in ${excludedName}`, exact: true }).uncheck();
  expected[excludedIndex].count--;
  const overlayStates = await page.getByTestId('detected-doorway-overlay').evaluateAll(nodes => nodes.map(node => ({ room: node.getAttribute('data-room-name'), index: node.getAttribute('data-door-index'), included: node.getAttribute('data-included') })));
  assert(overlayStates.some(state => state.room === excludedName && state.index === '0' && state.included === 'false'), 'Unticking a doorway changes its linked drawing overlay');
  await page.locator('.fp-workspace').screenshot({ path: `${output}/doorway-review-desktop.png` });
  await page.setViewportSize({ width: 390, height: 1050 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Doorway review fits a phone');
  await page.locator('.fp-inspector').screenshot({ path: `${output}/doorway-review-phone.png` });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await button('Add 3 selected rooms').click();
  const saved = (await project()).rooms;
  assert.equal(saved.length, 3);
  for (const item of expected) {
    const room = saved.find(room => room.name === item.name);
    assert(room); assert.equal(room.doorways.length, item.count, `${item.name}: only included, measured doors are saved`);
    for (const door of room.doorways) {
      const a = room.shape.points[door.edgeIndex], b = room.shape.points[(door.edgeIndex + 1) % room.shape.points.length];
      assert(door.width >= 400 && door.width <= 1500, 'Saved door width comes from the scaled opening');
      assert(door.offset >= 0 && door.offset + door.width <= Math.hypot(b.x - a.x, b.y - a.y) + 1, 'Saved door fits the correct room wall');
    }
  }
  const allDoors = saved.flatMap(room => room.doorways);
  const openingIds = new Set(allDoors.map(door => door.sharedOpeningId ?? door.id));
  assert.equal(allDoors.length, 2, 'Both rooms retain their side of the shared doorway');
  assert.equal(openingIds.size, 1, 'Opposite sides of one physical opening are linked for purchasing');
  pass('Excluded doors stay out; included doors are saved at the measured width and correct wall position');
  await page.locator('nav.tabs').getByRole('button', { name: 'Estimate', exact: true }).click();
  await page.getByRole('navigation', { name: 'Estimate sections', exact: true }).getByRole('button', { name: 'Order list & costs', exact: true }).click();
  const barQuantity = await page.getByTestId('bom-table').locator('tr[data-category="door_bars"]').evaluateAll(rows => rows.reduce((sum, row) => sum + Number.parseFloat(row.cells[1].textContent), 0));
  assert.equal(barQuantity, 1, 'The order list buys one door bar for the shared physical opening');
  pass('The estimate counts one physical door bar across both room entries');
  await page.reload();
  assert.deepEqual((await project()).rooms, saved, 'Included and excluded doorway choices persist after reload');
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  const removable = saved.find(room => room.doorways.length > 0);
  await page.getByRole('list', { name: 'Rooms on this plan', exact: true }).getByRole('button', { name: new RegExp(`^${removable.name}`) }).click();
  await button(`Remove opening 1 from ${removable.name}`).click();
  assert.equal((await project()).rooms.find(room => room.id === removable.id).doorways.length, removable.doorways.length - 1);
  await page.reload();
  assert.equal((await project()).rooms.find(room => room.id === removable.id).doorways.length, removable.doorways.length - 1);
  pass('Saved doorway removal and all room/door measurements survive reload');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, expected, rawWorkerResult: reply, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message, worker: await page.evaluate(() => window.doorWorkerReplies) }, null, 2));
  throw error;
} finally { await browser.close(); }
