/** Connected top-down editing, measured starters and editable landing footprints in Chrome. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const out = 'test-results/stair-corners';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const current = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.staircases[0]);
const piece = id => page.locator(`[data-plan-piece="${id}"]`);
const polygon = id => piece(id).locator('polygon').getAttribute('points');
async function select(id) { await piece(id).focus(); await piece(id).press('Enter'); }
async function edit(label, value) { const input = page.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab'); }
async function dragCorner(label, dx, dy, cancel = false) {
  const handle = button(label); await handle.scrollIntoViewIfNeeded();
  const p = await handle.locator('.stair-corner-dot').evaluate(dot => {
    const point = new DOMPoint(Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))).matrixTransform(dot.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  const before = await current();
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 5 });
  assert.deepEqual(await current(), before, 'Corner gestures stage measurements until release');
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  if (cancel) assert.deepEqual(await current(), before, 'Escape cancels the corner edit');
  else assert.notDeepEqual(await current(), before, 'Dragging changes the measured footprint');
}
function shared(a,b) { const points = s => s.trim().split(/\s+/).map(p=>p.split(',').map(Number)); return points(a).filter(p=>points(b).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.02)).length; }
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await button('+ Stairs').click();
  const original = await current();
  await button('Start l-shaped drawing').click();
  assert.deepEqual(await current(), original, 'Starters preview before replacing existing work');
  await button('Use staircase shape').click();
  let stairs = await current();
  assert.equal(stairs.landings[0].kind, 'quarter');
  assert.equal(stairs.steps.length, original.steps.length);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/01-l-starter.png` });
  await select(stairs.steps[2].id);
  assert.equal(await page.locator('[data-stair-corner]').count(), 4);
  await dragCorner('Step 3 corner 3', 9, -6);
  assert.equal(shared(await polygon(stairs.steps[2].id), await polygon(stairs.steps[3].id)), 2, 'Both vertices on a shared tread edge remain connected');
  stairs = await current();
  assert(stairs.steps[2].outline && stairs.steps[3].outline, 'Both adjacent measurements retain their edited footprints');
  await dragCorner('Step 3 corner 3', 8, -4, true);
  await button('Step 3 corner 3').focus(); await button('Step 3 corner 3').press('ArrowRight');
  assert.equal(shared(await polygon(stairs.steps[2].id), await polygon(stairs.steps[3].id)), 2);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/02-shared-corners.png` });
  await select(stairs.landings[0].id);
  await page.getByLabel('Selected landing shape', { exact: true }).selectOption('l_shape');
  assert.equal(await page.locator('[data-stair-corner]').count(), 6, 'L-shaped landings expose every corner');
  await edit('Selected landing length', '1.4');
  await edit('Selected landing width', '1.1');
  const landing = (await current()).landings[0];
  assert.equal(landing.length, 1400); assert.equal(landing.width, 1100);
  await button('Landing corner 4').focus(); await button('Landing corner 4').press('ArrowUp');
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/03-shaped-landing.png` });
  await button('Start curved drawing').click();
  const round = await polygon(stairs.steps[5].id);
  await page.getByLabel('Preset outside corners', { exact: true }).selectOption('square');
  assert.notEqual(await polygon(stairs.steps[5].id), round, 'Square corners change the curved staircase footprint');
  await button('Use staircase shape').click();
  stairs = await current();
  assert(stairs.steps.some(step => step.kind === 'winder' && step.outline));
  await select(stairs.steps[5].id);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/04-square-turns.png` });
  const saved = await current();
  await page.reload();
  assert.deepEqual(await current(), saved, 'Stair outlines survive local save and reload');
  await page.locator(`[data-sidebar-item="${saved.id}"] .list-row`).click();
  await select(stairs.steps[5].id);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), `No page overflow at ${width}px`);
  }
  await page.locator('.stair-plan-card').screenshot({ path: `${out}/05-phone-corners.png` });
  assert.deepEqual(errors, []);
  console.log('PASS measured L starter, connected pointer/keyboard corner editing, Escape, landing dimensions/6-corner shape, square curved stairs, reload and responsive layouts');
} finally { await browser.close(); }
