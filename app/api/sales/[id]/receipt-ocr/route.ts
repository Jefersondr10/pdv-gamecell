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
import { retryReceipt } from '@/lib/server/retry-receipt';
import {
  publicReceiptPaymentState,
  readReceiptPaymentSync,
} from '@/lib/server/receipt-payment-sync';
import {
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import { RECEIPT_SALE_READ_COST } from '@/lib/receipt-polling';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    const env = runtime();
    const includePayment = can(session, 'sales');
    await consumeStoreReadBudget(
      env.DB,
      Date.now(),
      session.storeId!,
      RECEIPT_SALE_READ_COST,
    );
    const [rows, payment] = await Promise.all([
      env.DB.prepare(`SELECT a.id, a.receipt_amount_cents AS amountCents, a.receipt_amount_source AS source, a.receipt_amount_confirmed_at AS confirmedAt, j.generation, j.status, j.error_code AS errorCode, j.updated_at AS updatedAt
      FROM attachments a LEFT JOIN receipt_ocr_jobs j ON j.attachment_id=a.id WHERE a.store_id=? AND a.sale_id=? AND a.kind='receipt' ORDER BY a.created_at, a.id`)
        .bind(session.storeId, id)
        .all(),
      includePayment
        ? readReceiptPaymentSync(env.DB, session.storeId!, id)
        : Promise.resolve(null),
    ]);
    if (includePayment && !payment)
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    return json({
      enabled: Boolean(env.RECEIPT_OCR_ENGINE_URL),
      receipts: rows.results,
      ...(payment ? { payment: publicReceiptPaymentState(payment) } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const { id } = await context.params;
    const body = await boundedJson(request);
    const attachmentId = operationIdField(body.attachmentId);
    const env = runtime();
    if (!env.RECEIPT_OCR_ENGINE_URL)
      throw new HttpError(
        503,
        'Leitura no servidor indisponível.',
        'OCR_UNAVAILABLE',
      );
    const now = Date.now();
    await consumeStoreWriteBudget(env.DB, now, session.storeId!, 3);
    if (
      Object.keys(body).some(
        (name) =>
          ![
            'attachmentId',
            'operationId',
            'expectedAmount',
            'expectedConfirmedAt',
            'expectedGeneration',
          ].includes(name),
      ) ||
      (body.expectedAmount !== null &&
        !Number.isSafeInteger(body.expectedAmount)) ||
      (body.expectedConfirmedAt !== null &&
        !Number.isSafeInteger(body.expectedConfirmedAt)) ||
      (body.expectedGeneration !== null &&
        !Number.isSafeInteger(body.expectedGeneration))
    )
      throw new HttpError(400, 'Dados inválidos.', 'INVALID_FIELDS');
    await retryReceipt(
      env.DB,
      {
        storeId: session.storeId!,
        saleId: id,
        actorId: session.id,
        subject: session,
      },
      {
        attachmentId,
        operationId: operationIdField(body.operationId),
        expectedAmount: body.expectedAmount as number | null,
        expectedConfirmedAt: body.expectedConfirmedAt as number | null,
        expectedGeneration: body.expectedGeneration as number | null,
      },
      now,
    );
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
