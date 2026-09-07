/** Browser acceptance for the room overview's linked measurement / plan editor. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = 'test-results/room-editing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const current = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.rooms[0]);
const commit = async (label, value) => { await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).press('Tab'); };
const plan = page.locator('.room-editable-plan');
async function dragCorner(index, dx, dy, cancel = false) {
  await plan.scrollIntoViewIfNeeded();
  const points = await plan.evaluate((svg, { index, dx, dy }) => {
    const circle = svg.querySelector(`[data-room-corner="${index}"] .room-corner-dot`);
    const x = +circle.getAttribute('cx'), y = +circle.getAttribute('cy');
    const from = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    const to = new DOMPoint(x + dx, y + dy).matrixTransform(svg.getScreenCTM());
    return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
  }, { index, dx, dy });
  await page.mouse.move(points.from.x, points.from.y); await page.mouse.down();
  await page.mouse.move(points.to.x, points.to.y, { steps: 8 });
  const live = await current();
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  return live;
}
try {
  await page.goto(url);
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await button('+ Room').click();
  await page.locator('.room-editor').waitFor();
  await commit('Room name', 'Drawing room');
  await page.locator('.room-editor').screenshot({ path: `${out}/01-overview.png` });
  const original = await current();
  assert.deepEqual(original.shape, { kind: 'rectangle', length: 4000, width: 3000 });

  const live = await dragCorner(2, 500, 300);
  assert.deepEqual(live.shape, { kind: 'rectangle', length: 4500, width: 3300 }, 'Store and figures should update during the drag');
  assert.equal(await page.getByLabel('Room length', { exact: true }).inputValue(), '4.5');
  assert.equal(await page.getByLabel('Room width', { exact: true }).inputValue(), '3.3');
  assert.equal(await page.getByTestId('figure-area').textContent(), '14.85 m²');
  assert.deepEqual((await current()).doorways, original.doorways);
  await button('Undo shape edit').click();
  assert.deepEqual((await current()).shape, original.shape, 'One undo should revert the entire drag');
  await dragCorner(0, -400, 200, true);
  assert.deepEqual((await current()).shape, original.shape, 'Escape should cancel a live drag');
  await page.waitForFunction(() => document.querySelector('[aria-label="Room length"]').value === '4' && document.querySelector('[aria-label="Room width"]').value === '3');

  await commit('Room length', '5.123');
  assert.equal((await current()).shape.length, 5123);
  assert((await plan.locator('polygon.room').getAttribute('points')).includes('5123,3000'));
  await button('Edit wall 2').focus(); await page.keyboard.press('Enter');
  await commit('Selected wall length', '3.5');
  assert.equal((await current()).shape.width, 3500);
  await page.waitForFunction(() => document.querySelector('[aria-label="Room width"]').value === '3.5');
  assert.equal(await page.getByLabel('Room width', { exact: true }).inputValue(), '3.5');
  await button('Add corner to this wall').click();
  assert.equal((await current()).shape.kind, 'polygon');
  assert.equal((await current()).shape.points.length, 5);
  await dragCorner(2, 200, 0);
  assert.equal(await page.getByLabel('Point 3 x', { exact: true }).inputValue(), '5.473');
  await page.locator('.room-design-grid').screenshot({ path: `${out}/02-corner-edit.png` });
  await button('Delete corner').click();
  assert.equal((await current()).shape.points.length, 4);
  await button('Undo shape edit').click();
  assert.equal((await current()).shape.points.length, 5);

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(() => scrollTo(0, 0));
    const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert(size.content <= size.width + 1, `${width}px room page overflow: ${size.content}`);
    if (width === 390) await page.locator('.room-editor').screenshot({ path: `${out}/03-phone.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  const saved = (await current()).shape;
  await page.reload();
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await page.locator('.sidebar-column .list-row').filter({ hasText: 'Drawing room' }).click();
  assert.deepEqual((await current()).shape, saved);
  assert.equal(await page.locator('[data-room-corner]').count(), 5);
  assert.deepEqual(errors, []);
  console.log('PASS room diagram: live corner resizing, dimensions roundtrip, undo/cancel, individual corners, saved outline, responsive widths 320–1440.');
} finally { await browser.close(); }
