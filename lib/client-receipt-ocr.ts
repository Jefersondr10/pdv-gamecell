'use client';

import portugueseDataUrl from '@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz?url';
// oxlint-disable-next-line import/default -- Vite exposes a URL string for ?url assets.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

import {
  extractReceiptAmount,
  type ReceiptAmountSuggestion,
} from './receipt-amount.ts';

type OcrWorker = {
  recognize: (image: File | HTMLCanvasElement) => Promise<{
    data: { text: string };
  }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<OcrWorker> | null = null;
let analysisQueue = Promise.resolve();
let workerCleanupTimer: number | null = null;

const LANGUAGE_CACHE_PATH = 'atacadoapple-receipt-ocr-v1';
const LANGUAGE_CACHE_KEY = `${LANGUAGE_CACHE_PATH}/por.traineddata`;

export async function readReceiptAmount(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ReceiptAmountSuggestion | null> {
  const task = analysisQueue.then(() => readReceiptAmountNow(file, onProgress));
  analysisQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function readReceiptAmountNow(
  file: File,
  onProgress?: (progress: number) => void,
) {
  onProgress?.(0.05);
  if (file.type === 'application/pdf') {
    const pdfResult = await readPdf(file, onProgress);
    if (pdfResult.suggestion) return pdfResult.suggestion;
    if (!pdfResult.canvas) return null;
    return recognizeImage(pdfResult.canvas, onProgress);
  }
  return recognizeImage(file, onProgress);
}

async function readPdf(file: File, onProgress?: (progress: number) => void) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWorkerFetch: true,
  });
  const document = await task.promise;
  try {
    let text = '';
    const pagesToRead = Math.min(document.numPages, 3);
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      text += `${content.items
        .map((item) =>
          'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '',
        )
        .join('')}\n`;
      onProgress?.(0.1 + (pageNumber / pagesToRead) * 0.2);
    }
    const suggestion = extractReceiptAmount(text);
    if (suggestion) return { canvas: null, suggestion };

    const page = await document.getPage(1);
    const initialViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      2,
      1_800 / Math.max(initialViewport.width, initialViewport.height),
    );
    const viewport = page.getViewport({ scale: Math.max(1.25, scale) });
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    onProgress?.(0.35);
    return { canvas, suggestion: null };
  } finally {
    await document.cleanup();
    await task.destroy();
  }
}

async function recognizeImage(
  image: File | HTMLCanvasElement,
  onProgress?: (progress: number) => void,
) {
  const run = async () => {
    try {
      onProgress?.(0.4);
      const worker = await getWorker();
      onProgress?.(0.65);
      const result = await worker.recognize(image);
      onProgress?.(1);
      return extractReceiptAmount(result.data.text);
    } finally {
      scheduleWorkerCleanup();
    }
  };
  return run();
}

async function getWorker(): Promise<OcrWorker> {
  if (workerCleanupTimer !== null) {
    window.clearTimeout(workerCleanupTimer);
    workerCleanupTimer = null;
  }
  workerPromise ??= (async () => {
    const [tesseract, { get, set }] = await Promise.all([
      import('tesseract.js'),
      import('idb-keyval'),
    ]);
    const cachedLanguage = await get<Uint8Array>(LANGUAGE_CACHE_KEY);
    if (!(cachedLanguage instanceof Uint8Array)) {
      const languageResponse = await fetch(portugueseDataUrl);
      if (!languageResponse.ok) {
        throw new Error('Não foi possível carregar a leitura de comprovantes.');
      }
      await set(
        LANGUAGE_CACHE_KEY,
        new Uint8Array(await languageResponse.arrayBuffer()),
      );
    }

    let rejectInitialization: (reason: unknown) => void = () => {};
    const initializationFailure = new Promise<never>((_, reject) => {
      rejectInitialization = reject;
    });
    let timeoutId: number | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () =>
          reject(
            new Error(
              'A leitura automática demorou demais. Informe o valor manualmente.',
            ),
          ),
        45_000,
      );
    });

    try {
      return await Promise.race([
        tesseract.createWorker('por', undefined, {
          cacheMethod: 'readOnly',
          cachePath: LANGUAGE_CACHE_PATH,
          corePath: tesseractCoreUrl,
          errorHandler: (reason) =>
            rejectInitialization(new Error(String(reason))),
          langPath: new URL('/ocr-language-cache', window.location.origin).href,
          workerBlobURL: false,
          workerPath: tesseractWorkerUrl,
        }),
        initializationFailure,
        timeout,
      ]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  })();
  try {
    return await workerPromise;
  } catch (error) {
    workerPromise = null;
    throw error;
  }
}

function scheduleWorkerCleanup() {
  if (workerCleanupTimer !== null) {
    window.clearTimeout(workerCleanupTimer);
  }
  workerCleanupTimer = window.setTimeout(() => {
    const workerToClose = workerPromise;
    workerPromise = null;
    workerCleanupTimer = null;
    if (workerToClose) {
      void workerToClose.then((worker) => worker.terminate()).catch(() => {});
    }
  }, 45_000);
}
