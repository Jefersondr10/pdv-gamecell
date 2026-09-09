import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  operationIdField,
} from '@/lib/server/http';
import { assertPermission } from '@/lib/server/permissions';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { deleteSaleReceipt } from '@/lib/server/delete-receipt';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; receiptId: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    assertPermission(session, 'sales.receipts.delete');
    const body = await boundedJson(request, 1024);
    if (Object.keys(body).some((key) => key !== 'operationId'))
      throw new HttpError(
        400,
        'A exclusão contém um campo não reconhecido.',
        'UNKNOWN_FIELD',
      );
    if (body.operationId === undefined)
      throw new HttpError(
        400,
        'Identificador da operação obrigatório.',
        'INVALID_OPERATION_ID',
      );
    const operationId = operationIdField(body.operationId);
    const { id: saleId, receiptId } = await context.params;
    const env = runtime();
    await consumeStoreWriteBudget(env.DB, Date.now(), session.storeId!, 4);
    return json(
      await deleteSaleReceipt(env.DB, env.FILES, {
        operationId,
        saleId,
        receiptId,
        storeId: session.storeId!,
        actorId: session.id,
        subject: session,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
