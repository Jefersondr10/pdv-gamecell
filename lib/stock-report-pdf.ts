import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFPage, PDFFont } from 'pdf-lib';
import type { AttachmentRecord } from './pdv-types';
import { productColorValue } from './product-color.ts';
import { summarizeStockByMemory } from './stock-report-summary.ts';
import { loadReportAsset } from './sales-report-pdf.ts';

export type StockPdfRow = {
  model: string;
  color: string;
  memory: string;
  available: number;
  serials: string[];
  photos: AttachmentRecord[];
};
export type StockPdfOptions = {
  rows: readonly StockPdfRow[];
  storeName: string;
  generatedAt: number;
  level: 'summary' | 'serials';
  includePhotos?: boolean;
};
const W = 595.28,
  H = 841.89,
  M = 36,
  CW = W - 2 * M,
  END = H - 49;
const NAVY = rgb(0.02, 0.17, 0.29),
  INK = rgb(0.08, 0.13, 0.2);
const MUTED = rgb(0.36, 0.42, 0.49),
  RULE = rgb(0.84, 0.88, 0.91);
const PALE = rgb(0.95, 0.97, 0.985),
  WHITE = rgb(1, 1, 1);
const date = (value: number) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
const memory = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/(\d)\s*(GB|TB)\b/g, '$1 $2');

/** A4 geometry is independent of the device viewport. Text and SNs stay vector. */
class StockLayout {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly mono: PDFFont,
    readonly options: StockPdfOptions,
  ) {}
  safe(value: string) {
    return Array.from(
      value
        .normalize('NFC')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[\u2010-\u2015]/g, '-'),
    )
      .map((char) => {
        try {
          this.regular.encodeText(char);
          return char;
        } catch {
          return '?';
        }
      })
      .join('');
  }
  lines(value: string, width: number, size = 10, font = this.regular) {
    const result: string[] = [];
    let line = '';
    for (const char of this.safe(value)) {
      if (line && font.widthOfTextAtSize(line + char, size) > width) {
        const space = line.lastIndexOf(' ');
        if (space > 0) {
          result.push(line.slice(0, space));
          line = line.slice(space + 1);
        } else {
          result.push(line);
          line = '';
        }
      }
      line += char;
    }
    if (line || !result.length) result.push(line.trim());
    return result;
  }
  text(
    value: string,
    x: number,
    top: number,
    size = 10,
    font = this.regular,
    color = INK,
  ) {
    this.page.drawText(this.safe(value), {
      x,
      y: H - top - size,
      size,
      font,
      color,
    });
  }
  right(
    value: string,
    edge: number,
    top: number,
    size = 10,
    font = this.bold,
    color = INK,
  ) {
    this.text(
      value,
      edge - font.widthOfTextAtSize(this.safe(value), size),
      top,
      size,
      font,
      color,
    );
  }
  box(x: number, top: number, width: number, height: number, color = PALE) {
    this.page.drawRectangle({ x, y: H - top - height, width, height, color });
  }
  rule(top: number) {
    this.page.drawLine({
      start: { x: M, y: H - top },
      end: { x: W - M, y: H - top },
      color: RULE,
      thickness: 0.5,
    });
  }
  newPage(first = false, section = 'Estoque disponível') {
    this.page = this.doc.addPage([W, H]);
    this.box(M, 28, 4, first ? 52 : 32, NAVY);
    const storeLines = this.lines(
      this.options.storeName,
      CW - 20,
      10,
      this.bold,
    );
    storeLines.forEach((line, i) =>
      this.text(line, M + 14, 28 + i * 13, 10, this.bold, NAVY),
    );
    const afterStore = 30 + storeLines.length * 13;
    this.text(
      first ? 'Relatório de estoque' : section,
      M + 14,
      afterStore + 2,
      first ? 24 : 13,
      this.bold,
    );
    this.y = afterStore + (first ? 38 : 24);
    this.text(
      `Gerado em ${date(this.options.generatedAt)}`,
      M,
      this.y,
      9,
      this.regular,
      MUTED,
    );
    this.y += 25;
  }
  ensure(height: number, section?: string) {
    if (this.y + height <= END) return false;
    this.newPage(false, section);
    return true;
  }
  tableHead() {
    this.box(M, this.y, CW, 23, NAVY);
    [
      ['PRODUTO', M + 10],
      ['COR', M + 196],
      ['MEMÓRIA', M + 352],
    ].forEach(([label, x]) =>
      this.text(String(label), Number(x), this.y + 7, 8, this.bold, WHITE),
    );
    this.right('QTD.', W - M - 10, this.y + 7, 8, this.bold, WHITE);
    this.y += 23;
  }
  product(
    row: StockPdfRow,
    serials: string[],
    continued: boolean,
    zebra: boolean,
  ) {
    const names = this.lines(row.model, 172, 10, this.bold);
    const colors = this.lines(row.color, 128, 10);
    const memories = this.lines(memory(row.memory) || '-', 77, 10, this.bold);
    const headerHeight =
      Math.max(names.length, colors.length, memories.length) * 13 + 15;
    const maxSerialWidth = Math.max(
      1,
      ...serials.map((sn) => this.mono.widthOfTextAtSize(this.safe(sn), 9)),
    );
    const columns = Math.max(
      1,
      Math.min(4, Math.floor((CW - 20) / (maxSerialWidth + 14))),
    );
    const lines = Math.ceil(serials.length / columns);
    const height =
      headerHeight + (continued ? 15 : 0) + (lines ? 17 + lines * 19 + 8 : 0);
    if (this.ensure(height)) this.tableHead();
    const top = this.y;
    this.box(M, top, CW, height, zebra ? PALE : WHITE);
    names.forEach((line, i) =>
      this.text(line, M + 10, top + 8 + i * 13, 10, this.bold),
    );
    const hex = productColorValue(row.color, row.model).slice(1);
    this.page.drawCircle({
      x: M + 198,
      y: H - top - 14,
      size: 4,
      color: rgb(
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      ),
      borderColor: RULE,
      borderWidth: 0.6,
    });
    colors.forEach((line, i) => this.text(line, M + 210, top + 8 + i * 13));
    memories.forEach((line, i) =>
      this.text(line, M + 352, top + 8 + i * 13, 10, this.bold),
    );
    this.right(String(row.available), W - M - 10, top + 8, 11);
    let serialTop = top + headerHeight;
    if (continued) {
      this.text(
        'Números de série - continuação',
        M + 10,
        serialTop,
        8,
        this.regular,
        MUTED,
      );
      serialTop += 15;
    }
    if (serials.length) {
      this.text('NÚMEROS DE SÉRIE', M + 10, serialTop, 7.5, this.bold, MUTED);
      serialTop += 16;
      const cell = (CW - 20) / columns;
      serials.forEach((sn, i) => {
        const size = Math.min(
          9,
          (cell - 10) / this.mono.widthOfTextAtSize(this.safe(sn), 1),
        );
        this.text(
          sn,
          M + 10 + (i % columns) * cell,
          serialTop + Math.floor(i / columns) * 19,
          size,
          this.mono,
        );
      });
    }
    this.y += height;
    this.rule(this.y);
  }
}

