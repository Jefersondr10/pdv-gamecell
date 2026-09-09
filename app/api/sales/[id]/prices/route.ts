import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  json,
} from '@/lib/server/http';
import { assertPermission } from '@/lib/server/permissions';
import {
  consumeStoreWriteBudget,
  consumeStoreReadBudget,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { changeSalePrices, readSalePrices } from '@/lib/server/sale-prices';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    assertPermission(session, 'sales.prices');
    const { id: saleId } = await context.params;
    await consumeStoreReadBudget(runtime().DB, Date.now(), session.storeId!, 4);
    return json(
      await readSalePrices(runtime().DB, {
        saleId,
        storeId: session.storeId!,
        actorId: session.id,
        subject: session,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    assertPermission(session, 'sales.prices');
    const { id: saleId } = await context.params;
    const body = await boundedJson(request, 32 * 1024);
    await consumeStoreWriteBudget(
      runtime().DB,
      Date.now(),
      session.storeId!,
      8,
    );
    return json(
      await changeSalePrices(
        runtime().DB,
        {
          saleId,
          storeId: session.storeId!,
          actorId: session.id,
          subject: session,
        },
        body,
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
