/** Real OCR → suggested scale → one confirmation → room/straight-threshold review, plus PDF/corrected-text sources. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.OUT_DIR ?? 'test-results/automatic-scale';
const storageKey = 'flooring-estimator:project:v1';
const fixture = 'scripts/fixtures/clear-room-dimensions.svg';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(25000);
await page.addInitScript(() => {
  window.scaleDetectionReplies = [];
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(url, options) {
      super(url, options);
      if (String(url).includes('detection.worker')) this.addEventListener('message', event => {
        if (event.data.kind !== 'progress') window.scaleDetectionReplies.push(event.data);
      });
    }
  };
});
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const pass = message => { checks.push(message); console.log('PASS', message); };
const button = name => page.getByRole('button', { name, exact: true });
const project = () => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.project, storageKey);
const overlay = () => page.getByTestId('floorplan-overlay');
const area = points => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;
async function planTab() {
  await page.locator('nav.tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
}
async function point(x, y) {
  await overlay().scrollIntoViewIfNeeded();
  const at = await overlay().evaluate((svg, p) => {
    const q = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y };
  }, { x, y });
  await page.mouse.click(at.x, at.y);
}
async function waitSuggestion() {
  await page.getByTestId('automatic-scale-suggestion').waitFor({ timeout: 75000 });
  assert.equal((await project()).floorPlans[0].mmPerPx, undefined, 'The suggested scale must remain a preview until confirmation');
  assert.equal((await project()).rooms.length, 0);
  assert(await page.getByTestId('draft-scale-reference').isVisible());
  assert(!(await page.getByTestId('scale-canvas-instruction').innerText()).includes('Tap the first end'), 'Automatic preview must not ask for manual scale points');
}
async function installReading(snapshot, reading, suffix) {
  const restored = structuredClone(snapshot);
  restored.project.id += `-${suffix}`;
  restored.project.rooms = []; restored.project.staircases = [];
  const plan = restored.project.floorPlans[0];
  plan.id += `-${suffix}`; delete plan.mmPerPx; delete plan.calibration;
  plan.reading = reading;
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: restored });
  await page.reload(); await planTab();
}
const sourceLines = [
  { text: 'Lounge', x: 286, y: 218, width: 130, height: 34, confidence: 100 },
  { text: '4.88 m x 3.88 m', x: 236, y: 265, width: 228, height: 30, confidence: 100 },
  { text: 'Bedroom', x: 275, y: 698, width: 155, height: 34, confidence: 100 },
  { text: '4.88 m x 3.88 m', x: 236, y: 745, width: 228, height: 30, confidence: 100 },
  { text: 'Kitchen', x: 786, y: 548, width: 130, height: 34, confidence: 100 },
  { text: '4.88 m x 7.88 m', x: 736, y: 595, width: 228, height: 30, confidence: 100 },
];

/** A real one-page PDF: native text extraction independently exercises coordinate conversion. */
function dimensionPdf() {
  const drawing = '1 1 1 rg 0 0 600 500 re f 0 g 0 G 6 w 50 50 500 400 re S 300 50 m 300 450 l S 50 250 m 300 250 l S '
    + 'BT /F1 16 Tf 130 375 Td (Lounge) Tj ET BT /F1 14 Tf 110 354 Td (4.88 m x 3.88 m) Tj ET '
    + 'BT /F1 16 Tf 130 135 Td (Bedroom) Tj ET BT /F1 14 Tf 110 114 Td (4.88 m x 3.88 m) Tj ET '
    + 'BT /F1 16 Tf 390 280 Td (Kitchen) Tj ET BT /F1 14 Tf 360 259 Td (4.88 m x 7.88 m) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 500] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

try {
  await page.goto(base);
  await planTab();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles(fixture);
  await page.getByTestId('mode-scale').waitFor();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.project.floorPlans[0]?.reading?.source === 'ocr', storageKey, { timeout: 75000 });
  const actualReading = (await project()).floorPlans[0].reading;
  await writeFile(`${output}/actual-ocr.json`, JSON.stringify(actualReading, null, 2));
  await waitSuggestion();
  pass('A real uploaded image is read automatically and yields a scale preview without saving measurements');
  const cleanSnapshot = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  await page.locator('.fp-workspace').screenshot({ path: `${output}/01-suggested-scale.png` });
  await page.setViewportSize({ width: 390, height: 1000 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('.fp-inspector').screenshot({ path: `${output}/02-suggested-scale-phone.png` });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await button('Confirm scale & find rooms').click();
  await page.getByTestId('mode-detected-rooms').waitFor({ timeout: 30000 });
  const calibrated = (await project()).floorPlans[0];
  assert(Math.abs(calibrated.mmPerPx - 10) < .15, `Expected 10 mm/px, got ${calibrated.mmPerPx}`);
  assert.equal((await project()).rooms.length, 0, 'Confirming the scale must not silently add rooms');
  const reply = await page.evaluate(() => window.scaleDetectionReplies.findLast(result => result.ok && result.candidates));
  assert(reply && reply.candidates.length === 3, 'Confirmation should automatically run the real all-room worker');
  const doors = reply.candidates.flatMap(room => room.detectedDoorways ?? []);
  assert(doors.length >= 4, 'The two drawn doors should be measured from both adjoining rooms');
  assert(doors.every(door => door.floorIncluded === true), 'Each safe opening includes its floor beneath the door');
  assert(doors.every(door => Math.abs(Math.hypot(door.b.x - door.a.x, door.b.y - door.a.y) - 80) < .01), 'The full 80 px jamb-to-jamb width is retained despite the drawn leaf');
  for (const room of reply.candidates) {
    assert(room.measurementPolygon?.length, 'Core retains the structural room outline for scale comparison');
    assert(Math.abs(area(room.polygon) - area(room.measurementPolygon) - room.detectedDoorways.length * 80 * 6) < .01, 'Floor coverage adds the full 80 px opening through half of the 12 px wall');
  }
  // The fixture has orthogonal adjoining rooms: their bounding boxes may touch at the shared thresholds only.
  const bounds = reply.candidates.map(room => ({ x0: Math.min(...room.polygon.map(p => p.x)), x1: Math.max(...room.polygon.map(p => p.x)), y0: Math.min(...room.polygon.map(p => p.y)), y1: Math.max(...room.polygon.map(p => p.y)) }));
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i], b = bounds[j];
    assert(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) < .01 || Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) < .01, 'Shared thresholds must not make adjoining floor areas overlap');
  }
  assert.equal(await page.locator('.fp-detected-door-leaf, .fp-detected-door-swing').count(), 0, 'No reconstructed door swing or leaf may obscure the straight floor boundary');
  assert.equal(await page.locator('.fp-detected-door-threshold').count(), doors.length);
  await page.locator('.fp-workspace').screenshot({ path: `${output}/03-straight-threshold-review.png` });
  pass('One confirmation finds rooms; straight thresholds include doorway floor recesses while suggestions remain unsaved');
  await button('Add 3 selected rooms').click();
  const saved = (await project()).rooms;
  assert.equal(saved.length, 3);
  for (const room of saved) {
    assert(room.doorways.length > 0);
    const pixelPoints = room.source.pixelPolygon;
    const minX = Math.min(...pixelPoints.map(point => point.x)), minY = Math.min(...pixelPoints.map(point => point.y));
    assert.deepEqual(room.shape.points, pixelPoints.map(point => ({ x: Math.round(point.x * calibrated.mmPerPx) - Math.round(minX * calibrated.mmPerPx), y: Math.round(point.y * calibrated.mmPerPx) - Math.round(minY * calibrated.mmPerPx) })), 'Every reviewed threshold corner is saved at the measured scale, rounded to whole millimetres');
  }
  assert.equal(new Set(saved.flatMap(room => room.doorways.map(door => door.sharedOpeningId))).size, 2, 'One physical opening is shared between each pair of rooms');
  await page.reload();
  assert.deepEqual((await project()).rooms, saved);
  pass('Accepted room areas and shared threshold measurements survive reload');

  await installReading(cleanSnapshot, actualReading, 'manual-button');
  await waitSuggestion();
  await button('Set scale manually').click();
  assert.equal(await page.getByTestId('automatic-scale-suggestion').count(), 0);
  await point(106, 106); await point(594, 106);
  await page.getByLabel('Known distance', { exact: true }).fill('4.88m');
  await button('Set scale & continue').click();
  assert(Math.abs((await project()).floorPlans[0].mmPerPx - 10) < .01);
  assert.equal(await page.getByTestId('mode-detected-rooms').count(), 0, 'Manual fallback retains its existing workflow');
  pass('Manual fallback cancels the automatic preview and accepts an explicitly measured scale');

  await installReading(cleanSnapshot, actualReading, 'manual-tap');
  await waitSuggestion(); await point(106, 106);
  assert.equal(await page.getByTestId('automatic-scale-suggestion').count(), 0);
  assert.equal((await project()).floorPlans[0].mmPerPx, undefined);
  assert.match(await page.getByTestId('scale-canvas-instruction').innerText(), /other end/);
  pass('Tapping a manual reference dismisses the automatic proposal without committing it');

  const correctedLines = sourceLines.map(line => ({ ...line, confidence: 25, reviewed: true }));
  await installReading(cleanSnapshot, { source: 'ocr', lines: correctedLines, text: correctedLines.map(line => line.text).join('\n') }, 'corrected');
  await waitSuggestion();
  pass('Explicitly corrected OCR lines can supply the scale even when their original recognition confidence was low');

  const imperialLines = sourceLines.map(line => ({ ...line, text: line.text.includes('4.88') ? line.text.replace('4.88 m', "16ft 0in").replace('3.88 m', '12ft 9in').replace('7.88 m', '25ft 10in') : line.text }));
  await installReading(cleanSnapshot, { source: 'pdf', lines: imperialLines, text: imperialLines.map(line => line.text).join('\n') }, 'imperial');
  await waitSuggestion();
  assert.match(await page.getByTestId('automatic-scale-suggestion').innerText(), /16ft|25ft/);
  pass('Spatial PDF text containing feet and inches supplies a scale preview');

  // Import a real PDF into an isolated project so native text extraction is not mocked.
  await page.evaluate(key => localStorage.removeItem(key), storageKey); await page.reload(); await planTab();
  await page.getByLabel('Upload a floor plan (PNG, JPG or PDF)', { exact: true }).setInputFiles({ name: 'clear-dimensions.pdf', mimeType: 'application/pdf', buffer: dimensionPdf() });
  await waitSuggestion();
  assert.equal((await project()).floorPlans[0].reading.source, 'pdf');
  pass('A real PDF text layer yields a scale preview without waiting for image OCR');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, rawWorkerResult: reply }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, error: error.message, state: await project() }, null, 2));
  throw error;
} finally { await browser.close(); }
