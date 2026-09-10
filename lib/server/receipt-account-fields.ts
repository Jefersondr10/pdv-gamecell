import { HttpError, stringField } from './http.ts';
export function receiptAccountFields(body: Record<string, unknown>) {
  const receiptBank =
    body.receiptBank == null || body.receiptBank === ''
      ? null
      : stringField(body.receiptBank, 'Banco recebedor', { max: 150 });
  const receiptRecipientDocument =
    body.receiptRecipientDocument == null ||
    body.receiptRecipientDocument === ''
      ? null
      : stringField(body.receiptRecipientDocument, 'CPF/CNPJ do recebedor', {
          max: 20,
        }).replace(/[.\-/\s]/g, '');
  if (
    receiptRecipientDocument &&
    !/^\d{11}$|^\d{14}$/.test(receiptRecipientDocument)
  )
    throw new HttpError(
      400,
      'Informe os 11 dígitos do CPF ou 14 do CNPJ do recebedor.',
      'INVALID_DOCUMENT',
    );
  return { receiptBank, receiptRecipientDocument };
}
