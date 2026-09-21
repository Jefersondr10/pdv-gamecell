'use client';
// oxlint-disable-next-line import/default -- Vite worker URL.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** Convert every page, sequentially, without changing the stored original. */
export async function* receiptPdfImages(
  bytes: Uint8Array,
): AsyncGenerator<Uint8Array> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const task = pdfjs.getDocument({ data: bytes.slice() });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pdf = await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('O PDF demorou para abrir. Tente novamente.')),
          30_000,
        );
      }),
    ]);
    clearTimeout(timer);
    if (pdf.numPages > 30)
      throw new Error(
        'Um comprovante excede 30 páginas. Use o PDF original ou reduza os anexos.',
      );
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 2200 / Math.max(natural.width, natural.height)),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const render = page.render({ canvas, viewport, background: '#ffffff' });
      try {
        await Promise.race([
          render.promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              render.cancel();
              reject(
                new Error(
                  'Não foi possível converter uma página do comprovante.',
                ),
              );
            }, 30_000);
          }),
        ]);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value
                ? resolve(value)
                : reject(new Error('Imagem do PDF indisponível.')),
            'image/jpeg',
            0.9,
          ),
        );
        yield new Uint8Array(await blob.arrayBuffer());
      } finally {
        clearTimeout(timer);
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
