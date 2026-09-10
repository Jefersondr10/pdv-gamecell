import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  buildSalesReportPdf,
  jpegNeedsOrientation,
} from '../lib/sales-report-pdf.ts';
import type { SaleRecord, AttachmentRecord } from '../lib/pdv-types.ts';
import { extractReceiptDocument } from '../lib/receipt-document.ts';

const out = new URL('../outputs/pdf-review/', import.meta.url);
for (let orientation = 1; orientation <= 8; orientation++) {
  const bytes = new Uint8Array(38);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0, 32, 69, 120, 105, 102, 0, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint16(12, 0x4949);
  view.setUint32(16, 8, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 0x0112, true);
  view.setUint16(24, 3, true);
  view.setUint32(26, 1, true);
  view.setUint16(30, orientation, true);
  bytes.set([0xff, 0xd9], 36);
  assert.equal(jpegNeedsOrientation(bytes), orientation !== 1);
}
assert.equal(
  jpegNeedsOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1])),
  false,
);
await mkdir(out, { recursive: true });
const asset = (id: string, mimeType = 'application/pdf'): AttachmentRecord => ({
  id,
  name: `${id}.pdf`,
  url: `https://example.invalid/${id}`,
  mimeType,
  sizeBytes: 1000,
});
const sale = (n: number, count = 1): SaleRecord => ({
  id: `sale-${n}`,
  number: n,
  customerId: `customer-${n}`,
  customerName: `Cliente Demonstração ${n}`,
  sellerName: 'Vendedor de teste',
  orderStatus: null,
  createdAt: Date.parse('2026-09-08T12:00:00-03:00') + n * 60_000,
  status: 'completed',
  productsTotalCents: count * 360000,
  receivedTotalCents: count * 360000,
  receivedDifferenceCents: 0,
  referenceTotalCents: count * 360000,
  priceDifferenceCents: 0,
  cancelledAt: null,
  cancelledByName: null,
  cancellationReason: null,
  items: Array.from({ length: count }, (_, i) => ({
    id: `item-${n}-${i}`,
    productId: 'product',
    productName: 'iPhone 15',
    productDetail: 'Azul · 128 GB',
    serial: `TESTE${n}SN${String(i).padStart(4, '0')}`,
    referencePriceCents: 360000,
    soldPriceCents: 360000,
    photos: [],
  })),
  payments: [
    {
      id: `payment-${n}`,
      method: 'pix',
      amountCents: count * 360000,
      accountName: 'Conta de demonstração',
      pixAccountId: 'account',
    },
  ],
  receipts: [],
  reconciliation: {
    status: 'pending',
    confirmedTotalCents: 0,
    differenceCents: null,
    pendingReceiptCount: 0,
  },
});
const first = sale(1, 2);
first.receipts = [
  {
    ...asset('comprovante-original'),
    receiptAmountCents: 720000,
    receiptAmountSource: 'manual',
    receiptAmountConfirmedAt: first.createdAt,
  },
];
first.reconciliation = {
  status: 'reconciled',
  confirmedTotalCents: 720000,
  differenceCents: 0,
  pendingReceiptCount: 0,
};
const second = sale(2);
second.createdAt -= 86400000;
second.receivedTotalCents = 100000;
second.payments[0].amountCents = 100000;
second.receivedDifferenceCents = -260000;
const cancelled = sale(3);
cancelled.status = 'cancelled';
cancelled.cancellationReason =
  'Cancelamento de demonstração, não contabilizar.';
