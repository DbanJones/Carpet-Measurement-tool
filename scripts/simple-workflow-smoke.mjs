/** Browser acceptance checks for flooring-first setup and details on demand. Run with a local app serving BASE_URL. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.OUT_DIR ?? 'test-results/simple-workflow';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
const checks = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const pass = (message) => { checks.push(message); console.log('PASS', message); };
const project = () => page.evaluate(() => JSON.parse(localStorage.getItem('flooring-estimator:project:v1')).project);
const tab = (name) => page.locator('nav.tabs').getByRole('button', { name, exact: true });
const estimateSection = (name) => page.getByRole('navigation', { name: 'Estimate sections', exact: true }).getByRole('button', { name, exact: true });
async function commit(label, value, container = page) {
  const input = container.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}
async function planTap(x, y) {
  const box = await page.getByTestId('floorplan-overlay').boundingBox();
  assert(box, 'Floor plan has a drawable overlay');
  await page.mouse.click(box.x + x / 960 * box.width, box.y + y / 700 * box.height);
}
async function noOverflow(width) {
  await page.setViewportSize({ width, height: 1000 });
  const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert(scrollWidth <= clientWidth + 1, `Page overflows at ${width}px: ${scrollWidth} > ${clientWidth}`);
}

try {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Start with your flooring', exact: true }).waitFor();
  const tabNames = await page.locator('nav.tabs button').allTextContents();
  assert.equal(tabNames[0].trim(), 'Materials & options');
  await page.getByRole('button', { name: 'Set up flooring & rolls', exact: true }).click();
  assert(await page.getByLabel('Product name', { exact: true }).isVisible(), 'The single product opens without another click');
  assert.equal(await page.getByLabel('Maximum roll length', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Seam policy', { exact: true }).count(), 0);
  pass('The guided journey starts with flooring; basic product settings open directly');

  await page.getByLabel('Product preset', { exact: true }).selectOption('carpet_5m');
  await page.getByRole('button', { name: '+ Add product', exact: true }).click();
  await commit('Product name', 'Warm wool');
  await page.getByLabel('Roll width', { exact: true }).selectOption('4000');
  await commit('Price per square metre', '27.5');
  const selectedProduct = (await project()).products.find((p) => p.name === 'Warm wool');
  assert(selectedProduct);
  assert.equal(selectedProduct.rollWidth, 4000);
  assert.equal(selectedProduct.pricePerM2, 27.5);
  const supplier = page.getByRole('button', { name: 'Supplier & fitting details', exact: true });
  await supplier.click();
  await commit('Maximum roll length', '25');
  await supplier.click();
  assert.equal(await page.getByLabel('Maximum roll length', { exact: true }).count(), 0);
  assert.equal((await project()).products.find((p) => p.id === selectedProduct.id).maxRollLength, 25000);
  await page.screenshot({ path: `${output}/01-flooring-desktop.png`, fullPage: true });
  await noOverflow(390);
  await page.screenshot({ path: `${output}/02-flooring-mobile.png`, fullPage: true });
  await noOverflow(1440);
  pass('Width and price edit directly; supplier details preserve values when closed; flooring fits mobile');

  await page.getByRole('button', { name: 'Measure stairs', exact: true }).click();
  const stairs = page.locator('.stairs-editor');
  await stairs.waitFor();
  assert.equal(await stairs.locator('input:visible, select:visible, textarea:visible').count(), 6);
  assert.equal(await stairs.getByLabel('Product', { exact: true }).inputValue(), selectedProduct.id);
  assert(await stairs.getByRole('group', { name: 'Top-down staircase drawing', exact: true }).isVisible());
  assert(await stairs.getByRole('group', { name: /^Side view of physical staircase:/ }).isVisible());
  assert.equal(await stairs.getByRole('img', { name: /^Side elevation:/ }).count(), 0, 'The unfolded measuring profile starts collapsed');
  assert.equal(await stairs.getByLabel('Step 1 width', { exact: true }).count(), 0);
  await commit('Staircase name', 'Main staircase', stairs);
  await commit('Number of risers', '12', stairs);
  await commit('Rise for all steps', '190mm', stairs);
  await commit('Going for all steps', '250mm', stairs);
  await commit('Width for all steps', '900mm', stairs);
  const measuredStair = (await project()).staircases[0];
  assert.equal(measuredStair.steps.length, 12);
  assert(measuredStair.steps.every((step) => step.rise === 190 && step.going === 250 && step.width === 900));
  await page.screenshot({ path: `${output}/03-stairs-simple-desktop.png`, fullPage: true });
  pass('New stairs inherit the chosen carpet and expose six basic controls with a live preview');

  const individual = stairs.getByRole('button', { name: /^Individual steps and turns/ });
  await individual.click();
  await commit('Step 1 width', '950mm', stairs);
  await individual.click();
  assert.equal(await stairs.getByLabel('Step 1 width', { exact: true }).count(), 0);
  assert.equal(await stairs.getByLabel('Width for all steps', { exact: true }).inputValue(), '');
  assert.equal(await stairs.getByLabel('Width for all steps', { exact: true }).getAttribute('placeholder'), 'varies');
  assert.equal((await project()).staircases[0].steps[0].width, 950);
  assert((await project()).staircases[0].steps.slice(1).every((step) => step.width === 900));
  await individual.click();
  assert.equal(await stairs.getByLabel('Step 1 width', { exact: true }).inputValue(), '0.95');
  await individual.click();
  for (const width of [768, 390, 320]) {
    await noOverflow(width);
    if (width === 390) await page.screenshot({ path: `${output}/04-stairs-simple-mobile.png`, fullPage: true });
  }
  pass('Individual step changes survive collapsed details and remain distinct; stairs fit 768, 390 and 320px');

  await noOverflow(1440);
  await tab('Materials & options').click();
  await page.getByRole('button', { name: 'Edit Warm wool', exact: true }).click();
  await page.getByRole('button', { name: 'Use a floor plan', exact: true }).click();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles('scripts/fixtures/estate-plan.svg');
  await page.getByAltText('Floor plan: estate-plan.svg').waitFor();
  const inspector = page.getByRole('complementary', { name: 'Current floor plan task' });
  await planTap(86, 90); await planTap(434, 90);
  await inspector.getByLabel('Known distance', { exact: true }).fill('4.35');
  await inspector.getByLabel('Known distance', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await planTap(86, 86); await planTap(434, 334);
  assert.equal(await inspector.getByLabel('Floor covering', { exact: true }).inputValue(), selectedProduct.id);
  await inspector.getByLabel('Room name', { exact: true }).fill('Lounge');
  await inspector.getByRole('button', { name: 'Add room', exact: true }).click();
  assert.equal((await project()).rooms[0].productId, selectedProduct.id);
  pass('Choosing a floor plan from a carpet uses that product for the traced room');

  await tab('Materials & options').click();
  const otherProduct = (await project()).products.find((p) => p.id !== selectedProduct.id);
  await page.getByRole('button', { name: `Edit ${otherProduct.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Use a floor plan', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await planTap(86, 346); await planTap(434, 554);
  assert.equal(await inspector.getByLabel('Floor covering', { exact: true }).inputValue(), otherProduct.id);
  await inspector.getByLabel('Room name', { exact: true }).fill('Bedroom');
  await inspector.getByRole('button', { name: 'Add room', exact: true }).click();
  assert.equal((await project()).rooms.find((room) => room.name === 'Bedroom').productId, otherProduct.id);
  pass('Returning to an existing plan with another carpet uses that choice for the next room');

  await page.getByRole('button', { name: 'Review rooms', exact: true }).click();
  await inspector.getByRole('button', { name: 'View estimate', exact: true }).click();
  await page.getByTestId('results-panel').waitFor();
  await estimateSection('Cutting plans').click();
  assert.equal((await project()).rooms.length, 2);
  assert.equal((await project()).staircases.length, 1);
  pass('The same flooring reaches the estimate with both its room and staircase');

  const rollDiagram = page.locator(`[data-testid="roll-cut-diagram"][data-product-id="${selectedProduct.id}"]`);
  await rollDiagram.waitFor();
  const physicalRoll = rollDiagram.getByTestId('physical-roll').first();
  const staircaseHighlight = physicalRoll.getByRole('button', { name: /^Highlight Main staircase:/ });
  await staircaseHighlight.click();
  assert.equal(await staircaseHighlight.getAttribute('aria-pressed'), 'true');
  const stairId = (await project()).staircases[0].id;
  const matchingPieces = physicalRoll.locator(`.roll-piece[data-owner-id="${stairId}"]`);
  assert(await matchingPieces.count() > 0);
  assert((await matchingPieces.evaluateAll((pieces) => pieces.map((piece) => piece.getAttribute('aria-pressed')))).every((value) => value === 'true'));
  await matchingPieces.first().click();
  assert.match(await physicalRoll.locator('.roll-selection').innerText(), /Main staircase/);
  assert.match(await physicalRoll.locator('.roll-selection').innerText(), /length along roll/);
  await physicalRoll.getByRole('button', { name: 'Open Main staircase', exact: true }).click();
  assert.equal(await page.locator('.stairs-editor').getByLabel('Staircase name', { exact: true }).inputValue(), 'Main staircase');
  assert.equal((await project()).staircases[0].steps[0].width, 950);
  pass('Roll destinations highlight their pieces; a selected piece shows dimensions and opens its staircase');

  await tab('Estimate').click();
  await estimateSection('Cutting plans').click();
  await physicalRoll.locator('.roll-piece-details summary').click();
  const firstListPiece = physicalRoll.locator('.roll-piece-link').first();
  await firstListPiece.click();
  assert.equal(await firstListPiece.getAttribute('aria-pressed'), 'true');
  assert.equal(await physicalRoll.locator('.roll-piece[aria-pressed="true"]').count(), 1);
  await physicalRoll.screenshot({ path: `${output}/05-cuts-desktop.png` });
  await noOverflow(390);
  await physicalRoll.locator('.roll-piece-details summary').click();
  await physicalRoll.screenshot({ path: `${output}/06-cuts-mobile.png` });
  await noOverflow(320);
  pass('The detailed cut list selects the matching diagram piece; cuts fit 390 and 320px without page overflow');

  const previousPieceCount = await rollDiagram.locator('.roll-piece').count();
  await noOverflow(1440);
  await tab('Materials & options').click();
  await page.getByRole('button', { name: 'Edit Warm wool', exact: true }).click();
  await page.getByRole('button', { name: 'Supplier & fitting details', exact: true }).click();
  await commit('Maximum roll length', '5');
  await tab('Estimate').click();
  await estimateSection('Cutting plans').click();
  const physicalRolls = rollDiagram.getByTestId('physical-roll');
  assert.equal(await physicalRolls.count(), 2, 'A 5 m supplier maximum splits these cuts across two rolls');
  assert.equal(await rollDiagram.locator('.roll-piece').count(), previousPieceCount);
  const orderLengths = (await rollDiagram.locator('.physical-roll-order strong').allTextContents()).map((text) => parseFloat(text));
  assert(orderLengths.every((length) => length > 0 && length <= 5));
  const totalOrder = parseFloat(await rollDiagram.locator('.roll-order-summary strong').innerText());
  assert(Math.abs(orderLengths.reduce((sum, length) => sum + length, 0) - totalOrder) < .001);
  const allCutIndexes = await rollDiagram.locator('.roll-cut[data-cut-index]').evaluateAll((cuts) => cuts.map((cut) => cut.dataset.cutIndex));
  assert.equal(new Set(allCutIndexes).size, allCutIndexes.length, 'Each cut appears on exactly one physical roll');
  for (let index = 0; index < 2; index++) {
    const roll = physicalRolls.nth(index);
    assert.equal(await roll.getAttribute('data-roll-number'), String(index + 1));
    assert(await roll.locator('.roll-piece').count() > 0);
    assert((await roll.locator('.roll-piece').evaluateAll((pieces) => pieces.map((piece) => piece.getAttribute('aria-label')))).every((label) => /^\d+[A-Z]+ · /u.test(label)));
  }
  assert(await rollDiagram.getByRole('button', { name: /^Highlight Lounge:/ }).count() > 0);
  assert(await rollDiagram.getByRole('button', { name: /^Highlight Main staircase:/ }).count() > 0);
  await rollDiagram.screenshot({ path: `${output}/07-multiple-rolls-desktop.png` });
  await noOverflow(390);
  await rollDiagram.screenshot({ path: `${output}/08-multiple-rolls-mobile.png` });
  pass('A shorter supplier roll produces two numbered roll cards with every piece once and matching order totals');

  await noOverflow(1440);
  assert.equal(await page.locator('.roll-piece-details[open]').count(), 0);
  const pdfBytes = await page.pdf({
    path: `${output}/estimate-with-cut-lists.pdf`, format: 'A4', printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
  });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false });
  try {
    const pdf = await loadingTask.promise;
    let printedText = '';
    for (let number = 1; number <= pdf.numPages; number++) {
      const text = await (await pdf.getPage(number)).getTextContent();
      printedText += ` ${text.items.map((item) => 'str' in item ? item.str : '').join(' ')}`;
    }
    assert(pdf.numPages > 0);
    for (const expected of [/Cut list & dimensions/i, /Size: length × width/i, /Roll 1/i, /Roll 2/i, /Main staircase/i, /Lounge/i]) {
      assert(expected.test(printedText), `The printed PDF must contain ${expected}`);
    }
    await writeFile(`${output}/printed-text.txt`, printedText);
  } finally {
    await loadingTask.destroy();
  }
  assert.equal(await page.locator('.roll-piece-details[open]').count(), 0, 'Printing restores the closed detail sections');
  pass('The actual A4 PDF includes both roll allocations and detailed cut lists, then restores collapsed details');

  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ url, checks, errors }, null, 2));
  console.log('Simple-workflow browser checks passed.');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ url, checks, errors, error: error.message }, null, 2));
  throw error;
} finally {
  await browser.close();
}
