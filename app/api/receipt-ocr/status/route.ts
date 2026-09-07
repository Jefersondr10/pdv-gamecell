import { requireSession } from '@/lib/server/auth';
import { apiError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const { DB, RECEIPT_OCR_ENGINE_URL } = runtime();
    if (!RECEIPT_OCR_ENGINE_URL)
      return json({ pending: 0, version: 'disabled' });
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
    return json({
      pending: rows
        .filter((row) =>
          ['pending', 'processing', 'retry'].includes(row.status),
        )
        .reduce((total, row) => total + row.count, 0),
      version: JSON.stringify(rows),
    });
  } catch (error) {
    return apiError(error);
  }
}
