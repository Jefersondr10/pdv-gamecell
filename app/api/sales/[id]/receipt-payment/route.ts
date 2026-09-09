import { assertCsrf, requireSession } from '@/lib/server/auth';
import { can } from '@/lib/permissions';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  operationIdField,
} from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import {
  readReceiptPaymentSync,
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
} from '@/lib/server/receipt-payment-sync';
import {
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';

type Context = { params: Promise<{ id: string }> };
function publicState(
  state: NonNullable<Awaited<ReturnType<typeof readReceiptPaymentSync>>>,
) {
  return {
    status: state.request?.status ?? 'manual',
    requestId: state.request?.requestId ?? null,
    updatedAt: state.request?.updatedAt ?? null,
    saleStatus: state.sale.status,
    receivedTotalCents: state.sale.receivedTotalCents,
    productsTotalCents: state.sale.productsTotalCents,
    receiptTotalCents: state.total,
    complete: state.complete,
    payments: state.payments,
    expectedPayments: state.sale.paymentsJson,
    expectedReceipts: state.sale.receiptsJson,
  };
}
export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), session.storeId!, 2);
    const state = await readReceiptPaymentSync(db, session.storeId!, id);
    if (!state)
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    return json(publicState(state));
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    if (!can(session, 'sales.receipts') || !can(session, 'sales.payments'))
      throw new HttpError(
        403,
        'É necessário acesso a comprovantes e pagamentos.',
        'PERMISSION_DENIED',
      );
    const { id: saleId } = await context.params;
    const storeId = session.storeId!;
    const body = await boundedJson(request);
    if (
      Object.keys(body).some(
        (k) =>
          ![
            'operationId',
            'targetPaymentId',
            'expectedPayments',
            'expectedReceipts',
            'expectedRequestId',
          ].includes(k),
      ) ||
      body.operationId === undefined ||
      typeof body.expectedPayments !== 'string' ||
      typeof body.expectedReceipts !== 'string' ||
      (body.expectedRequestId !== null &&
        typeof body.expectedRequestId !== 'string')
    )
      throw new HttpError(
        400,
        'Atualize os comprovantes antes de confirmar.',
        'INVALID_FIELDS',
      );
    const operationId = operationIdField(body.operationId);
    const targetPaymentId =
      body.targetPaymentId == null
        ? null
        : operationIdField(body.targetPaymentId);
    const details = JSON.stringify({
      targetPaymentId,
      expectedPayments: body.expectedPayments,
      expectedReceipts: body.expectedReceipts,
      expectedRequestId: body.expectedRequestId,
    });
    const db = runtime().DB;
    const replay = await db
      .prepare(
        `SELECT actor_user_id AS actor, store_id AS storeId, entity_id AS saleId, action, details_json AS details FROM audit_events WHERE id=?`,
      )
      .bind(operationId)
      .first<{
        actor: string;
        storeId: string;
        saleId: string;
        action: string;
        details: string;
      }>();
    if (
      replay &&
      (replay.actor !== session.id ||
        replay.storeId !== storeId ||
        replay.saleId !== saleId ||
        replay.action !== 'sale.receipt_payment_requested' ||
        replay.details !== details)
    )
      throw new HttpError(
        409,
        'Esta operação já foi utilizada.',
        'OPERATION_ALREADY_USED',
      );
    const state = await readReceiptPaymentSync(db, storeId, saleId);
    if (!state)
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    if (replay) return json({ ...publicState(state), replayed: true });
    if (
      state.sale.status !== 'completed' ||
      state.sale.paymentsJson !== body.expectedPayments ||
      state.sale.receiptsJson !== body.expectedReceipts ||
      (state.request?.requestId ?? null) !== body.expectedRequestId
    )
      throw new HttpError(
        409,
        'A venda mudou. Confira os valores atualizados e tente novamente.',
        'SALE_CHANGED',
      );
    if (!state.complete)
      throw new HttpError(
        409,
        'Aguarde a leitura ou corrija os comprovantes sem valor.',
        'RECEIPTS_PENDING',
      );
    const target = targetPaymentId
      ? state.payments.find((p) => p.id === targetPaymentId)
      : state.payments.length === 1
        ? state.payments[0]
        : undefined;
    const nextAmount = target
      ? state.total -
        state.payments
          .filter((p) => p.id !== target.id)
          .reduce((sum, p) => sum + p.amountCents, 0)
      : 0;
    if (!target || nextAmount < 1 || nextAmount > 1_000_000_000)
      throw new HttpError(
        400,
        'Escolha um pagamento que possa receber a diferença. Se precisar distribuir entre vários, use Alterar pagamentos.',
        'INVALID_TARGET_PAYMENT',
      );
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, storeId, 6);
    try {
      await db.batch([
        db
          .prepare(`INSERT INTO audit_events (id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
          SELECT ?,?,?,'sale.receipt_payment_requested','sale', CASE WHEN EXISTS(SELECT 1 FROM sales WHERE id=? AND store_id=? AND status='completed')
          AND (SELECT json_group_array(json_object('id',id,'method',method,'pixAccountId',pix_account_id,'accountName',account_name,'amountCents',amount_cents)) FROM (SELECT * FROM payments WHERE sale_id=? AND store_id=? ORDER BY id))=?
          AND (SELECT json_group_array(json_object('id',id,'amountCents',receipt_amount_cents,'source',receipt_amount_source,'confirmedAt',receipt_amount_confirmed_at)) FROM (SELECT * FROM attachments WHERE sale_id=? AND store_id=? AND kind='receipt' ORDER BY id))=?
          AND (SELECT request_id FROM sale_receipt_payment_sync WHERE sale_id=? AND store_id=?) IS ?
          THEN ? ELSE NULL END,?,?`)
          .bind(
            operationId,
            storeId,
            session.id,
            saleId,
            storeId,
            saleId,
            storeId,
            body.expectedPayments,
            saleId,
            storeId,
            body.expectedReceipts,
            saleId,
            storeId,
            body.expectedRequestId,
            saleId,
            details,
            now,
          ),
        ...requestReceiptPaymentSync(
          db,
          { storeId, saleId, actorId: session.id, subject: session },
          operationId,
          now,
          target.id,
        ),
      ]);
    } catch (error) {
      if (error instanceof Error && /constraint failed/i.test(error.message))
        throw new HttpError(
          409,
          'A venda mudou. Confira os valores antes de confirmar novamente.',
          'SALE_CHANGED',
        );
      throw error;
    }
    await settleReceiptPaymentSync(db, storeId, saleId).catch(() => {});
    return json(
      publicState((await readReceiptPaymentSync(db, storeId, saleId))!),
    );
  } catch (error) {
    return apiError(error);
  }
}
