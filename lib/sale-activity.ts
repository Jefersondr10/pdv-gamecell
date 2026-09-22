export type SaleActivityChange = {
  label: string;
  before: string;
  after: string;
};
export type SaleActivity = {
  id: string;
  title: string;
  actor: string;
  automatic: boolean;
  createdAt: number;
  notes: string[];
  changes: SaleActivityChange[];
};
export type SaleActivityPage = {
  items: SaleActivity[];
  nextCursor: string | null;
};
export type ReceiptConflict = {
  receiptId: string;
  otherReceiptId: string;
  saleId: string;
  saleNumber: number;
  customerName: string;
};
export type ReceiptConflicts = { items: ReceiptConflict[]; hasMore: boolean };

export const SALE_ACTIVITY_TITLES: Record<string, string> = {
  'sale.created': 'Venda registrada',
  'sale.participants_changed': 'Cliente ou vendedor alterado',
  'sale.date_changed': 'Data da venda alterada',
  'sale.prices_changed': 'Preços da venda alterados',
  'sale.order_status_changed': 'Status cadastrado alterado',
  'sale.payment_added': 'Recebimento adicionado',
  'sale.payments_corrected': 'Pagamentos corrigidos',
  'sale.payment_from_receipts': 'Pagamentos atualizados pelos comprovantes',
  'sale.receipt_payment_requested': 'Conferência dos pagamentos solicitada',
  'sale.attachments_added': 'Anexos adicionados',
  'sale.receipt_values_updated': 'Leitura do comprovante salva',
  'sale.receipt_reread': 'Releitura do comprovante solicitada',
  'sale.legacy_receipts_reread':
    'Releitura dos comprovantes antigos solicitada',
  'sale.receipt_deleted': 'Comprovante excluído',
  'sale.receipt_review': 'Comprovante encaminhado para revisão',
  'sale.receipts_verified': 'Comprovantes conferidos automaticamente',
  'sale.cancelled': 'Venda cancelada',
};
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const text = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : 'Não registrado';
const money = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value)
    ? (value / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      })
    : 'Não registrado';
const date = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0 &&
  value < 8.64e15
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(value)
    : 'Não registrada';
const array = (value: unknown) =>
  Array.isArray(value) ? value.slice(0, 100).map(object) : [];
const total = (value: unknown) =>
  Array.isArray(value) &&
  value.every((row) => Number.isSafeInteger(object(row).amountCents))
    ? value.reduce<number>(
        (sum, row) => sum + Number(object(row).amountCents),
        0,
      )
    : undefined;

/** Whitelisted presentation only: never expose raw audit payloads, file keys or fingerprints. */
export function presentSaleActivity(row: {
  id: string;
  action: string;
  actor: string | null;
  createdAt: number;
  details: string | null;
}): SaleActivity {
  let details: ObjectValue = {};
  try {
    details = object(JSON.parse(row.details ?? '{}'));
  } catch {
    /* Legacy audits may have incomplete details. */
  }
  const before = object(details.before);
  const after = object(details.after);
  const changes: SaleActivityChange[] = [];
  const notes: string[] = [];
  const change = (
    label: string,
    previous: unknown,
    next: unknown,
    format = text,
  ) => {
    if (previous !== next && (previous !== undefined || next !== undefined))
      changes.push({ label, before: format(previous), after: format(next) });
  };
  switch (row.action) {
    case 'sale.created':
      notes.push(`Valor da venda: ${money(details.productsTotalCents)}.`);
      if (Number.isSafeInteger(details.items))
        notes.push(`${Number(details.items)} aparelho(s).`);
      break;
    case 'sale.participants_changed':
      change('Cliente', before.customerName, after.customerName);
      change('Vendedor', before.sellerName, after.sellerName);
      break;
    case 'sale.date_changed':
      change('Data e horário', before.createdAt, after.createdAt, date);
      break;
    case 'sale.prices_changed':
      change('Total da venda', before.totalCents, after.totalCents, money);
      for (const item of array(after.items)) {
        const previous = array(before.items).find((old) => old.id === item.id);
        change(
          `SN ${text(item.serial)}`,
          previous?.soldPriceCents,
          item.soldPriceCents,
          money,
        );
      }
      break;
    case 'sale.order_status_changed':
      change(
        'Status cadastrado',
        details.previousOrderStatusName,
        details.orderStatusName,
      );
      if (!changes.length)
        notes.push(
          'Os nomes dos status não foram registrados nesta alteração antiga.',
        );
      notes.push(
        'As pendências automáticas continuam sendo calculadas pelos dados da venda.',
      );
      break;
    case 'sale.payment_added':
      notes.push(
        `${details.method === 'cash' ? 'Dinheiro' : details.method === 'pix' ? 'Pix' : 'Recebimento'}: ${money(details.amountCents)}.`,
      );
      change(
        'Total recebido',
        details.previousReceivedCents,
        details.receivedTotalCents,
        money,
      );
      break;
    case 'sale.payments_corrected':
      for (const payment of array(details.after)) {
        const previous = array(details.before).find(
          (old) => old.id === payment.id,
        );
        change(
          `${payment.method === 'cash' ? 'Dinheiro' : 'Pix'} · recebimento ${array(details.after).indexOf(payment) + 1}`,
          previous?.amountCents,
          payment.amountCents,
          money,
        );
      }
      change(
        'Total recebido',
        total(details.before),
        total(details.after),
        money,
      );
      break;
    case 'sale.payment_from_receipts':
      change(
        'Total recebido',
        details.beforeTotalCents ?? total(details.before),
        details.afterTotalCents ?? details.receivedTotalCents,
        money,
      );
      notes.push(
        'Atualização automática a partir dos comprovantes; não confirma crédito bancário.',
      );
      break;
    case 'sale.attachments_added':
      if (Number(details.receiptsAdded) > 0)
        notes.push(
          `${Number(details.receiptsAdded)} comprovante(s) adicionado(s).`,
        );
      if (Number(details.itemPhotosAdded) > 0)
        notes.push(
          `${Number(details.itemPhotosAdded)} foto(s) de aparelho adicionada(s).`,
        );
      break;
    case 'sale.receipt_values_updated':
      if (Number.isSafeInteger(details.updatedCount))
        notes.push(
          `${Number(details.updatedCount)} comprovante(s) atualizado(s).`,
        );
      notes.push('Os valores anteriores não foram registrados neste evento.');
      break;
    case 'sale.receipt_reread':
      if (details.expectedAmount !== undefined)
        notes.push(
          `Valor antes da releitura: ${money(details.expectedAmount)}.`,
        );
      notes.push(
        'A solicitação de releitura não significa que o pagamento foi confirmado.',
      );
      break;
    case 'sale.receipt_deleted':
      notes.push(
        `Arquivo: ${text(before.name)}.`,
        `Valor identificado antes da exclusão: ${money(before.amountCents)}.`,
      );
      break;
    case 'sale.receipt_review':
      if (typeof details.reason === 'string') notes.push(text(details.reason));
      break;
    case 'sale.cancelled':
      notes.push(`Motivo: ${text(details.reason)}.`);
      break;
  }
  const automatic =
    [
      'sale.payment_from_receipts',
      'sale.receipt_review',
      'sale.receipts_verified',
    ].includes(row.action) ||
    (row.action === 'sale.payment_added' && Boolean(details.attachmentId));
  return {
    id: row.id,
    title: SALE_ACTIVITY_TITLES[row.action] ?? 'Alteração registrada',
    actor: row.actor?.trim() || 'Operador não identificado',
    automatic,
    createdAt: Number(row.createdAt),
    notes,
    changes,
  };
}
