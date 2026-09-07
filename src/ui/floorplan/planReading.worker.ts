import { createWorker, PSM } from 'tesseract.js';
import type { PlanReading } from '@engine/types';

export type ReadingReply = { type: 'progress'; progress: number } | { type: 'complete'; reading: PlanReading } | { type: 'error'; message: string };
export interface ReadingRequest { imageDataUrl: string; assetBase: string }

/** The coordinator owns the OCR child worker, so cancellation also works during language loading. */
const scope = self as unknown as { onmessage: ((event: MessageEvent<ReadingRequest>) => void) | null; postMessage: (message: ReadingReply) => void };
scope.onmessage = async ({ data: request }) => {
  let failed = false;
  const fail = (error: unknown) => {
    if (failed) return;
    failed = true;
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : typeof error === 'string' ? error : 'The recognition engine could not read this image.' });
  };
  try {
    // Small estate-agent images often lose decimal points at their native text size.
    // Enlarge for recognition while keeping every returned box in original plan pixels.
    let input: string | OffscreenCanvas = request.imageDataUrl;
    let sx = 1, sy = 1;
    if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined') {
      const bitmap = await createImageBitmap(await (await fetch(request.imageDataUrl)).blob());
      try {
        const factor = Math.max(1, Math.min(2.5, 2400 / Math.max(bitmap.width, bitmap.height)));
        if (factor > 1) {
          const canvas = new OffscreenCanvas(Math.round(bitmap.width * factor), Math.round(bitmap.height * factor));
          const context = canvas.getContext('2d');
          if (context) {
            context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            sx = canvas.width / bitmap.width; sy = canvas.height / bitmap.height; input = canvas;
          }
        }
      } finally { bitmap.close(); }
    }
    const worker = await createWorker('eng', 1, {
      workerPath: `${request.assetBase}worker.min.js`, corePath: request.assetBase, langPath: request.assetBase, workerBlobURL: false,
      logger: event => { if (!failed) scope.postMessage({ type: 'progress', progress: event.status === 'recognizing text' ? Math.round(20 + event.progress * 80) : Math.round(event.progress * 20) }); },
      // Tesseract's initialization promise does not reject for every language-loading error.
      errorHandler: fail,
    });
    try {
      if (failed) return;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
      if (failed) return;
      const lines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)).slice(0, 2000).map(line => ({
        text: line.text.trim().slice(0, 500), x: line.bbox.x0 / sx, y: line.bbox.y0 / sy,
        width: (line.bbox.x1 - line.bbox.x0) / sx, height: (line.bbox.y1 - line.bbox.y0) / sy, confidence: line.confidence,
      }));
      scope.postMessage({ type: 'complete', reading: { source: 'ocr', text: data.text.slice(0, 50000), lines } });
    } finally { await worker.terminate(); }
  } catch (error) { fail(error); }
};
