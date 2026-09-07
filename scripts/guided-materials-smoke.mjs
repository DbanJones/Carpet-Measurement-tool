import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const out = 'test-results/guided-materials';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const saved = () => page.evaluate(async () => {
  const persisted = localStorage.getItem('flooring-estimator:project:v1');
  return persisted ? JSON.parse(persisted).project : (await import('/src/store/projectStore.ts')).useProjectStore.getState().project;
});
const click = name => page.getByRole('button', { name, exact: typeof name === 'string' }).click();
const commit = async (name, value) => { const input = page.getByLabel(name, { exact: true }); await input.fill(value); await input.press('Tab'); };
try {
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  await click('Guide me through setup');
  const original = await saved();
  await commit('Guide product name', 'Natural wool carpet');
  await commit('Guide price per m²', '25');
  assert(await page.getByLabel('Guide underlay price per roll', { exact: true }).isVisible());
  assert.equal(await page.getByLabel('Guide underlay thickness', { exact: true }).count(), 0, 'Technical underlay details start collapsed');
  await page.getByLabel('Guide underlay price basis', { exact: true }).selectOption('per_m2');
  await commit('Guide underlay price per m²', '5');
  await click('Add another flooring');
  await page.getByLabel('Guide flooring type', { exact: true }).selectOption('laminate');
  await commit('Guide product name', 'Warm oak laminate');
  await commit('Guide pack coverage', '2');
  await commit('Guide price per pack', '48');
  await click('Add another flooring');
  await page.getByLabel('Guide flooring type', { exact: true }).selectOption('lvt_click');
  await commit('Guide product name', 'Kitchen LVT');
  await click('Remove Kitchen LVT');
  assert.equal(await page.getByRole('button', { name: 'Edit Kitchen LVT', exact: true }).count(), 0);
  await click('Undo removal');
  assert(await page.getByRole('button', { name: 'Edit Kitchen LVT', exact: true }).isVisible());
  await click('Remove Kitchen LVT');
  await click('Edit Natural wool carpet');
  assert.equal(await page.getByLabel('Guide price per m²', { exact: true }).inputValue(), '25');
  assert.equal(await page.getByLabel('Guide underlay price per m²', { exact: true }).inputValue(), '5');
  assert.deepEqual((await saved()).products, original.products, 'Editing cards does not save a partial setup');
  await page.locator('.guided-setup').screenshot({ path: `${out}/flooring-desktop.png` });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `Flooring guide overflow at ${width}px`);
    assert(await page.getByRole('button', { name: 'Add another flooring', exact: true }).isVisible());
  }
  await page.locator('.guided-setup').screenshot({ path: `${out}/flooring-phone.png` });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel('Guide default flooring', { exact: true }).selectOption({ label: 'Warm oak laminate' });
  await click('Close guide');
  await click('Guide me through setup');
  assert.equal(await page.getByLabel('Guide underlay price per m²', { exact: true }).inputValue(), '5');
  assert.equal(await page.getByRole('button', { name: 'Edit Warm oak laminate', exact: true }).count(), 1);
  await click('Continue with 2 flooring products');
  let project = await saved();
  assert.equal(project.products.length, 2);
  const wool = project.products.find(product => product.name === 'Natural wool carpet');
  const oak = project.products.find(product => product.name === 'Warm oak laminate');
  assert.equal(wool.pricePerM2, 25); assert.equal(wool.underlay.pricePerM2, 5); assert.equal(wool.underlay.pricePerRoll, undefined);
  assert.equal(oak.pricePerPack, 48); assert.equal(oak.packCoverageM2, 2);
  await click(/Enter room measurements/);
  assert.equal((await saved()).rooms[0].productId, oak.id);
  await click('Back to guide');
  await page.getByLabel('Guide room flooring', { exact: true }).selectOption(wool.id);
  await page.locator('.guided-setup').getByRole('button', { name: 'Add room', exact: true }).click();
  assert.equal((await saved()).rooms[1].productId, wool.id);
  await click('Back to guide');
  await page.locator('.guided-setup').screenshot({ path: `${out}/mixed-flooring-rooms.png` });
  // Revisit setup: editing a saved product still keeps each room's assignment.
  await page.locator('.guided-setup').getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.guided-setup').getByRole('button', { name: 'Back', exact: true }).click();
  await click('Edit Natural wool carpet');
  await commit('Guide price per m²', '26');
  await click('Continue with 2 flooring products');
  project = await saved();
  assert.deepEqual(project.rooms.map(room => room.productId), [oak.id, wool.id]);
  // Exercise real engine pricing using the exact persisted product/room data.
  const estimate = await page.evaluate(async () => {
    const { estimateProject } = await import('/src/engine/estimate.ts');
    return estimateProject(JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
  });
  const carpetLine = estimate.bom.find(line => line.category === 'floor_covering' && line.subjectIds.includes(project.rooms[1].id));
  const oakLine = estimate.bom.find(line => line.category === 'floor_covering' && line.subjectIds.includes(project.rooms[0].id));
  const underlayLine = estimate.bom.find(line => line.category === 'underlay' && line.subjectIds.includes(project.rooms[1].id));
  assert.equal(carpetLine.unitPrice, 104, 'Carpet £26/m² on a 4m roll');
  assert.equal(oakLine.unitPrice, 48, 'Laminate retains its own pack price');
  assert.equal(underlayLine.unitPrice, 75.35, 'Underlay separately orders 15.07m² rolls at £5/m²');
  assert(!underlayLine.subjectIds.includes(project.rooms[0].id), 'Carpet underlay is not applied to laminate');
  await page.reload();
  assert.deepEqual((await saved()).products, project.products);
  assert.deepEqual((await saved()).rooms.map(room => room.productId), [oak.id, wool.id]);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ products: project.products.map(({ id, name, kind, pricePerM2, pricePerPack, underlay }) => ({ id, name, kind, pricePerM2, pricePerPack, underlay })), assignedRooms: project.rooms.map(({ id, productId }) => ({ id, productId })), priceChecks: { carpet: carpetLine.unitPrice, laminate: oakLine.unitPrice, underlay: underlayLine.unitPrice }, widths: [1440, 1024, 768, 390, 320], errors }, null, 2));
  console.log('Guided multi-product setup, separate underlay pricing, draft persistence, removal/undo, room assignments, real estimate pricing, reload and mobile layout passed.');
} finally { await browser.close(); }
