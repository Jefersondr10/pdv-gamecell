import { requireSession } from '@/lib/server/auth';
import { apiError, json } from '@/lib/server/http';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';
import { readOverview } from '@/lib/server/overview';
import { runtime } from '@/lib/server/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), session.storeId!, 10);
    return json(await readOverview(db, new URL(request.url), session.storeId!));
  } catch (error) {
    return apiError(error);
  }
}
