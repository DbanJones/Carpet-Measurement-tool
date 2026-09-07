/** Real SVG rasterisation and detect-all worker; no injected OCR labels or detector results. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { doorwayFixtures } from './fixtures/doorway-plans.mjs';
import { assertDetectedFloor } from './fixtures/assert-detected-floor.mjs';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const output = process.env.OUT_DIR ?? 'test-results/doorway-detection';
await mkdir(output, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const fixtures = doorwayFixtures(await readFile(new URL('./fixtures/estate-plan.svg', import.meta.url), 'utf8'));
const reports = [];
const failures = [];
try {
  await page.goto(base);
  for (const fixture of fixtures) {
    const result = await page.evaluate(async markup => {
      const source = new Image();
      await new Promise((resolve, reject) => { source.onload = resolve; source.onerror = reject; source.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`; });
      const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
      const context = canvas.getContext('2d'); context.drawImage(source, 0, 0);
      const image = { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
      return await new Promise((resolve, reject) => {
        const worker = new Worker('/src/ui/floorplan/detection.worker.ts', { type: 'module' });
        const started = performance.now();
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Doorway worker timed out')); }, 30000);
        worker.onmessage = ({ data }) => { if (data.kind === 'progress') return; clearTimeout(timer); worker.terminate(); resolve({ ...data, elapsedMs: performance.now() - started }); };
        worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage({ kind: 'all', image, options: { mmPerPx: 12.5 } });
      });
    }, fixture.markup);
    reports.push({ name: fixture.name, ...result });
    try {
    assert.equal(result.ok, true, `${fixture.name}: ${result.reason}`);
    assert.equal(result.candidates.length, 3, `${fixture.name}: room count must be unchanged`);
    assert(result.candidates.every(candidate => (candidate.measurementPolygon ?? candidate.polygon).length === 4), `${fixture.name}: door symbols must not distort structural room measurements`);
    await assertDetectedFloor(page, result.candidates, fixture.name);
    const doors = result.candidates.flatMap(candidate => candidate.detectedDoorways ?? []);
    assert(doors.length >= fixture.minDoors, `${fixture.name}: expected at least ${fixture.minDoors} evidenced room doorways, got ${doors.length}`);
    if (fixture.maxDoors !== undefined) assert(doors.length <= fixture.maxDoors, `${fixture.name}: plain gaps or furniture must not automatically become doors`);
    for (const door of doors) {
      const mid = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
      assert(fixture.openings.some(opening => Math.hypot(mid.x - opening.x, mid.y - opening.y) <= 18), `${fixture.name}: door must be at a real drawn opening, got ${JSON.stringify(door)}`);
      assert(['swing-arc', 'door-leaf'].includes(door.evidence));
      assert(['high', 'medium'].includes(door.confidence));
      if (fixture.onlyEvidence) assert.equal(door.evidence, fixture.onlyEvidence);
      assert(Math.hypot(door.a.x - door.b.x, door.a.y - door.b.y) * 12.5 >= 400, 'Door width remains a measured opening');
    }
    console.log(`PASS ${fixture.name}: ${result.candidates.length} rooms, ${doors.length} evidenced room doorways (${Math.round(result.elapsedMs)} ms)`);
    } catch (error) { failures.push(error.message); console.log(`FAIL ${fixture.name}: ${error.message}`); }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, [], failures.join('\n'));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ base, reports, errors, failures }, null, 2));
  await browser.close();
}
