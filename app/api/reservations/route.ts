import { requireSession, assertCsrf } from '@/lib/server/auth';
import {
  apiError,
  boundedJson,
  json,
  assertSameOrigin,
} from '@/lib/server/http';
import { assertPermission } from '@/lib/server/permissions';
import { runtime } from '@/lib/server/runtime';
import {
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import { createReservation, listReservations } from '@/lib/server/reservations';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    assertPermission(session, 'reservations');
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), session.storeId!, 5);
    return json(
      await listReservations(db, session.storeId!, new URL(request.url)),
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    assertPermission(session, 'reservations.manage');
    const db = runtime().DB;
    const body = await boundedJson(request);
    await consumeStoreWriteBudget(
      db,
      Date.now(),
      session.storeId!,
      Array.isArray(body.unitIds) ? Math.min(50, body.unitIds.length) + 2 : 2,
    );
    return json(
      await createReservation(db, session.storeId!, session.id, body),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
