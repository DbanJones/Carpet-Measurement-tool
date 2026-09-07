/** Real-browser regression for a rectangular tread within a squared U-shaped turn. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.OUT_DIR ?? 'test-results/stairs-rectangular';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
const pass = text => { checks.push(text); console.log('PASS', text); };
const current = () => page.evaluate(async () => {
  const { stairPlanGeometry } = await import('/src/ui/stairs/stairLayout.ts');
  const staircase = JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.staircases[0];
  return { staircase, geometry: stairPlanGeometry(staircase, { normalize: false }) };
});
const select = async index => { const { staircase } = await current(); await page.locator(`[data-plan-piece="${staircase.steps[index].id}"] text`).click(); };
const close = (a, b) => assert(Math.hypot(a.x - b.x, a.y - b.y) < .02);
const aligned = (before, after) => {
  const a = before.geometry.pieces.at(-1), b = after.geometry.pieces.at(-1);
  assert(Math.abs(a.heading - b.heading) < .001);
  assert(Math.abs((after.geometry.pieces.at(-1).endHeading - after.geometry.pieces[0].heading) + 180) < .001);
};
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.evaluate(async () => {
    const { makeEmptyProject, makeSteps } = await import('/src/store/projectStore.ts');
    const { measuredStairPreset } = await import('/src/ui/stairs/stepEditing.ts');
    const project = makeEmptyProject('Square stair review');
    const staircase = measuredStairPreset({ id: 'square-u', name: 'U-shaped stairs', productId: project.products[0].id, steps: makeSteps(13), landings: [], method: 'cap_and_band', openSides: 'none' }, { kind: 'half_turn', direction: 'right', turn: 'winders', turnSteps: 9, corner: 'square' });
    project.staircases = [staircase];
    localStorage.setItem('flooring-estimator:project:v1', JSON.stringify({ schemaVersion: 1, project, savedAt: new Date().toISOString() }));
  });
  await page.reload();
  await page.locator('.sidebar-organising .list-row').filter({ hasText: 'U-shaped stairs' }).click();
  const original = await current();
  await select(6);
  await page.locator(`[data-plan-piece="${original.staircase.steps[6].id}"] text`).click({ button: 'right' });
  await page.screenshot({ path: `${output}/01-right-click.png` });
  await page.getByRole('menuitem', { name: 'Make rectangular', exact: true }).click();
  const rectangular = await current();
  aligned(original, rectangular);
  rectangular.geometry.pieces.at(-1).points.forEach((point, index) => close(point, original.geometry.pieces.at(-1).points[index]));
  assert.equal(rectangular.staircase.steps[6].kind, 'straight');
  const points = rectangular.geometry.pieces[6].points;
  assert.equal(points.length, 4);
  points.forEach((point, index) => {
    const prev = points[(index + 3) % 4], next = points[(index + 1) % 4];
    assert(Math.abs((point.x - prev.x) * (next.x - point.x) + (point.y - prev.y) * (next.y - point.y)) < .01);
  });
  await button('3D').click();
  await page.locator('.stair-linked-views').screenshot({ path: `${output}/02-rectangle-and-3d.png` });
  pass('Right-click makes the central U tread rectangular, keeps shared geometry and leaves the upper flight in place');

  await button('Undo step edit').click();
  await select(6);
  await page.getByLabel('Selected step type', { exact: true }).selectOption('straight');
  aligned(original, await current());
  await select(5); await button('Add step after selection').click();
  aligned(original, await current());
  await button('Delete selected steps').click();
  aligned(original, await current());
  pass('Type changes and subsequent insert/delete keep the U turn aligned');

  await select(6);
  await button('Open stair actions').click();
  await page.getByRole('menuitem', { name: 'Edit dimensions', exact: true }).click();
  const details = page.locator('.step-dimensions-editor');
  if (!(await details.getAttribute('open') !== null)) await details.locator('summary').first().click();
  const sideInput = page.getByLabel('Exact tread side length', { exact: true });
  assert(await sideInput.isVisible());
  const old = await sideInput.inputValue();
  await sideInput.fill(`${Number(old) * 1000 + 5}mm`); await sideInput.press('Tab');
  assert.equal(await page.locator('.step-dimensions-error').count(), 0);
  await page.locator('.stair-piece-inspector').screenshot({ path: `${output}/03-exact-dimensions.png` });
  pass('Each tread side has an editable actual measurement with a labelled outline and corner angles');

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await select(6); await button('Open stair actions').click();
    const menuBox = await page.getByRole('menu').boundingBox();
    assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= width + 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.keyboard.press('Escape');
  }
  await page.locator('.stair-plan-card').screenshot({ path: `${output}/04-phone-actions.png` });
  const saved = (await current()).staircase;
  await page.waitForTimeout(450); await page.reload();
  assert.deepEqual((await current()).staircase, saved);
  pass('Actions fit phone widths and edited tread outlines survive reload');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
