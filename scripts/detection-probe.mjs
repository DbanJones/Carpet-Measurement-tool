/** Developer fixture check against the real browser rasterizer and detection worker. Vite must be running. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { assertDetectedFloor } from './fixtures/assert-detected-floor.mjs';

const paths = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? paths.find((candidate) => existsSync(candidate)) });
try {
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5173/');
  const svg = await readFile(new URL('./fixtures/estate-plan.svg', import.meta.url), 'utf8');
  const results = await page.evaluate(async (markup) => {
    const image = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const raster = { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    const seeds = [{ name: 'Lounge', x: 135, y: 240 }, { name: 'Bedroom', x: 330, y: 510 }, { name: 'Kitchen', x: 650, y: 410 }];
    const results = [];
    for (const seed of seeds) {
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker('/src/ui/floorplan/detection.worker.ts', { type: 'module' });
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker timed out')); }, 10000);
        worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
        worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage({ image: raster, seed, options: { mmPerPx: 12.5 } });
      });
      results.push({ name: seed.name, ...result });
    }
    return results;
  }, svg);
  for (const result of results) {
    console.log(JSON.stringify(result));
    assert.equal(result.ok, true, `${result.name}: ${result.reason}`);
    const measured = result.measurementPolygon ?? result.polygon;
    const xs = measured.map((p) => p.x), ys = measured.map((p) => p.y);
    const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    if (result.name === 'Lounge') assert.deepEqual(bounds, { minX: 86, maxX: 434, minY: 86, maxY: 334 });
    if (result.name === 'Bedroom') assert.deepEqual(bounds, { minX: 86, maxX: 434, minY: 346, maxY: 554 });
    if (result.name === 'Kitchen') assert.deepEqual(bounds, { minX: 446, maxX: 794, minY: 86, maxY: 554 });
  }
  await assertDetectedFloor(page, results);
  console.log('Estate-plan detection fixture passed in Chromium with three separate room previews.');
} finally { await browser.close(); }
