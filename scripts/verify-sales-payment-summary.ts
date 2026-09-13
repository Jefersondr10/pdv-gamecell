import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { summarizeSalesPayments } from '../lib/sales-payment-summary.ts';
import { buildSalesReportPdf } from '../lib/sales-report-pdf.ts';
import type { SaleRecord, SalePaymentRecord } from '../lib/pdv-types.ts';

const payment = (
  id: string,
  method: 'pix' | 'cash',
  amountCents: number,
  accountName: string | null = null,
  pixAccountId: string | null = null,
): SalePaymentRecord => ({
  id,
  method,
  amountCents,
  accountName,
  pixAccountId,
});
const sale = (
  id: number,
  amount: number,
  payments: SalePaymentRecord[],
): SaleRecord => ({
  id: String(id),
  number: id,
  customerId: null,
  customerName: `Cliente de teste ${id}`,
  sellerName: 'Vendedor de teste',
  orderStatus: null,
  productsTotalCents: amount,
  receivedTotalCents: payments.reduce((sum, p) => sum + p.amountCents, 0),
  receivedDifferenceCents:
    payments.reduce((sum, p) => sum + p.amountCents, 0) - amount,
  referenceTotalCents: amount,
  priceDifferenceCents: 0,
  status: 'completed',
  createdAt: Date.parse('2026-09-09T12:00:00-03:00') + id * 1000,
  cancelledAt: null,
  cancelledByName: null,
  cancellationReason: null,
  items: [
    {
      id: `item${id}`,
      productId: 'product',
      productName: 'iPhone 17',
      productDetail: 'Azul-névoa · 256 GB',
      serial: `TESTE${id}`,
      soldPriceCents: amount,
      referencePriceCents: amount,
      photos: [],
    },
  ],
  payments,
  receipts: payments
    .filter((payment) => payment.method === 'pix')
    .map((payment) => ({
      id: `receipt-${payment.id}`,
      name: `comprovante-${payment.id}.png`,
      mimeType: 'image/png',
      sizeBytes: 100,
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      receiptAmountCents: payment.amountCents,
      receiptAmountSource: 'ocr' as const,
      receiptAmountConfirmedAt: Date.parse('2026-09-09T12:00:00-03:00'),
      receiptPaymentId: payment.id,
      receiptReviewReason: null,
      receiptOcrStatus: 'done',
      receiptDetails: {
        version: 1 as const,
        payerName: 'Pagador de teste',
        payerBank: 'Banco pagador',
        recipientName: payment.accountName,
        recipientBank: payment.accountName,
        recipientDocument: null,
        transactionId: `E${payment.id.padEnd(31, '0').slice(0, 31)}`,
        alternateTransactionId: null,
        observedTransactionId: null,
        paidAtText: '09/09/2026 12:00',
        state: 'completed' as const,
        automaticEligible: true,
        ambiguous: false,
        blocked: false,
      },
    })),
  reconciliation: {
    status: 'pending',
    confirmedTotalCents: 0,
    differenceCents: null,
    pendingReceiptCount: 0,
  },
});
const mixed = sale(1, 710000, [
  payment('pix1', 'pix', 410000, 'Banco MT', 'mt'),
  payment('cash1', 'cash', 300000),
]);
const before = JSON.stringify(mixed);
assert.deepEqual(
  summarizeSalesPayments([mixed]).groups.map((g) => [g.label, g.amountCents]),
  [
    ['Pix · Banco MT', 410000],
    ['Dinheiro', 300000],
  ],
);
assert.equal(JSON.stringify(mixed), before);
const homonyms = sale(2, 30000, [
  payment('a', 'pix', 10000, 'Principal', 'bankA'),
  payment('b', 'pix', 20000, 'Principal', 'bankB'),
]);
assert.equal(summarizeSalesPayments([homonyms]).groups.length, 2);
const renamed = sale(3, 10000, [
  payment('renamed', 'pix', 10000, 'Banco MT novo', 'mt'),
]);
const renamedSummary = summarizeSalesPayments([renamed, mixed]);
assert.equal(renamedSummary.groups[0].amountCents, 420000);
assert.deepEqual(renamedSummary.groups[0].aliases, ['Banco MT']);
assert.equal(renamedSummary.groups[0].label, 'Pix · Banco MT novo');
assert.deepEqual(renamedSummary, summarizeSalesPayments([mixed, renamed]));
const legacy = sale(4, 3000, [
  payment('none', 'pix', 1000),
  payment('legacyA', 'pix', 1000, '  Antiga   conta  '),
  payment('legacyB', 'pix', 1000, 'antiga conta'),
]);
assert.equal(summarizeSalesPayments([legacy]).groups.length, 2);
assert.equal(
  summarizeSalesPayments([legacy]).groups.find((g) =>
    g.label.includes('Banco não identificado'),
  )?.amountCents,
  1000,
);
const cancelled = { ...mixed, status: 'cancelled' as const };
assert.equal(summarizeSalesPayments([cancelled]).receivedCents, 0);
assert.equal(summarizeSalesPayments([cancelled]).groups.length, 0);
const under = sale(5, 10000, []),
  over = sale(6, 10000, [payment('cashover', 'cash', 20000)]);
