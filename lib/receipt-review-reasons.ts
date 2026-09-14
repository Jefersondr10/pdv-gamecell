// These explanations describe evidence inferred by the reader. Older sync
// versions persisted them after the underlying evidence had already become
// valid, so they are not a durable/manual financial hold by themselves.
export const DERIVED_RECEIPT_REVIEW_REASONS = [
  'Documento sem confirmação de pagamento realizado: confira agendamento, processamento, cancelamento ou estorno.',
  'A leitura do comprovante ficou ambígua. Reenvie uma imagem legível de uma única transação para conferência.',
  'Há comprovantes da mesma transação. Não registre o Pix duas vezes.',
  'Esta transação aparece em outro comprovante. Ela não será somada novamente; confira os anexos.',
  'Há comprovantes da mesma transação nesta venda. Confira os anexos duplicados.',
  'O documento indica agendamento, cancelamento ou estorno. Confira o pagamento.',
  'Confira o documento: pagamento não confirmado ou leitura ambígua.',
  'A leitura não identificou uma transação concluída com segurança. Releia o comprovante.',
  'Esta transação já foi registrada por outro comprovante. Ela não será somada novamente.',
  'A leitura não contém identificação suficiente para conciliação automática. Releia o comprovante.',
  'Não foi possível confirmar um único valor para conciliação automática. Releia o comprovante.',
] as const;

export function isDerivedReceiptReviewReason(
  reason: string | null | undefined,
) {
  return DERIVED_RECEIPT_REVIEW_REASONS.some((candidate) => candidate === reason);
}

// Unknown/manual reasons fail closed. A derived reason is obsolete only when
// the current evidence independently passes every acceptance check.
export function hasEffectiveReceiptReviewReason(
  reason: string | null | undefined,
  currentEvidenceAccepted: boolean,
) {
  if (reason === null || reason === undefined || reason === '') return false;
  return !currentEvidenceAccepted || !isDerivedReceiptReviewReason(reason);
}