cancelled.receipts = [
  {
    ...asset('cancelled-should-not-load'),
    receiptAmountCents: null,
    receiptAmountSource: null,
    receiptAmountConfirmedAt: null,
  },
];
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (const angle of [0, 90, 180, 270]) {
  const page = source.addPage([300, 440]);
  page.setRotation(degrees(angle));
  page.drawText(`COMPROVANTE ORIGINAL ${angle}`, {
    x: 18,
    y: 410,
    size: 14,
    font,
  });
  page.drawText('R$ 7.200,00', { x: 18, y: 350, size: 24, font });
  page.drawText('FIM DO COMPROVANTE', { x: 18, y: 20, size: 14, font });
}
const sourceBytes = await source.save();
await writeFile(
  new URL('novo-cancelada.pdf', out),
  await buildSalesReportPdf(
    {
      storeName: 'Loja Demonstração',
      sales: [cancelled],
      level: 'complete',
      singleSale: true,
    },
    async () => sourceBytes,
  ),
);
const loaded: string[] = [];
const loader = async (attachment: AttachmentRecord) => {
  loaded.push(attachment.id);
  assert.notEqual(attachment.id, 'cancelled-should-not-load');
  return sourceBytes;
};
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
for (const level of ['simple', 'detailed', 'complete'] as const) {
  loaded.length = 0;
  const bytes = await buildSalesReportPdf(
    {
      storeName: 'Loja Demonstração',
      sales: [first, second, cancelled],
      level,
      filterSummary: '07/09/2026 a 08/09/2026 · Todos os vendedores',
      generatedAt: first.createdAt,
    },
    loader,
  );
  const result = await PDFDocument.load(bytes);
  assert.ok(result.getPageCount() >= 2);
  assert.equal(loaded.length, level === 'complete' ? 1 : 0);
  assert.ok(
    bytes.byteLength < 100000,
    'Text reports must not become giant screenshots',
  );
  await writeFile(new URL(`novo-${level}.pdf`, out), bytes);
  const task = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
    );
  }
  const reportText = pages.join(' ');
  assert.doesNotMatch(
    reportText,
    /TOTAL DO DIA/,
    `${level}: no daily total card inside a sale`,
  );
  assert.equal(
    (reportText.match(/MONTANTE VENDIDO/g) || []).length,
    1,
    `${level}: keep just the opening report total`,
  );
  assert.match(
    pages[0],
    /10\.800,00/,
    `${level}: preserve opening sales total`,
  );
  assert.match(
    pages[0],
    /Onde foi recebido/,
    `${level}: preserve receipt breakdown`,
  );
  for (const name of [
    first.customerName,
    second.customerName,
    cancelled.customerName,
  ])
    assert.ok(reportText.includes(name), `${level}: preserve every sale`);
  await task.destroy();
}
const long = sale(99, 64);
long.customerName =
  'Cliente com nome muito longo São João e Comércio de Aparelhos e Acessórios '.repeat(
    3,
  );
