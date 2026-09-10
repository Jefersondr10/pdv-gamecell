import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { AttachmentRecord, SaleRecord } from './pdv-types';
import { saleDisplayStatus, saleIssues } from './sale-display-status.ts';
import { saleFinancialSummary } from './sale-financial-summary.ts';
import { summarizeSalesPayments } from './sales-payment-summary.ts';
import { reportCard, reportColors, reportTones } from './report-pdf-theme.ts';
import type { RGB } from 'pdf-lib';

export type SalesPdfOptions = {
  storeName: string;
  sales: SaleRecord[];
  level: 'simple' | 'detailed' | 'complete';
  filterSummary?: string;
  generatedAt?: number;
  singleSale?: boolean;
  includePhotos?: boolean;
  includeReceipts?: boolean;
};
type AssetLoader = (attachment: AttachmentRecord) => Promise<Uint8Array>;

const W = 595.28;
const H = 841.89;
const M = 36;
const CONTENT = W - 2 * M;
const BOTTOM = H - 45;
const {
  ink: INK,
  muted: MUTED,
  navy: NAVY,
  rule: RULE,
  pale: PALE,
  white: WHITE,
} = reportColors;
const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
const date = (timestamp: number, time = false) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(time ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
  }).format(timestamp);
const number = (sale: SaleRecord) => `#${String(sale.number).padStart(5, '0')}`;