const offset = summarizeSalesPayments([under, over]);
assert.equal(offset.outstandingCents, 10000);
assert.equal(offset.excessCents, 10000);
assert.equal(offset.receivedCents, offset.soldCents);
assert.equal(
  summarizeSalesPayments([sale(7, 10001, [payment('cent', 'cash', 10000)])])
    .outstandingCents,
  1,
);
const inconsistent = { ...mixed, receivedTotalCents: 720000 };
assert.equal(summarizeSalesPayments([inconsistent]).inconsistentSaleCount, 1);
assert.equal(summarizeSalesPayments([inconsistent]).detailedCents, 710000);
assert.equal(summarizeSalesPayments([inconsistent]).receivedCents, 710000);
assert.equal(
  summarizeSalesPayments([sale(8, 0, [payment('no-price', 'cash', 100)])])
    .excessCents,
  100,
);
const demo = [
  mixed,
  sale(9, 100000, [
    payment('second-bank', 'pix', 100000, 'Conta principal', 'principal'),
  ]),
  under,
  over,
  cancelled,
];
const out = new URL('../tmp/pdfs/sales-payments/', import.meta.url);
await mkdir(out, { recursive: true });
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
for (const level of ['simple', 'detailed', 'complete'] as const) {
  const bytes = await buildSalesReportPdf({
    storeName: 'Loja Demonstração',
    sales: demo,
    level,
    filterSummary: '09/09/2026 · Dados fictícios para conferência',
    generatedAt: mixed.createdAt,
  });
  await writeFile(new URL(`recebimentos-${level}.pdf`, out), bytes);
  const task = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ');
  for (const label of [
    'Onde foi recebido',
    'Pix · Banco MT',
    'Pix · Conta principal',
    'Dinheiro',
    'Total recebido',
    'Falta receber',
    'Recebido a mais',
  ])
    assert.ok(text.includes(label), `${level}: missing ${label}`);
  for (const amount of ['8.300,00', '4.100,00', '1.000,00', '3.200,00'])
    assert.ok(text.includes(amount), `${level}: missing ${amount}`);
  assert.equal((text.match(/100,00/g) || []).length, 3); // 4.100 and the two separate differences.
  await task.destroy();
}
const manyAccounts = sale(
  10,
  360000,
  Array.from({ length: 36 }, (_, n) =>
    payment(
      `p${n}`,
      'pix',
      10000,
      `Conta de teste ${n + 1} - Nome longo para conferir o espaço disponível no relatório`,
      `bank${n}`,
    ),
  ),
);
await writeFile(
  new URL('recebimentos-muitas-contas.pdf', out),
  await buildSalesReportPdf({
    storeName: 'Loja Demonstração',
    sales: [manyAccounts],
    level: 'simple',
  }),
);
console.log(
  'Sales receipts breakdown passed: mixed payments, bank identity, historical names, missing bank, cancellation, one cent, offsetting balances and saved-total mismatch.',
);
