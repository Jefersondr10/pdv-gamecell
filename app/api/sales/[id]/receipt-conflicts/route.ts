import { requireSession } from '@/lib/server/auth';
import { assertPermission } from '@/lib/server/permissions';
import { apiError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';
import { readReceiptConflicts } from '@/lib/server/sale-activity';

export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    assertPermission(session, 'sales');
    const { id } = await context.params;
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), session.storeId!, 6);
    return json(await readReceiptConflicts(db, session.storeId!, id));
  } catch (error) {
    return apiError(error);
  }
}