/** Text is written directly into the PDF: it never depends on screen size or a canvas. */
class Layout {
  page!: PDFPage;
  y = 78;
  context = 'Resumo de vendas';
  constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly store: string,
    readonly measureOnly = false,
  ) {}

  text(value: string) {
    // Helvetica covers Portuguese. Unsupported pictograms must not abort an export.
    return Array.from(value.normalize('NFC').replace(/[\r\n\t]+/g, ' '))
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
  lines(value: string, width = CONTENT, size = 10, bold = false): string[] {
    const font = bold ? this.bold : this.regular;
    const result: string[] = [];
    let line = '';
    for (const word of this.text(value).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) result.push(line);
      line = '';
      // Long filenames/identifiers also wrap without escaping the page margin.
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) {
          result.push(line);
          line = '';
        }
        line += char;
      }
    }
    if (line || !result.length) result.push(line);
    return result;
  }
  draw(
    value: string,
    x: number,
    top: number,
    size = 10,
    bold = false,
    color = INK,
  ) {
    if (this.measureOnly) return;
    this.page.drawText(this.text(value), {
      x,
      y: H - top - size,
      size,
      font: bold ? this.bold : this.regular,
      color,
    });
  }
  newPage(first = false) {
    this.page = this.doc.addPage([W, H]);
    const store = this.lines(this.store, CONTENT, 9, true)[0];
    this.draw(store, M, 25, 9, true, MUTED);
    const heading = first
      ? []
      : this.lines(this.context, CONTENT, 11, true).slice(0, 2);
    heading.forEach((line, index) =>
      this.draw(line, M, 40 + index * 14, 11, true, NAVY),
    );
    if (!first)
      this.page.drawLine({
        start: { x: M, y: H - 72 },
        end: { x: W - M, y: H - 72 },
        thickness: 0.6,
        color: RULE,
      });
    this.y = first ? 46 : 86;
  }
  ensure(height: number) {
    if (this.measureOnly) return;
    if (!this.page || this.y + height > BOTTOM) this.newPage();
  }
  paragraph(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      muted?: boolean;
      width?: number;
      x?: number;
    } = {},
  ) {
    const {
      size = 10,
      bold = false,
      muted = false,
      width = CONTENT,
      x = M,
    } = options;
    for (const line of this.lines(value, width, size, bold)) {
      this.ensure(size + 5);
      this.draw(line, x, this.y, size, bold, muted ? MUTED : INK);
      this.y += size + 5;
    }
  }
  title(value: string) {
    this.ensure(50);
    this.y += 12;
    this.paragraph(value, { size: 12, bold: true });
    this.y += 4;
  }
  row(
    left: string,
    right: string,
    options: { bold?: boolean; muted?: boolean; fill?: RGB; color?: RGB } = {},
  ) {
    const rightWidth = Math.max(
      105,
      this.bold.widthOfTextAtSize(this.text(right), 10),
    );
    const lines = this.lines(left, CONTENT - rightWidth - 40, 10, options.bold);
    this.ensure(Math.min(lines.length * 15 + 18, BOTTOM - 86));
    if (!this.measureOnly)
      reportCard(
        this.page,
        M,
        this.y,
        CONTENT,
        lines.length * 15 + 12,
        options.fill ?? WHITE,
        options.fill ? undefined : RULE,
        undefined,
        6,
      );
    this.y += 6;
    this.draw(
      right,
      W - M - 10 - this.bold.widthOfTextAtSize(this.text(right), 10),
      this.y,
      10,
      true,
      options.color ?? INK,
    );
    for (const line of lines) {
      this.ensure(15);
      this.draw(
        line,
        M + 10,
        this.y,
        10,
        options.bold,
        options.color ?? (options.muted ? MUTED : INK),
      );
      this.y += 15;
    }
    this.y += 10;
  }
  rule() {
    this.ensure(12);
    if (!this.measureOnly)
      this.page.drawLine({
        start: { x: M, y: H - this.y },
        end: { x: W - M, y: H - this.y },
        thickness: 0.6,
        color: RULE,
      });
    this.y += 12;
  }
  totals(
    label: string,
    value: string,
    count: number,
    units: number,
    warnings: number,
  ) {
    this.ensure(82);
    const heroWidth = 211,
      gap = 6,
      width = (CONTENT - heroWidth - gap * 3) / 3;
    reportCard(
      this.page,
      M,
      this.y,
      heroWidth,
      70,
      reportColors.emerald,
      undefined,
      [reportColors.emerald, reportColors.green, reportColors.cyan],
    );
    this.draw(label, M + 12, this.y + 12, 8, true, WHITE);
    const moneySize = Math.min(
      25,
      (heroWidth - 24) / this.bold.widthOfTextAtSize(this.text(value), 1),
    );
    this.draw(value, M + 12, this.y + 32, moneySize, true, WHITE);
    [
      ['VENDAS CONCLUÍDAS', count],
      ['APARELHOS', units],
      ['AVISOS', warnings],
    ].forEach(([caption, amount], index) => {
      const x = M + heroWidth + gap + index * (width + gap);
      reportCard(this.page, x, this.y, width, 70, PALE);
      this.lines(String(caption), width - 18, 8, true).forEach((line, i) =>
        this.draw(line, x + 9, this.y + 11 + i * 11, 8, true, MUTED),
      );
      this.draw(String(amount), x + 9, this.y + 43, 18, true);
    });
    this.y += 82;
  }
  panel(
    entries: { text: string; size?: number; bold?: boolean }[],
    tone = reportTones.neutral,
  ) {
    const lines = entries.flatMap((entry) =>
      this.lines(entry.text, CONTENT - 24, entry.size ?? 10, entry.bold).map(
        (text) => ({ ...entry, text }),
      ),
    );
    // Bound panels as well as rows; repeat page context if unusually long labels wrap.
    for (let offset = 0; offset < lines.length; offset += 22) {
      const part = lines.slice(offset, offset + 22);
      const height =
        20 + part.reduce((sum, line) => sum + (line.size ?? 10) + 5, 0);
      this.ensure(height + 8);
      if (!this.measureOnly)
        reportCard(
          this.page,
          M,
          this.y,
          CONTENT,
          height,
          tone.fill,
          tone.border,
        );
      this.y += 10;
      for (const line of part) {
        this.draw(
          line.text,
          M + 12,
          this.y,
          line.size ?? 10,
          line.bold,
          tone.ink,
        );
        this.y += (line.size ?? 10) + 5;
      }
      this.y += 18;
    }
  }
  dayHeader(day: string, count: number, units: number, amount: number) {
    this.ensure(135);
    reportCard(this.page, M, this.y, CONTENT, 58, NAVY, undefined, [
      NAVY,
      reportColors.blue,
    ]);
    this.draw(day, M + 12, this.y + 10, 12, true, WHITE);
    this.draw(
      `${count} venda(s) concluída(s) · ${units} aparelho(s)`,
      M + 12,
      this.y + 33,
      9,
      false,
      WHITE,
    );
    const value = money(amount);
    this.draw('TOTAL DO DIA', W - M - 124, this.y + 10, 8, true, WHITE);
    this.draw(
      value,
      W - M - 12 - this.bold.widthOfTextAtSize(value, 16),
      this.y + 28,
      16,
      true,
      WHITE,
    );
    this.y += 70;
  }
}

