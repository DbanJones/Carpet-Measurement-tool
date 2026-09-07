/** Browser acceptance: imported corner correction, linked details and floor-plan row actions. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = 'test-results/room-angle-sidebar';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const cornerAngle = (points, index) => {
  const a = points[(index - 1 + points.length) % points.length], b = points[index], c = points[(index + 1) % points.length];
  const area = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0);
  return 180 - Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) * Math.sign(area) * 180 / Math.PI;
};

try {
  await page.goto(url);
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await button('+ Room').click(); await button('+ Stairs').click();
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('flooring-estimator:project:v1'));
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 500;
    const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 600, 500);
    const imageDataUrl = canvas.toDataURL();
    saved.project.floorPlans = [
      { id: 'survey', name: 'Ground floor survey', imageDataUrl, widthPx: 600, heightPx: 500, mmPerPx: 10 },
      { id: 'upstairs', name: 'Upper floor survey', imageDataUrl, widthPx: 600, heightPx: 500, mmPerPx: 10 },
    ];
    const points = [{ x: 0, y: 0 }, { x: 4200, y: 120 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
    const source = { floorPlanId: 'survey', pixelPolygon: points.map(p => ({ x: 40 + p.x / 10, y: 50 + p.y / 10 })) };
    Object.assign(saved.project.rooms[0], { name: 'Survey lounge', shape: { kind: 'polygon', points }, source, doorways: [] });
    saved.project.staircases[0].source = structuredClone(source);
    localStorage.setItem('flooring-estimator:project:v1', JSON.stringify(saved));
  });
  await page.reload();
  await page.locator('.sidebar-column .list-row').filter({ hasText: 'Survey lounge' }).click();
  const original = (await project()).rooms[0];
  await button('Edit corner 2').focus(); await page.keyboard.press('Enter');
  await button('Make right angle · 90°').click();
  const squared = (await project()).rooms[0];
  assert(Math.abs(cornerAngle(squared.shape.points, 1) - 90) < .000001);
  assert.deepEqual(squared.shape.points.filter((_, i) => i !== 1), original.shape.points.filter((_, i) => i !== 1));
  assert.equal(await page.locator('.room-angle-marker text').textContent(), '90°');
  assert.equal(await page.getByLabel('Selected corner angle', { exact: true }).inputValue(), '90.0');
  assert.equal(squared.source, undefined);
  await page.locator('.room-plan-card').screenshot({ path: `${out}/01-square-corner.png` });
  await page.getByLabel('Selected corner angle', { exact: true }).fill('105');
  await page.getByLabel('Selected corner angle', { exact: true }).press('Enter');
  assert(Math.abs(cornerAngle((await project()).rooms[0].shape.points, 1) - 105) < .000001);
  await page.getByLabel('Selected corner angle', { exact: true }).fill('180'); await button('Apply angle').click();
  assert.match(await page.locator('.room-edit-status').textContent(), /Delete corner/);
  assert(Math.abs(cornerAngle((await project()).rooms[0].shape.points, 1) - 105) < .000001);
  await button('Undo shape edit').click(); await button('Undo shape edit').click();
  assert.deepEqual((await project()).rooms[0].shape, original.shape);
  assert.deepEqual((await project()).rooms[0].source, original.source);

  await button('Floor plan 1 actions').click();
  assert.equal(await button('Floor plan 1 actions').locator('svg circle').count(), 3);
  const menu = page.getByRole('group', { name: 'Actions for Ground floor survey', exact: true });
  await menu.screenshot({ path: `${out}/02-floor-plan-actions.png` });
  await button('Rename floor plan').click();
  await page.getByLabel('Floor plan name', { exact: true }).fill('Ground floor measured');
  await button('Save name').click();
  assert.equal((await project()).floorPlans[0].name, 'Ground floor measured');
  assert.equal((await project()).floorPlans[0].mmPerPx, 10);
  await button('Reorder floor plan 2').focus(); await page.keyboard.press('ArrowUp');
  assert.deepEqual((await project()).floorPlans.map(plan => plan.id), ['upstairs', 'survey']);

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await button('Edit corner 2').focus(); await page.keyboard.press('Enter');
    await page.locator('.room-plan-card').scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}px room overflow`);
    if (width === 390) await page.locator('.room-plan-card').screenshot({ path: `${out}/03-phone-angle.png` });
    await button('Floor plan 2 actions').click();
    const bounds = await page.getByRole('group', { name: 'Actions for Ground floor measured', exact: true }).boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${width}px menu outside viewport`);
    await button('Floor plan 2 actions').press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await button('Floor plan 2 actions').click(); await button('Delete floor plan').click();
  assert.match(await page.locator('.sidebar-removal-note').textContent(), /Rooms, stairs and their measurements stay/);
  await button('Cancel').click(); assert.equal((await project()).floorPlans.length, 2);
  await button('Floor plan 2 actions').click(); await button('Delete floor plan').click(); await button('Confirm deletion').click();
  const after = await project();
  assert.equal(after.floorPlans.length, 1); assert.equal(after.rooms.length, 1); assert.equal(after.staircases.length, 1);
  assert.deepEqual(after.rooms[0].shape, original.shape); assert.equal(after.rooms[0].source, undefined); assert.equal(after.staircases[0].source, undefined);
  await page.reload(); assert.equal((await project()).floorPlans[0].id, 'upstairs');
  assert.deepEqual(errors, []);
  console.log('PASS room angles and sidebar: exact right/custom angles, other corners fixed, invalid input, undo/source recovery, SVG actions, floor-plan rename/order/delete, retained spaces and 320–1440px layouts.');
} finally { await browser.close(); }
