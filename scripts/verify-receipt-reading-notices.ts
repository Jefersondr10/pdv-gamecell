import assert from 'node:assert/strict';

import type { ReceiptDocument } from '../lib/receipt-document.ts';
import { DERIVED_RECEIPT_REVIEW_REASONS } from '../lib/receipt-review-reasons.ts';
import {
  receiptNoticeGroup,
  receiptNoticeSentence,
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
assert.equal(
  receiptNoticeSentence(review.blocking[0]),
  'Pix repetido em outro comprovante; o valor não foi somado.',
  'known duplicate warnings use concise copy',
);

const singlePresentation = receiptNoticeGroup([
  {
    key: 'amount_missing',
    label: 'Valor do pagamento não identificado',
    tone: 'blocking',
  },
]);
assert.deepEqual(singlePresentation, {
  items: ['Valor não identificado.'],
  numbered: false,
});

const multiplePresentation = receiptNoticeGroup([
  {
    key: 'payer_missing',
    label: 'Nome do pagador: Não identificado no comprovante.',
    tone: 'informational',
  },
  {
    key: 'recipient_bank_missing',
    label: 'Banco recebedor: Não identificado no comprovante.',
    tone: 'informational',
  },
]);
assert.deepEqual(multiplePresentation, {
  items: ['Pagador não identificado.', 'Banco recebedor não identificado.'],
  numbered: true,
});
assert.ok(
  multiplePresentation.items.every((label) => /[.!?]$/.test(label)),
  'every rendered notice is punctuated',
);

assert.equal(
  receiptNoticeSentence({
    key: 'system_review',
    label:
      'A leitura não contém identificação suficiente para conciliação automática. Releia o comprovante.',
    tone: 'blocking',
  }),
  'Dados insuficientes; releia o comprovante.',
  'known automatic reviews never fall back to long copy',
);

for (const reason of DERIVED_RECEIPT_REVIEW_REASONS) {
  const sentence = receiptNoticeSentence({
    key: 'system_review',
    label: reason,
    tone: 'blocking',
  });
  assert.ok(sentence.length <= 75, `automatic notice stayed long: ${sentence}`);
  assert.ok(/[.!?]$/.test(sentence), `automatic notice lost punctuation`);
}

for (const [reason, expected] of [
  [
    'O pagamento deste comprovante foi alterado manualmente. Confira os pagamentos; dinheiro não será convertido em Pix.',
    'Pagamento alterado manualmente; dinheiro não será convertido em Pix.',
  ],
  [
    'Um comprovante já aplicado ou seu pagamento foi alterado/excluído. Confira a alocação; o Pix não será registrado novamente.',
    'Vínculo do comprovante mudou; confira o pagamento.',
  ],
  [
    'A identificação da transação mudou na releitura. Confira o pagamento registrado.',
    'ID da transação mudou; confira o pagamento.',
  ],
] as const)
  assert.equal(
    receiptNoticeSentence({
      key: 'system_review',
      label: reason,
      tone: 'blocking',
    }),
    expected,
  );

const missingValueWithReaderReason = splitReceiptReadingNotices({
  receiptAmountCents: null,
  receiptReviewReason:
    'Não foi possível identificar o valor do comprovante. Releia o arquivo.',
});
assert.deepEqual(
  missingValueWithReaderReason.blocking.map((notice) => notice.key),
  ['amount_missing'],
  'the reader reason does not duplicate the structured missing-value warning',
);

console.log('receipt reading notices verified');
