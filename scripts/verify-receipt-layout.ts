import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { buildSalesReportPdf } from '../lib/sales-report-pdf.ts';
import { extractReceiptDocument } from '../lib/receipt-document.ts';
import { deriveReceiptReconciliation } from '../lib/receipt-reconciliation.ts';
import type { SaleRecord } from '../lib/pdv-types.ts';

const attachment = {
  id: 'receipt',
  name: 'comprovante-ficticio.png',
  mimeType: 'image/png',
  sizeBytes: 1,
  url: 'https://example.invalid/receipt',
};
const receipts = [
  {
    ...attachment,
    receiptAmountCents: 410000,
    receiptAmountSource: 'ocr' as const,
    receiptDetails: extractReceiptDocument(
      `Comprovante de Pix\n8/setembro/2026 às 17:51:29.\nR$ 4.100,00\nOrigem e destino\nPagador de demonstração LTDA\nBanco Pagador\nCNPJ:00000000000000\nRecebedor de demonstração LTDA\nBanco Recebedor\nCNPJ:12345678000199\nID de transação Pix\nE${'0'.repeat(31)}`,
    ).details,
  },
];
const sale = {
  id: 'sale',
  number: 1,
  customerName: 'Cliente de demonstração',
  sellerName: 'Vendedor de teste',
  createdAt: Date.UTC(2026, 8, 8, 20, 52),
  status: 'completed',
  productsTotalCents: 710000,
  receivedTotalCents: 999999,
  receivedDifferenceCents: 289999,
  referenceTotalCents: 710000,
  priceDifferenceCents: 0,
  items: [
    {
      id: 'item',
      productName: 'iPhone Teste',
      productDetail: 'Preto · 256 GB',
      serial: 'TESTX00001',
      soldPriceCents: 710000,
      referencePriceCents: 710000,
      photos: [{ ...attachment, id: 'photo' }],
    },
  ],
  payments: [
    {
      id: 'cash',
      method: 'cash',
      amountCents: 300000,
      pixAccountId: null,
      accountName: null,
    },
  ],
  receipts,
  reconciliation: deriveReceiptReconciliation(receipts, 410000),
} as SaleRecord;
const bytes = await buildSalesReportPdf({
  storeName: 'Loja de demonstração',
  sales: [sale],
  singleSale: true,
  level: 'detailed',
  includePhotos: false,
  includeReceipts: false,
});
await mkdir('tmp/pdfs', { recursive: true });
await writeFile('tmp/pdfs/receipt-income-preview.pdf', bytes);
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const task = getDocument({ data: bytes, useSystemFonts: true });
const pdf = await task.promise;
const texts = [];
for (let i = 1; i <= pdf.numPages; i++)
  texts.push(
    (await (await pdf.getPage(i)).getTextContent()).items
      .map((x) => ('str' in x ? x.str : ''))
      .join(' '),
  );
const text = texts.join(' ');
assert.match(text, /08\/09\/2026.*17:51/);
assert.match(text, /Pagador de demonstração/);
assert.match(text, /Recebedor de demonstração/);
assert.match(text, /7\.100,00/);
assert.doesNotMatch(text, /9\.999,99|Pix informado|TOTAL DO DIA/);
assert.match(text, /Conciliado/);
assert.equal(pdf.numPages, 1);
await task.destroy();
console.log(
  'PASS: one-page PDF with short date, separate payer/recipient and authoritative receipt + cash totals.',
);
