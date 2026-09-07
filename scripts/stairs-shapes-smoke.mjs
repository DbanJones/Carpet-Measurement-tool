/** Staircase shape acceptance check against a running local app. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = 'test-results/stairs-shapes';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const commit = async (name, value) => { const input = page.getByLabel(name, { exact: true }); await input.fill(value); await input.press('Tab'); };
try {
  await page.goto(url);
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await page.getByRole('button', { name: '+ Stairs', exact: true }).click();
  await page.locator('.stairs-editor').waitFor();
  await commit('Staircase name', 'Curved entrance stairs');
  const original = (await project()).staircases[0];
  assert(await page.getByRole('group', { name: 'Top-down staircase drawing', exact: true }).isVisible());
  assert(await page.getByRole('group', { name: /^Side view of physical staircase: 13 risers/ }).isVisible());
  await page.getByRole('button', { name: /^Measured turns and shape presets/ }).click();
  await page.getByRole('button', { name: /^Unfolded measurement profile/ }).click();
  await page.getByRole('button', { name: /Quarter turn L-shaped/ }).click();
  await page.getByLabel('Turn direction', { exact: true }).selectOption('left');
  await commit('Turn after step', '4');
  await commit('Widest turning tread depth', '620mm');
  await page.getByRole('button', { name: 'Apply staircase layout', exact: true }).click();
  assert(await page.getByRole('img', { name: /quarter turn, turning left/ }).isVisible());
  let current = (await project()).staircases[0];
  assert.deepEqual(current.steps.map((s) => s.id), original.steps.map((s) => s.id));
  assert.equal(current.steps.filter((s) => s.kind === 'winder').length, 3);
  await page.locator('.stairs-preview').screenshot({ path: `${out}/quarter-turn.png` });

  await page.getByRole('button', { name: /Curved A sweeping flight/ }).click();
  await commit('Curve sweep', '150');
  await commit('Inside radius', '550mm');
  await page.getByRole('button', { name: 'Apply staircase layout', exact: true }).click();
  assert(await page.getByRole('img', { name: /curved, turning left/ }).isVisible());
  current = (await project()).staircases[0];
  assert.equal(current.steps.filter((s) => s.kind === 'winder').length, 13);
  assert.equal(current.layout.curveAngle, 150);
  await page.locator('.stairs-preview').screenshot({ path: `${out}/curved.png` });
  await page.getByRole('button', { name: 'Duplicate staircase', exact: true }).click();
  assert.equal((await project()).staircases.length, 2);
  assert.equal(await page.getByLabel('Staircase name', { exact: true }).inputValue(), 'Curved entrance stairs (copy)');
  await page.getByRole('button', { name: /^Measured turns and shape presets/ }).click();
  await page.getByRole('button', { name: 'Edit turn and curve', exact: true }).click();
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    assert(size.scroll <= size.viewport + 1, `Stairs overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.locator('.stairs-layout-picker').screenshot({ path: `${out}/curved-controls-mobile.png` });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  const reloaded = (await project()).staircases;
  assert.equal(reloaded[1].layout.curveAngle, 150);
  assert.equal(new Set(reloaded.flatMap((s) => s.steps.map((step) => step.id))).size, 26);
  assert.deepEqual(errors, []);
  console.log('PASS staircase corners, curves, preserved measurements, duplication, persistence and 1024/768/390/320px layouts');
} finally { await browser.close(); }
