/** Run after npm run build. Needs playwright; uses installed Chrome on Windows. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const url = process.env.BASE_URL ?? 'http://127.0.0.1:4173/';
const out = path.resolve('test-results/responsive');
await mkdir(out, { recursive: true });
let server;
try { await fetch(url); } catch {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', new URL(url).port || '4173'], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Preview is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const installed = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? installed.find((candidate) => existsSync(candidate)) });
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'en-GB', reducedMotion: 'reduce' });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  await page.goto(url);
  await page.locator('#project-actions-toggle').click();
  await page.getByRole('button', { name: 'Load example house', exact: true }).click();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    for (const tab of ['Rooms & stairs', 'Floor plan', 'Materials & options', 'Estimate']) {
      await page.getByRole('navigation', { name: 'Sections', exact: true }).getByRole('button', { name: tab, exact: true }).click();
      if (tab === 'Rooms & stairs') {
        if (width <= 800) {
          await page.getByLabel('Current space', { exact: true }).selectOption({ label: 'Bedroom 1' });
        } else {
          await page.locator('.sidebar-column').getByRole('button', { name: /^Bedroom 1 / }).click();
        }
        await page.getByRole('heading', { name: 'Bedroom 1', exact: true }).waitFor();
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      if (size.content > size.width + 1) {
        await page.screenshot({ path: path.join(out, `${width}-overflow.png`), fullPage: true });
        console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 15).map((el) => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right }))));
      }
      assert(size.content <= size.width + 1, `${width}px ${tab}: horizontal overflow (${size.content}px)`);
      const slug = tab.toLowerCase().replace(/[^a-z]+/g, '-');
      if (width === 1440 || width === 390) await page.screenshot({ path: path.join(out, `${width}-${slug}.png`) });
      console.log(`PASS ${width}px ${tab}: no page overflow`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Estimate sections', exact: true }).getByRole('button', { name: 'Cutting plans', exact: true }).click();
  const comparison = page.getByTestId('compare-table').first();
  await comparison.locator('xpath=ancestor::details[1]/summary').click();
  const choice = comparison.locator('button:not(:disabled)').first();
  const nextWidth = await choice.getAttribute('aria-label');
  await choice.click();
  assert(await comparison.getByRole('button', { name: nextWidth, exact: true }).isDisabled(), 'Chosen roll width should become selected');
  console.log('PASS roll-width selection updates the estimate');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  assert((await download).suggestedFilename().endsWith('.flooring.json'));
  console.log('PASS project backup download');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ media: 'print' });
  assert(await page.locator('.main-column').isVisible());
  assert(!(await page.locator('.sidebar-column').isVisible()));
  await page.pdf({ path: path.join(out, 'sample-estimate.pdf'), format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  console.log('PASS full estimate print layout; PDF written');
  assert.deepEqual(problems, [], 'No browser errors');
  console.log('Responsive smoke passed. Screenshots and PDF:', out);
} finally {
  await browser.close();
  server?.kill();
}
