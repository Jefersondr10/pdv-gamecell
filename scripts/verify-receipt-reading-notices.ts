import assert from 'node:assert/strict';

import type { ReceiptDocument } from '../lib/receipt-document.ts';
import {
  receiptReadingNotices,
  splitReceiptReadingNotices,
} from '../lib/receipt-reading-notices.ts';

const complete: ReceiptDocument = {
  version: 1,
  payerName: 'Cliente',
  payerBank: 'Banco pagador',
  recipientName: 'Loja',
  recipientBank: 'Banco recebedor',
  recipientDocument: '61120555000161',
  transactionId: `E${'1'.repeat(31)}`,
  alternateTransactionId: null,
  observedTransactionId: null,
  paidAtText: '12/09/2026 15:55',
  state: 'completed',
  automaticEligible: true,
  ambiguous: false,
  blocked: false,
};

assert.deepEqual(
  receiptReadingNotices({
    receiptAmountCents: 13_940_00,
    receiptDetails: complete,
  }),
  [],
  'a complete receipt does not invent warnings',
);

const missingMetadata = splitReceiptReadingNotices({
  receiptAmountCents: 13_940_00,
  receiptDetails: {
    ...complete,
    payerName: null,
    payerBank: null,
    recipientName: null,
    recipientBank: null,
    recipientDocument: null,
    transactionId: null,
    automaticEligible: false,
    paidAtText: null,
  },
});
assert.equal(
  missingMetadata.blocking.length,
  0,
  'missing metadata is informational and cannot block reconciliation by itself',
);
assert.deepEqual(
  new Set(missingMetadata.informational.map((notice) => notice.key)),
  new Set([
    'payer_missing',
    'payer_bank_missing',
    'recipient_missing',
    'recipient_bank_missing',
    'recipient_document_missing',
    'paid_at_missing',
    'transaction_id_missing',
  ]),
);

const unknown = splitReceiptReadingNotices({
  receiptAmountCents: 13_940_00,
  receiptDetails: { ...complete, state: 'unknown' },
});
assert.deepEqual(
  unknown.informational.map((notice) => notice.key),
  ['payment_status_unconfirmed'],
);
assert.equal(unknown.blocking.length, 0);

const processing = splitReceiptReadingNotices({
  receiptAmountCents: 13_940_00,
  receiptDetails: {
    ...complete,
    state: 'unknown',
    automaticEligible: false,
    blocked: true,
  },
});
assert.deepEqual(
  processing.blocking.map((notice) => notice.key),
  ['reading_blocked'],
);
assert.equal(
  processing.informational.some(
    (notice) => notice.key === 'payment_status_unconfirmed',
  ),
  false,
);

const noDocument = splitReceiptReadingNotices({
  receiptAmountCents: 13_940_00,
  receiptDetails: null,
});
assert.equal(noDocument.blocking.length, 0);
assert.equal(
  noDocument.informational.some(
    (notice) => notice.key === 'payment_status_unconfirmed',
  ),
  true,
);

const scheduled = splitReceiptReadingNotices({
  receiptAmountCents: 13_940_00,
  receiptDetails: {
    ...complete,
    state: 'scheduled',
    automaticEligible: false,
    blocked: true,
  },
});
assert.deepEqual(
  scheduled.blocking.map((notice) => notice.key),
  ['payment_scheduled'],
);

const scheduledWithDerivedReason = splitReceiptReadingNotices({
  receiptAmountCents: 13_940_00,
  receiptDetails: {
    ...complete,
    state: 'scheduled',
    automaticEligible: false,
    blocked: true,
  },
  receiptReviewReason:
    'Confira o documento: pagamento não confirmado ou leitura ambígua.',
});
assert.deepEqual(
  scheduledWithDerivedReason.blocking.map((notice) => notice.key),
  ['payment_scheduled'],
  'a structured blocker replaces the equivalent derived review warning',
);

const reading = splitReceiptReadingNotices({
  receiptAmountCents: null,
  receiptDetails: null,
  receiptOcrStatus: 'processing',
});
assert.deepEqual(
  reading.progress.map((notice) => notice.key),
  ['reading'],
);
assert.equal(reading.blocking.length, 0);
assert.equal(reading.informational.length, 0);

const noAmount = splitReceiptReadingNotices({
  receiptAmountCents: null,
  receiptDetails: complete,
});
assert.deepEqual(
  noAmount.blocking.map((notice) => notice.key),
  ['amount_missing'],
);

const providerIdentity = splitReceiptReadingNotices({
  receiptAmountCents: 15_000_00,
  receiptDetails: {
    ...complete,
    transactionId: null,
    alternateTransactionId: 'mercado-pago:177978581202',
  },
});
assert.equal(
  providerIdentity.informational.some(
    (notice) => notice.key === 'transaction_id_missing',
  ),
  false,
  'a provider transaction id is valid presentation metadata',
);

const review = splitReceiptReadingNotices({
  receiptAmountCents: 15_000_00,
  receiptDetails: complete,
  receiptReviewReason: 'Esta transação também aparece em outra venda.',
});
assert.deepEqual(
  review.blocking.map((notice) => notice.key),
  ['system_review'],
);

console.log('receipt reading notices verified');
