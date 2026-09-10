import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFPage, PDFFont } from 'pdf-lib';
import type { AttachmentRecord } from './pdv-types';
import { productColorValue } from './product-color.ts';
import { summarizeStockByMemory } from './stock-report-summary.ts';
import { loadReportAsset } from './sales-report-pdf.ts';
import { reportCard, reportColors } from './report-pdf-theme.ts';

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
const {
  ink: INK,
  muted: MUTED,
  rule: RULE,
  pale: PALE,
  white: WHITE,
} = reportColors;
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
    reportCard(this.page, x, top, width, height, color);
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
    const storeLines = this.lines(
      this.options.storeName,
      CW - 20,
      10,
      this.bold,
    );
    storeLines.forEach((line, i) =>
      this.text(line, M, 28 + i * 13, 10, this.bold, MUTED),
    );
    const afterStore = 30 + storeLines.length * 13;
    this.text(
      first ? 'Relatório de estoque' : section,
      M,
      afterStore + 2,
      first ? 21 : 13,
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
    this.rule(this.y - 9);
  }
  ensure(height: number, section?: string) {
    if (this.y + height <= END) return false;
    this.newPage(false, section);
    return true;
  }
  product(
    row: StockPdfRow,
    serials: string[],
    continued: boolean,
    photosHeight = 0,
  ) {
    const names = this.lines(row.model, CW - 145, 11, this.bold);
    const colors = this.lines(row.color, 185, 10);
    const memories = this.lines(memory(row.memory) || '-', 115, 10, this.bold);
    const detailTop = 12 + names.length * 14;
    const headerHeight =
      detailTop + Math.max(colors.length, memories.length) * 13 + 12;
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
      headerHeight +
      (continued ? 15 : 0) +
      (lines ? 8 + lines * 21 : 0) +
      photosHeight;
    this.ensure(height + 8);
    const top = this.y;
    reportCard(this.page, M, top, CW, height, WHITE, RULE);
    names.forEach((line, i) =>
      this.text(line, M + 12, top + 10 + i * 14, 11, this.bold),
    );
    const hex = productColorValue(row.color, row.model).slice(1);
    this.page.drawCircle({
      x: M + 17,
      y: H - top - detailTop - 6,
      size: 4,
      color: rgb(
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      ),
      borderColor: RULE,
      borderWidth: 0.6,
    });
    colors.forEach((line, i) =>
      this.text(
        line,
        M + 28,
        top + detailTop + i * 13,
        10,
        this.regular,
        MUTED,
      ),
    );
    const memoryWidth = Math.min(
      127,
      Math.max(
        ...memories.map((line) => this.bold.widthOfTextAtSize(line, 10)),
      ) + 12,
    );
    reportCard(
      this.page,
      M + 224,
      top + detailTop - 2,
      memoryWidth,
      memories.length * 13 + 4,
      PALE,
      undefined,
      undefined,
      4,
    );
    memories.forEach((line, i) =>
      this.text(line, M + 230, top + detailTop + i * 13, 10, this.bold),
    );
    this.right(`${row.available} disponíveis`, W - M - 12, top + 11, 10);
    let serialTop = top + headerHeight;
    if (continued) {
      this.text(
        photosHeight
          ? 'Fotos das entradas - continuação'
          : 'Números de série - continuação',
        M + 10,
        serialTop,
        8,
        this.regular,
        MUTED,
      );
      serialTop += 15;
    }
    if (serials.length) {
      serialTop += 3;
      const cell = (CW - 20) / columns;
      serials.forEach((sn, i) => {
        const size = Math.min(
          9,
          (cell - 10) / this.mono.widthOfTextAtSize(this.safe(sn), 1),
        );
        reportCard(
          this.page,
          M + 10 + (i % columns) * cell,
          serialTop + Math.floor(i / columns) * 21,
          cell - 6,
          17,
          PALE,
          undefined,
          undefined,
          3,
        );
        this.text(
          sn,
          M + 14 + (i % columns) * cell,
          serialTop + 3 + Math.floor(i / columns) * 21,
          size,
          this.mono,
        );
      });
    }
    this.y += height + 8;
    return top + height - photosHeight;
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
    layout.box(x, layout.y, width, 54, PALE);
    layout.text(label, x + 12, layout.y + 10, 7.5, layout.bold, MUTED);
    layout.text(value, x + 12, layout.y + 23, 22, layout.bold, INK);
  });
  layout.y += 72;
  layout.text('Quantidade por modelo e memória', M, layout.y, 12, layout.bold);
  layout.y += 23;
  for (let offset = 0; offset < summary.groups.length; offset += 2) {
    const groups = summary.groups.slice(offset, offset + 2);
    const width = (CW - 8) / 2;
    const blocks = groups.map((group) => ({
      group,
      lines: layout.lines(
        `${group.model} · ${group.memory || 'Memória não informada'}`,
        width - 44,
        10,
      ),
    }));
    const height =
      Math.max(...blocks.map((block) => block.lines.length)) * 14 + 18;
    layout.ensure(height + 8, 'Quantidade por modelo e memória');
    blocks.forEach(({ group, lines }, index) => {
      const x = M + index * (width + 8);
      reportCard(
        layout.page,
        x,
        layout.y,
        width,
        height,
        WHITE,
        RULE,
        undefined,
        7,
      );
      lines.forEach((line, i) =>
        layout.text(line, x + 10, layout.y + 9 + i * 14, 10),
      );
      layout.right(String(group.quantity), x + width - 10, layout.y + 9, 10);
    });
    layout.y += height + 8;
  }
  layout.ensure(100);
  layout.y += 12;
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
  for (const row of rows) {
    // Bounded blocks repeat the product identity; no SN can spill onto an unrelated page.
    const serials = options.level === 'serials' ? row.serials : [];
    if (!serials.length) layout.product(row, [], false);
    for (let offset = 0; offset < serials.length; offset += 12) {
      layout.product(row, serials.slice(offset, offset + 12), offset > 0);
    }
    if (options.includePhotos) {
      const photos = [
        ...new Map(row.photos.map((photo) => [photo.id, photo])).values(),
      ];
      for (let offset = 0; offset < photos.length; offset += 3) {
        const top = layout.product(row, [], true, 195);
        layout.text('Fotos das entradas', M + 12, top, 9, layout.bold, MUTED);
        for (const [index, photo] of photos
          .slice(offset, offset + 3)
          .entries()) {
          const bytes = await loadAsset(photo);
          const embedded =
            bytes[0] === 0x89
              ? await doc.embedPng(bytes)
              : await doc.embedJpg(bytes);
          const width = (CW - 40) / 3,
            x = M + 12 + index * (width + 8);
          layout.box(x, top + 19, width, 145);
          const scale = Math.min(
            (width - 8) / embedded.width,
            137 / embedded.height,
          );
          const imageWidth = embedded.width * scale,
            imageHeight = embedded.height * scale;
          layout.page.drawImage(embedded, {
            x: x + (width - imageWidth) / 2,
            y: H - top - 19 - (145 + imageHeight) / 2,
            width: imageWidth,
            height: imageHeight,
          });
          layout.text(
            `Foto ${offset + index + 1} de ${photos.length}`,
            x,
            top + 171,
            8,
            layout.regular,
            MUTED,
          );
        }
      }
    }
  }
  if (!rows.length) {
    layout.text('Nenhum aparelho disponível.', M + 10, layout.y + 15, 11);
    layout.y += 42;
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
