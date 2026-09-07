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
const analysisByFile = new WeakMap<
  File,
  Promise<ReceiptAmountSuggestion | null>
>();

const LANGUAGE_CACHE_PATH = 'atacadoapple-receipt-ocr-v1';
const LANGUAGE_CACHE_KEY = `${LANGUAGE_CACHE_PATH}/por.traineddata`;
const FILE_READ_TIMEOUT_MS = 15_000;
const PDF_DEPENDENCY_TIMEOUT_MS = 10_000;
const PDF_LOAD_TIMEOUT_MS = 25_000;
const PDF_PROCESS_TIMEOUT_MS = 35_000;
const WORKER_DEPENDENCY_TIMEOUT_MS = 10_000;
const LANGUAGE_CACHE_TIMEOUT_MS = 8_000;
const LANGUAGE_DOWNLOAD_TIMEOUT_MS = 20_000;
const WORKER_INITIALIZATION_TIMEOUT_MS = 45_000;
const RECOGNITION_TIMEOUT_MS = 50_000;
const RESOURCE_CLEANUP_TIMEOUT_MS = 5_000;

export async function readReceiptAmount(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ReceiptAmountSuggestion | null> {
  const existing = analysisByFile.get(file);
  if (existing) return existing;

  const task = analysisQueue.then(() => readReceiptAmountNow(file, onProgress));
  analysisByFile.set(file, task);
  analysisQueue = task.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await task;
  } catch (error) {
    analysisByFile.delete(file);
    throw error;
  }
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
  const pdfjs = await withDeadline(
    import('pdfjs-dist'),
    PDF_DEPENDENCY_TIMEOUT_MS,
    'A leitura do PDF demorou demais. Informe o valor manualmente.',
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const fileData = await withDeadline(
    file.arrayBuffer(),
    FILE_READ_TIMEOUT_MS,
    'Não foi possível abrir este comprovante. Informe o valor manualmente.',
  );
  const task = pdfjs.getDocument({
    data: new Uint8Array(fileData),
    useWorkerFetch: true,
  });
  let disposalPromise: Promise<void> | null = null;
  const disposeTaskOnce = () => {
    disposalPromise ??= disposePdfTask(task);
    return disposalPromise;
  };
  let document: Awaited<typeof task.promise> | null = null;
  try {
    document = await withDeadline(
      task.promise,
      PDF_LOAD_TIMEOUT_MS,
      'O PDF demorou demais para abrir. Informe o valor manualmente.',
      () => {
        void disposeTaskOnce();
      },
    );
    const loadedDocument = document;
    return await withDeadline(
      (async () => {
        let text = '';
        const pagesToRead = Math.min(loadedDocument.numPages, 3);
        for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
          const page = await loadedDocument.getPage(pageNumber);
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

        const page = await loadedDocument.getPage(1);
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
      })(),
      PDF_PROCESS_TIMEOUT_MS,
      'A análise do PDF demorou demais. Informe o valor manualmente.',
      () => {
        void disposeTaskOnce();
      },
    );
  } finally {
    if (document && !disposalPromise) {
      await ignoreCleanupFailure(() => document?.cleanup());
    }
    await disposeTaskOnce();
  }
}

async function recognizeImage(
  image: File | HTMLCanvasElement,
  onProgress?: (progress: number) => void,
) {
  let worker: OcrWorker | null = null;
  let workerCanBeReused = false;
  try {
    onProgress?.(0.4);
    worker = await getWorker();
    onProgress?.(0.65);
    const result = await withDeadline(
      worker.recognize(image),
      RECOGNITION_TIMEOUT_MS,
      'A leitura automática demorou demais. Informe o valor manualmente.',
    );
    const suggestion = extractReceiptAmount(result.data.text);
    workerCanBeReused = true;
    onProgress?.(1);
    return suggestion;
  } finally {
    if (workerCanBeReused) {
      scheduleWorkerCleanup();
    } else if (worker) {
      await discardWorker(worker);
    }
  }
}

async function getWorker(): Promise<OcrWorker> {
  if (workerCleanupTimer !== null) {
    window.clearTimeout(workerCleanupTimer);
    workerCleanupTimer = null;
  }
  workerPromise ??= (async () => {
    const [tesseract, { get, set }] = await withDeadline(
      Promise.all([import('tesseract.js'), import('idb-keyval')]),
      WORKER_DEPENDENCY_TIMEOUT_MS,
      'Não foi possível iniciar a leitura automática a tempo.',
    );
    const cachedLanguage = await withDeadline(
      get<Uint8Array>(LANGUAGE_CACHE_KEY),
      LANGUAGE_CACHE_TIMEOUT_MS,
      'Não foi possível acessar os dados da leitura automática.',
    );
    if (!(cachedLanguage instanceof Uint8Array)) {
      const downloadController = new AbortController();
      const languageResponse = await withDeadline(
        fetch(portugueseDataUrl, { signal: downloadController.signal }),
        LANGUAGE_DOWNLOAD_TIMEOUT_MS,
        'Não foi possível carregar a leitura de comprovantes a tempo.',
        () => downloadController.abort(),
      );
      if (!languageResponse.ok) {
        throw new Error('Não foi possível carregar a leitura de comprovantes.');
      }
      const languageData = await withDeadline(
        languageResponse.arrayBuffer(),
        LANGUAGE_DOWNLOAD_TIMEOUT_MS,
        'Não foi possível carregar a leitura de comprovantes a tempo.',
        () => downloadController.abort(),
      );
      await withDeadline(
        set(LANGUAGE_CACHE_KEY, new Uint8Array(languageData)),
        LANGUAGE_CACHE_TIMEOUT_MS,
        'Não foi possível preparar a leitura automática.',
      );
    }

    let rejectInitialization: (reason: unknown) => void = () => {};
    const initializationFailure = new Promise<never>((_, reject) => {
      rejectInitialization = reject;
    });
    const creationPromise = tesseract.createWorker('por', undefined, {
      cacheMethod: 'readOnly',
      cachePath: LANGUAGE_CACHE_PATH,
      corePath: tesseractCoreUrl,
      errorHandler: (reason) => rejectInitialization(new Error(String(reason))),
      langPath: new URL('/ocr-language-cache', window.location.origin).href,
      workerBlobURL: false,
      workerPath: tesseractWorkerUrl,
    });

    try {
      return await withDeadline(
        Promise.race([creationPromise, initializationFailure]),
        WORKER_INITIALIZATION_TIMEOUT_MS,
        'A leitura automática demorou demais para iniciar. Informe o valor manualmente.',
      );
    } catch (error) {
      void creationPromise.then(terminateWorker).catch(() => {});
      throw error;
    }
  })();
  const currentWorkerPromise = workerPromise;
  try {
    return await currentWorkerPromise;
  } catch (error) {
    if (workerPromise === currentWorkerPromise) workerPromise = null;
    throw error;
  }
}

async function discardWorker(worker: OcrWorker) {
  if (workerCleanupTimer !== null) {
    window.clearTimeout(workerCleanupTimer);
    workerCleanupTimer = null;
  }
  workerPromise = null;
  await terminateWorker(worker);
}

async function terminateWorker(worker: OcrWorker) {
  await ignoreCleanupFailure(() => worker.terminate());
}

async function disposePdfTask(task: { destroy: () => Promise<void> }) {
  await ignoreCleanupFailure(() => task.destroy());
}

async function ignoreCleanupFailure(action: () => unknown) {
  try {
    await withDeadline(
      Promise.resolve().then(action),
      RESOURCE_CLEANUP_TIMEOUT_MS,
      'Tempo de encerramento excedido.',
    );
  } catch {
    // A fila deve seguir mesmo se a biblioteca não conseguir encerrar o recurso.
  }
}

function withDeadline<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout?.();
      } catch {
        // O prazo continua valendo mesmo se a tentativa de cancelar falhar.
      }
      reject(new Error(message));
    }, timeoutMs);

    void Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
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
      void workerToClose.then(terminateWorker).catch(() => {});
    }
  }, 45_000);
}
