import { requireSession } from '@/lib/server/auth';
import { apiError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const { DB } = runtime();
    await consumeStoreReadBudget(DB, Date.now(), session.storeId!, 1);
    const result =
      await DB.prepare(`SELECT j.status, COUNT(*) AS count, MAX(j.updated_at) AS updatedAt, SUM(j.generation) AS generations
      FROM receipt_ocr_jobs j JOIN attachments a ON a.id=j.attachment_id WHERE a.store_id=? GROUP BY j.status ORDER BY j.status`)
        .bind(session.storeId)
        .all<{
          status: string;
          count: number;
          updatedAt: number;
          generations: number;
        }>();
    const rows = result.results ?? [];
    const sync = await DB.prepare(
      `SELECT status, COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM sale_receipt_payment_sync WHERE store_id=? GROUP BY status ORDER BY status`,
    )
      .bind(session.storeId)
      .all<{ status: string; count: number; updatedAt: number }>();
    return json({
      pending:
        rows
          .filter((row) =>
            ['pending', 'processing', 'retry'].includes(row.status),
          )
          .reduce((total, row) => total + row.count, 0) +
        sync.results
          .filter((row) => row.status === 'pending')
          .reduce((sum, row) => sum + row.count, 0),
      version: JSON.stringify([rows, sync.results]),
    });
  } catch (error) {
    return apiError(error);
  }
}
