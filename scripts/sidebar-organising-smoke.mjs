/** Actual pointer and touch reordering, persistence and sidebar deletion journeys. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = 'test-results/sidebar-organising';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const project = (target = page) => target.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const ids = async (key, target = page) => (await project(target))[key].map(item => item.id);
const row = id => page.locator(`[data-sidebar-item="${id}"]`);
const button = name => page.getByRole('button', { name, exact: true });
async function pointerDrag(sourceId, targetId, after = true, cancel = false) {
  const handle = row(sourceId).locator('.sidebar-drag-handle');
  await handle.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const target = await row(targetId).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, target.y + (after ? target.height - 5 : 5), { steps: 10 });
  if (cancel) await page.keyboard.press('Escape');
  else assert.equal(await page.locator('.sidebar-drop-before, .sidebar-drop-after').count(), 1);
  await page.mouse.up();
}
async function confirmRemove(id, kind) {
  await row(id).locator('.sidebar-actions-toggle').click();
  await row(id).getByRole('button', { name: `Delete ${kind}`, exact: true }).click();
  await row(id).getByRole('button', { name: 'Confirm deletion', exact: true }).click();
}

try {
  await page.goto(url);
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  for (let index = 0; index < 3; index++) await button('+ Room').click();
  for (let index = 0; index < 2; index++) await button('+ Stairs').click();
  for (let index = 0; index < 2; index++) {
    await button('+ Product').click();
    await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  }
  const original = await project();
  const rooms = original.rooms.map(item => item.id);
  const stairs = original.staircases.map(item => item.id);
  const products = original.products.map(item => item.id);
  await row(rooms[0]).locator('.list-row').click();
  await pointerDrag(rooms[0], rooms[2]);
  assert.deepEqual(await ids('rooms'), [rooms[1], rooms[2], rooms[0]]);
  assert.equal(await row(rooms[0]).locator('.list-row').getAttribute('aria-current'), 'true');
  await pointerDrag(stairs[1], stairs[0], false);
  assert.deepEqual(await ids('staircases'), [stairs[1], stairs[0]]);
  await pointerDrag(products[0], products[2]);
  assert.deepEqual(await ids('products'), [products[1], products[2], products[0]]);
  await pointerDrag(rooms[0], rooms[1], false, true);
  assert.deepEqual(await ids('rooms'), [rooms[1], rooms[2], rooms[0]], 'Escape cancels the pending drag');
  const keyboardHandle = row(rooms[0]).locator('.sidebar-drag-handle');
  await keyboardHandle.focus(); await keyboardHandle.press('ArrowUp'); await keyboardHandle.press('ArrowUp');
  assert.deepEqual(await ids('rooms'), rooms);
  assert.equal(await keyboardHandle.evaluate(node => node === document.activeElement), true);
  await page.locator('.sidebar-column').screenshot({ path: `${out}/01-organised-desktop.png` });

  await page.reload();
  await page.locator('.sidebar-organising').waitFor();
  assert.deepEqual(await ids('rooms'), rooms);
  assert.deepEqual(await ids('staircases'), [stairs[1], stairs[0]]);
  assert.deepEqual(await ids('products'), [products[1], products[2], products[0]]);

  await row(products[0]).locator('.list-row').click();
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await row(products[0]).locator('.sidebar-actions-toggle').click();
  await row(products[0]).getByRole('button', { name: 'Delete product', exact: true }).click();
  assert.match(await row(products[0]).locator('.sidebar-removal-note').innerText(), /5 spaces will switch to New carpet/);
  await page.locator('.sidebar-column').screenshot({ path: `${out}/02-product-confirmation.png` });
  await row(products[0]).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await ids('products')).length, 3);
  await confirmRemove(products[0], 'product');
  const reassigned = await project();
  assert(reassigned.rooms.every(room => room.productId === products[1]));
  assert(reassigned.staircases.every(staircase => staircase.productId === products[1]));
  await row(stairs[1]).locator('.list-row').click();
  await confirmRemove(stairs[1], 'staircase');
  assert.deepEqual(await ids('staircases'), [stairs[0]]);
  await row(rooms[2]).locator('.list-row').click();
  await confirmRemove(rooms[2], 'room');
  assert.deepEqual(await ids('rooms'), rooms.slice(0, 2));

  const saved = await page.evaluate(() => localStorage.getItem('flooring-estimator:project:v1'));
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.addInitScript(value => localStorage.setItem('flooring-estimator:project:v1', value), saved);
  await mobile.goto(url); await mobile.locator('.sidebar-organising').waitFor();
  const touchHandle = mobile.locator(`[data-sidebar-item="${rooms[0]}"] .sidebar-drag-handle`);
  await touchHandle.scrollIntoViewIfNeeded();
  const touchFrom = await touchHandle.boundingBox();
  const touchTarget = await mobile.locator(`[data-sidebar-item="${rooms[1]}"]`).boundingBox();
  const cdp = await mobileContext.newCDPSession(mobile);
  const x = touchFrom.x + touchFrom.width / 2;
  const y = touchFrom.y + touchFrom.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let index = 1; index <= 10; index++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (touchTarget.y + touchTarget.height - 5 - y) * index / 10 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(await ids('rooms', mobile), [rooms[1], rooms[0]], 'Touch dragging reorders and saves rooms');
  assert.equal(await mobile.locator('.sidebar-column').evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await mobile.locator('.sidebar-column').screenshot({ path: `${out}/03-organised-mobile.png` });
  await mobileContext.close();
  assert.deepEqual(errors, []);
  console.log('Sidebar organising smoke passed: mouse/touch drag, keyboard, selection, reload, all deletions, product reassignment and mobile layout.');
} finally {
  await browser.close();
}