function modelSummary(layout: Layout, sales: SaleRecord[], detailed: boolean) {
  const groups = new Map<
    string,
    { label: string; name: string; detail: string; serials: string[] }
  >();
  for (const sale of sales)
    for (const item of sale.items) {
      const label = `${item.productName} · ${item.productDetail}`;
      const group = groups.get(label) ?? {
        label,
        name: item.productName,
        detail: item.productDetail,
        serials: [],
      };
      group.serials.push(`${item.serial} (${number(sale)})`);
      groups.set(label, group);
    }
  layout.title('Quantidade por aparelho');
  for (const group of groups.values()) {
    layout.context = `Resumo por modelo · ${group.label}`;
    const chunks = detailed ? Math.ceil(group.serials.length / 12) : 1;
    for (let offset = 0; offset < chunks; offset++) {
      const names = layout.lines(group.name, CONTENT - 80, 11, true);
      const details = layout.lines(group.detail, CONTENT - 24, 9);
      const serials = detailed
        ? group.serials.slice(offset * 12, offset * 12 + 12)
        : [];
      const chips: { text: string; width: number; x: number; row: number }[] =
        [];
      let x = 0,
        row = 0;
      for (const sn of serials) {
        const width = Math.min(
          CONTENT - 24,
          layout.regular.widthOfTextAtSize(layout.text(sn), 8) + 12,
        );
        if (x + width > CONTENT - 24) {
          x = 0;
          row++;
        }
        chips.push({ text: sn, width, x, row });
        x += width + 5;
      }
      const height =
        22 +
        names.length * 15 +
        details.length * 13 +
        (offset ? 14 : 0) +
        (chips.length ? (row + 1) * 20 + 5 : 0);
      layout.ensure(height + 8);
      reportCard(layout.page, M, layout.y, CONTENT, height, WHITE, RULE);
      const top = layout.y;
      names.forEach((line, i) =>
        layout.draw(line, M + 12, top + 10 + i * 15, 11, true),
      );
      layout.draw(String(group.serials.length), W - M - 30, top + 10, 11, true);
      layout.y += 10 + names.length * 15;
      details.forEach((line) => {
        layout.draw(line, M + 12, layout.y, 9, false, MUTED);
        layout.y += 13;
      });
      if (offset) {
        layout.draw(
          'Números de série - continuação',
          M + 12,
          layout.y,
          8,
          false,
          MUTED,
        );
        layout.y += 14;
      }
      for (const chip of chips) {
        reportCard(
          layout.page,
          M + 12 + chip.x,
          layout.y + 5 + chip.row * 20,
          chip.width,
          17,
          PALE,
          undefined,
          undefined,
          3,
        );
        const size = Math.min(
          8,
          (chip.width - 12) /
            layout.regular.widthOfTextAtSize(layout.text(chip.text), 1),
        );
        layout.draw(
          chip.text,
          M + 18 + chip.x,
          layout.y + 9 + chip.row * 20,
          size,
        );
      }
      layout.y = top + height + 8;
    }
  }
  layout.context = 'Resumo de vendas';
  if (!groups.size) layout.paragraph('Nenhum aparelho vendido neste filtro.');
}