long.payments = Array.from({ length: 28 }, (_, n) => ({
  ...long.payments[0],
  id: `p-${n}`,
  amountCents: 10000,
  accountName: 'Conta com nome longo '.repeat(7),
}));
long.receivedTotalCents = 280000;
const longBytes = await buildSalesReportPdf(
  { storeName: 'Loja de teste', sales: [long], level: 'detailed' },
  loader,
);
assert.ok((await PDFDocument.load(longBytes)).getPageCount() > 5);
await writeFile(new URL('novo-stress.pdf', out), longBytes);
await assert.rejects(
  () => buildSalesReportPdf({ storeName: 'Teste', sales: [], level: 'simple' }),
  /Não há vendas/,
);
await assert.rejects(
  () =>
    buildSalesReportPdf({
      storeName: 'Teste',
      sales: Array(251).fill(first),
      level: 'simple',
    }),
  /250/,
);
await assert.rejects(
  () =>
    buildSalesReportPdf(
      { storeName: 'Teste', sales: [first], level: 'complete' },
      async () => {
        throw new Error('Teste falha');
      },
    ),
  /Nenhum PDF incompleto/,
);
const tooMany = { ...first, receipts: Array(41).fill(first.receipts[0]) };
await assert.rejects(
  () =>
    buildSalesReportPdf(
      { storeName: 'Teste', sales: [tooMany], level: 'complete' },
      loader,
    ),
  /40 arquivos/,
);
// Optional visual fixtures are generated by the PDF QA renderer, not required in CI.
try {
  const landscape = await readFile(new URL('foto-horizontal.png', out));
  const portrait = await readFile(new URL('comprovante-vertical.png', out));
  const withImages = structuredClone(first);
  withImages.items[0].photos = [
    { ...asset('foto-horizontal', 'image/png'), name: 'foto-horizontal.png' },
  ];
  withImages.receipts.push({
    ...asset('comprovante-vertical', 'image/png'),
    name: 'comprovante-vertical.png',
    receiptAmountCents: null,
    receiptAmountSource: null,
    receiptAmountConfirmedAt: null,
  });
  const result = await buildSalesReportPdf(
    {
      storeName: 'Loja Demonstração',
      sales: [withImages],
      level: 'complete',
      singleSale: true,
    },
    async (item) =>
      item.id === 'foto-horizontal'
        ? landscape
        : item.id === 'comprovante-vertical'
          ? portrait
          : sourceBytes,
  );
  await writeFile(new URL('novo-imagens.pdf', out), result);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
console.log(
  'PASS: vector sales PDFs, levels, cancellation totals, linked attachments, rotation, long sales, limits and download errors.',
);

// Payment equality alone must not be called Quitado while receipts differ.
const discrepant = sale(10);
discrepant.productsTotalCents = 3473000;
discrepant.receivedTotalCents = 3473000;
discrepant.items[0].soldPriceCents = 3473000;
discrepant.items[0].photos = [asset('photo')];
discrepant.payments[0].amountCents = 3473000;
discrepant.receipts = [{ ...first.receipts[0], receiptAmountCents: 3465000 }];
discrepant.reconciliation = {
  status: 'divergent',
  confirmedTotalCents: 3465000,
  differenceCents: -8000,
  pendingReceiptCount: 0,
};
const statusBytes = await buildSalesReportPdf(
  { storeName: 'Loja de teste', sales: [discrepant], level: 'detailed' },
  loader,
);
await writeFile(new URL('novo-status.pdf', out), statusBytes);
const textTask = getDocument({ data: statusBytes, useSystemFonts: true });
const textPdf = await textTask.promise;
let textContent = '';
for (let pageNo = 1; pageNo <= textPdf.numPages; pageNo++) {
  const page = await textPdf.getPage(pageNo);
  const content = await page.getTextContent();
  textContent += content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ');
}
assert.match(textContent, /Verificar comprovante/);
assert.match(textContent, /Pagamento informado igual ao valor da venda/);
assert.match(textContent, /80,00 abaixo do Pix informado/);
assert.doesNotMatch(textContent, /Quitado/);
await textTask.destroy();
console.log(
  'PASS: PDF shows automatic status and R$80 discrepancy, never false Quitado.',
);

const identified = sale(30);
identified.productsTotalCents = 710000;
identified.receivedTotalCents = 710000;
identified.items[0].soldPriceCents = 710000;
identified.items[0].photos = [asset('photo')];
identified.payments = [
  { ...identified.payments[0], amountCents: 410000 },
  {
    id: 'cash',
    method: 'cash',
    pixAccountId: null,
    accountName: null,
    amountCents: 300000,
  },
];
identified.receipts = [
  {
    ...first.receipts[0],
    receiptAmountCents: 410000,
    receiptAmountSource: 'ocr',
    receiptPaymentId: identified.payments[0].id,
    receiptDetails: extractReceiptDocument(
      `Comprovante de Pix\n09/09/2026 às 17:34:00\nR$ 4.100,00\nOrigem e destino\nCliente de demonstração\nBanco Pagador\nCNPJ:00000000000000\nLoja de demonstração\nBanco Recebedor\nCNPJ:12345678000199\nID de transação Pix\nE${'0'.repeat(31)}`,
    ).details,
  },
];
identified.reconciliation = {
  status: 'reconciled',
  confirmedTotalCents: 410000,
  differenceCents: 0,
  pendingReceiptCount: 0,
};
const identifiedBytes = await buildSalesReportPdf({
  storeName: 'Loja demonstração',
  sales: [identified],
  singleSale: true,
  level: 'detailed',
  includePhotos: false,
  includeReceipts: false,
});
await writeFile(
  new URL('novo-comprovante-identificado.pdf', out),
  identifiedBytes,
);
const identifiedTask = getDocument({
  data: identifiedBytes,
  useSystemFonts: true,
});
const identifiedPdf = await identifiedTask.promise;
const texts = [];
for (let n = 1; n <= identifiedPdf.numPages; n++)
  texts.push(
    (await (await identifiedPdf.getPage(n)).getTextContent()).items
      .map((i) => ('str' in i ? i.str : ''))
      .join(' '),
  );
const orderText = texts.join(' ');
assert.ok(
  texts[0].includes(identified.customerName),
  'The customer starts on the first page, not a redundant cover',
);
assert.ok(
  orderText.indexOf(identified.customerName) < orderText.indexOf('Produtos'),
);
assert.ok(
  orderText.indexOf('Produtos') < orderText.indexOf('Pagamentos informados'),
);
assert.ok(
  orderText.indexOf('Banco recebedor: Banco Recebedor') <
    orderText.indexOf('Conferência dos comprovantes'),
);
assert.doesNotMatch(
  orderText,
  /Quantidade por aparelho|MONTANTE VENDIDO|TOTAL DO DIA/,
);
assert.match(orderText, /3\.000,00/);
assert.match(orderText, /4\.100,00/);
assert.match(orderText, /Status: Conciliado/);
await identifiedTask.destroy();
console.log(
  'PASS: single-sale PDF customer/items/payments order, bank/date/ID metadata and separate cash.',
);
