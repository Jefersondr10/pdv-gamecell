import { requireSession } from '@/lib/server/auth';
import { apiError, HttpError, json, stringField } from '@/lib/server/http';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { parseSalesFilters } from '@/lib/server/sales-filters';
import type {
  SalesGroupDetailPage,
  SalesGroupDetailRecord,
  SalesGrouping,
} from '@/lib/pdv-types';

type DetailCursor = {
  createdAt: number;
  itemId: string;
  saleId: string;
};

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const storeId = session.storeId!;
    const url = new URL(request.url);
    const dimension = parseDimension(url.searchParams.get('dimension'));
    const key = stringField(url.searchParams.get('key'), 'Grupo', { max: 240 });
    const pageSize = Math.min(
      99,
      Math.max(10, Math.trunc(Number(url.searchParams.get('limit')) || 50)),
    );
    const { bindings, where } = parseSalesFilters(url, storeId);
    where.push("s.status = 'completed'", dimensionPredicate(dimension));
    bindings.push(key);
    const cursor = parseCursor(url.searchParams.get('cursor'));
    if (cursor) {
      where.push(`(
        s.created_at < ? OR
        (s.created_at = ? AND s.id < ?) OR
        (s.created_at = ? AND s.id = ? AND si.id < ?)
      )`);
      bindings.push(
        cursor.createdAt,
        cursor.createdAt,
        cursor.saleId,
        cursor.createdAt,
        cursor.saleId,
        cursor.itemId,
      );
    }

    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), storeId, 8);
    const result = await db
      .prepare(
        `SELECT si.id, si.serial, si.product_id AS productId,
                si.product_name AS productName,
                si.product_detail AS productDetail,
                si.reference_price_cents AS referencePriceCents,
                si.sold_price_cents AS soldPriceCents,
                s.id AS saleId, s.number AS saleNumber,
                s.created_at AS saleCreatedAt,
                COALESCE(c.name, s.customer_name) AS customerName,
                COALESCE(NULLIF(u.display_name, ''), s.seller_name,
                         'Sem vendedor') AS sellerName
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
         LEFT JOIN clients c ON c.id = s.customer_id AND c.store_id = s.store_id
         LEFT JOIN users u ON u.id = s.seller_user_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.created_at DESC, s.id DESC, si.id DESC
         LIMIT ?`,
      )
      .bind(...bindings, pageSize + 1)
      .all();
    const rows = (result.results ?? []) as SalesGroupDetailRecord[];
    const hasMore = rows.length > pageSize;
    const visible = rows.slice(0, pageSize).map(numericDetail);
    const last = visible.at(-1);
    return json({
      items: visible,
      nextCursor:
        hasMore && last
          ? encodeCursor(last.saleCreatedAt, last.saleId, last.id)
          : null,
    } satisfies SalesGroupDetailPage);
  } catch (error) {
    return apiError(error);
  }
}

function parseDimension(value: string | null): SalesGrouping {
  if (value === 'model' || value === 'customer' || value === 'seller') {
    return value;
  }
  throw new HttpError(400, 'Agrupamento inválido.', 'INVALID_GROUP');
}

function dimensionPredicate(dimension: SalesGrouping) {
  if (dimension === 'model') return 'si.product_name = ?';
  if (dimension === 'customer') {
    return "COALESCE(s.customer_id, 'legacy:' || s.customer_name) = ?";
  }
  return "COALESCE(s.seller_user_id, 'legacy:' || s.seller_name) = ?";
}

function numericDetail(row: SalesGroupDetailRecord) {
  return {
    ...row,
    referencePriceCents: Number(row.referencePriceCents),
    soldPriceCents: Number(row.soldPriceCents),
    saleNumber: Number(row.saleNumber),
    saleCreatedAt: Number(row.saleCreatedAt),
  } satisfies SalesGroupDetailRecord;
}

function encodeCursor(createdAt: number, saleId: string, itemId: string) {
  return btoa(`${createdAt}|${saleId}|${itemId}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseCursor(value: string | null): DetailCursor | null {
  if (!value) return null;
  try {
    const decoded = atob(
      value.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (value.length % 4)) % 4),
    );
    const [createdAtValue, saleId, itemId, ...extra] = decoded.split('|');
    const createdAt = Number(createdAtValue);
    if (
      extra.length > 0 ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0 ||
      !/^[a-f0-9-]{20,80}$/i.test(saleId ?? '') ||
      !/^[a-f0-9-]{20,80}$/i.test(itemId ?? '')
    ) {
      throw new Error('invalid cursor');
    }
    return { createdAt, saleId, itemId };
  } catch {
    throw new HttpError(400, 'Paginação inválida.', 'INVALID_CURSOR');
  }
}
