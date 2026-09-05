import { requireSession } from '@/lib/server/auth';
import { apiError, HttpError, json, utf8Prefix } from '@/lib/server/http';
import type {
  AttachmentRecord,
  InventoryDetailRecord,
  InventoryPage,
  StockSummaryRecord,
  StockSummaryResponse,
} from '@/lib/pdv-types';
import { runtime } from '@/lib/server/runtime';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';

type DetailRow = Omit<InventoryDetailRecord, 'photos'>;
type AttachmentRow = Omit<AttachmentRecord, 'url'> & { entryId: string };

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const storeId = session.storeId!;
    const db = runtime().DB;
    const url = new URL(request.url);
    const summaryView = url.searchParams.get('view') === 'summary';
    const includePhotos = url.searchParams.get('includePhotos') === '1';
    await consumeStoreReadBudget(
      db,
      Date.now(),
      storeId,
      summaryView ? 8 : includePhotos ? 10 : 5,
    );

    if (summaryView) {
      const result = await db
        .prepare(
          `SELECT product_id AS productId, COUNT(*) AS received,
                  SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
                  SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold
           FROM inventory_units
           WHERE store_id = ?
           GROUP BY product_id`,
        )
        .bind(storeId)
        .all<StockSummaryRecord>();
      const summaryRows = result.results.map((row) => ({
        productId: row.productId,
        received: Number(row.received),
        available: Number(row.available),
        sold: Number(row.sold),
      }));
      return json({
        rows: summaryRows,
        availableTotal: summaryRows.reduce(
          (total, row) => total + row.available,
          0,
        ),
      } satisfies StockSummaryResponse);
    }

    const pageSize = Math.min(
      99,
      Math.max(10, Math.trunc(Number(url.searchParams.get('limit')) || 50)),
    );
    const query = utf8Prefix((url.searchParams.get('q') ?? '').trim(), 48);
    const cursor = parseCursor(url.searchParams.get('cursor'));
    const where = ['iu.store_id = ?', "iu.status = 'available'"];
    const bindings: Array<string | number> = [storeId];
    if (query) {
      const pattern = `%${query}%`;
      where.push(`(
        iu.serial LIKE ? COLLATE NOCASE OR p.model LIKE ? COLLATE NOCASE
        OR p.color LIKE ? COLLATE NOCASE OR p.memory LIKE ? COLLATE NOCASE
      )`);
      bindings.push(pattern, pattern, pattern, pattern);
    }
    const aggregateBindings = [...bindings];
    if (cursor) {
      where.push('(iu.created_at < ? OR (iu.created_at = ? AND iu.id < ?))');
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const filterSql = where.join(' AND ');
    const results = await db.batch([
      cursor
        ? db.prepare('SELECT NULL AS total')
        : db
            .prepare(
              `SELECT COUNT(*) AS total
               FROM inventory_units iu
               JOIN products p ON p.id = iu.product_id AND p.store_id = iu.store_id
               WHERE ${where.slice(0, cursor ? -1 : undefined).join(' AND ')}`,
            )
            .bind(...aggregateBindings),
      db
        .prepare(
          `SELECT iu.id, iu.product_id AS productId, iu.entry_id AS entryId,
                  p.model AS productName,
                  (p.color || ' · ' || p.memory) AS productDetail,
                  iu.serial, iu.created_at AS createdAt
           FROM inventory_units iu
           JOIN products p ON p.id = iu.product_id AND p.store_id = iu.store_id
           WHERE ${filterSql}
           ORDER BY iu.created_at DESC, iu.id DESC LIMIT ?`,
        )
        .bind(...bindings, pageSize + 1),
    ]);
    const listed = rows<DetailRow>(results[1]);
    const hasMore = listed.length > pageSize;
    const visible = listed.slice(0, pageSize);
    const photosByEntry = includePhotos
      ? await loadEntryPhotos(db, storeId, visible)
      : new Map<string, AttachmentRecord[]>();
    const items = visible.map(
      (item): InventoryDetailRecord => ({
        ...item,
        createdAt: Number(item.createdAt),
        photos: photosByEntry.get(item.entryId) ?? [],
      }),
    );
    const last = visible.at(-1);
    return json({
      items,
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      total: cursor
        ? null
        : Number(rows<{ total: number }>(results[0])[0]?.total ?? 0),
    } satisfies InventoryPage);
  } catch (error) {
    return apiError(error);
  }
}

async function loadEntryPhotos(
  db: D1Database,
  storeId: string,
  items: DetailRow[],
) {
  const entryIds = Array.from(new Set(items.map((item) => item.entryId)));
  if (entryIds.length === 0) return new Map<string, AttachmentRecord[]>();
  const placeholders = entryIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT id, entry_id AS entryId, file_name AS name,
              mime_type AS mimeType, size_bytes AS sizeBytes
       FROM attachments
       WHERE store_id = ? AND kind = 'entry_photo'
         AND entry_id IN (${placeholders})
       ORDER BY created_at, id`,
    )
    .bind(storeId, ...entryIds)
    .all<AttachmentRow>();
  const grouped = new Map<string, AttachmentRecord[]>();
  for (const photo of result.results) {
    const photos = grouped.get(photo.entryId) ?? [];
    photos.push({
      id: photo.id,
      name: photo.name,
      mimeType: photo.mimeType,
      sizeBytes: Number(photo.sizeBytes),
      url: `/api/files/${photo.id}`,
    });
    grouped.set(photo.entryId, photos);
  }
  return grouped;
}

function encodeCursor(createdAt: number, id: string) {
  return btoa(`${createdAt}|${id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseCursor(value: string | null) {
  if (!value) return null;
  try {
    const decoded = atob(
      value.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (value.length % 4)) % 4),
    );
    const separator = decoded.indexOf('|');
    const createdAt = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (
      separator < 1 ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0 ||
      !/^[a-f0-9-]{20,80}$/i.test(id)
    ) {
      throw new Error('invalid cursor');
    }
    return { createdAt, id };
  } catch {
    throw new HttpError(400, 'Paginação inválida.', 'INVALID_CURSOR');
  }
}

function rows<T>(result: D1Result<unknown>) {
  return (result.results ?? []) as T[];
}