export async function buildStockReportPdf(
  options: StockPdfOptions,
  loadAsset: (photo: AttachmentRecord) => Promise<Uint8Array> = loadReportAsset,
) {
  const rows = options.rows.filter((row) => row.available > 0);
  if (
    options.level === 'serials' &&
    rows.some((row) => row.serials.length !== row.available)
  ) {
    throw new Error(
      'O estoque mudou durante a consulta. Feche o relatório, atualize o estoque e carregue os SNs novamente.',
    );
  }
  const doc = await PDFDocument.create();
  doc.setTitle(`Relatório de estoque - ${options.storeName}`);
  doc.setAuthor(options.storeName);
  doc.setCreator('Atacado Apple');
  doc.setCreationDate(new Date(options.generatedAt));
  doc.setModificationDate(new Date(options.generatedAt));
  const layout = new StockLayout(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    await doc.embedFont(StandardFonts.Courier),
    options,
  );
  layout.newPage(true);
  const summary = summarizeStockByMemory(rows);
  const total = rows.reduce((sum, row) => sum + row.available, 0);
  [
    [String(total), 'APARELHOS DISPONÍVEIS'],
    [String(summary.modelCount), 'MODELOS'],
    [String(rows.length), 'VARIAÇÕES'],
  ].forEach(([value, label], i) => {
    const width = (CW - 16) / 3,
      x = M + i * (width + 8);
    layout.box(x, layout.y, width, 54, i ? PALE : NAVY);
    layout.text(
      label,
      x + 12,
      layout.y + 10,
      7.5,
      layout.bold,
      i ? MUTED : WHITE,
    );
    layout.text(value, x + 12, layout.y + 23, 22, layout.bold, i ? INK : WHITE);
  });
  layout.y += 72;
  layout.text(
    options.level === 'serials'
      ? 'Produtos e números de série'
      : 'Produtos disponíveis',
    M,
    layout.y,
    12,
    layout.bold,
  );
  layout.y += 23;
  layout.tableHead();
  rows.forEach((row, index) => {
    // Bounded blocks repeat the product identity; no SN can spill onto an unrelated page.
    const serials = options.level === 'serials' ? row.serials : [];
    if (!serials.length) layout.product(row, [], false, index % 2 === 0);
    for (let offset = 0; offset < serials.length; offset += 16) {
      layout.product(
        row,
        serials.slice(offset, offset + 16),
        offset > 0,
        index % 2 === 0,
      );
    }
  });
  if (!rows.length) {
    layout.text('Nenhum aparelho disponível.', M + 10, layout.y + 15, 11);
    layout.y += 42;
  }
  layout.ensure(50);
  layout.y += 18;
  layout.text('Resumo por modelo e memória', M, layout.y, 11, layout.bold);
  layout.y += 22;
  for (const group of summary.groups) {
    const label = `${group.model}  ·  ${group.memory || 'Sem memória informada'}`;
    const lines = layout.lines(label, CW - 65, 9);
    if (layout.ensure(lines.length * 13 + 7, 'Resumo por modelo e memória'))
      layout.y += 2;
    lines.forEach((line, i) =>
      layout.text(line, M, layout.y + i * 13, 9, layout.regular, MUTED),
    );
    layout.right(String(group.quantity), W - M, layout.y, 9);
    layout.y += lines.length * 13 + 7;
  }
  if (options.includePhotos) {
    let first = true;
    for (const row of rows) {
      const photos = [
        ...new Map(row.photos.map((photo) => [photo.id, photo])).values(),
      ];
      for (let offset = 0; offset < photos.length; offset += 2) {
        if (first) {
          layout.newPage(false, 'Fotos das entradas');
          first = false;
        }
        const label = `${row.model} · ${row.color} · ${memory(row.memory)}`;
        const labels = layout.lines(label, CW, 11, layout.bold);
        const blockHeight = labels.length * 15 + 204;
        layout.ensure(blockHeight, 'Fotos das entradas');
        labels.forEach((line, i) =>
          layout.text(line, M, layout.y + i * 15, 11, layout.bold),
        );
        layout.y += labels.length * 15 + 8;
        for (const [index, photo] of photos
          .slice(offset, offset + 2)
          .entries()) {
          const bytes = await loadAsset(photo);
          const embedded =
            bytes[0] === 0x89
              ? await doc.embedPng(bytes)
              : await doc.embedJpg(bytes);
          const width = (CW - 12) / 2,
            x = M + index * (width + 12);
          layout.box(x, layout.y, width, 170);
          const scale = Math.min(
            (width - 12) / embedded.width,
            158 / embedded.height,
          );
          const imageWidth = embedded.width * scale,
            imageHeight = embedded.height * scale;
          layout.page.drawImage(embedded, {
            x: x + (width - imageWidth) / 2,
            y: H - layout.y - (170 + imageHeight) / 2,
            width: imageWidth,
            height: imageHeight,
          });
          layout.text(
            `Foto da entrada ${offset + index + 1} de ${photos.length}`,
            x,
            layout.y + 176,
            8,
            layout.regular,
            MUTED,
          );
        }
        layout.y += 196;
      }
    }
  }
  doc.getPages().forEach((page, i, pages) => {
    layout.page = page;
    layout.rule(H - 37);
    layout.text(
      'Estoque disponível na data da geração',
      M,
      H - 27,
      8,
      layout.regular,
      MUTED,
    );
    layout.right(
      `Página ${i + 1} de ${pages.length}`,
      W - M,
      H - 27,
      8,
      layout.regular,
      MUTED,
    );
  });
  return doc.save();
}

export async function downloadStockReportPdf(
  options: StockPdfOptions & { fileName: string },
) {
  const bytes = await buildStockReportPdf(options);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/pdf' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${options.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-')}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