function saleDetails(
  layout: Layout,
  sale: SaleRecord,
  level: SalesPdfOptions['level'],
  singleSale: boolean,
) {
  const detailed = level !== 'simple';
  const showFinancial = singleSale || sale.status === 'completed';
  layout.context = `Venda ${number(sale)} · ${sale.customerName}`;
  layout.ensure(205);
  const difference = sale.receivedTotalCents - sale.productsTotalCents;
  const tone =
    sale.status === 'cancelled'
      ? reportTones.neutral
      : difference < 0
        ? reportTones.shortage
        : difference > 0
          ? reportTones.excess
          : saleFinancialSummary(sale).reconciled
            ? reportTones.success
            : reportTones.warning;
  layout.panel(
    [
      {
        text: `Venda ${number(sale)} · ${sale.customerName}`,
        size: 13,
        bold: true,
      },
      {
        text: `${date(sale.createdAt, true)} · Vendedor: ${sale.sellerName}`,
        size: 9,
      },
      {
        text: `Status: ${saleDisplayStatus(sale).label}`,
        size: 10,
        bold: true,
      },
      ...(saleIssues(sale).length
        ? [
            {
              text: `Conferência: ${saleIssues(sale)
                .map((issue) => issue.label)
                .join(' · ')}`,
              size: 9,
            },
          ]
        : []),
    ],
    tone,
  );
  layout.row('Valor da venda', money(sale.productsTotalCents), {
    bold: true,
    fill: PALE,
  });
  if ((detailed || singleSale) && showFinancial) {
    layout.row('Total pago informado', money(sale.receivedTotalCents), {
      fill: PALE,
    });
    if (sale.status !== 'cancelled') {
      const diff = sale.receivedTotalCents - sale.productsTotalCents;
      const label =
        sale.productsTotalCents <= 0
          ? 'Valor da venda ainda não definido'
          : diff < 0
            ? `Falta receber ${money(-diff)}`
            : diff > 0
              ? `Pagamento acima da venda em ${money(diff)}`
              : 'Pagamento informado igual ao valor da venda';
      layout.paragraph(label, { bold: true, size: 9 });
      const financial = saleFinancialSummary(sale);
      if (financial.receiptText)
        layout.paragraph(financial.receiptText, {
          size: 9,
          bold: financial.receiptWarning,
        });
    }
  }
  if (sale.status === 'cancelled') {
    layout.paragraph(
      'Cancelada: não entra no montante vendido nem nas quantidades.',
      { bold: true, size: 9 },
    );
    if (sale.cancelledAt)
      layout.paragraph(
        `Cancelamento: ${date(sale.cancelledAt, true)} · ${sale.cancelledByName || 'Usuário não informado'}`,
        { size: 9 },
      );
    if (sale.cancellationReason)
      layout.paragraph(`Motivo: ${sale.cancellationReason}`, { size: 9 });
  }
  layout.title(`Produtos · ${sale.items.length} aparelho(s)`);
  for (const item of sale.items) {
    const names = layout.lines(item.productName, CONTENT - 140, 10, true);
    const details = layout.lines(
      `${item.productDetail}${detailed ? ` · SN: ${item.serial}` : ''}`,
      CONTENT - 24,
      9,
    );
    const height = 18 + names.length * 14 + details.length * 13;
    layout.ensure(height + 8);
    if (!layout.measureOnly)
      reportCard(
        layout.page,
        M,
        layout.y,
        CONTENT,
        height,
        WHITE,
        RULE,
        undefined,
        6,
      );
    names.forEach((line, i) =>
      layout.draw(line, M + 12, layout.y + 8 + i * 14, 10, true),
    );
    const value = money(item.soldPriceCents);
    layout.draw(
      value,
      W - M - 12 - layout.bold.widthOfTextAtSize(value, 10),
      layout.y + 8,
      10,
      true,
    );
    details.forEach((line, i) =>
      layout.draw(
        line,
        M + 12,
        layout.y + 8 + names.length * 14 + i * 13,
        9,
        false,
        MUTED,
      ),
    );
    layout.y += height + 6;
  }
  if (detailed && showFinancial) {
    layout.title('Pagamentos informados');
    for (const payment of sale.payments)
      layout.row(
        payment.method === 'cash'
          ? 'Dinheiro'
          : `Pix · ${payment.accountName || 'Conta não informada'}`,
        money(payment.amountCents),
        { fill: PALE },
      );
    if (!sale.payments.length) layout.paragraph('Nenhum pagamento informado.');
  }
  if ((level === 'complete' || singleSale) && showFinancial) {
    layout.title('Conferência dos comprovantes');
    layout.paragraph(
      'Compara comprovantes com o Pix. Dinheiro informado manualmente; não confirma crédito bancário.',
      { size: 9, muted: true },
    );
    layout.row(
      'Valor identificado nos comprovantes',
      money(sale.reconciliation.confirmedTotalCents),
    );
    const pending = sale.reconciliation.pendingReceiptCount;
    const diff = sale.reconciliation.differenceCents;
    layout.paragraph(
      sale.reconciliation.status === 'not_required'
        ? 'Sem Pix — comprovante não exigido; dinheiro informado manualmente.'
        : !sale.receipts.length
          ? 'Sem comprovante anexado.'
          : pending || sale.reconciliation.status === 'pending'
            ? pending
              ? `Leitura/conferência pendente: ${pending} comprovante(s).`
              : 'Conferência dos comprovantes pendente.'
            : diff === 0
              ? 'Comprovantes conferem com o Pix informado.'
              : diff === null
                ? 'Conferência pendente.'
                : `Comprovantes ${diff < 0 ? 'abaixo' : 'acima'} do Pix informado: diferença de ${money(Math.abs(diff))}.`,
      { size: 9, bold: true },
    );
  }
  if (level === 'complete' && showFinancial)
    layout.row(
      'Preços cadastrados (referência)',
      money(sale.referenceTotalCents),
    );
  layout.y += 10;
  layout.rule();
}

