/** Real rasterizer + module worker check. Run against the development server. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { assertDetectedFloor } from './fixtures/assert-detected-floor.mjs';

const paths = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? paths.find(existsSync) });
try {
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  const markup = await readFile(new URL('./fixtures/estate-plan.svg', import.meta.url), 'utf8');
  const output = await page.evaluate(async markup => {
    const source = new Image();
    await new Promise((resolve, reject) => {
      source.onload = resolve; source.onerror = reject;
      source.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0);
    const image = { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    const progress = [];
    const scan = excludePolygons => new Promise((resolve, reject) => {
      const worker = new Worker('/src/ui/floorplan/detection.worker.ts', { type: 'module' });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker timed out')); }, 15000);
      worker.onmessage = ({ data }) => {
        if (data.kind === 'progress') { progress.push(data.progress); return; }
        clearTimeout(timer); worker.terminate(); resolve(data);
      };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ kind: 'all', image, options: { mmPerPx: 12.5, excludePolygons } });
    });
    const first = await scan([]);
    const second = first.ok ? await scan(first.candidates.map(candidate => candidate.polygon)) : null;
    return { first, second, progress };
  }, markup);
  assert.equal(output.first.ok, true, output.first.reason);
  assert.equal(output.first.candidates.length, 3, 'Only the Lounge, Bedroom and Kitchen should be suggested');
  const bounds = output.first.candidates.map(candidate => {
    const measured = candidate.measurementPolygon ?? candidate.polygon;
    const xs = measured.map(point => point.x), ys = measured.map(point => point.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  });
  for (const expected of [
    { minX: 86, maxX: 434, minY: 86, maxY: 334 },
    { minX: 86, maxX: 434, minY: 346, maxY: 554 },
    { minX: 446, maxX: 794, minY: 86, maxY: 554 },
  ]) assert.ok(bounds.some(actual => JSON.stringify(actual) === JSON.stringify(expected)), `Missing room ${JSON.stringify(expected)}; got ${JSON.stringify(bounds)}`);
  assert.ok(output.first.candidates.every(candidate => (candidate.measurementPolygon ?? candidate.polygon).length === 4), 'Door swings should not deform structural room measurements');
  await assertDetectedFloor(page, output.first.candidates);
  assert.ok(output.first.candidates.every(candidate => candidate.inferredGaps.length >= 1), 'Supported door closures must be flagged for review');
  assert.equal(output.second.ok, true);
  assert.equal(output.second.candidates.length, 0, 'A repeated scan should exclude existing rooms');
  assert.ok(output.progress.includes(1), 'The worker should report completed progress');
  console.log(JSON.stringify({ rooms: bounds, inferredDoors: output.first.candidates.map(candidate => candidate.inferredGaps.length), repeatedScan: output.second.candidates.length }));
  console.log('Detect-all browser fixture passed: three separate room previews; furniture/exterior excluded and repeat scan deduplicated.');
} finally { await browser.close(); }
