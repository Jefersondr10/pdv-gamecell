import { assertCsrf, requireSession } from './auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  integerField,
  json,
  operationIdField,
  stringField,
} from './http';
import { consumeStoreWriteBudget } from './rate-limit';
import { runtime } from './runtime';

type Payment = {
  id: string;
  method: 'pix' | 'cash';
  pixAccountId: string | null;
  amountCents: number;
};

function parsePayments(value: unknown): Payment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new HttpError(
      400,
      'Informe os pagamentos que deseja corrigir.',
      'INVALID_PAYMENTS',
    );
  }
  const payments = value
    .map((raw): Payment => {
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        Object.keys(raw).some(
          (key) =>
            !['id', 'method', 'pixAccountId', 'amountCents'].includes(key),
        )
      ) {
        throw new HttpError(400, 'Pagamento inválido.', 'INVALID_PAYMENT');
      }
      if (raw.method !== 'pix' && raw.method !== 'cash') {
        throw new HttpError(
          400,
          'Forma de pagamento inválida.',
          'INVALID_PAYMENT',
        );
      }
      return {
        id: stringField(raw.id, 'Pagamento', { max: 80 }),
        method: raw.method,
        pixAccountId:
          raw.method === 'pix'
            ? stringField(raw.pixAccountId, 'Conta Pix', { max: 80 })
            : null,
        amountCents: integerField(raw.amountCents, 'Valor do pagamento', {
          min: 1,
          max: 1_000_000_000,
        }),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(payments.map((payment) => payment.id)).size !== payments.length) {
    throw new HttpError(
      400,
      'Um pagamento foi informado mais de uma vez.',
      'DUPLICATE_PAYMENT',
    );
  }
  return payments;
}

