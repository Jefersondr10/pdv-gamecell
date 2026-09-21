import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  financialRows,
  identifiedReceiptDate,
  reportDateWindow,
  summarizeFinancialReport,
} from '../lib/financial-report.ts';
import { buildSalesReportPdf } from '../lib/sales-report-pdf.ts';
import {
  safePublicPdf,
  reportExpiry,
  readPublicReport,
  revokeReport,
  expireReportFiles,
} from '../lib/server/report-shares.ts';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { extractReceiptDocument } from '../lib/receipt-document.ts';
import type { SaleRecord } from '../lib/pdv-types.ts';

const now = Date.parse('2026-09-21T14:00:00-03:00');
const baseDoc = extractReceiptDocument('Valor R$ 1.000,00').details;
const accountDocument = extractReceiptDocument(
  'Pix realizado\n21/09/2026 14:00\nValor R$ 1.000,00\nPagador\nCliente Teste\nBanco Origem\nConta: 1111-0\nRecebedor\nLoja Teste\nBanco Destino\nConta: 2222-0\nID da transação\nE00000000000000000000000000000001',
);
assert.equal(accountDocument.details.recipientAccount, '2222-0');
const payerOnly = extractReceiptDocument(
  'Valor R$ 1.000,00\nPagador\nCliente\nBanco Origem\nConta: 1111-0\nRecebedor\nLoja\nBanco Destino',
);
assert.equal(payerOnly.details.recipientAccount, null);
function sale(
  n: number,
  at: string | null,
  recipient = 'Loja Demonstração',
  bank = 'Banco Exemplo',
  account: string | null = '***123-4',
): SaleRecord {
  return {
    id: `sale${n}`,
    number: n,
    customerId: 'demo',
    customerName: 'Cliente Demonstração',
    sellerName: 'Vendedor Teste',
    orderStatus: null,
    createdAt: now - 86400_000,
    status: 'completed',
    productsTotalCents: 100000,
    receivedTotalCents: 100000,
    receivedDifferenceCents: 0,
    referenceTotalCents: 100000,
    priceDifferenceCents: 0,
    cancelledAt: null,
    cancelledByName: null,
    cancellationReason: null,
    items: [
      {
        id: `item${n}`,
        productId: 'p',
        productName: 'iPhone Teste',
        productDetail: 'Preto · 128 GB',
        serial: `TESTE0000${n}`,
        referencePriceCents: 100000,
        soldPriceCents: 100000,
        photos: [],
      },
    ],
    payments: [],
    receipts: [
      {
        id: `receipt${n}`,
        name: 'comprovante.pdf',
        url: '/api/files/test',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        receiptAmountCents: 100000,
        receiptAmountSource: 'ocr',
        receiptAmountConfirmedAt: now,
        receiptDetails: {
          ...baseDoc,
          recipientName: recipient,
          recipientBank: bank,
          recipientAccount: account,
          paidAtText: at,
          payerName: 'Cliente Exemplo',
          payerBank: 'Banco Origem',
          transactionId: `E${String(n).padStart(31, '0')}`,
        },
      },
    ],
    reconciliation: {
      status: 'reconciled',
      confirmedTotalCents: 100000,
      differenceCents: 0,
      pendingReceiptCount: 0,
    },
  };
}
assert.deepEqual(identifiedReceiptDate('8/setembro/2026 às 17:51:29'), {
  date: '08/09/2026',
  time: '17:51',
  dateKey: '2026-09-08',
});
assert.equal(identifiedReceiptDate('31/02/2026 às 10:00').date, null);
assert.equal(identifiedReceiptDate('21/09/2026').time, null);
assert.equal(identifiedReceiptDate('21/09/2026 29:15').time, null);
assert.deepEqual(reportDateWindow('period=month&month=2024-02', now), {
  from: '2024-02-01',
  to: '2024-02-29',
});
const sales = [
  sale(1, '21/09/2026 14:23'),
  sale(2, null),
  sale(3, '20/09/2026', 'Outro recebedor'),
  sale(4, '21/09/2026', 'Loja Demonstração', 'Banco Exemplo', '***456-7'),
];
sales[0].payments.push({
  id: 'cash',
  method: 'cash',
  amountCents: 50000,
  accountName: null,
  pixAccountId: null,
  createdAt: now,
});
const cancelled = { ...sale(9, '21/09/2026'), status: 'cancelled' as const };
const rows = financialRows([...sales, cancelled]);
assert.equal(rows.length, 5);
assert.equal(rows.find((r) => r.saleNumber === 2)?.date, null); // no upload/sale time substituted
assert.equal(rows.find((r) => r.method === 'cash')?.time, '14:00');
const all = summarizeFinancialReport(sales);
assert.equal(all.saleGroups.length, 4);
assert.equal(
  all.saleGroups.find((group) => group.saleNumber === 1)?.rows.length,
  2,
);
assert.equal(
  all.saleGroups.find((group) => group.saleNumber === 1)?.amountCents,
  150000,
);
assert.equal(all.totalCents, 450000);
assert.equal(all.groups.length, 4);
const filtered = summarizeFinancialReport(
  sales,
  'receipt',
  'period=today',
  now,
);
assert.equal(filtered.saleGroups.length, 2);
assert.equal(
  filtered.saleGroups.reduce((sum, group) => sum + group.amountCents, 0),
  filtered.totalCents,
);
assert.equal(filtered.totalCents, 250000);
assert.equal(filtered.undatedCount, 1);
assert.equal(filtered.undatedCents, 100000);
assert.equal(
  summarizeFinancialReport(sales, 'sale', 'period=today', now).totalCents,
  450000,
);
const duplicate = sale(8, '21/09/2026');
duplicate.receipts.push({ ...duplicate.receipts[0], id: 'copy' });
assert.equal(financialRows([duplicate]).length, 0);
const blocked = sale(7, '21/09/2026');
blocked.receipts[0].receiptDetails!.blocked = true;
assert.equal(financialRows([blocked]).length, 0);
const unknown = sale(6, null, '', '', null);
assert.equal(financialRows([unknown])[0].bank, 'Banco não identificado');
const output = new URL('../tmp/pdfs/financial-review/', import.meta.url);
await mkdir(output, { recursive: true });
const cashSale = sale(62, null);
cashSale.receipts = [];
cashSale.payments = [200000, 100000, 100000, 50000, 10000, 40000].map(
  (amountCents, index) => ({
    id: `cash${index}`,
    method: 'cash',
    amountCents,
    pixAccountId: null,
    accountName: null,
    createdAt: now + index * 60000,
  }),
);
const cashSummary = summarizeFinancialReport([cashSale]);
assert.equal(cashSummary.saleGroups.length, 1);
assert.equal(cashSummary.saleGroups[0].rows.length, 6);
assert.equal(cashSummary.saleGroups[0].amountCents, 500000);
await writeFile(
  new URL('financial-grouped-cash.pdf', output),
  await buildSalesReportPdf({
    storeName: 'Loja Demonstração',
    sales: [cashSale],
    level: 'detailed',
    kind: 'financial',
    includePhotos: false,
    includeReceipts: false,
    generatedAt: now,
  }),
);
for (const level of ['simple', 'detailed', 'complete'] as const) {
  const bytes = await buildSalesReportPdf({
    storeName: 'Loja Demonstração',
    sales: [...sales, cancelled, unknown],
    level,
    kind: 'financial',
    dateBasis: 'sale',
    includePhotos: false,
    includeReceipts: false,
    generatedAt: now,
    filterSummary: '20 a 21 de setembro de 2026',
  });
  await writeFile(new URL(`financial-${level}.pdf`, output), bytes);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
}
const source = await PDFDocument.create();
source.addPage().drawText('Comprovante sintético - página 1');
source.addPage().drawText('Página 2');
const sourceBytes = await source.save();
const annotated = source.getPages()[0];
annotated.node.set(
  PDFName.of('AA'),
  source.context.obj({ O: { S: 'JavaScript', JS: 'app.alert(1)' } }),
);
source.addJavaScript('unsafe', 'app.alert(1)');
const safe = await PDFDocument.load(await safePublicPdf(await source.save()));
assert.equal(safe.getPageCount(), 2);
assert.equal(safe.catalog.has(PDFName.of('Names')), false);
assert.equal(safe.getPages()[0].node.has(PDFName.of('AA')), false);
assert.equal(safe.getPages()[0].node.Annots()?.size() ?? 0, 0);
await assert.rejects(() => safePublicPdf(new Uint8Array([1, 2, 3])));
const withReceipt = await buildSalesReportPdf(
  {
    storeName: 'Teste',
    sales: [sales[0]],
    level: 'simple',
    kind: 'financial',
    includeReceipts: true,
  },
  async () => sourceBytes,
);
assert.ok((await PDFDocument.load(withReceipt)).getPageCount() >= 3);
await writeFile(new URL('financial-with-receipt.pdf', output), withReceipt);
await assert.rejects(
  () =>
    buildSalesReportPdf(
      {
        storeName: 'Teste',
        sales: [sales[0]],
        level: 'simple',
        kind: 'financial',
        includeReceipts: true,
        receiptPdfMode: 'images',
      },
      async () => sourceBytes,
      async function* () {
        yield await Promise.reject(new Error('conversion failed'));
      },
    ),
  /Nenhum PDF incompleto/,
);
console.log(
  'PASS: financial totals, dates, account separation, cancellations, duplicate/blocked receipts, PDF levels and safe public PDF.',
);

