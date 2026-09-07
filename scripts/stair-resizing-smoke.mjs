/** Pointer resizing changes measured dimensions and keeps the diagrams/table connected. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const out = 'test-results/stair-resizing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const current = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.staircases[0]);
const dimensions = step => { const { plan, ...measured } = step; return measured; };
const handle = dimension => page.getByRole('slider', { name: `Resize selected step ${dimension === 'going' ? 'depth' : 'width'}`, exact: true });
async function handleFrame(dimension) {
  return handle(dimension).locator('.step-resize-arrow').evaluate(path => {
    const a = new DOMPoint(0, 0).matrixTransform(path.getScreenCTM());
    const b = new DOMPoint(1, 0).matrixTransform(path.getScreenCTM());
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x, y: a.y, dx: (b.x - a.x) / length, dy: (b.y - a.y) / length };
  });
}
async function resize(dimension, pixels, cancel = false) {
  await handle(dimension).scrollIntoViewIfNeeded();
  const frame = await handleFrame(dimension), before = await current();
  await page.mouse.move(frame.x, frame.y); await page.mouse.down();
  await page.mouse.move(frame.x + frame.dx * pixels, frame.y + frame.dy * pixels, { steps: 8 });
  assert.deepEqual(await current(), before, 'A resize preview does not write measurements before release');
  const moving = await handleFrame(dimension);
  if (before.steps[2].kind === 'straight') assert(Math.hypot(moving.x - (frame.x + frame.dx * pixels), moving.y - (frame.y + frame.dy * pixels)) < 2, 'Straight resize handle follows the pointer in a stable diagram frame');
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  const after = await current();
  if (cancel) assert.deepEqual(after, before, 'Escape discards the preview');
  else {
    assert(after.steps[2][dimension] > before.steps[2][dimension], `Dragging increases ${dimension}`);
    assert.deepEqual(after.steps.filter((_, i) => i !== 2).map(dimensions), before.steps.filter((_, i) => i !== 2).map(dimensions));
    assert.equal(after.steps[2].rise, before.steps[2].rise);
    const label = `Step 3 ${dimension}${dimension === 'going' && after.steps[2].kind === 'winder' ? ' (max)' : ''}`;
    await page.waitForFunction(({ label, value }) => Math.abs(Number(document.querySelector(`input[aria-label="${label}"]`)?.value) * 1000 - value) < .6, { label, value: after.steps[2][dimension] });
    const table = await page.getByLabel(label, { exact: true }).inputValue();
    assert(Math.abs(Number(table) * 1000 - after.steps[2][dimension]) < .6, `Table shows the measurement made on the diagram: ${table} vs ${after.steps[2][dimension]} mm`);
  }
}
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('nav.tabs').getByRole('button', { name: 'Rooms & stairs', exact: true }).click();
  await button('+ Stairs').click();
  await page.getByRole('button', { name: /^Individual steps and turns/ }).click();
  await button('Select step 3 in table').click();
  await button('Width & depth').click();
  await resize('width', 18);
  await resize('going', 12);
  await resize('width', 12, true);
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/01-straight-resized.png` });
  const stairs = await current();
  const first = page.locator(`[data-plan-piece="${stairs.steps[2].id}"]`);
  const fourth = page.locator(`[data-plan-piece="${stairs.steps[5].id}"]`);
  await first.focus(); await first.press('Enter');
  await fourth.focus(); await fourth.press('Shift+Enter');
  await button('Curve selected steps').click();
  await first.focus(); await first.press('Enter');
  assert.equal((await current()).steps[2].kind, 'winder');
  const narrow = (await current()).steps[2].goingNarrow;
  await resize('width', 8);
  await resize('going', 8);
  assert.equal((await current()).steps[2].goingNarrow, narrow, 'Widest-depth resizing preserves the narrow edge measurement');
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/02-winder-resized.png` });
  const beforeKeyboard = await current();
  await handle('width').focus(); await handle('width').press('ArrowRight');
  assert.equal((await current()).steps[2].width, beforeKeyboard.steps[2].width + 10);
  await page.setViewportSize({ width: 390, height: 1100 });
  await handle('going').scrollIntoViewIfNeeded();
  await page.locator('.stair-linked-views').screenshot({ path: `${out}/03-phone-handles.png` });
  assert.deepEqual(errors, []);
  console.log('PASS straight/winder width and depth pointer resizing, stable handles, Escape cancel, linked table measurements, keyboard resizing and preserved other measurements');
} finally { await browser.close(); }
