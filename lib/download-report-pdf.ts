'use client';

type DownloadReportPdfOptions = {
  element: HTMLElement;
  fileName: string;
  pdfAttachments?: Array<{ name: string; url: string }>;
};

export async function downloadReportPdf({
  element,
  fileName,
  pdfAttachments = [],
}: DownloadReportPdfOptions) {
  await waitForImages(element);
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ]);
  const contentWidth = Math.max(element.scrollWidth, element.offsetWidth, 1);
  const contentHeight = Math.max(element.scrollHeight, element.offsetHeight, 1);
  const deviceMemory =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const constrainedDevice =
    window.matchMedia('(max-width: 768px)').matches || deviceMemory <= 4;
  const maxCanvasDimension = constrainedDevice ? 16_000 : 28_000;
  const maxCanvasPixels = constrainedDevice ? 8_000_000 : 20_000_000;
  const scale = Math.min(
    window.devicePixelRatio || 1,
    constrainedDevice ? 1 : 1.35,
    maxCanvasDimension / contentWidth,
    maxCanvasDimension / contentHeight,
    Math.sqrt(maxCanvasPixels / (contentWidth * contentHeight)),
  );
  if (!Number.isFinite(scale) || scale < 0.22) {
    throw new Error(
      'Este relatório ficou grande demais. Gere novamente sem as fotos.',
    );
  }
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    height: contentHeight,
    imageTimeout: 15_000,
    logging: false,
    scale,
    useCORS: true,
    width: contentWidth,
    windowWidth: contentWidth,
  });
  if (!canvas.width || !canvas.height) {
    throw new Error('O relatório não possui conteúdo para baixar.');
  }

  const pdf = new jsPDF({
    compress: true,
    format: 'a4',
    orientation: 'portrait',
    unit: 'pt',
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const printableWidth = pageWidth - margin * 2;
  const printableHeight = pageHeight - margin * 2;
  const pixelsPerPage = Math.max(
    1,
    Math.floor((printableHeight * canvas.width) / printableWidth),
  );
  const breakRanges = reportBreakRanges(element, canvas.height / contentHeight);
  const pageCanvas = document.createElement('canvas');
  const context = pageCanvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Não foi possível preparar o PDF.');

  let sourceY = 0;
  let pageIndex = 0;
  while (sourceY < canvas.height) {
    const maximumSliceHeight = Math.min(pixelsPerPage, canvas.height - sourceY);
    const sliceHeight = chooseSliceHeight(
      sourceY,
      maximumSliceHeight,
      breakRanges,
    );
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );
    if (pageIndex > 0) pdf.addPage();
    const renderedHeight = (sliceHeight * printableWidth) / canvas.width;
    pdf.addImage(
      pageCanvas.toDataURL('image/jpeg', 0.86),
      'JPEG',
      margin,
      margin,
      printableWidth,
      renderedHeight,
      undefined,
      'FAST',
    );
    sourceY += sliceHeight;
    pageIndex += 1;
  }

  const basePdf = pdf.output('arraybuffer');
  canvas.width = 1;
  canvas.height = 1;
  pageCanvas.width = 1;
  pageCanvas.height = 1;

  const blob = pdfAttachments.length
    ? await appendPdfAttachments(basePdf, pdfAttachments)
    : new Blob([basePdf], { type: 'application/pdf' });
  downloadBlob(blob, safePdfName(fileName));
}

function reportBreakRanges(element: HTMLElement, scaleY: number) {
  const rootTop = element.getBoundingClientRect().top;
  return Array.from(
    element.querySelectorAll<HTMLElement>('.report-row, .report-section'),
  )
    .map((section) => {
      const box = section.getBoundingClientRect();
      return {
        top: Math.max(0, Math.round((box.top - rootTop) * scaleY)),
        bottom: Math.max(0, Math.round((box.bottom - rootTop) * scaleY)),
      };
    })
    .filter((range) => range.bottom > range.top)
    .sort((left, right) => left.top - right.top);
}

function chooseSliceHeight(
  sourceY: number,
  maximumSliceHeight: number,
  ranges: Array<{ top: number; bottom: number }>,
) {
  const idealEnd = sourceY + maximumSliceHeight;
  const minimumUsefulEnd = sourceY + maximumSliceHeight * 0.25;
  const breakBefore = ranges
    .filter(
      (range) =>
        range.top >= minimumUsefulEnd &&
        range.top < idealEnd &&
        range.bottom > idealEnd &&
        range.bottom - range.top < maximumSliceHeight * 0.92,
    )
    .at(-1)?.top;
  return Math.max(1, Math.floor((breakBefore ?? idealEnd) - sourceY));
}

async function appendPdfAttachments(
  basePdf: ArrayBuffer,
  attachments: Array<{ name: string; url: string }>,
) {
  const { PDFDocument } = await import('pdf-lib');
  const combined = await PDFDocument.load(basePdf);
  let appendedPages = 0;

  for (const attachment of attachments) {
    try {
      const response = await fetch(attachment.url, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('download failed');
      const source = await PDFDocument.load(await response.arrayBuffer());
      appendedPages += source.getPageCount();
      if (appendedPages > 200) {
        throw new Error('page limit exceeded');
      }
      const pages = await combined.copyPages(source, source.getPageIndices());
      pages.forEach((page) => combined.addPage(page));
    } catch {
      throw new Error(
        `Não foi possível incluir o comprovante ${attachment.name}. Baixe sem os comprovantes ou envie o arquivo novamente.`,
      );
    }
  }

  const bytes = await combined.save({ useObjectStreams: true });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/pdf' });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function waitForImages(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) {
        try {
          await image.decode();
        } catch {
          // O relatório ainda pode registrar o arquivo mesmo sem pré-visualização.
        }
        return;
      }
      await Promise.race([
        new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        }),
        new Promise<void>((resolve) => window.setTimeout(resolve, 8_000)),
      ]);
    }),
  );
}

function safePdfName(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${normalized || 'relatorio'}.pdf`;
}