export async function editSalePayments(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const storeId = session.storeId!;
    const { id: saleId } = await context.params;
    const body = await boundedJson(request);
    if (
      Object.keys(body).some(
        (key) => !['operationId', 'expectedPayments', 'payments'].includes(key),
      )
    ) {
      throw new HttpError(
        400,
        'A correção contém um campo não reconhecido.',
        'UNKNOWN_FIELD',
      );
    }
    const operationId = operationIdField(body.operationId);
    const before = parsePayments(body.expectedPayments);
    const after = parsePayments(body.payments);
    if (
      before.length !== after.length ||
      before.some((payment, index) => payment.id !== after[index].id)
    ) {
      throw new HttpError(
        400,
        'Use Adicionar pagamento para incluir novos pagamentos.',
        'PAYMENT_SET_CHANGED',
      );
    }
    const details = JSON.stringify({ before, after });
    const changes = after.filter(
      (payment, index) =>
        JSON.stringify(payment) !== JSON.stringify(before[index]),
    );
    const db = runtime().DB;
    const readReplay = async () => {
      const saved = await db
        .prepare(`SELECT details_json AS details FROM audit_events
        WHERE id = ? AND store_id = ? AND entity_id = ? AND action = 'sale.payments_corrected' LIMIT 1`)
        .bind(operationId, storeId, saleId)
        .first<{ details: string }>();
      if (!saved) return false;
      if (saved.details !== details) {
        throw new HttpError(
          409,
          'Esta operação já foi usada em outra correção.',
          'OPERATION_ALREADY_USED',
        );
      }
      return true;
    };
    const response = async (replayed: boolean) => {
      const results = await db.batch([
        db
          .prepare(`SELECT id, method, pix_account_id AS pixAccountId, account_name AS accountName,
          amount_cents AS amountCents FROM payments WHERE sale_id = ? AND store_id = ? ORDER BY created_at, id`)
          .bind(saleId, storeId),
        db
          .prepare(`SELECT products_total_cents AS productsTotalCents, received_total_cents AS receivedTotalCents,
          received_difference_cents AS receivedDifferenceCents FROM sales WHERE id = ? AND store_id = ?`)
          .bind(saleId, storeId),
      ]);
      return json({
        ok: true,
        replayed,
        payments: results[0].results,
        sale: results[1].results[0],
      });
    };
    if (await readReplay()) return response(true);
    const sale = await db
      .prepare('SELECT status FROM sales WHERE id = ? AND store_id = ?')
      .bind(saleId, storeId)
      .first<{ status: string }>();
    if (!sale)
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    if (sale.status !== 'completed')
      throw new HttpError(
        409,
        'Uma venda cancelada não pode ter os pagamentos alterados.',
        'SALE_CANCELLED',
      );
    const now = Date.now();
    await consumeStoreWriteBudget(
      db,
      now,
      storeId,
      Math.max(4, changes.length + 2),
    );
    try {
      await db.batch([
        // A comparação e todas as escritas estão na mesma transação. O NOT NULL
        // intencional aborta o lote inteiro se outra pessoa mudou os pagamentos.
        db
          .prepare(`INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
          VALUES (?, ?, ?, 'sale.payments_corrected', 'sale', CASE WHEN
            EXISTS (SELECT 1 FROM sales WHERE id = ? AND store_id = ? AND status = 'completed')
            AND (SELECT COUNT(*) FROM payments WHERE sale_id = ? AND store_id = ?) = ?
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) expected LEFT JOIN payments p
                ON p.id = json_extract(expected.value, '$.id') AND p.sale_id = ? AND p.store_id = ?
              WHERE p.id IS NULL OR p.method != json_extract(expected.value, '$.method')
                OR p.pix_account_id IS NOT json_extract(expected.value, '$.pixAccountId')
                OR p.amount_cents != json_extract(expected.value, '$.amountCents'))
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) next JOIN payments p ON p.id = json_extract(next.value, '$.id')
              WHERE json_extract(next.value, '$.method') = 'pix'
                AND (p.method != 'pix' OR p.pix_account_id IS NOT json_extract(next.value, '$.pixAccountId'))
                AND NOT EXISTS (SELECT 1 FROM pix_accounts a WHERE a.id = json_extract(next.value, '$.pixAccountId') AND a.store_id = ? AND a.active = 1))
          THEN ? ELSE NULL END, ?, ?)`)
          .bind(
            operationId,
            storeId,
            session.id,
            saleId,
            storeId,
            saleId,
            storeId,
            before.length,
            JSON.stringify(before),
            saleId,
            storeId,
            JSON.stringify(after),
            storeId,
            saleId,
            details,
            now,
          ),
        ...changes.map((payment) =>
          db
            .prepare(`UPDATE payments SET method = ?, pix_account_id = ?, amount_cents = ?,
          account_name = CASE WHEN ? = 'cash' THEN NULL WHEN pix_account_id IS ? THEN account_name
            ELSE (SELECT name FROM pix_accounts WHERE id = ? AND store_id = ? AND active = 1) END
          WHERE id = ? AND sale_id = ? AND store_id = ?`)
            .bind(
              payment.method,
              payment.pixAccountId,
              payment.amountCents,
              payment.method,
              payment.pixAccountId,
              payment.pixAccountId,
              storeId,
              payment.id,
              saleId,
              storeId,
            ),
        ),
        db
          .prepare(`UPDATE sales SET received_total_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE sale_id = ? AND store_id = ?),
          received_difference_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE sale_id = ? AND store_id = ?) - products_total_cents
          WHERE id = ? AND store_id = ?`)
          .bind(saleId, storeId, saleId, storeId, saleId, storeId),
      ]);
    } catch (error) {
      if (await readReplay()) return response(true);
      if (error instanceof Error && /constraint failed/i.test(error.message)) {
        throw new HttpError(
          409,
          'Os pagamentos mudaram ou a conta Pix não está disponível. Reabra a venda e confira antes de salvar.',
          'PAYMENTS_CHANGED',
        );
      }
      throw error;
    }
    return response(false);
  } catch (error) {
    return apiError(error);
  }
}
