/** Real browser acceptance: eight winders through 180°, contextual plan edits and linked physical views. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.OUT_DIR ?? 'test-results/stairs-simple';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce' });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
const current = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.staircases[0]);
const commit = async (name, value) => { const input = page.getByLabel(name, { exact: true }); await input.fill(value); await input.press('Tab'); };
const pass = message => { checks.push(message); console.log('PASS', message); };
const selectStep = async index => { const step = (await current()).steps[index]; await page.locator(`[data-plan-piece="${step.id}"] text`).click(); return step; };
const sweep = stairs => Math.abs(stairs.steps.reduce((sum, step) => sum + (step.plan?.turn ?? 0), 0));
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await button('+ Stairs').click();
  const original = await current();
  await button('Guide me through stairs').click();
  await commit('Guide riser count', '8'); await button(/U-shaped Half turn/).click();
  await page.locator('.stair-setup').screenshot({ path: `${output}/01-count-and-rotation.png` });
  await button('Continue').click();
  assert.equal(await page.getByLabel('Guide turning steps', { exact: true }).inputValue(), '8');
  assert.equal(await page.locator('.setup-stair-preview .preview-landing').count(), 0);
  assert.equal((await current()).steps.length, original.steps.length, 'Guide preview does not replace saved measurements');
  await button(/A curved outer edge/).click();
  await page.locator('.stair-setup').screenshot({ path: `${output}/02-eight-winders-no-landing.png` });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Guide fits ${width}px`);
  }
  await page.locator('.stair-setup').screenshot({ path: `${output}/03-guide-phone.png` });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await button('Continue').click(); await commit('Guide stair width', '900mm'); await button('Continue').click(); await button('Apply this staircase').click();
  let stairs = await current();
  assert.equal(stairs.steps.length, 8); assert.equal(stairs.landings.length, 0);
  assert(stairs.steps.every(step => step.kind === 'winder'));
  assert(Math.abs(sweep(stairs) - 180) < .0001);
  pass('Count-and-rotation guide creates eight connected winders through 180 degrees without a landing');

  const savedIds = stairs.steps.map(step => step.id);
  await selectStep(3);
  assert(await page.locator('.stair-plan-card').getByRole('button', { name: 'Add step after selection', exact: true }).isVisible());
  assert(await page.locator('.stair-plan-card').getByRole('button', { name: 'Add a flat landing after this step', exact: true }).isVisible());
  await button('Add step after selection').click();
  stairs = await current();
  const added = stairs.steps.find(step => !savedIds.includes(step.id));
  assert.equal(stairs.steps.length, 9); assert.equal(added.kind, 'winder');
  assert.equal(await page.locator(`[data-plan-piece="${added.id}"]`).getAttribute('aria-pressed'), 'true');
  assert(Math.abs(sweep(stairs) - 180) < .0001);
  await button('Delete selected steps').click();
  assert.deepEqual((await current()).steps.map(step => step.id), savedIds);
  assert(Math.abs(sweep(await current()) - 180) < .0001);
  pass('Contextual Add/Delete redistributes the turn and selects the new step without distorting the U');

  await button('3D').click();
  const physical = page.locator('.stair-physical-svg');
  await physical.scrollIntoViewIfNeeded();
  const startYaw = await physical.getAttribute('data-orbit-yaw');
  const box = await physical.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5 + 70, box.y + box.height * .5 - 40, { steps: 8 }); await page.mouse.up();
  assert.notEqual(await physical.getAttribute('data-orbit-yaw'), startYaw);
  await page.locator('.stair-linked-views').screenshot({ path: `${output}/04-connected-u-and-orbit.png` });
  await button('Side').click(); assert.match(await physical.getAttribute('aria-label'), /^Side view/);
  await button('Front').click(); assert.match(await physical.getAttribute('aria-label'), /^Front view/);
  pass('The physical view still supports pointer orbit and side/front inspection');

  await selectStep(7); await button('Add a flat landing after this step').click();
  await commit('Selected landing length', '1.2m'); await commit('Selected landing width', '1.1m');
  await page.getByLabel('Selected landing shape', { exact: true }).selectOption('l_shape');
  assert.equal((await current()).landings[0].length, 1200);
  assert.equal((await current()).landings[0].width, 1100);
  assert.equal(await page.locator('[data-stair-corner]').count(), 6);
  await page.locator('.stair-linked-views').screenshot({ path: `${output}/05-contextual-landing.png` });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Plan editor fits ${width}px`);
  }
  await page.locator('.stair-plan-card').screenshot({ path: `${output}/06-plan-phone.png` });
  const saved = await current(); await page.reload(); assert.deepEqual(await current(), saved);
  pass('Plan landing insertion, dimensions and shape stay editable and persist across reload at phone sizes');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
