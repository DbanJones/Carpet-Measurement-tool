/** Real-browser acceptance of drawing and inspecting a staircase. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = 'test-results/stairs-drawing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const current = async () => (await project()).staircases[0];
const button = name => page.getByRole('button', { name, exact: true });
const commitInput = async (label, value) => { const input = page.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab'); };
const canvas = page.getByTestId('stair-drawing-canvas');
async function clickCanvas(x, y) {
  await canvas.scrollIntoViewIfNeeded();
  const position = await canvas.evaluate((svg, point) => { const p = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; }, { x, y });
  await page.mouse.click(position.x, position.y);
}
try {
  await page.goto(url);
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await button('+ Stairs').click();
  await page.locator('.stairs-editor').waitFor();
  const original = await current();
  assert.equal(await page.locator('.stairs-editor input, .stairs-editor select').count(), 6);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/01-straight.png` });

  await button('Draw your own').click();
  // Four route points make a return around two corners.
  for (const [x, y] of [[215, 295], [215, 135], [385, 135], [385, 295]]) await clickCanvas(x, y);
  assert.equal(await page.locator('[data-route-node]').count(), 4);
  await button('Finish drawing').click();
  const drawn = await current();
  assert.equal(drawn.drawing.points.length, 4);
  assert.deepEqual(drawn.steps, original.steps, 'Drawing must preserve measured treads and cuts');
  assert.deepEqual(drawn.landings, original.landings);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/02-returning-side.png` });
  await button('3D').click();
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/03-returning-3d.png` });

  await button('Edit route').click();
  await page.getByText('Walking line and placement tools', { exact: true }).click();
  await button('Edit walking line').click();
  const handle = page.locator('[data-route-node="1"] .stair-node-dot');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 22, box.y + box.height / 2 - 16, { steps: 8 });
  await page.mouse.up();
  await button('Curved turn').click();
  await button('Use drawing').click();
  const adjusted = await current();
  assert(adjusted.drawing.points[1].curve);
  assert.notDeepEqual(adjusted.drawing.points, drawn.drawing.points);
  assert.deepEqual(adjusted.steps, original.steps);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/04-rounded-corner.png` });

  // Keyboard selection works across both diagrams, including dimensions.
  const selected = page.locator(`[data-plan-piece="${original.steps[3].id}"]`);
  await selected.focus(); await selected.press('Enter');
  assert.equal(await selected.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.stair-physical-target.selected').count(), 1);
  await commitInput('Selected step rise', '180mm');
  assert.equal((await current()).steps[3].rise, 180);
  assert.equal((await current()).steps[2].rise, original.steps[2].rise);
  await page.getByLabel('Selected step type', { exact: true }).selectOption('winder');
  await commitInput('Selected step going', '460mm');
  await commitInput('Selected step narrow depth', '100mm');
  await button('Add a flat landing after this step').click();
  assert.equal((await current()).landings[0].kind, 'quarter');
  assert.equal((await current()).landings[0].afterStepIndex, 3);
  await button('Close selection').click();

  // Draft survives leaving the workspace; cancel cannot change the saved drawing.
  await button('Edit route').click();
  await page.getByText('Walking line and placement tools', { exact: true }).click();
  await button('Edit walking line').click();
  await page.locator('[data-route-node="1"]').focus();
  await canvas.press('ArrowLeft');
  await page.locator('nav.tabs').getByRole('button', { name: 'Materials & options', exact: true }).click();
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  assert(await button('Cancel drawing').isVisible());
  await button('Cancel drawing').click();
  assert.deepEqual((await current()).drawing, adjusted.drawing);

  await button('Duplicate staircase').click();
  let stairs = (await project()).staircases;
  assert.deepEqual(stairs[1].drawing, stairs[0].drawing);
  assert.notEqual(stairs[1].steps[0].id, stairs[0].steps[0].id);
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    assert(await canvas.isVisible());
    assert(await page.locator('.stair-physical-view').isVisible());
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    assert(size.scroll <= size.viewport + 1, `Stair drawing overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 1080 });
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/05-phone.png` });
  await page.reload();
  stairs = (await project()).staircases;
  assert.deepEqual(stairs[1].drawing, adjusted.drawing);
  assert.equal(stairs[1].landings[0].kind, 'quarter');
  assert.deepEqual(errors, []);
  console.log('PASS custom return drawing, pointer dragging, rounded corners, linked selection, individual measurements, landings, draft navigation, duplication, reload and 1440/1024/768/390/320px layouts');
} finally { await browser.close(); }
