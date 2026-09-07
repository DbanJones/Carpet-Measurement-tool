import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const out = 'test-results/stair-step-editing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const current = async () => (await project()).staircases[0];
const commit = async (name, value) => { const input = page.getByLabel(name, { exact: true }); await input.fill(value); await input.press('Tab'); };
const tread = id => page.locator(`[data-plan-piece="${id}"]`);
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await button('+ Stairs').click();
  await page.locator('.stairs-editor').waitFor();
  const original = await current();
  // Start with a measured U: two flights around a flat half landing.
  await button('Start u-shaped drawing').click();
  assert.equal((await current()).landings.length, 0);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/01-u-preview.png` });
  await button('Use staircase shape').click();
  assert.equal((await current()).landings[0].kind, 'half');
  assert.deepEqual((await current()).steps, original.steps);
  await button('3D').click();
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/02-u-3d.png` });

  // Enter object editing and select four consecutive steps by clicking the plan.
  await button('Edit route').click();
  await tread(original.steps[0].id).click();
  assert.equal(await tread(original.steps[0].id).getAttribute('aria-pressed'), 'true');
  await page.keyboard.down('Shift');
  await tread(original.steps[3].id).click();
  await page.keyboard.up('Shift');
  assert.equal(await page.locator('[data-plan-piece][aria-pressed=true]').count(), 4);
  assert.equal(await page.locator('.stair-physical-target.selected').count(), 4);
  await commit('Selected group turn', '90');
  await button('Curve selected steps').click();
  let stairs = await current();
  assert(stairs.steps.slice(0, 4).every(step => step.kind === 'winder'));
  assert(stairs.steps.slice(0, 4).every(step => Math.abs(step.plan.turn + 22.5) < .2));
  await page.getByRole('button', { name: /^Individual steps and turns/ }).click();
  const section = await page.getByRole('button', { name: /^Individual steps and turns/ }).boundingBox();
  const views = await page.locator('.stair-linked-views').boundingBox();
  assert(section.y < views.y, 'Step details belong above the diagrams');
  assert.equal(await page.getByLabel('Step 1 kind', { exact: true }).inputValue(), 'winder');
  const beforeWidth = await tread(original.steps[0].id).locator('polygon').getAttribute('points');
  await commit('Step 1 width', '950mm');
  assert.notEqual(await tread(original.steps[0].id).locator('polygon').getAttribute('points'), beforeWidth);

  // Drag the four selected objects as a group. Their relative placement is preserved.
  await tread(original.steps[0].id).scrollIntoViewIfNeeded();
  const dragTarget = await tread(original.steps[0].id).locator('polygon').boundingBox();
  const beforeMove = await current();
  await page.mouse.move(dragTarget.x + dragTarget.width * .65, dragTarget.y + dragTarget.height * .6);
  await page.mouse.down();
  await page.mouse.move(dragTarget.x + dragTarget.width * .65 + 45, dragTarget.y + dragTarget.height * .6 - 25, { steps: 10 });
  await page.mouse.up();
  stairs = await current();
  const delta = { x: stairs.steps[0].plan.x - beforeMove.steps[0].plan.x, y: stairs.steps[0].plan.y - beforeMove.steps[0].plan.y };
  assert(Math.hypot(delta.x, delta.y) > 20, 'Dragging moves the actual step objects');
  for (let index = 1; index < 4; index++) {
    assert(Math.abs((stairs.steps[index].plan.x - beforeMove.steps[index].plan.x) - delta.x) < 2);
    assert(Math.abs((stairs.steps[index].plan.y - beforeMove.steps[index].plan.y) - delta.y) < 2);
  }
  assert.equal(stairs.steps[4].plan.x, beforeMove.steps[4].plan.x);
  assert.equal(stairs.steps[0].width, 950);
  await button('Undo step edit').click();
  assert.deepEqual((await current()).steps, beforeMove.steps);

  await button('Select step 3 in table').click();
  const selectedId = original.steps[2].id;
  assert.equal(await tread(selectedId).getAttribute('aria-pressed'), 'true');
  await button('Add step after selection').click();
  assert.equal((await current()).steps.length, 14);
  await button('Delete selected steps').click();
  assert.equal((await current()).steps.length, 13);
  await button('Undo step edit').click();
  assert.equal((await current()).steps.length, 14);
  await page.locator('.stairs-editor').screenshot({ path: `${out}/03-step-editor.png` });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    assert(size.scroll <= size.viewport + 1, `Step editor overflow at ${width}px`);
  }
  const saved = await current();
  await page.reload();
  assert.deepEqual((await current()).steps, saved.steps);
  assert.deepEqual(errors, []);
  console.log('PASS clean U preview, four-step selection/curve, linked table edits, real group drag, add/delete/undo, persistence and mobile layouts');
} finally { await browser.close(); }
