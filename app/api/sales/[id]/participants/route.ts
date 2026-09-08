import { assertCsrf, requireSession } from '@/lib/server/auth';
import { assertPermission } from '@/lib/server/permissions';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  json,
} from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import {
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import {
  changeSaleParticipants,
  saleParticipantChoices,
} from '@/lib/server/sale-participants';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    assertPermission(session, 'sales.participants');
    const { id } = await context.params;
    await consumeStoreReadBudget(runtime().DB, Date.now(), session.storeId!, 4);
    return json(
      await saleParticipantChoices(runtime().DB, session.storeId!, id),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertPermission(session, 'sales.participants');
    assertCsrf(request, session);
    const { id } = await context.params;
    const body = await boundedJson(request);
    return json(
      await changeSaleParticipants(
        runtime().DB,
        { storeId: session.storeId!, actorId: session.id, saleId: id },
        body,
        () =>
          consumeStoreWriteBudget(
            runtime().DB,
            Date.now(),
            session.storeId!,
            4,
          ),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
