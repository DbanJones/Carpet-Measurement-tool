#!/usr/bin/env node
/**
 * Production browser checks for first-visit offline use and recoverable browser-save failures.
 * Run after `npm run build` with `npm run preview` listening (default http://127.0.0.1:4173/):
 *   node scripts/offline-smoke.mjs
 * Requires an optional local Playwright installation. BASE_URL, CHROMIUM_PATH and OUT_DIR override
 * the server, browser and artifact directory. Uses a fresh, disposable browser context.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const output = path.resolve(process.env.OUT_DIR ?? path.join(root, 'test-results', 'offline-smoke'));
const storageKey = 'flooring-estimator:project:v1';
const browserPath = process.env.CHROMIUM_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/opt/pw-browsers/chromium',
].find((candidate) => existsSync(candidate));

/** A valid small PDF generated locally; exercising the real PDF renderer needs no external file. */
function samplePdf() {
  const stream = '0.2 w 30 30 240 140 re S BT /F1 16 Tf 45 110 Td (Lounge 4m x 3m) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
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
const response = await fetch(baseUrl);
assert(response.ok, `Preview must be running at ${baseUrl}.`);
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const pageErrors = [];
const browserLog = [];
const externalRequests = [];
context.on('request', request => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseUrl).origin) externalRequests.push(request.url());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') browserLog.push(message.text()); });
page.on('requestfailed', (request) => browserLog.push(`${request.url()}: ${request.failure()?.errorText}`));
const passed = [];
const record = (check, detail) => {
  passed.push({ check, detail });
  console.log(`PASS ${check}${detail ? `: ${detail}` : ''}`);
};
const inspector = () => page.getByRole('complementary', { name: 'Current floor plan task' });
async function tapPlan(x, y, width = 960, height = 700) {
  const overlay = page.getByTestId('floorplan-overlay');
  await overlay.scrollIntoViewIfNeeded();
  const box = await overlay.boundingBox();
  assert(box, 'The uploaded floor-plan overlay must be visible.');
  await page.mouse.click(box.x + x / width * box.width, box.y + y / height * box.height);
}

