import {
  receiptDataWarnings,
  type ReceiptDataWarningKey,
  type ReceiptDocument,
} from './receipt-document.ts';
import { isDerivedReceiptReviewReason } from './receipt-review-reasons.ts';

export type ReceiptReadingNoticeTone =
  | 'blocking'
  | 'informational'
  | 'progress';

export type ReceiptReadingNotice = {
  key:
    | 'reading'
    | 'amount_missing'
    | 'amount_invalid'
    | 'payment_scheduled'
    | 'payment_cancelled'
    | 'payment_status_unconfirmed'
    | 'reading_ambiguous'
    | 'reading_blocked'
    | 'payer_missing'
    | 'payer_bank_missing'
    | 'recipient_missing'
    | 'recipient_bank_missing'
    | 'recipient_document_missing'
    | 'paid_at_missing'
    | 'transaction_id_missing'
    | 'system_review';
  label: string;
  tone: ReceiptReadingNoticeTone;
};

export type ReceiptNoticeInput = {
  receiptAmountCents: number | null;
  receiptDetails?: ReceiptDocument | null;
  receiptOcrStatus?: string | null;
  processingStatus?: string | null;
  receiptReviewReason?: string | null;
};

const READING_STATUSES = new Set(['pending', 'processing', 'retry']);
const DATA_WARNING_NOTICE_KEYS: Record<
  ReceiptDataWarningKey,
  ReceiptReadingNotice['key']
> = {
  completion_status: 'payment_status_unconfirmed',
  transaction_id: 'transaction_id_missing',
  paid_at: 'paid_at_missing',
  payer_name: 'payer_missing',
  payer_bank: 'payer_bank_missing',
  recipient_name: 'recipient_missing',
  recipient_bank: 'recipient_bank_missing',
  recipient_document: 'recipient_document_missing',
};

/**
 * Presentation-only diagnostics for one receipt.
 *
 * Missing metadata is intentionally informational. It must never decide whether
 * the sale is reconciled: the financial/status layer owns that decision.
 */
export function receiptReadingNotices(
  receipt: ReceiptNoticeInput,
): ReceiptReadingNotice[] {
  const notices: ReceiptReadingNotice[] = [];
  const processingStatus =
    receipt.receiptOcrStatus ?? receipt.processingStatus ?? null;
  const reading = READING_STATUSES.has(processingStatus ?? '');
  const amount = receipt.receiptAmountCents;
  const details = receipt.receiptDetails ?? null;

  if (reading) {
    notices.push({
      key: 'reading',
      label: 'Leitura do comprovante em andamento',
      tone: 'progress',
    });
  } else if (amount === null) {
    notices.push({
      key: 'amount_missing',
      label: 'Valor do pagamento não identificado',
      tone: 'blocking',
    });
  } else if (!Number.isSafeInteger(amount) || amount <= 0) {
    notices.push({
      key: 'amount_invalid',
      label: 'Valor do pagamento inválido',
      tone: 'blocking',
    });
  }

  if (!reading) {
    if (details?.state === 'scheduled') {
      notices.push({
        key: 'payment_scheduled',
        label: 'Pagamento apenas agendado; ainda não realizado',
        tone: 'blocking',
      });
    } else if (details?.state === 'cancelled') {
      notices.push({
        key: 'payment_cancelled',
        label: 'Pagamento cancelado ou estornado',
        tone: 'blocking',
      });
    }

    if (details?.ambiguous) {
      notices.push({
        key: 'reading_ambiguous',
        label: 'Leitura ambígua ou com mais de uma transação',
        tone: 'blocking',
      });
    }
    if (
      details?.blocked &&
      !['scheduled', 'cancelled'].includes(details.state) &&
      !details.ambiguous
    ) {
      notices.push({
        key: 'reading_blocked',
        label: 'Documento bloqueado para conciliação automática',
        tone: 'blocking',
      });
    }

    for (const warning of receiptDataWarnings(details))
      notices.push({
        key: DATA_WARNING_NOTICE_KEYS[warning.key],
        label: `${warning.label}: ${warning.message}`,
        tone: 'informational',
      });
  }

  const reason = receipt.receiptReviewReason?.trim();
  const hasStructuredBlocker = notices.some(
    (notice) => notice.tone === 'blocking',
  );
  if (
    reason &&
    !(hasStructuredBlocker && isDerivedReceiptReviewReason(reason)) &&
    !notices.some((notice) => notice.label === reason)
  ) {
    notices.push({
      key: 'system_review',
      label: reason,
      tone: 'blocking',
    });
  }

  return notices;
}

export function splitReceiptReadingNotices(receipt: ReceiptNoticeInput) {
  const notices = receiptReadingNotices(receipt);
  return {
    blocking: notices.filter((notice) => notice.tone === 'blocking'),
    informational: notices.filter((notice) => notice.tone === 'informational'),
    progress: notices.filter((notice) => notice.tone === 'progress'),
  };
}
