import { requireSession, assertCsrf } from '@/lib/server/auth';
import {
  apiError,
  boundedJson,
  json,
  assertSameOrigin,
} from '@/lib/server/http';
import { assertPermission } from '@/lib/server/permissions';
import { runtime } from '@/lib/server/runtime';
import { changeReservation } from '@/lib/server/reservations';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    assertPermission(session, 'reservations.manage');
    const db = runtime().DB;
    await consumeStoreWriteBudget(db, Date.now(), session.storeId!, 2);
    return json(
      await changeReservation(
        db,
        session.storeId!,
        session.id,
        (await params).id,
        await boundedJson(request),
      ),
    );
  } catch (error) {
    return apiError(error);
  }
}
