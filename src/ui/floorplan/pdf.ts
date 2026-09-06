/**
 * Floor plan document import: PNG/JPG images and PDF pages, rasterised to a PNG data URL that fits
 * `MAX_PLAN_PX` on its long side (the store keeps the data URL, so this also bounds storage).
 *
 * pdf.js is ~1 MB, so it is loaded on demand the first time a PDF is opened rather than on start-up
 * (`import * as pdfjsLib from 'pdfjs-dist'` + the `?url` worker import, both deferred).
 */

/** Longest side of an imported raster, in pixels. */
export const MAX_PLAN_PX = 2400;
/** A portrait A4 PDF rendered 2400 px wide would be ~3400 px tall; cap the long side there. */
export const MAX_PDF_LONG_SIDE = 3400;

export interface PlanRaster {
  imageDataUrl: string;
  widthPx: number;
  heightPx: number;
}

export function isPdfFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name);
}

/** Draw any canvas-drawable source to a fresh canvas, downscaled to fit `maxPx`, and return a PNG data URL. */
export function rasterFromSource(src: CanvasImageSource, width: number, height: number, maxPx = MAX_PLAN_PX): PlanRaster {
  if (!(width > 0) || !(height > 0)) throw new Error('The image has no size.');
  const scale = Math.min(1, maxPx / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas drawing is not available in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return { imageDataUrl: canvas.toDataURL('image/png'), widthPx: canvas.width, heightPx: canvas.height };
}

/** Decode an image file in the browser and downscale it. */
export async function importImageFile(file: File): Promise<PlanRaster> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`"${file.name}" could not be decoded as an image.`));
      im.src = url;
    });
    return rasterFromSource(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PdfHandle {
  pageCount: number;
  /** Render one page (1-based) to a raster about `MAX_PLAN_PX` wide. */
  renderPage: (pageNumber: number) => Promise<PlanRaster>;
  destroy: () => Promise<void>;
}

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjsLib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
      pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjsLib;
    })().catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

/** Open a PDF file. The handle renders pages on demand; call `destroy()` when finished with it. */
export async function openPdf(file: File): Promise<PdfHandle> {
  const pdfjsLib = await loadPdfJs();
  const data = await file.arrayBuffer();
  let doc: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
  try {
    doc = await pdfjsLib.getDocument({ data }).promise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`"${file.name}" could not be opened as a PDF${msg ? ` (${msg})` : ''}.`);
  }
  return {
    pageCount: doc.numPages,
    async renderPage(pageNumber: number) {
      const n = Math.min(Math.max(1, Math.floor(pageNumber)), doc.numPages);
      const page = await doc.getPage(n);
      try {
        const base = page.getViewport({ scale: 1 });
        let scale = MAX_PLAN_PX / base.width;
        const longSide = Math.max(base.width, base.height) * scale;
        if (longSide > MAX_PDF_LONG_SIDE) scale *= MAX_PDF_LONG_SIDE / longSide;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas drawing is not available in this browser.');
        await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
        return { imageDataUrl: canvas.toDataURL('image/png'), widthPx: canvas.width, heightPx: canvas.height };
      } finally {
        page.cleanup();
      }
    },
    destroy: () => doc.destroy(),
  };
}
