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

const SHORT_NOTICE_LABELS: Partial<
  Record<ReceiptReadingNotice['key'], string>
> = {
  reading: 'Leitura em andamento.',
  amount_missing: 'Valor não identificado.',
  amount_invalid: 'Valor inválido.',
  payment_scheduled: 'Pagamento apenas agendado.',
  payment_cancelled: 'Pagamento cancelado ou estornado.',
  payment_status_unconfirmed: 'Conclusão do pagamento não identificada.',
  reading_ambiguous: 'Mais de uma transação foi identificada.',
  reading_blocked: 'Documento bloqueado para conciliação.',
  payer_missing: 'Pagador não identificado.',
  payer_bank_missing: 'Banco pagador não identificado.',
  recipient_missing: 'Recebedor não identificado.',
  recipient_bank_missing: 'Banco recebedor não identificado.',
  recipient_document_missing: 'CPF/CNPJ do recebedor ausente ou mascarado.',
  paid_at_missing: 'Data e hora não identificadas.',
  transaction_id_missing: 'ID da transação não identificado.',
};

function compactSystemReview(label: string) {
  const normalized = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (
    normalized.includes('outro comprovante') ||
    normalized.includes('outra venda')
  )
    return 'Pix repetido em outro comprovante; o valor não foi somado.';
  if (
    normalized.includes('mesma transacao') ||
    normalized.includes('anexos duplicados')
  )
    return 'Pix repetido nesta venda; o valor não foi somado.';
  if (
    normalized.includes('agendamento') ||
    normalized.includes('cancelamento') ||
    normalized.includes('estorno')
  )
    return 'Pagamento não confirmado; confira se foi concluído.';
  if (
    normalized.includes('ambigua') ||
    normalized.includes('unico valor')
  )
    return 'Leitura ambígua; reenvie um único comprovante legível.';
  if (normalized.includes('identificacao suficiente'))
    return 'Dados insuficientes; releia o comprovante.';
  if (normalized.includes('transacao concluida com seguranca'))
    return 'Pagamento concluído não confirmado; releia o comprovante.';
  if (
    normalized.includes('identificar o valor') ||
    normalized.includes('valor do comprovante nao identificado')
  )
    return 'Valor não identificado; releia o comprovante.';
  if (normalized.includes('alterado manualmente'))
    return 'Pagamento alterado manualmente; dinheiro não será convertido em Pix.';
  if (
    normalized.includes('ja aplicado') ||
    normalized.includes('alocacao')
  )
    return 'Vínculo do comprovante mudou; confira o pagamento.';
  if (normalized.includes('identificacao da transacao mudou'))
    return 'ID da transação mudou; confira o pagamento.';
  if (normalized.includes('valor fora do limite'))
    return 'Valor fora do limite; confira os pagamentos.';
  return label;
}

export function receiptNoticeSentence(notice: ReceiptReadingNotice) {
  const concise =
    SHORT_NOTICE_LABELS[notice.key] ?? compactSystemReview(notice.label);
  const normalized = concise.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

export function receiptNoticeGroup(notices: ReceiptReadingNotice[]) {
  return {
    items: notices.map(receiptNoticeSentence).filter(Boolean),
    numbered: notices.length > 1,
  };
}

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
