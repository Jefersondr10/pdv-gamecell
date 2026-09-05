import { assertCsrf, requireSession } from '@/lib/server/auth';
import { apiError, assertSameOrigin, json } from '@/lib/server/http';
import { GUIDE_VERSION } from '@/lib/pdv-types';
import { consumeControlWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const db = runtime().DB;
    const now = Date.now();
    await consumeControlWriteBudget(db, now, session.storeId!, session.id, 2);
    await db
      .prepare(
        `INSERT INTO guide_reads (user_id, version, read_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, version) DO UPDATE SET read_at = excluded.read_at`,
      )
      .bind(session.id, GUIDE_VERSION, now)
      .run();
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