/** Pure builder, also exercised in Node tests. Attachments are loaded one at a time. */
export async function buildSalesReportPdf(
  options: SalesPdfOptions,
  loadAsset: AssetLoader = loadReportAsset,
): Promise<Uint8Array> {
  const { storeName, level, singleSale = false } = options;
  const sales = [...options.sales].sort(
    (a, b) => b.createdAt - a.createdAt || b.number - a.number,
  );
  if (!sales.length) throw new Error('Não há vendas para exportar.');
  if (sales.length > 250)
    throw new Error('Selecione um período com até 250 vendas.');
  const photos = options.includePhotos ?? level === 'complete';
  const receipts = options.includeReceipts ?? level === 'complete';
  // Cancelled sales remain visible for audit, but period totals and media exclude them.
  const mediaSales = singleSale
    ? sales
    : sales.filter((sale) => sale.status === 'completed');
  const assets = mediaSales.flatMap((sale) => [
    ...(photos ? sale.items.flatMap((item) => item.photos) : []),
    ...(receipts ? sale.receipts : []),
  ]);
  const mediaLimit = singleSale ? 60 : 40;
  const byteLimit = (singleSale ? 50 : 25) * 1024 * 1024;
  if (
    assets.length > mediaLimit ||
    assets.reduce((sum, item) => sum + item.sizeBytes, 0) > byteLimit
  )
    throw new Error(
      `Os anexos excedem ${mediaLimit} arquivos ou ${byteLimit / 1024 / 1024} MB. Reduza o período ou gere o relatório detalhado sem anexos.`,
    );
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const layout = new Layout(doc, regular, bold, storeName);
  doc.setTitle(
    singleSale ? `Venda ${number(sales[0])}` : 'Relatório de vendas',
  );
  doc.setAuthor(storeName);
  doc.setCreationDate(new Date(options.generatedAt ?? Date.now()));
  doc.setProducer('Sistema PDV · relatório vetorial');
  const completed = sales.filter((sale) => sale.status === 'completed');
  const summarySales = singleSale ? sales : completed;
  const amount = summarySales.reduce(
    (sum, sale) => sum + sale.productsTotalCents,
    0,
  );
  const units = summarySales.reduce((sum, sale) => sum + sale.items.length, 0);
  layout.newPage(true);
  layout.paragraph(
    singleSale
      ? `Relatório da venda ${number(sales[0])}`
      : 'Relatório de vendas',
    { size: 21, bold: true },
  );
  layout.paragraph(
    `${{ simple: 'Simplificado', detailed: 'Detalhado', complete: 'Completo' }[level]} · Emitido em ${date(options.generatedAt ?? Date.now(), true)}`,
    { size: 9, muted: true },
  );
  if (options.filterSummary)
    layout.paragraph(options.filterSummary, { size: 10 });
  layout.y += 12;
  layout.totals(
    singleSale ? 'VALOR DA VENDA' : 'MONTANTE VENDIDO',
    money(amount),
    completed.length,
    units,
    completed.filter((sale) => saleIssues(sale).length > 0).length,
  );
  if (!singleSale || sales[0].status === 'completed') {
    const summary = summarizeSalesPayments(sales);
    layout.context = 'Onde foi recebido';
    layout.title('Onde foi recebido');
    layout.paragraph(
      'Pagamentos informados das vendas deste relatório. Não confirma crédito no banco.',
      { size: 9, muted: true },
    );
    layout.y += 5;
    if (!summary.groups.length)
      layout.paragraph('Nenhum pagamento informado.', {
        size: 10,
        muted: true,
      });
    for (const group of summary.groups) {
      layout.row(group.label, money(group.amountCents));
      if (group.aliases.length)
        layout.paragraph(
          `Outros nomes no período: ${group.aliases.join(', ')}`,
          { size: 9, muted: true },
        );
    }
    layout.rule();
    layout.row('Total recebido informado', money(summary.receivedCents), {
      bold: true,
      fill: PALE,
    });
    if (summary.outstandingCents > 0)
      layout.row('Falta receber', money(summary.outstandingCents), {
        bold: true,
        fill: PALE,
        color: reportTones.shortage.ink,
      });
    if (summary.excessCents > 0)
      layout.row('Recebido a mais', money(summary.excessCents), {
        bold: true,
        fill: PALE,
        color: reportTones.warning.ink,
      });
    if (summary.outstandingCents > 0 && summary.excessCents > 0)
      layout.paragraph(
        'As diferenças são conferidas por venda: um valor a mais não quita outra venda.',
        { size: 9, muted: true },
      );
    if (summary.inconsistentSaleCount > 0)
      layout.paragraph(
        `Conferir pagamentos de ${summary.inconsistentSaleCount} venda(s): o detalhamento não corresponde ao total recebido salvo. Total detalhado: ${money(summary.detailedCents)}.`,
        { size: 9, bold: true },
      );
    layout.y += 8;
    layout.context = 'Resumo de vendas';
  }
  if (completed.length !== sales.length)
    layout.paragraph(
      singleSale
        ? 'Cancelada: registro histórico, fora dos totais do período.'
        : `${sales.length - completed.length} venda(s) cancelada(s), excluída(s) dos totais.`,
      { size: 9, muted: true },
    );
  const days = new Map<string, SaleRecord[]>();
  for (const sale of sales) {
    const key = date(sale.createdAt);
    days.set(key, [...(days.get(key) ?? []), sale]);
  }
  modelSummary(layout, summarySales, level !== 'simple');

  let loadedBytes = 0;
  let attachmentPages = 0;
  async function attach(asset: AttachmentRecord, label: string) {
    try {
      const bytes = await loadAsset(asset);
      loadedBytes += bytes.byteLength;
      if (loadedBytes > byteLimit)
        throw new Error(
          `Os anexos processados excedem ${byteLimit / 1024 / 1024} MB.`,
        );
      if (asset.mimeType === 'application/pdf') {
        const source = await PDFDocument.load(bytes);
        attachmentPages += source.getPageCount();
        if (attachmentPages > 200)
          throw new Error('Os anexos excedem 200 páginas.');
        for (const [index, page] of source.getPages().entries()) {
          layout.newPage();
          layout.paragraph(label, { size: 12, bold: true });
          layout.paragraph(
            `${asset.name} · Página ${index + 1} de ${source.getPageCount()}`,
            { size: 8, muted: true },
          );
          layout.y += 10;
          const embedded = await doc.embedPage(page);
          // Keep original PDF text/images, orientation and proportions inside a labelled page.
          const angle = ((page.getRotation().angle % 360) + 360) % 360;
          const sideways = angle === 90 || angle === 270;
          const naturalW = sideways ? embedded.height : embedded.width;
          const naturalH = sideways ? embedded.width : embedded.height;
          const scale = Math.min(
            CONTENT / naturalW,
            (BOTTOM - layout.y) / naturalH,
          );
          const drawW = embedded.width * scale;
          const drawH = embedded.height * scale;
          const x = M + (CONTENT - naturalW * scale) / 2;
          const y = H - layout.y - naturalH * scale;
          const { degrees } = await import('pdf-lib');
          layout.page.drawPage(embedded, {
            x: angle === 180 || angle === 270 ? x + naturalW * scale : x,
            y: angle === 90 || angle === 180 ? y + naturalH * scale : y,
            width: drawW,
            height: drawH,
            rotate: degrees(-angle),
          });
          layout.y = BOTTOM;
        }
      } else {
        const png = bytes[0] === 0x89 && bytes[1] === 0x50;
        const embedded = png
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes);
        const isReceipt = label.startsWith('Comprovante');
        const labelHeight =
          layout.lines(label, CONTENT, 11, true).length * 16 +
          layout.lines(asset.name, CONTENT, 8).length * 13 +
          12;
        const maxHeight = isReceipt ? BOTTOM - 86 - labelHeight : 280;
        const scale = Math.min(
          CONTENT / embedded.width,
          maxHeight / embedded.height,
        );
        const width = embedded.width * scale;
        const height = embedded.height * scale;
        if (isReceipt) layout.newPage();
        else layout.ensure(height + labelHeight + 18);
        layout.paragraph(label, { size: 11, bold: true });
        layout.paragraph(asset.name, { size: 8, muted: true });
        layout.y += 8;
        layout.page.drawImage(embedded, {
          x: M + (CONTENT - width) / 2,
          y: H - layout.y - height,
          width,
          height,
        });
        layout.y += height + 18;
      }
    } catch (error) {
      throw new Error(
        `Não foi possível incluir "${asset.name}". Nenhum PDF incompleto foi baixado. ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  let previousDay = '';
  for (const sale of sales) {
    layout.context = `Venda ${number(sale)} · ${sale.customerName}`;
    // Complete reports give each sale its own starting page and keep its evidence together.
    if (level === 'complete' || photos || receipts || sale === sales[0])
      layout.newPage();
    const measure = new Layout(doc, regular, bold, storeName, true);
    measure.y = 0;
    saleDetails(measure, sale, level, singleSale);
    // Keep a sale whole when it fits a page; oversized sales continue with their header.
    layout.ensure(Math.min(measure.y + 12, BOTTOM - 86));
    if (!singleSale && date(sale.createdAt) !== previousDay) {
      previousDay = date(sale.createdAt);
      const valid = (days.get(previousDay) ?? []).filter(
        (item) => item.status === 'completed',
      );
      layout.ensure(Math.min(measure.y + 82, BOTTOM - 86));
      layout.dayHeader(
        previousDay,
        valid.length,
        valid.reduce((sum, item) => sum + item.items.length, 0),
        valid.reduce((sum, item) => sum + item.productsTotalCents, 0),
      );
    }
    saleDetails(layout, sale, level, singleSale);
    if (!mediaSales.includes(sale)) continue;
    if (photos)
      for (const item of sale.items) {
        for (const [index, photo] of item.photos.entries())
          await attach(
            photo,
            `Foto ${index + 1} · ${item.productName} · ${item.productDetail} · SN ${item.serial}`,
          );
      }
    if (receipts)
      for (const [index, receipt] of sale.receipts.entries()) {
        const amountLabel =
          receipt.receiptAmountCents === null
            ? 'valor pendente'
            : money(receipt.receiptAmountCents);
        await attach(receipt, `Comprovante ${index + 1} · ${amountLabel}`);
      }
  }
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const text = `Página ${index + 1} de ${pages.length}`;
    page.drawText(text, {
      x: W - M - regular.widthOfTextAtSize(text, 8),
      y: 23,
      size: 8,
      font: regular,
      color: MUTED,
    });
    page.drawText('Relatório de vendas', {
      x: M,
      y: 23,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });
  return doc.save();
}

export async function loadReportAsset(
  attachment: AttachmentRecord,
): Promise<Uint8Array> {
  const response = await fetch(attachment.url, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error('Falha ao baixar o anexo. Tente novamente.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    attachment.mimeType === 'application/pdf' ||
    bytes[0] === 0x89 ||
    (bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      jpegNeedsOrientation(bytes) === false)
  )
    return bytes;
  // Browser decoding applies EXIF orientation. Bound conversion memory on mobile;
  // keep the original on the server and use a high-quality print-size copy here.
  // Never rasterize the report or original receipt PDFs.
  const url = URL.createObjectURL(
    new Blob([bytes], { type: attachment.mimeType }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    const scale = Math.min(
      1,
      2600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível abrir a imagem.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error('Imagem inválida.')),
        'image/jpeg',
        0.94,
      ),
    );
    canvas.width = canvas.height = 1;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function jpegNeedsOrientation(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  try {
    while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker === 0xe1 && view.getUint32(offset + 4) === 0x45786966) {
        const tiff = offset + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const directory = tiff + view.getUint32(tiff + 4, little);
        const entries = view.getUint16(directory, little);
        for (let index = 0; index < entries; index++) {
          const entry = directory + 2 + index * 12;
          if (entry + 12 > offset + 2 + length) break;
          if (view.getUint16(entry, little) === 0x0112) {
            const orientation = view.getUint16(entry + 8, little);
            return orientation >= 2 && orientation <= 8;
          }
        }
      }
      offset += length + 2;
    }
  } catch {
    /* Malformed optional metadata must not discard an otherwise readable image. */
  }
  return false;
}

export async function downloadSalesReportPdf(
  options: SalesPdfOptions & { fileName: string },
) {
  const bytes = await buildSalesReportPdf(options);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(
    new Blob([buffer], { type: 'application/pdf' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${options.fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')}.pdf`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
