/** Real raster/OCR/worker → scale → review/edit suggestions → accepted measured rooms. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const out = 'test-results/floorplan-batch'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
async function point(x, y) {
  const overlay = page.getByTestId('floorplan-overlay'); await overlay.scrollIntoViewIfNeeded();
  const p = await overlay.evaluate((svg, p) => { const q = new DOMPoint(p.x,p.y).matrixTransform(svg.getScreenCTM()); return { x:q.x,y:q.y }; }, { x,y });
  await page.mouse.click(p.x,p.y);
}
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  const svg = await readFile(new URL('./fixtures/estate-plan.svg', import.meta.url));
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles({ name:'Estate agent plan.svg', mimeType:'image/svg+xml', buffer:svg });
  await page.getByTestId('mode-scale').waitFor();
  assert.equal(await button('Detect all rooms').count(),0, 'Scale setup hides unrelated drawing tools');
  await point(86,86); await point(434,86);
  await page.getByLabel('Known distance', { exact: true }).fill('4.35m');
  await page.locator('.fp-workspace').screenshot({ path:`${out}/01-scale.png` });
  await button('Set scale & continue').click();
  assert(Math.abs((await project()).floorPlans[0].mmPerPx - 12.5) < .0001);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project.floorPlans[0]?.reading?.source === 'ocr', undefined, { timeout:65000 });
  await button('Detect all rooms').click();
  await page.getByTestId('mode-detected-rooms').waitFor();
  assert.equal(await page.locator('[data-suggestion-id]').count(),3);
  assert.equal((await project()).rooms.length,0, 'Detected outlines are suggestions until accepted');
  const names = await page.locator('.fp-suggestion-list strong').allTextContents();
  assert(names.some(name=>/Lounge|Kitchen|Bedroom/i.test(name)), `OCR names appear without a reading button: ${names}`);
  await page.locator('.fp-workspace').screenshot({ path:`${out}/02-detected-review.png` });
  const first = page.locator('[data-suggestion-id]').first(); await first.focus(); await first.press('Enter');
  await button('Edit detected outline').click();
  const remaining = await page.locator('.fp-suggestion-number').allTextContents();
  assert.deepEqual(remaining,['2','3'], 'Editing one outline preserves the other suggestion numbers');
  await page.getByLabel('Room name', { exact: true }).fill('Family lounge');
  await page.getByLabel('Selected corner', { exact: true }).selectOption('0');
  await page.getByTestId('floorplan-overlay').focus(); await page.keyboard.press('ArrowRight');
  assert.equal((await project()).rooms.length,0);
  await button('Save room suggestion').click();
  assert.equal(await page.getByLabel('Detected room name', { exact: true }).inputValue(),'Family lounge');
  await page.locator('.fp-suggestion-list input[type=checkbox]').nth(2).uncheck();
  for (const width of [1024,768,390,320]) {
    await page.setViewportSize({width,height:1100});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No page overflow at ${width}px`);
  }
  await page.locator('.fp-inspector').screenshot({ path:`${out}/03-phone-review.png` });
  await page.setViewportSize({ width:1440,height:1100 });
  await button('Add 2 selected rooms').click();
  const accepted = (await project()).rooms;
  assert.equal(accepted.length,2); assert(accepted.some(room=>room.name==='Family lounge'));
  assert(accepted.some(room=>room.doorways.length>0), 'Included drawn door symbols are saved with the accepted rooms');
  assert(accepted.every(room=>room.source && room.shape.kind==='polygon'));
  await button('Detect all rooms').click(); await page.getByTestId('mode-detected-rooms').waitFor();
  assert.equal(await page.locator('[data-suggestion-id]').count(),1,'Only the unaccepted room is suggested on a second scan');
  await button('Add 1 selected room').click(); assert.equal((await project()).rooms.length,3);
  const saved = (await project()).rooms;
  await page.locator('.fp-workspace').screenshot({ path:`${out}/04-saved-rooms.png` });
  await page.reload(); assert.deepEqual((await project()).rooms,saved);
  assert.deepEqual(errors,[]);
  console.log('PASS automatic OCR names, focused scale, three-room detection, stable numbered editing, subset acceptance with drawn doorways, no duplicate rooms, mobile layouts and reload persistence');
} finally { await browser.close(); }
