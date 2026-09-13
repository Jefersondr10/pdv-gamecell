import { requireSession } from '@/lib/server/auth';
import { apiError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';
import { RECEIPT_ACTIVITY_SQL } from '@/lib/server/sale-status-sql';
import { RECEIPT_ACTIVITY_READ_COST } from '@/lib/receipt-polling';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const { DB } = runtime();
    await consumeStoreReadBudget(
      DB,
      Date.now(),
      session.storeId!,
      RECEIPT_ACTIVITY_READ_COST,
    );
    const activity = await DB.prepare(RECEIPT_ACTIVITY_SQL)
      .bind(session.storeId)
      .first<{ pending: number; jobs: string; sync: string; audit: string }>();
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(activity)),
    );
    return json({
      pending: activity?.pending ?? 0,
      // The public polling signal contains no internal IDs or review details.
      version: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    });
  } catch (error) {
    return apiError(error);
  }
}
