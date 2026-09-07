import { HttpError, utf8Prefix } from './http.ts';
import { parseSalesFilters } from './sales-filters.ts';
import type {
  RankingDimension,
  RankingOrder,
  RankingPage,
  RankingRecord,
} from '../pdv-types.ts';

// Group by immutable IDs, never names or commercial codes. One sold SN is one
// unit: joining payments/attachments here would multiply quantities and money.
export async function readRanking(
  db: D1Database,
  url: URL,
  storeId: string,
): Promise<RankingPage> {
  const dimension = url.searchParams.get('dimension') ?? 'customer';
  if (!['customer', 'seller', 'product'].includes(dimension)) {
    throw new HttpError(400, 'Ranking inválido.', 'INVALID_RANKING');
  }
  const order = url.searchParams.get('order') ?? 'items';
  if (order !== 'items' && order !== 'value') {
    throw new HttpError(400, 'Ordenação inválida.', 'INVALID_RANKING_ORDER');
  }
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new HttpError(400, 'Paginação inválida.', 'INVALID_CURSOR');
  }
  const filters = new URL('https://ranking.internal');
  for (const key of ['period', 'day', 'month']) {
    const value = url.searchParams.get(key);
    if (value !== null) filters.searchParams.set(key, value);
  }
  if (!filters.searchParams.has('period'))
    filters.searchParams.set('period', 'today');
  const { where, bindings } = parseSalesFilters(filters, storeId);
  const cte = rankingCte(
    dimension as RankingDimension,
    order,
    where.join(' AND '),
  );
  const query = utf8Prefix((url.searchParams.get('q') ?? '').trim(), 120);
  // Search after ranking so finding one participant does not turn them into #1.
  const match = `(? = '' OR (label || ' ' || COALESCE(color, '') || ' ' || COALESCE(memory, '')) LIKE ? ESCAPE '\\')`;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const values = [...bindings, query, pattern];
  const sort =
    order === 'items'
      ? 'itemCount DESC, totalCents DESC'
      : 'totalCents DESC, itemCount DESC';
  // A single read snapshot; do not use batch (BEGIN IMMEDIATE on the VPS).
  // Empty pages still carry totals via LEFT JOIN, without rerunning the CTE.
  const listed = await db
    .prepare(`${cte}, filtered AS (SELECT * FROM ranked WHERE ${match}),
    summary AS (SELECT COUNT(*) AS participants, COALESCE(SUM(itemCount), 0) AS totalItems,
      COALESCE(SUM(totalCents), 0) AS totalAmount FROM filtered),
    page AS (SELECT * FROM filtered ORDER BY ${sort}, label COLLATE NOCASE, key LIMIT 51 OFFSET ?)
    SELECT page.*, summary.* FROM summary LEFT JOIN page ON 1 = 1
    ORDER BY ${sort}, label COLLATE NOCASE, key`)
    .bind(...values, offset)
    .all();
  const rows = (listed.results ?? []) as (RankingRecord & {
    participants: number;
    totalItems: number;
    totalAmount: number;
  })[];
  const raw = rows.filter((row) => row.key !== null);
  const total = rows[0];
  return {
    items: raw.slice(0, 50).map((row) => ({
      key: row.key,
      label: row.label,
      color: row.color,
      memory: row.memory,
      position: Number(row.position),
      saleCount: Number(row.saleCount),
      itemCount: Number(row.itemCount),
      totalCents: Number(row.totalCents),
    })),
    nextOffset: raw.length > 50 ? offset + 50 : null,
    totals: {
      participants: Number(total?.participants ?? 0),
      itemCount: Number(total?.totalItems ?? 0),
      amountCents: Number(total?.totalAmount ?? 0),
    },
  };
}

function rankingCte(
  dimension: RankingDimension,
  order: RankingOrder,
  filter: string,
) {
  const key =
    dimension === 'customer'
      ? "COALESCE(s.customer_id, 'legacy:' || s.customer_name)"
      : dimension === 'seller'
        ? "COALESCE(s.seller_user_id, 'legacy:' || s.seller_name)"
        : 'si.product_id';
  const label =
    dimension === 'customer'
      ? 'COALESCE(c.name, s.customer_name)'
      : dimension === 'seller'
        ? "COALESCE(NULLIF(u.display_name, ''), s.seller_name, 'Sem vendedor')"
        : 'COALESCE(p.model, si.product_name)';
  const join =
    dimension === 'customer'
      ? 'LEFT JOIN clients c ON c.id = s.customer_id AND c.store_id = s.store_id'
      : dimension === 'seller'
        ? 'LEFT JOIN users u ON u.id = s.seller_user_id AND u.store_id = s.store_id'
        : 'LEFT JOIN products p ON p.id = si.product_id AND p.store_id = s.store_id';
  return `WITH totals AS (
    SELECT ${key} AS key, MAX(${label}) AS label,
      ${dimension === 'product' ? 'MAX(p.color)' : 'NULL'} AS color,
      ${dimension === 'product' ? 'MAX(p.memory)' : 'NULL'} AS memory,
      COUNT(DISTINCT s.id) AS saleCount, COUNT(si.id) AS itemCount,
      COALESCE(SUM(si.sold_price_cents), 0) AS totalCents
    FROM sales s JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
    ${join} WHERE ${filter} AND s.status = 'completed' GROUP BY ${key}
  ), ranked AS (SELECT *, DENSE_RANK() OVER (ORDER BY ${order === 'items' ? 'itemCount' : 'totalCents'} DESC) AS position FROM totals)`;
}
