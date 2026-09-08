import { HttpError } from './http.ts';
import { parseSalesFilters } from './sales-filters.ts';
import type {
  OverviewPage,
  OverviewSale,
  OverviewTotals,
} from '../overview.ts';

const pageSize = 20;

export async function readOverview(
  db: D1Database,
  url: URL,
  storeId: string,
): Promise<OverviewPage> {
  const rawCursor = url.searchParams.get('cursor');
  let cursor: [number, string] | null = null;
  if (rawCursor) {
    try {
      if (rawCursor.length > 200) throw new Error('Invalid cursor');
      const value = JSON.parse(rawCursor);
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !Number.isSafeInteger(value[0]) ||
        value[0] < 0 ||
        typeof value[1] !== 'string' ||
        !value[1] ||
        value[1].length > 128
      )
        throw new Error('Invalid cursor');
      cursor = value as [number, string];
    } catch {
      throw new HttpError(400, 'Paginação inválida.', 'INVALID_CURSOR');
    }
  }
  const filters = new URL('https://overview.internal');
  for (const key of ['period', 'day', 'month']) {
    const value = url.searchParams.get(key);
    if (value !== null) filters.searchParams.set(key, value);
  }
  if (!filters.searchParams.has('period'))
    filters.searchParams.set('period', 'today');
  const { where, bindings } = parseSalesFilters(filters, storeId);

  // One SELECT snapshot, no write-locking batch. Aggregate each relation before
  // joining: multiple payments, items and receipts must never multiply money.
  const result = await db
    .prepare(`WITH filtered AS (
    SELECT s.* FROM sales s WHERE ${where.join(' AND ')} AND s.status = 'completed'
  ), receipts AS (
    SELECT a.sale_id, COUNT(*) AS receiptCount,
      COALESCE(SUM(a.receipt_amount_cents), 0) AS receiptCents,
      SUM(CASE WHEN a.receipt_amount_cents IS NULL THEN 1 ELSE 0 END) AS pendingCount
    FROM attachments a JOIN filtered s ON s.id = a.sale_id AND s.store_id = a.store_id
    WHERE a.kind = 'receipt' GROUP BY a.sale_id
  ), cash AS (
    SELECT p.sale_id, SUM(p.amount_cents) AS cashCents FROM payments p
    JOIN filtered s ON s.id = p.sale_id AND s.store_id = p.store_id
    WHERE p.method = 'cash' GROUP BY p.sale_id
  ), compared AS (
    SELECT s.id, s.number, s.customer_name AS customerName, s.created_at AS createdAt,
      s.received_total_cents AS receivedCents, s.store_id AS storeId,
      COALESCE(c.cashCents, 0) AS cashCents, COALESCE(r.receiptCount, 0) AS receiptCount,
      COALESCE(r.receiptCents, 0) AS receiptCents, COALESCE(r.pendingCount, 0) AS pendingCount
    FROM filtered s LEFT JOIN receipts r ON r.sale_id = s.id LEFT JOIN cash c ON c.sale_id = s.id
  ), summary AS (
    SELECT COUNT(*) AS totalSales, COALESCE(SUM(receivedCents), 0) AS totalReceived,
      COALESCE(SUM(cashCents), 0) AS totalCash, COALESCE(SUM(receiptCents), 0) AS totalReceipts,
      COALESCE(SUM(receiptCount), 0) AS totalFiles, COALESCE(SUM(pendingCount), 0) AS totalPending,
      COALESCE(SUM(CASE WHEN receiptCount = 0 THEN 1 ELSE 0 END), 0) AS totalMissing,
      COALESCE(SUM(CASE WHEN receiptCount > 0 AND pendingCount = 0 AND receiptCents != receivedCents THEN 1 ELSE 0 END), 0) AS totalDivergent
    FROM compared
  ), page AS (SELECT * FROM compared ${cursor ? 'WHERE createdAt < ? OR (createdAt = ? AND id < ?)' : ''} ORDER BY createdAt DESC, id DESC LIMIT ?)
  SELECT summary.*, page.*, a.id AS attachmentId, a.file_name AS fileName,
    a.mime_type AS mimeType, a.size_bytes AS sizeBytes, a.receipt_amount_cents AS amountCents,
    a.receipt_amount_source AS amountSource, a.receipt_amount_confirmed_at AS confirmedAt,
    j.status AS processingStatus
  FROM summary LEFT JOIN page ON 1 = 1
  LEFT JOIN attachments a ON a.sale_id = page.id AND a.store_id = page.storeId AND a.kind = 'receipt'
  LEFT JOIN receipt_ocr_jobs j ON j.attachment_id = a.id
  ORDER BY page.createdAt DESC, page.id DESC, a.created_at, a.id`)
    .bind(
      ...bindings,
      ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []),
      pageSize + 1,
    )
    .all();
  type Row = OverviewSale & {
    totalSales: number;
    totalReceived: number;
    totalCash: number;
    totalReceipts: number;
    totalFiles: number;
    totalPending: number;
    totalMissing: number;
    totalDivergent: number;
    attachmentId: string | null;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    amountCents: number | null;
    amountSource: 'ocr' | 'manual' | null;
    confirmedAt: number | null;
    processingStatus: string | null;
  };
  const rows = (result.results ?? []) as Row[];
  const first = rows[0];
  const totals: OverviewTotals = {
    saleCount: Number(first?.totalSales ?? 0),
    receivedCents: Number(first?.totalReceived ?? 0),
    cashCents: Number(first?.totalCash ?? 0),
    receiptCents: Number(first?.totalReceipts ?? 0),
    receiptCount: Number(first?.totalFiles ?? 0),
    pendingCount: Number(first?.totalPending ?? 0),
    missingCount: Number(first?.totalMissing ?? 0),
    divergentCount: Number(first?.totalDivergent ?? 0),
  };
  const sales = new Map<string, OverviewSale>();
  for (const row of rows) {
    if (!row.id) continue;
    if (!sales.has(row.id))
      sales.set(row.id, {
        id: row.id,
        number: row.number,
        customerName: row.customerName,
        createdAt: row.createdAt,
        receivedCents: row.receivedCents,
        cashCents: row.cashCents,
        receiptCents: row.receiptCents,
        receiptCount: row.receiptCount,
        pendingCount: row.pendingCount,
        receipts: [],
      });
    if (row.attachmentId)
      sales.get(row.id)!.receipts.push({
        id: row.attachmentId,
        name: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        url: `/api/files/${encodeURIComponent(row.attachmentId)}`,
        receiptAmountCents: row.amountCents,
        receiptAmountSource: row.amountSource,
        receiptAmountConfirmedAt: row.confirmedAt,
        processingStatus: row.processingStatus,
      });
  }
  const items = [...sales.values()].slice(0, pageSize);
  const last = items.at(-1);
  return {
    totals,
    items,
    nextCursor:
      sales.size > pageSize && last
        ? JSON.stringify([last.createdAt, last.id])
        : null,
  };
}
