import { assertCsrf, requireSession } from '@/lib/server/auth';
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
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    const env = runtime();
    await consumeStoreReadBudget(env.DB, Date.now(), session.storeId!, 2);
    const rows =
      await env.DB.prepare(`SELECT a.id, a.receipt_amount_cents AS amountCents, a.receipt_amount_source AS source, j.status, j.error_code AS errorCode, j.updated_at AS updatedAt
      FROM attachments a LEFT JOIN receipt_ocr_jobs j ON j.attachment_id=a.id WHERE a.store_id=? AND a.sale_id=? AND a.kind='receipt' ORDER BY a.created_at, a.id`)
        .bind(session.storeId, id)
        .all();
    return json({
      enabled: Boolean(env.RECEIPT_OCR_ENGINE_URL),
      receipts: rows.results,
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
    if (Object.keys(body).some((name) => name !== 'attachmentId'))
      throw new HttpError(400, 'Dados inválidos.', 'INVALID_FIELDS');
    const result =
      await env.DB.prepare(`UPDATE receipt_ocr_jobs SET status='pending', generation=generation+1, attempts=0, next_attempt_at=?, lease_token=NULL, lease_until=NULL, error_code=NULL, confidence=NULL, updated_at=?
      WHERE attachment_id=? AND status='needs_review' AND EXISTS(SELECT 1 FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id WHERE a.id=attachment_id AND a.store_id=? AND a.sale_id=? AND a.receipt_amount_cents IS NULL AND s.status='completed')`)
        .bind(now, now, attachmentId, session.storeId, id)
        .run();
    if (result.meta.changes !== 1)
      throw new HttpError(
        409,
        'Este comprovante já está em leitura, possui valor ou não está disponível para nova leitura.',
        'OCR_NOT_RETRYABLE',
      );
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
