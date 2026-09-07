import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Reproducible, same-origin OCR assets. No floor-plan images go to a remote service.
const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, 'public', 'ocr');
await mkdir(target, { recursive: true });
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ...['tesseract-core', 'tesseract-core-simd', 'tesseract-core-lstm', 'tesseract-core-simd-lstm'].map(name => [`tesseract.js-core/${name}.wasm.js`, `${name}.wasm.js`]),
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ['tesseract.js/LICENSE.md', 'TESSERACT-LICENSE.md'],
];
await Promise.all(files.map(([source, destination]) => copyFile(join(root, 'node_modules', source), join(target, destination))));
