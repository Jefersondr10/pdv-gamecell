import { HttpError, integerField } from './http.ts';

import type {
  ReceiptAmountSource,
  ReceiptValueInput,
} from '../receipt-reconciliation.ts';

export function parseReceiptValues(
  value: unknown,
  expectedLength: number,
): ReceiptValueInput[] {
  if (value === undefined) {
    return Array.from({ length: expectedLength }, () => ({
      amountCents: null,
      source: null,
    }));
  }
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new HttpError(
      400,
      'Os valores dos comprovantes não correspondem aos arquivos enviados.',
      'INVALID_RECEIPT_VALUES',
    );
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw invalidReceiptValue('Valor de comprovante inválido.');
    }
    const record = raw as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => key !== 'amountCents' && key !== 'source',
      )
    ) {
      throw invalidReceiptValue(
        'O valor do comprovante contém um campo não reconhecido.',
      );
    }
    if (record.amountCents === null) {
      if (record.source !== null) {
        throw invalidReceiptValue(
          'A origem do valor do comprovante é inválida.',
        );
      }
      return { amountCents: null, source: null };
    }
    const source: ReceiptAmountSource | null =
      record.source === 'ocr'
        ? 'ocr'
        : record.source === 'manual'
          ? 'manual'
          : null;
    if (!source) {
      throw invalidReceiptValue('A origem do valor do comprovante é inválida.');
    }
    return {
      amountCents: integerField(record.amountCents, 'Valor do comprovante', {
        min: 1,
        max: 1_000_000_000,
      }),
      source,
    };
  });
}

function invalidReceiptValue(message: string) {
  return new HttpError(400, message, 'INVALID_RECEIPT_VALUE');
}