try {
  // Seed someone else's cache before worker registration, so activation must preserve it.
  await page.addInitScript(() => {
    // Observe a real detector reply, so its graceful main-thread fallback cannot accidentally
    // make an uncached/broken worker pass this first-use offline check.
    window.offlineDetectionProbe = { started: [], replies: [] };
    window.offlineReadingProbe = { started: [], replies: [] };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('detection.worker')) {
          window.offlineDetectionProbe.started.push(String(url));
          this.addEventListener('message', ({ data }) => window.offlineDetectionProbe.replies.push(data));
        }
        if (String(url).includes('planReading.worker')) {
          window.offlineReadingProbe.started.push(String(url));
          this.addEventListener('message', ({ data }) => window.offlineReadingProbe.replies.push(data));
        }
      }
    };
    if (!('serviceWorker' in navigator)) return;
    const original = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    const cacheReady = caches.open('unrelated-app-smoke').then((cache) => cache.put('./unrelated.txt', new Response('Keep this data')));
    navigator.serviceWorker.register = async (...args) => {
      await cacheReady;
      return original(...args);
    };
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  // The first production visit also installs the OCR language/core assets.
  await page.getByLabel('Project name', { exact: true }).waitFor({ timeout: 60000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cacheInfo = await page.evaluate(async () => {
    const keys = await caches.keys();
    const own = keys.find((key) => key.startsWith('flooring-estimator-'));
    const assets = own ? (await (await caches.open(own)).keys()).map((request) => request.url) : [];
    return {
      keys, assets,
      loadedPdf: performance.getEntriesByType('resource').some((entry) => /\/pdf[^/]*\.(js|mjs)/.test(entry.name)),
      startedDetectors: window.offlineDetectionProbe.started,
      startedReaders: window.offlineReadingProbe.started,
    };
  });
  assert(cacheInfo.keys.includes('unrelated-app-smoke'), 'Activation deleted another app cache.');
  assert(cacheInfo.assets.some((asset) => /pdf\.worker.*\.mjs$/.test(asset)), 'PDF worker is missing from the first installation cache.');
  assert(cacheInfo.assets.some((asset) => /\/detection\.worker[^/]*\.js$/.test(asset)), 'Room detection worker is missing from the first installation cache.');
  assert(cacheInfo.assets.some((asset) => /\/planReading\.worker[^/]*\.js$/.test(asset)), 'OCR coordinator is missing from the first installation cache.');
  for (const asset of ['worker.min.js', 'eng.traineddata.gz', 'tesseract-core.wasm.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) {
    const localUrl = new URL(`ocr/${asset}`, baseUrl).href;
    assert(cacheInfo.assets.includes(localUrl), `Local OCR resource missing from first-install cache: ${asset}`);
  }
  assert(cacheInfo.assets.every(asset => new URL(asset).origin === new URL(baseUrl).origin), 'Application cache must contain only same-origin resources.');
  assert.equal(cacheInfo.loadedPdf, false, 'PDF was loaded before the offline test, weakening the first-use check.');
  assert.deepEqual(cacheInfo.startedDetectors, [], 'Room detection was started before the offline test, weakening the first-use check.');
  assert.deepEqual(cacheInfo.startedReaders, [], 'OCR was started online, weakening the first-use offline check.');
  record('Fresh install caches all assets and preserves other apps', `${cacheInfo.assets.length} cached resources`);

  await page.getByLabel('Project name', { exact: true }).fill('Offline survey');
  await page.getByRole('button', { name: '+ Room', exact: true }).click();
  await page.getByLabel('Room name', { exact: true }).fill('Offline lounge');
  await page.getByLabel('Room length', { exact: true }).fill('5.7');
  await page.getByLabel('Room length', { exact: true }).press('Tab');
  await page.getByText('Saved in this browser', { exact: true }).waitFor();

  await context.setOffline(true);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('Project name', { exact: true }).inputValue(), 'Offline survey');
  await page.getByRole('button', { name: /^Offline lounge/ }).first().waitFor();
  record('First offline reload restores project and measurements');

  await page.getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.locator('input[type="file"][accept*="application/pdf"]').setInputFiles({
    name: 'offline-check.pdf', mimeType: 'application/pdf', buffer: samplePdf(),
  });
  await page.getByAltText('Floor plan: offline-check.pdf', { exact: true }).waitFor();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).project.floorPlans.length === 1, storageKey);
  const imported = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project.floorPlans[0], storageKey);
  assert(imported.imageDataUrl.startsWith('data:image/png;base64,'));
  assert(imported.widthPx > 0 && imported.heightPx > 0);
  await page.screenshot({ path: path.join(output, 'offline-pdf.png'), fullPage: true });
  record('First PDF import works completely offline', `${imported.widthPx} × ${imported.heightPx} raster`);

  assert.deepEqual(await page.evaluate(() => window.offlineReadingProbe.started), [], 'Useful PDF text must not start OCR.');
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles(path.join(root, 'scripts', 'fixtures', 'estate-plan.svg'));
  await page.getByAltText('Floor plan: estate-plan.svg', { exact: true }).waitFor();
  assert.equal(await page.locator('#current-floorplan option:checked').innerText(), 'estate-plan.svg');
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).project.floorPlans.find(plan => plan.name === 'estate-plan.svg')?.reading?.source === 'ocr', storageKey, { timeout: 60000 });
  const readPlan = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project.floorPlans.find(plan => plan.name === 'estate-plan.svg'), storageKey);
  const readingEvidence = await page.evaluate(() => window.offlineReadingProbe);
  assert.equal(readingEvidence.started.length, 1, 'First offline OCR must start its dedicated coordinator.');
  assert(readingEvidence.replies.some(reply => reply.type === 'complete'), 'The offline OCR worker did not return recognised text.');
  assert.match(readPlan.reading.text, /lounge/i, 'OCR must recognise an actual room label.');
  const loungeLabel = readPlan.reading.lines.find(line => /lounge/i.test(line.text));
  assert(loungeLabel, 'OCR must provide positional evidence for the room label.');
  assert(loungeLabel.x + loungeLabel.width / 2 > 230 && loungeLabel.x + loungeLabel.width / 2 < 330, 'Recognised label x must use original 960px plan coordinates.');
  assert(loungeLabel.y + loungeLabel.height / 2 > 150 && loungeLabel.y + loungeLabel.height / 2 < 220, 'Recognised label y must use original 700px plan coordinates.');
  assert.equal(readPlan.mmPerPx, undefined, 'OCR must not apply a scale automatically.');
  assert.equal(await page.getByRole('button', { name: 'Detect room', exact: true }).count(), 0, 'Room drawing tools stay out of the way until scale is set.');
  await page.screenshot({ path: path.join(output, 'offline-ocr-first-use.png'), fullPage: true });
  record('Automatic OCR recognition runs entirely offline with original plan coordinates', `Lounge label at ${loungeLabel.x.toFixed(1)}, ${loungeLabel.y.toFixed(1)}; calibration still required`);
  await tapPlan(86, 90);
  await tapPlan(434, 90);
  await inspector().getByLabel('Known distance', { exact: true }).fill('4.35');
  await inspector().getByLabel('Known distance', { exact: true }).press('Enter');
  assert.equal(await page.getByRole('button', { name: 'Detect room', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.evaluate(() => window.offlineDetectionProbe.started), [], 'Detector must first run after the browser goes offline.');
  const beforeDetection = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project.rooms.length, storageKey);
  await tapPlan(135, 240);
  await page.getByTestId('mode-review-outline').waitFor();
  const workerEvidence = await page.evaluate(() => window.offlineDetectionProbe);
  assert.equal(workerEvidence.started.length, 1, 'First offline detection did not create its dedicated worker.');
  assert(workerEvidence.replies.some((reply) => reply.ok), 'The cached room detector worker did not return a successful offline result.');
  assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project.rooms.length, storageKey), beforeDetection, 'Detection saved a room before review.');
  await page.screenshot({ path: path.join(output, 'offline-detected-outline.png'), fullPage: true });
  await inspector().getByLabel('Room name', { exact: true }).fill('Offline detected lounge');
  await inspector().getByRole('button', { name: 'Add room', exact: true }).click();
  await page.getByText('Saved in this browser', { exact: true }).waitFor();
  const detected = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project.rooms.find((room) => room.name === 'Offline detected lounge'), storageKey);
  const detectedResult = workerEvidence.replies.find(reply => reply.ok);
  assert.deepEqual(detected?.source?.pixelPolygon, detectedResult.polygon, 'Offline detection saves the complete reviewed outline, including doorway floor.');
  assert.equal((detectedResult.measurementPolygon ?? detectedResult.polygon).length, 4, 'The original structural room measurement remains rectangular.');
  assert(detectedResult.detectedDoorways.some(door => door.floorIncluded), 'The drawn door includes its floor recess.');
  assert(detected.source.pixelPolygon.some(point => point.y === 340), 'The actual floor extends to the shared straight threshold.');
  assert.equal(Math.max(...detected.shape.points.map((point) => point.x)), 4350);
  assert.equal(Math.max(...detected.shape.points.map((point) => point.y)), 3175);
  record('First room detection runs offline in its precached worker', 'Estate-agent lounge reviewed and saved at 4.35 m × 3.10 m plus its 75 mm doorway recess');

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreStorageWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) throw new DOMException('Smoke test quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByLabel('Project name', { exact: true }).fill('Unsaved survey changes');
  await page.getByText('Browser save failed', { exact: true }).waitFor();
  await page.getByText(/Browser storage is full/).waitFor();
  assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project.name, storageKey), 'Offline survey');
  await page.screenshot({ path: path.join(output, 'save-failure.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a backup file', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(backup.project.name, 'Unsaved survey changes');
  await page.getByText('Browser save failed', { exact: true }).waitFor();
  record('Quota failure is visible and file backup includes unsaved changes');

  await page.evaluate(() => window.restoreStorageWrites());
  await page.getByRole('button', { name: 'Retry browser save', exact: true }).click();
  await page.getByText('Saved in this browser', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('Project name', { exact: true }).inputValue(), 'Unsaved survey changes');
  const restored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project, storageKey);
  assert.equal(restored.rooms[0].shape.length, 5700);
  assert.equal(restored.floorPlans[0].name, 'offline-check.pdf');
  assert.equal(restored.floorPlans[1].name, 'estate-plan.svg');
  assert.equal(restored.floorPlans[1].reading?.source, 'ocr');
  assert.match(restored.floorPlans[1].reading.text, /lounge/i);
  assert.deepEqual(restored.rooms.find(room => room.name === 'Offline detected lounge')?.source?.pixelPolygon, detected.source.pixelPolygon);
  record('Retry save recovers all edits and imported plan across reload');

  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key));
    saved.project.products[0].rollWidth = 0;
    localStorage.setItem(key, JSON.stringify(saved));
  }, storageKey);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Check your restored project', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Project name', { exact: true }).inputValue(), 'Unsaved survey changes');
  await page.screenshot({ path: path.join(output, 'restore-notice.png'), fullPage: true });
  record('Repaired autosave displays a restore notice');

  assert.deepEqual(pageErrors, [], 'Uncaught browser errors were reported.');
  assert.deepEqual(externalRequests, [], 'Offline OCR or app code attempted to contact an external host.');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ baseUrl, passed, pageErrors, browserLog, externalRequests }, null, 2));
  console.log(`All ${passed.length} offline and persistence checks passed. Artifacts: ${output}`);
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  const diagnostic = await page.evaluate(async () => ({
    html: document.documentElement.outerHTML.slice(0, 2000),
    appStyle: document.querySelector('.app') ? { display: getComputedStyle(document.querySelector('.app')).display, visibility: getComputedStyle(document.querySelector('.app')).visibility, bounds: document.querySelector('.app').getBoundingClientRect().toJSON() } : null,
    controlled: Boolean(navigator.serviceWorker.controller),
    caches: await Promise.all((await caches.keys()).map(async (name) => ({ name, urls: (await (await caches.open(name)).keys()).map((request) => request.url) }))),
  })).catch(() => null);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ baseUrl, passed, pageErrors, browserLog, diagnostic, error: error.message }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
