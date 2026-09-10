import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
} from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import {
  legacyReceiptReviewStatus,
  queueLegacyReceiptReviews,
} from '@/lib/server/legacy-receipt-review';
import {
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const env = runtime();
    await consumeStoreReadBudget(env.DB, Date.now(), session.storeId!, 2);
    return json({
      enabled: Boolean(env.RECEIPT_OCR_ENGINE_URL),
      ...(await legacyReceiptReviewStatus(env.DB, {
        storeId: session.storeId!,
        actorId: session.id,
        subject: session,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const body = await boundedJson(request, 1024);
    if (body.confirm !== true || Object.keys(body).length !== 1)
      throw new HttpError(
        400,
        'Confirme a releitura dos comprovantes antigos.',
        'CONFIRM_REQUIRED',
      );
    const env = runtime();
    if (!env.RECEIPT_OCR_ENGINE_URL)
      throw new HttpError(
        503,
        'Leitura no servidor indisponível.',
        'OCR_UNAVAILABLE',
      );
    const now = Date.now();
    await consumeStoreWriteBudget(env.DB, now, session.storeId!, 5);
    const scope = {
      storeId: session.storeId!,
      actorId: session.id,
      subject: session,
    };
    return json({
      ...(await queueLegacyReceiptReviews(env.DB, scope, now)),
      status: {
        enabled: true,
        ...(await legacyReceiptReviewStatus(env.DB, scope)),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
