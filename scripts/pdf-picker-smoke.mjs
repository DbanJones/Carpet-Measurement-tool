#!/usr/bin/env node
/** Real PDF rendering and preview-before-import checks. Requires Playwright and a running app. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = path.resolve(process.env.OUT_DIR ?? path.join(root, 'test-results', 'pdf-picker-smoke'));
const storageKey = 'flooring-estimator:project:v1';
const browserPath = process.env.CHROMIUM_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/opt/pw-browsers/chromium',
].find((candidate) => existsSync(candidate));

/** Different page sizes and drawings make an accidental cover import observable. */
function brochurePdf() {
  const cover = '0.85 0.93 0.92 rg 0 0 300 200 re f 0 g BT /F1 24 Tf 30 120 Td (PROPERTY BROCHURE) Tj ET';
  const plan = '0 g 4 w 30 30 240 240 re S 150 30 m 150 270 l S 30 150 m 150 150 l S BT /F1 15 Tf 45 210 Td (LOUNGE) Tj ET BT /F1 15 Tf 45 90 Td (BEDROOM) Tj ET BT /F1 15 Tf 170 160 Td (KITCHEN) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(cover)} >>\nstream\n${cover}\nendstream`,
    `<< /Length ${Buffer.byteLength(plan)} >>\nstream\n${plan}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

await mkdir(output, { recursive: true });
assert((await fetch(baseUrl)).ok, `The app must be running at ${baseUrl}`);
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
const failedRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
const checks = [];
const pass = (check) => { checks.push(check); console.log(`PASS ${check}`); };
const plans = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key))?.project?.floorPlans ?? [], storageKey);
const upload = () => page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles({
  name: 'estate-brochure.pdf', mimeType: 'application/pdf', buffer: brochurePdf(),
});
const usePage = () => page.getByRole('button', { name: 'Use this page', exact: true });

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('Project name', { exact: true }).waitFor({ timeout: 60000 });
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  await upload();
  const first = page.getByAltText('Page 1 of estate-brochure.pdf', { exact: true });
  await first.waitFor();
  const coverRaster = await first.getAttribute('src');
  assert.equal((await plans()).length, 0, 'The cover page must not create a plan.');
  pass('Opening a real two-page PDF previews its cover without importing it');

  await page.getByRole('combobox', { name: 'PDF page', exact: true }).selectOption('2');
  const second = page.getByAltText('Page 2 of estate-brochure.pdf', { exact: true });
  await second.waitFor();
  assert.equal(await first.count(), 0, 'The old cover preview must be removed.');
  const planRaster = await second.getAttribute('src');
  assert.notEqual(planRaster, coverRaster, 'The selected page preview must differ from the cover.');
  assert.equal(await second.getAttribute('width'), await second.getAttribute('height'), 'Page 2 should have its own square page size.');
  assert.equal((await plans()).length, 0, 'Previewing page 2 must not add it to the project.');
  assert.equal(await usePage().isDisabled(), false);
  await page.screenshot({ path: path.join(output, 'page-two-before-import.png'), fullPage: true });
  pass('Choosing page 2 automatically displays the correct raster before import');

  await page.setViewportSize({ width: 390, height: 844 });
  const layout = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert(layout[0] <= layout[1] + 1, `PDF picker overflowed at 390px: ${layout}`);
  await page.screenshot({ path: path.join(output, 'page-two-phone.png'), fullPage: true });
  pass('PDF preview and page controls fit a 390px viewport');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a floor plan', exact: true }).waitFor();
  assert.equal((await plans()).length, 0, 'Cancelling must leave the project without a plan.');
  assert.equal(await page.getByRole('combobox', { name: 'PDF page', exact: true }).count(), 0);
  pass('Cancelling the preview adds no floor plan');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await upload();
  await page.getByAltText('Page 1 of estate-brochure.pdf', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'PDF page', exact: true }).selectOption('2');
  const finalPreview = page.getByAltText('Page 2 of estate-brochure.pdf', { exact: true });
  await finalPreview.waitFor();
  const chosenRaster = await finalPreview.getAttribute('src');
  await usePage().click();
  await page.getByAltText('Floor plan: estate-brochure.pdf (page 2)', { exact: true }).waitFor();
  await page.getByTestId('mode-scale').waitFor();
  const imported = await plans();
  assert.equal(imported.length, 1, 'Import should add exactly the chosen page.');
  assert.equal(imported[0].name, 'estate-brochure.pdf (page 2)');
  assert.equal(imported[0].imageDataUrl, chosenRaster, 'The saved raster must exactly match the chosen preview.');
  assert.equal(imported[0].widthPx, imported[0].heightPx);
  assert.equal(imported[0].reading?.source, 'pdf', 'The chosen page must retain its native PDF text layer.');
  assert.match(imported[0].reading.text, /LOUNGE/);
  assert(!imported[0].reading.text.includes('PROPERTY BROCHURE'), 'The imported text must belong to the chosen page, not the cover.');
  const lounge = imported[0].reading.lines.find(line => line.text === 'LOUNGE');
  assert(lounge && lounge.confidence === 100, 'The native PDF label must retain positional text evidence.');
  assert(lounge.x >= 0 && lounge.y >= 0 && lounge.x + lounge.width <= imported[0].widthPx && lounge.y + lounge.height <= imported[0].heightPx, 'PDF text bounds must use imported raster coordinates.');
  assert(lounge.x < imported[0].widthPx / 2 && lounge.y < imported[0].heightPx / 2, 'Lounge text must remain in the top-left room after PDF coordinate conversion.');
  assert.equal(imported[0].mmPerPx, undefined, 'A PDF page must still require known-distance calibration.');
  assert.equal(await page.getByRole('button', { name: 'Detect room', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('region', { name: 'Choose the floor plan page' }).count(), 0);
  await page.screenshot({ path: path.join(output, 'imported-page-two-calibration.png'), fullPage: true });
  pass('Use this page imports exactly page 2 and starts calibration');
  pass('Chosen PDF text layer supplies LOUNGE in raster coordinates without OCR or automatic scale');

  assert.deepEqual(errors, [], 'Browser/app errors were reported.');
  assert.deepEqual(failedRequests, [], 'Browser requests failed.');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ baseUrl, checks, errors, failedRequests }, null, 2));
  console.log(`All ${checks.length} PDF picker browser checks passed. Artifacts: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ baseUrl, checks, errors, failedRequests, error: error.message }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
