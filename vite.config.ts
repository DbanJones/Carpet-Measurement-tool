/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * Stamp the built service worker with a build id and the complete generated asset list.
 *
 * `public/sw.js` is copied verbatim into dist, so without this its `CACHE_VERSION` would be the same
 * string for ever: `activate` would never delete the previous cache and an installed app could sit
 * on an old build's assets. The id is a hash of the built index.html, which names every hashed
 * bundle — so it changes exactly when the app does, and not otherwise (the build stays reproducible).
 */
function swBuildId(): Plugin {
  return {
    name: 'sw-build-id',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist', import.meta.url));
      const sw = `${dist}/sw.js`;
      const html = `${dist}/index.html`;
      if (!existsSync(sw) || !existsSync(html)) return;
      const listAssets = (relative: string): string[] => readdirSync(`${dist}/${relative}`, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? listAssets(`${relative}/${entry.name}`) : [`./${relative}/${entry.name}`],
      );
      const assets = ['assets', 'ocr'].flatMap(directory => existsSync(`${dist}/${directory}`) ? listAssets(directory) : []).sort();
      const hash = createHash('sha256').update(readFileSync(html)).update(JSON.stringify(assets));
      // OCR uses fixed filenames: include their bytes so an OCR update changes the cache too.
      assets.filter(path => path.startsWith('./ocr/')).forEach(path => hash.update(readFileSync(`${dist}/${path}`)));
      const id = hash.digest('hex').slice(0, 12);
      writeFileSync(sw, readFileSync(sw, 'utf8')
        .replace(/__BUILD_ID__/g, id)
        .replace('/* __PRECACHE_ASSETS__ */ []', JSON.stringify(assets)));
    },
  };
}

// `base: './'` makes the built site relocatable (GitHub Pages, Netlify, a sub-folder on any host).
export default defineConfig({
  base: './',
  plugins: [react(), swBuildId()],
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@store': fileURLToPath(new URL('./src/store', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // No source maps in the published build: they are 2.7 MB of the payload, are served publicly by
    // the Pages workflow, and are of no use to the trade audience. `npm run dev` still has them.
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    globals: true,
    css: { include: [/client-pack\.css/] },
    // Avoid saturating the workstation with many simultaneous jsdom + browser test processes.
    maxWorkers: 2,
    // The engine is pure and runs in node; the UI and the store need a DOM. Expressed as projects
    // (the supported split since Vitest 3.2) rather than the deprecated `environmentMatchGlobs`,
    // which is removed in Vitest 4 — and would have silently run 200+ DOM tests in node.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          // everything that is not the UI or the store: the engine today, plus anything added later
          exclude: ['src/ui/**', 'src/store/**', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['src/ui/**/*.test.{ts,tsx}', 'src/store/**/*.test.{ts,tsx}'] },
      },
    ],
  },
});
