import { ORDER_STATUS_COLORS, type OrderStatusColor } from '@/lib/pdv-types';
import { HttpError, stringField } from '@/lib/server/http';
import { isAutomaticStatusName } from '../sale-display-status';
export { normalizeOrderStatusName } from '../order-status-names.ts';

export function orderStatusName(value: unknown) {
  const name = stringField(value, 'Nome do status', { max: 60 })
    .normalize('NFKC')
    .replace(/\s+/gu, ' ');
  if (isAutomaticStatusName(name))
    throw new HttpError(
      400,
      'Esse nome pertence a um status automático. Escolha outro nome para a etiqueta interna.',
      'SYSTEM_STATUS_NAME',
    );
  return name;
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
