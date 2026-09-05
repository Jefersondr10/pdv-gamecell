import { ORDER_STATUS_COLORS, type OrderStatusColor } from '@/lib/pdv-types';
import { HttpError, stringField } from '@/lib/server/http';

export function orderStatusName(value: unknown) {
  return stringField(value, 'Nome do status', { max: 60 }).replace(
    /\s+/gu,
    ' ',
  );
}

export function normalizeOrderStatusName(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('pt-BR');
}

export function orderStatusColor(
  value: unknown,
  fallback?: OrderStatusColor,
): OrderStatusColor {
  if (value === undefined && fallback) return fallback;
  if (
    typeof value !== 'string' ||
    !ORDER_STATUS_COLORS.includes(value as OrderStatusColor)
  ) {
    throw new HttpError(
      400,
      'Escolha uma cor válida para o status.',
      'INVALID_ORDER_STATUS_COLOR',
    );
  }
  return value as OrderStatusColor;
}