const adapter = new SqliteDatabase(':memory:');
const db = adapter as unknown as D1Database;
adapter.database.exec(
  `CREATE TABLE stores(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE attachments(id TEXT PRIMARY KEY,store_id TEXT,kind TEXT,r2_key TEXT);INSERT INTO stores VALUES('a'),('b');INSERT INTO users VALUES('user');`,
);
adapter.database.exec(
  await readFile(
    new URL('../drizzle/0017_public_report_links.sql', import.meta.url),
    'utf8',
  ),
);
adapter.database.exec(
  await readFile(
    new URL('../drizzle/0013_manual_receipt_deletion.sql', import.meta.url),
    'utf8',
  ),
);
adapter.database.exec(
  "INSERT INTO attachments VALUES('file','a','report','stores/a/reports/file.pdf');",
);
const expiry = reportExpiry(24, now);
assert.equal(expiry - now, 86400_000);
assert.throws(() => reportExpiry(0, now));
adapter.database
  .prepare('INSERT INTO report_shares VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run(
    'share',
    'a',
    'user',
    'hash',
    'file',
    'Teste',
    now,
    expiry,
    null,
    'operation',
  );
assert.equal(
  (await readPublicReport(db, 'hash', now)).key,
  'stores/a/reports/file.pdf',
);
await assert.rejects(() => readPublicReport(db, 'wrong', now));
await assert.rejects(() => readPublicReport(db, 'hash', expiry));
await assert.rejects(() => revokeReport(db, 'b', 'share', now));
assert.ok(await readPublicReport(db, 'hash', now));
await revokeReport(db, 'a', 'share', now);
await assert.rejects(() => readPublicReport(db, 'hash', now));
await expireReportFiles(db, now);
assert.equal(
  adapter.database
    .prepare('SELECT attachment_id AS id FROM report_shares')
    .get()!.id,
  null,
);
assert.equal(
  adapter.database.prepare('SELECT count(*) AS n FROM attachments').get()!.n,
  0,
);
assert.equal(
  adapter.database
    .prepare('SELECT r2_key AS key FROM file_deletion_jobs')
    .get()!.key,
  'stores/a/reports/file.pdf',
);
await expireReportFiles(db, now);
assert.equal(
  adapter.database
    .prepare('SELECT count(*) AS n FROM file_deletion_jobs')
    .get()!.n,
  1,
);
adapter.close();
console.log(
  'PASS: expiry boundary, revocation, store isolation, quota release and durable cleanup.',
);
