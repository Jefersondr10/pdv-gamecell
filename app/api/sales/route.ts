import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  assertFormDataKeys,
  boundedFormData,
  cleanupFiles,
  prepareFile,
  uploadFiles,
  validateFileSignatures,
  validateFiles,
} from '@/lib/server/files';
import {
  apiError,
  assertSameOrigin,
  HttpError,
  integerField,
  json,
  operationIdField,
  parseJsonObject,
  stringField,
} from '@/lib/server/http';
import {
  consumeFixedWindowLimits,
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { parseReceiptValues } from '@/lib/server/receipt-values';
import { parseSalesFilters, SALE_ALERT_SQL } from '@/lib/server/sales-filters';
import {
  isValidAppleSerial,
  normalizeAppleSerial,
  serialAliases,
  serialAliasKey,
  sha256,
} from '@/lib/server/security';
import { releaseUpload, reserveUpload } from '@/lib/server/storage-quota';
import { deriveReceiptReconciliation } from '@/lib/receipt-reconciliation';
import type {
  AttachmentRecord,
  OrderStatusColor,
  ReceiptAttachmentRecord,
  SaleItemRecord,
  SalePaymentRecord,
  SaleRecord,
  SalesAnalytics,
  SalesGroupRecord,
  SalesGrouping,
  SalesPage,
} from '@/lib/pdv-types';

type SaleInputItem = { serial: string; priceCents: number };
type SaleInputPayment = {
  method: 'pix' | 'cash';
  pixAccountId: string | null;
  amountCents: number;
};
type UnitRow = {
  id: string;
  serial: string;
  productId: string;
  productName: string;
  productDetail: string;
  referencePriceCents: number;
};
type SaleAttachmentRow = {
  pending: ReturnType<typeof prepareFile>;
  kind: 'item_photo' | 'receipt';
  saleItemId: string | null;
  receiptAmountCents: number | null;
  receiptAmountSource: 'ocr' | 'manual' | null;
};
type SaleListRow = Omit<
  SaleRecord,
  'items' | 'payments' | 'receipts' | 'reconciliation' | 'orderStatus'
> & {
  orderStatusId: string | null;
  orderStatusName: string | null;
  orderStatusColor: OrderStatusColor | null;
};
type SaleItemListRow = Omit<SaleItemRecord, 'photos'> & { saleId: string };
type SalePaymentListRow = SalePaymentRecord & { saleId: string };
type SaleAttachmentListRow = Omit<AttachmentRecord, 'url'> & {
  kind: 'item_photo' | 'receipt';
  receiptAmountCents: number | null;
  receiptAmountSource: 'ocr' | 'manual' | null;
  receiptAmountConfirmedAt: number | null;
  saleId: string;
  saleItemId: string | null;
};
type SalesAggregateRow = {
  total: number;
  amountCents: number;
  saleCount: number;
  itemCount: number;
  alertCount: number;
  previousAmountCents?: number | null;
  previousSaleCount?: number | null;
  previousItemCount?: number | null;
  previousAlertCount?: number | null;
};

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const storeId = session.storeId!;
    const url = new URL(request.url);
    const grouping = url.searchParams.get('group');
    const group =
      grouping === 'model' ||
      grouping === 'customer' ||
      grouping === 'seller' ||
      grouping === 'all'
        ? grouping
        : 'sale';
    const { bindings, comparison, where } = parseSalesFilters(url, storeId);
    const filterSql = where.join(' AND ');
    const db = runtime().DB;
    await consumeStoreReadBudget(
      db,
      Date.now(),
      storeId,
      group === 'sale' ? 10 : group === 'all' ? 16 : 12,
    );
    const aggregateStatement = salesAggregateStatement(
      db,
      filterSql,
      bindings,
      comparison
        ? {
            bindings: comparison.bindings,
            filterSql: comparison.where.join(' AND '),
          }
        : null,
    );

    if (group === 'all') {
      const results = await db.batch([
        aggregateStatement,
        salesGroupStatement(db, 'model', filterSql, bindings),
        salesGroupStatement(db, 'customer', filterSql, bindings),
        salesGroupStatement(db, 'seller', filterSql, bindings),
      ]);
      const aggregate = firstRow<SalesAggregateRow>(results[0]);
      return json({
        groups: {
          model: numericSalesGroups(results[1]),
          customer: numericSalesGroups(results[2]),
          seller: numericSalesGroups(results[3]),
        },
        total: Number(aggregate?.total ?? 0),
        aggregates: numericSalesAggregates(aggregate),
        comparison: salesComparison(comparison, aggregate),
      } satisfies SalesAnalytics);
    }

    if (group !== 'sale') {
      const groupStatement = salesGroupStatement(
        db,
        group,
        filterSql,
        bindings,
      );
      const results = await db.batch([aggregateStatement, groupStatement]);
      const aggregate = firstRow<SalesAggregateRow>(results[0]);
      return json({
        items: [],
        groups: numericSalesGroups(results[1]),
        nextCursor: null,
        total: Number(aggregate?.total ?? 0),
        aggregates: numericSalesAggregates(aggregate),
        comparison: salesComparison(comparison, aggregate),
      } satisfies SalesPage);
    }

    const pageSize = Math.min(
      99,
      Math.max(10, Math.trunc(Number(url.searchParams.get('limit')) || 50)),
    );
    const pageWhere = [...where];
    const pageBindings = [...bindings];
    const cursor = parseCursor(url.searchParams.get('cursor'));
    if (cursor) {
      pageWhere.push('(s.created_at < ? OR (s.created_at = ? AND s.id < ?))');
      pageBindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const listStatement = db
      .prepare(
        `SELECT s.id, s.number, s.customer_id AS customerId,
                s.customer_name AS customerName, s.seller_name AS sellerName,
                order_status.id AS orderStatusId,
                order_status.name AS orderStatusName,
                order_status.color AS orderStatusColor,
                s.products_total_cents AS productsTotalCents,
                s.received_total_cents AS receivedTotalCents,
                s.received_difference_cents AS receivedDifferenceCents,
                s.reference_total_cents AS referenceTotalCents,
                s.price_difference_cents AS priceDifferenceCents,
                s.status, s.created_at AS createdAt,
                s.cancelled_at AS cancelledAt,
                cancelled_by.display_name AS cancelledByName,
                s.cancellation_reason AS cancellationReason
         FROM sales s
         LEFT JOIN users cancelled_by ON cancelled_by.id = s.cancelled_by
         LEFT JOIN order_statuses order_status
           ON order_status.id = s.order_status_id
          AND order_status.store_id = s.store_id
         WHERE ${pageWhere.join(' AND ')}
         ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
      )
      .bind(...pageBindings, pageSize + 1);
    const baseResults = await db.batch([aggregateStatement, listStatement]);
    const aggregate = firstRow<SalesAggregateRow>(baseResults[0]);
    const listed = resultRows<SaleListRow>(baseResults[1]);
    const hasMore = listed.length > pageSize;
    const visible = listed.slice(0, pageSize);
    const ids = visible.map((sale) => sale.id);
    const sales = ids.length ? await hydrateSales(db, storeId, visible) : [];
    const last = visible.at(-1);
    return json({
      items: sales,
      groups: [],
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      total: Number(aggregate?.total ?? 0),
      aggregates: numericSalesAggregates(aggregate),
      comparison: salesComparison(comparison, aggregate),
    } satisfies SalesPage);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const uploaded: ReturnType<typeof prepareFile>[] = [];
  let committed = false;
  let reservationId: string | null = null;
  let saleId: string | null = null;
  let storeId: string | null = null;
  let operationFingerprint: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    storeId = session.storeId!;
    assertCsrf(request, session);
    const db = runtime().DB;
    const uploadAt = Date.now();
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    await consumeFixedWindowLimits(
      db,
      uploadAt,
      [
        {
          scope: 'multipart:global',
          windowMs: 60 * 1000,
          max: 80,
          global: true,
        },
        {
          scope: `multipart:user:${session.id}`,
          windowMs: 60 * 1000,
          max: 20,
        },
        {
          scope: `multipart:ip:${sourceIp}`,
          windowMs: 60 * 1000,
          max: 40,
        },
        {
          scope: `multipart:store:${session.storeId}:minute`,
          windowMs: 60 * 1000,
          max: 40,
        },
        {
          scope: `multipart:store:${session.storeId}:hour`,
          windowMs: 60 * 60 * 1000,
          max: 200,
        },
        {
          scope: `multipart:store:${session.storeId}:day`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 1_000,
        },
      ],
      {
        message: 'Muitos envios foram iniciados. Aguarde um minuto.',
        code: 'UPLOAD_RATE_LIMIT',
      },
      'specific-first',
      0,
      'business',
    );
    const form = await boundedFormData(request, {
      maxBytes: 50 * 1024 * 1024,
      tooLargeMessage: 'Os anexos desta venda ultrapassam 45 MB.',
    });
    assertFormDataKeys(
      form,
      (key) =>
        key === 'payload' ||
        key === 'receipts' ||
        /^itemPhotos:(?:[0-9]|[1-4][0-9])$/.test(key),
    );
    const payloadValue = form.get('payload');
    if (typeof payloadValue !== 'string') {
      throw new HttpError(400, 'Dados da venda ausentes.', 'INVALID_PAYLOAD');
    }
    if (payloadValue.length > 64 * 1024) {
      throw new HttpError(
        413,
        'Dados da venda muito grandes.',
        'PAYLOAD_TOO_LARGE',
      );
    }
    const payload = parseJsonObject(payloadValue, 'Dados da venda inválidos.');
    saleId = operationIdField(payload.operationId);
    const customerId = stringField(payload.customerId, 'Cliente', { max: 80 });
    const items = parseItems(payload.items);
    const payments = parsePayments(payload.payments);
    const productsTotalCents = items.reduce(
      (sum, item) => sum + item.priceCents,
      0,
    );
    const receivedTotalCents = payments.reduce(
      (sum, payment) => sum + payment.amountCents,
      0,
    );
    operationFingerprint = await saleFingerprint(customerId, items, payments);
    const replay = await findSaleCommit(db, session.storeId!, saleId);
    if (replay) {
      assertSameSaleOperation(
        replay,
        operationFingerprint,
        customerId,
        items,
        payments,
      );
      return json({
        ok: true,
        id: replay.id,
        number: replay.number,
        productsTotalCents: replay.productsTotalCents,
        receivedTotalCents: replay.receivedTotalCents,
        receivedDifferenceCents: replay.receivedDifferenceCents,
        receipts: replay.receipts,
        replayed: true,
      });
    }
    const customer = await db
      .prepare(
        'SELECT id, name FROM clients WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1',
      )
      .bind(customerId, session.storeId)
      .first<{ id: string; name: string }>();
    if (!customer)
      throw new HttpError(404, 'Cliente não encontrado.', 'CUSTOMER_NOT_FOUND');

    const serialValues = Array.from(
      new Set(items.flatMap((item) => serialAliases(item.serial))),
    );
    const units: UnitRow[] = [];
    for (const serialGroup of chunk(serialValues, 90)) {
      const unitsResult = await db
        .prepare(
          `SELECT iu.id, iu.serial, iu.product_id AS productId,
                  p.model AS productName,
                  (p.color || ' · ' || p.memory) AS productDetail,
                  p.default_price_cents AS referencePriceCents
           FROM inventory_units iu
           JOIN products p ON p.id = iu.product_id AND p.store_id = iu.store_id
           WHERE iu.store_id = ? AND iu.status = 'available'
             AND iu.serial IN (${serialGroup.map(() => '?').join(',')})`,
        )
        .bind(session.storeId, ...serialGroup)
        .all<UnitRow>();
      units.push(...unitsResult.results);
    }
    const unitsByStoredSerial = new Map(
      units.map((unit) => [unit.serial, unit]),
    );
    const unitBySerial = new Map(
      items.flatMap((item) => {
        const unit = serialAliases(item.serial)
          .map((alias) => unitsByStoredSerial.get(alias))
          .find(Boolean);
        return unit ? [[item.serial, unit] as const] : [];
      }),
    );
    if (
      unitBySerial.size !== items.length ||
      new Set([...unitBySerial.values()].map((unit) => unit.id)).size !==
        items.length
    ) {
      const unavailable = items.find(
        (item) => !unitBySerial.has(item.serial),
      )?.serial;
      throw new HttpError(
        409,
        unavailable
          ? `O SN ${unavailable} não está disponível.`
          : 'Um aparelho não está mais disponível.',
        'SERIAL_UNAVAILABLE',
        { serial: unavailable },
      );
    }

    const pixIds = Array.from(
      new Set(
        payments
          .filter((payment) => payment.method === 'pix')
          .map((payment) => payment.pixAccountId!),
      ),
    );
    const pixRows = pixIds.length
      ? (
          await db
            .prepare(
              `SELECT id, name FROM pix_accounts
               WHERE store_id = ? AND active = 1 AND id IN (${pixIds.map(() => '?').join(',')})`,
            )
            .bind(session.storeId, ...pixIds)
            .all<{ id: string; name: string }>()
        ).results
      : [];
    if (pixRows.length !== pixIds.length) {
      throw new HttpError(
        409,
        'Selecione uma conta Pix ativa.',
        'PIX_ACCOUNT_INVALID',
      );
    }
    const itemFiles = items.map((_, index) =>
      validateFiles(form.getAll(`itemPhotos:${index}`), {
        required: true,
        max: 6,
      }),
    );
    const receiptFiles = validateFiles(form.getAll('receipts'), {
      receipts: true,
      max: 8,
    });
    const receiptValues = parseReceiptValues(
      payload.receiptValues,
      receiptFiles.length,
    );
    const allFiles = [...itemFiles.flat(), ...receiptFiles];
    await validateFileSignatures(allFiles);
    const filesSizeBytes = allFiles.reduce(
      (total, file) => total + file.size,
      0,
    );
    if (allFiles.length > 60 || filesSizeBytes > 45 * 1024 * 1024) {
      throw new HttpError(
        400,
        'Envie no máximo 60 anexos e 45 MB por venda.',
        'SALE_FILES_LIMIT',
      );
    }
    await consumeStoreWriteBudget(
      db,
      Date.now(),
      session.storeId!,
      8 + items.length * 3 + payments.length + allFiles.length,
    );
    reservationId = await reserveUpload(session.storeId!, filesSizeBytes);
    const itemIds = items.map(() => crypto.randomUUID());
    const itemUploads = itemFiles.flatMap((files, itemIndex) =>
      files.map((file) => ({
        itemIndex,
        pending: prepareFile(
          session.storeId!,
          `sales/${saleId}/items/${itemIds[itemIndex]}`,
          file,
        ),
      })),
    );
    const receiptUploads = receiptFiles.map((file, index) => ({
      pending: prepareFile(session.storeId!, `sales/${saleId}/receipts`, file),
      receiptValue: receiptValues[index],
    }));
    uploaded.push(
      ...itemUploads.map((value) => value.pending),
      ...receiptUploads.map((value) => value.pending),
    );

    await uploadFiles(uploaded);

    const referenceTotalCents = items.reduce(
      (sum, item) => sum + unitBySerial.get(item.serial)!.referencePriceCents,
      0,
    );
    const priceDifferenceCents = items.reduce((sum, item) => {
      const reference = unitBySerial.get(item.serial)!.referencePriceCents;
      return reference > 0 ? sum + item.priceCents - reference : sum;
    }, 0);
    const now = Date.now();
    const itemRows = items.map((item, index) => ({
      itemId: itemIds[index],
      unit: unitBySerial.get(item.serial)!,
      priceCents: item.priceCents,
    }));
    const saleItemStatements = chunk(itemRows, 24).map((itemGroup) => {
      const values = itemGroup.map(() => '(?, ?, ?, ?)').join(', ');
      return db
        .prepare(
          `WITH incoming
             (item_id, inventory_unit_id, reference_price_cents, sold_price_cents) AS
             (VALUES ${values})
           INSERT INTO sale_items
             (id, store_id, sale_id, inventory_unit_id, product_id,
              product_name, product_detail, serial, reference_price_cents,
              sold_price_cents, created_at)
           SELECT incoming.item_id, iu.store_id, iu.sale_id, iu.id,
                  iu.product_id, p.model, (p.color || ' · ' || p.memory),
                  iu.serial, incoming.reference_price_cents,
                  incoming.sold_price_cents, ?
           FROM incoming
           JOIN inventory_units iu ON iu.id = incoming.inventory_unit_id
           JOIN products p ON p.id = iu.product_id
           WHERE iu.store_id = ? AND iu.status = 'sold' AND iu.sale_id = ?`,
        )
        .bind(
          ...itemGroup.flatMap((row) => [
            row.itemId,
            row.unit.id,
            row.unit.referencePriceCents,
            row.priceCents,
          ]),
          now,
          session.storeId,
          saleId,
        );
    });
    const paymentStatements = chunk(payments, 20).map((paymentGroup) => {
      const rows = paymentGroup.map((payment) => ({
        ...payment,
        id: crypto.randomUUID(),
      }));
      const values = rows.map(() => '(?, ?, ?, ?)').join(', ');
      return db
        .prepare(
          `WITH incoming (id, method, pix_account_id, amount_cents) AS
             (VALUES ${values})
           INSERT INTO payments
             (id, store_id, sale_id, method, pix_account_id,
              account_name, amount_cents, created_at)
           SELECT incoming.id, ?, ?, incoming.method,
                  incoming.pix_account_id,
                  pix_account.name,
                  incoming.amount_cents, ?
           FROM incoming
           LEFT JOIN pix_accounts pix_account
             ON pix_account.id = incoming.pix_account_id
            AND pix_account.store_id = ? AND pix_account.active = 1
           WHERE incoming.method = 'cash' OR pix_account.id IS NOT NULL`,
        )
        .bind(
          ...rows.flatMap((payment) => [
            payment.id,
            payment.method,
            payment.pixAccountId,
            payment.amountCents,
          ]),
          session.storeId,
          saleId,
          now,
          session.storeId,
        );
    });
    const attachmentRows: SaleAttachmentRow[] = [
      ...itemUploads.map(({ itemIndex, pending }) => ({
        pending,
        kind: 'item_photo' as const,
        saleItemId: itemIds[itemIndex],
        receiptAmountCents: null,
        receiptAmountSource: null,
      })),
      ...receiptUploads.map(({ pending, receiptValue }) => ({
        pending,
        kind: 'receipt' as const,
        saleItemId: null,
        receiptAmountCents: receiptValue.amountCents,
        receiptAmountSource: receiptValue.source,
      })),
    ];
    const attachmentStatements = buildAttachmentStatements(
      db,
      session.storeId!,
      session.id,
      saleId,
      now,
      attachmentRows,
    );
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO sales
           (id, store_id, number, customer_id, customer_name,
            seller_user_id, seller_name, products_total_cents,
            received_total_cents, received_difference_cents,
            reference_total_cents, price_difference_cents, status, created_at)
           SELECT ?, stores.id, stores.next_sale_number,
                  active_customer.id, active_customer.name,
                  ?, ?, ?, ?, ?, ?, ?,
                  'completed', ?
           FROM stores
           JOIN clients active_customer
             ON active_customer.id = ? AND active_customer.store_id = stores.id
            AND active_customer.active = 1
           WHERE stores.id = ?`,
        )
        .bind(
          saleId,
          session.id,
          session.displayName,
          productsTotalCents,
          receivedTotalCents,
          receivedTotalCents - productsTotalCents,
          referenceTotalCents,
          priceDifferenceCents,
          now,
          customer.id,
          session.storeId,
        ),
      db
        .prepare(
          `UPDATE stores
           SET next_sale_number = CASE WHEN EXISTS (
                 SELECT 1 FROM sales
                 WHERE id = ? AND store_id = stores.id
                   AND number = stores.next_sale_number
               )
             THEN next_sale_number + 1 ELSE NULL END,
             updated_at = ?
           WHERE id = ?`,
        )
        .bind(saleId, now, session.storeId),
      db
        .prepare(
          `UPDATE inventory_units
           SET status = 'sold', sale_id = ?, sold_at = ?
           WHERE store_id = ? AND status = 'available'
             AND id IN (${itemRows.map(() => '?').join(', ')})`,
        )
        .bind(
          saleId,
          now,
          session.storeId,
          ...itemRows.map((row) => row.unit.id),
        ),
      ...saleItemStatements,
      ...paymentStatements,
      db
        .prepare(
          `UPDATE sales
           SET customer_name = CASE WHEN (
             SELECT COUNT(*) FROM payments
             WHERE sale_id = ? AND store_id = ?
           ) = ? THEN customer_name ELSE NULL END
           WHERE id = ? AND store_id = ?`,
        )
        .bind(
          saleId,
          session.storeId,
          payments.length,
          saleId,
          session.storeId,
        ),
      ...attachmentStatements,
    ];
    statements.push(
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, ?, ?, 'sale.created', 'sale',
             CASE WHEN (
                 SELECT COUNT(*) FROM sale_items
                 WHERE sale_id = ? AND store_id = ?
               ) = ?
             THEN ? ELSE NULL END,
             ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          saleId,
          session.storeId,
          items.length,
          saleId,
          JSON.stringify({
            items: items.length,
            receivedDifferenceCents: receivedTotalCents - productsTotalCents,
            operationFingerprint,
          }),
          now,
        ),
      db
        .prepare(
          'DELETE FROM upload_reservations WHERE id = ? AND store_id = ?',
        )
        .bind(reservationId, session.storeId),
      db
        .prepare(
          'SELECT number FROM sales WHERE id = ? AND store_id = ? LIMIT 1',
        )
        .bind(saleId, session.storeId),
    );
    const batchResults = await db.batch(statements);
    reservationId = null;
    committed = true;
    const numberResult = batchResults.at(-1) as
      | D1Result<{ number: number }>
      | undefined;
    let number = Number(numberResult?.results?.[0]?.number);
    if (!Number.isSafeInteger(number) || number < 1) {
      const saved = await findSaleCommit(db, session.storeId!, saleId);
      if (!saved) {
        throw new HttpError(
          500,
          'A venda foi salva, mas o número não pôde ser exibido. Atualize a lista de vendas.',
          'SALE_NUMBER_UNAVAILABLE',
        );
      }
      number = saved.number;
    }
    return json(
      {
        ok: true,
        id: saleId,
        number,
        productsTotalCents,
        receivedTotalCents,
        receivedDifferenceCents: receivedTotalCents - productsTotalCents,
        receipts: receiptUploads.map(({ pending }) =>
          receiptUploadResponse(pending),
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    const recoverable =
      !(error instanceof HttpError) || error.code === 'SALE_NUMBER_UNAVAILABLE';
    if (recoverable && saleId && storeId && operationFingerprint) {
      let recoveryLookupFailed = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let saved: Awaited<ReturnType<typeof findSaleCommit>> = null;
        try {
          saved = await findSaleCommit(runtime().DB, storeId, saleId);
          recoveryLookupFailed = false;
        } catch {
          recoveryLookupFailed = true;
          continue;
        }
        if (!saved) break;
        try {
          assertSameSaleOperation(saved, operationFingerprint);
        } catch (mismatch) {
          await cleanupFiles(uploaded);
          return apiError(mismatch);
        }
        if (!attemptFilesWereCommitted(uploaded, saved.attachmentIds)) {
          await cleanupFiles(uploaded);
        }
        if (reservationId) {
          await releaseUpload(reservationId);
          reservationId = null;
        }
        committed = true;
        return json({
          ok: true,
          id: saved.id,
          number: saved.number,
          productsTotalCents: saved.productsTotalCents,
          receivedTotalCents: saved.receivedTotalCents,
          receivedDifferenceCents: saved.receivedDifferenceCents,
          receipts: saved.receipts,
          replayed: true,
        });
      }
      if (uploaded.length) {
        if (recoveryLookupFailed) {
          // Não apagar anexos se o estado da transação não pôde ser consultado.
          committed = true;
        } else if (!committed) {
          await cleanupFiles(uploaded);
        }
      }
    } else if (uploaded.length && !committed) {
      await cleanupFiles(uploaded);
    }
    if (
      error instanceof Error &&
      /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
        error.message,
      )
    ) {
      return apiError(
        new HttpError(
          409,
          'Um dos aparelhos acabou de ser vendido em outra operação. Atualize e tente novamente.',
          'SERIAL_UNAVAILABLE',
        ),
      );
    }
    if (
      error instanceof Error &&
      /NOT NULL constraint failed:\s*sales\.customer_name/i.test(error.message)
    ) {
      return apiError(
        new HttpError(
          409,
          'Uma conta Pix foi alterada durante o envio. Selecione uma conta ativa e tente novamente.',
          'PIX_ACCOUNT_INVALID',
        ),
      );
    }
    if (
      error instanceof Error &&
      /NOT NULL constraint failed:\s*stores\.next_sale_number/i.test(
        error.message,
      )
    ) {
      return apiError(
        new HttpError(
          409,
          'O cliente foi alterado durante o envio. Selecione um cliente ativo e tente novamente.',
          'CUSTOMER_NOT_FOUND',
        ),
      );
    }
    if (
      error instanceof Error &&
      /FOREIGN KEY constraint failed/i.test(error.message)
    ) {
      return apiError(
        new HttpError(
          409,
          'O cliente foi alterado durante o envio. Selecione um cliente ativo e tente novamente.',
          'CUSTOMER_NOT_FOUND',
        ),
      );
    }
    return apiError(error);
  } finally {
    if (reservationId) await releaseUpload(reservationId);
  }
}

async function findSaleCommit(db: D1Database, storeId: string, saleId: string) {
  const sale = await db
    .prepare(
      `SELECT id, number, customer_id AS customerId,
              products_total_cents AS productsTotalCents,
              received_total_cents AS receivedTotalCents,
              received_difference_cents AS receivedDifferenceCents,
              status,
              (SELECT details_json FROM audit_events audit
               WHERE audit.store_id = sales.store_id
                 AND audit.entity_id = sales.id
                 AND audit.action = 'sale.created'
               LIMIT 1) AS operationDetailsJson
       FROM sales WHERE id = ? AND store_id = ? LIMIT 1`,
    )
    .bind(saleId, storeId)
    .first<{
      id: string;
      number: number;
      customerId: string | null;
      productsTotalCents: number;
      receivedTotalCents: number;
      receivedDifferenceCents: number;
      status: 'completed' | 'cancelled';
      operationDetailsJson: string | null;
    }>();
  if (!sale) return null;
  const [items, payments, attachments] = await Promise.all([
    db
      .prepare(
        `SELECT serial, sold_price_cents AS priceCents
         FROM sale_items WHERE sale_id = ? AND store_id = ? ORDER BY serial, id`,
      )
      .bind(saleId, storeId)
      .all<SaleInputItem>(),
    db
      .prepare(
        `SELECT method, pix_account_id AS pixAccountId,
                amount_cents AS amountCents
         FROM payments WHERE sale_id = ? AND store_id = ?
         ORDER BY created_at, id`,
      )
      .bind(saleId, storeId)
      .all<SaleInputPayment>(),
    db
      .prepare(
        `SELECT id, kind, file_name AS name, mime_type AS mimeType,
                size_bytes AS sizeBytes
         FROM attachments
         WHERE sale_id = ? AND store_id = ? ORDER BY created_at, rowid`,
      )
      .bind(saleId, storeId)
      .all<{
        id: string;
        kind: 'item_photo' | 'receipt';
        name: string;
        mimeType: string;
        sizeBytes: number;
      }>(),
  ]);
  const details = saleOperationDetails(sale.operationDetailsJson);
  const productsTotalCents = Number(sale.productsTotalCents);
  const currentReceivedTotalCents = Number(sale.receivedTotalCents);
  const currentReceivedDifferenceCents = Number(sale.receivedDifferenceCents);
  const originalDifference = details.receivedDifferenceCents;
  return {
    ...sale,
    number: Number(sale.number),
    productsTotalCents,
    receivedTotalCents:
      originalDifference === null
        ? currentReceivedTotalCents
        : productsTotalCents + originalDifference,
    receivedDifferenceCents:
      originalDifference ?? currentReceivedDifferenceCents,
    items: items.results.map((item) => ({
      serial: item.serial,
      priceCents: Number(item.priceCents),
    })),
    payments: payments.results.map((payment) => ({
      method: payment.method,
      pixAccountId: payment.pixAccountId,
      amountCents: Number(payment.amountCents),
    })),
    attachmentIds: attachments.results.map((attachment) => attachment.id),
    receipts: attachments.results
      .filter((attachment) => attachment.kind === 'receipt')
      .map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: Number(attachment.sizeBytes),
        url: `/api/files/${attachment.id}`,
      })),
    operationFingerprint: details.operationFingerprint,
  };
}

function receiptUploadResponse(pending: ReturnType<typeof prepareFile>) {
  return {
    id: pending.id,
    name: pending.file.name.slice(0, 200) || 'comprovante',
    mimeType: pending.file.type,
    sizeBytes: pending.file.size,
    url: `/api/files/${pending.id}`,
  };
}

async function saleFingerprint(
  customerId: string,
  items: SaleInputItem[],
  payments: SaleInputPayment[],
) {
  return sha256(canonicalSaleOperation(customerId, items, payments));
}

function canonicalSaleOperation(
  customerId: string,
  items: SaleInputItem[],
  payments: SaleInputPayment[],
) {
  const canonicalItems = items
    .map((item) => [item.serial, item.priceCents] as const)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  const canonicalPayments = payments
    .map(
      (payment) =>
        [
          payment.method,
          payment.pixAccountId ?? '',
          payment.amountCents,
        ] as const,
    )
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  return JSON.stringify({
    customerId,
    items: canonicalItems,
    payments: canonicalPayments,
  });
}

function assertSameSaleOperation(
  saved: NonNullable<Awaited<ReturnType<typeof findSaleCommit>>>,
  operationFingerprint: string,
  customerId?: string,
  items?: SaleInputItem[],
  payments?: SaleInputPayment[],
) {
  const fallbackMatches =
    customerId !== undefined &&
    items !== undefined &&
    payments !== undefined &&
    canonicalSaleOperation(
      saved.customerId ?? '',
      saved.items,
      saved.payments,
    ) === canonicalSaleOperation(customerId, items, payments);
  if (
    saved.operationFingerprint
      ? saved.operationFingerprint !== operationFingerprint
      : !fallbackMatches
  ) {
    throw new HttpError(
      409,
      'Esta operação já foi usada em outra venda. Inicie uma nova venda.',
      'OPERATION_ALREADY_USED',
    );
  }
}

function saleOperationDetails(detailsJson: string | null) {
  if (!detailsJson) {
    return { operationFingerprint: null, receivedDifferenceCents: null };
  }
  try {
    const details = JSON.parse(detailsJson) as Record<string, unknown>;
    return {
      operationFingerprint:
        typeof details.operationFingerprint === 'string'
          ? details.operationFingerprint
          : null,
      receivedDifferenceCents:
        typeof details.receivedDifferenceCents === 'number' &&
        Number.isSafeInteger(details.receivedDifferenceCents)
          ? details.receivedDifferenceCents
          : null,
    };
  } catch {
    return { operationFingerprint: null, receivedDifferenceCents: null };
  }
}

function attemptFilesWereCommitted(
  files: ReturnType<typeof prepareFile>[],
  savedAttachmentIds: string[],
) {
  if (files.length === 0) return false;
  const savedIds = new Set(savedAttachmentIds);
  return files.every((file) => savedIds.has(file.id));
}

function parseItems(value: unknown): SaleInputItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new HttpError(400, 'Adicione de 1 a 50 aparelhos.', 'INVALID_ITEMS');
  }
  const items = value.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new HttpError(400, 'Item inválido.', 'INVALID_ITEM');
    }
    const record = raw as Record<string, unknown>;
    const serial = normalizeAppleSerial(
      stringField(record.serial, 'SN', { min: 8, max: 24 }),
    );
    if (!isValidAppleSerial(serial)) {
      throw new HttpError(400, 'SN inválido.', 'INVALID_SERIAL');
    }
    return {
      serial,
      priceCents: integerField(record.priceCents, 'Preço', {
        min: 1,
        max: 1_000_000_000,
      }),
    };
  });
  if (
    new Set(items.map((item) => serialAliasKey(item.serial))).size !==
    items.length
  ) {
    throw new HttpError(
      409,
      'O mesmo SN aparece mais de uma vez.',
      'DUPLICATE_SERIAL',
    );
  }
  return items;
}

function parsePayments(value: unknown): SaleInputPayment[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new HttpError(
      400,
      'Envie no máximo 20 pagamentos.',
      'INVALID_PAYMENTS',
    );
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new HttpError(400, 'Pagamento inválido.', 'INVALID_PAYMENT');
    }
    const record = raw as Record<string, unknown>;
    const method =
      record.method === 'pix'
        ? 'pix'
        : record.method === 'cash'
          ? 'cash'
          : null;
    if (!method)
      throw new HttpError(
        400,
        'Forma de pagamento inválida.',
        'INVALID_PAYMENT',
      );
    const pixAccountId =
      method === 'pix'
        ? stringField(record.pixAccountId, 'Conta Pix', { max: 80 })
        : null;
    return {
      method,
      pixAccountId,
      amountCents: integerField(record.amountCents, 'Valor do pagamento', {
        min: 1,
        max: 1_000_000_000,
      }),
    };
  });
}

function buildAttachmentStatements(
  db: D1Database,
  storeId: string,
  userId: string,
  saleId: string,
  now: number,
  rows: SaleAttachmentRow[],
) {
  return chunk(rows, 10).map((rowGroup) => {
    const values = rowGroup.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    return db
      .prepare(
        `WITH incoming
           (id, kind, sale_item_id, r2_key, file_name, mime_type, size_bytes,
            receipt_amount_cents, receipt_amount_source) AS
           (VALUES ${values})
         INSERT INTO attachments
           (id, store_id, kind, entry_id, sale_id, sale_item_id, r2_key,
             file_name, mime_type, size_bytes, receipt_amount_cents,
             receipt_amount_source, receipt_amount_confirmed_by,
             receipt_amount_confirmed_at, created_by, created_at)
         SELECT incoming.id, ?, incoming.kind, NULL, ?, incoming.sale_item_id,
                incoming.r2_key, incoming.file_name, incoming.mime_type,
                incoming.size_bytes, incoming.receipt_amount_cents,
                incoming.receipt_amount_source,
                CASE WHEN incoming.receipt_amount_cents IS NOT NULL THEN ? END,
                CASE WHEN incoming.receipt_amount_cents IS NOT NULL THEN ? END,
                ?, ?
         FROM incoming
         WHERE incoming.sale_item_id IS NULL OR EXISTS (
           SELECT 1 FROM sale_items
           WHERE id = incoming.sale_item_id AND sale_id = ? AND store_id = ?
         )`,
      )
      .bind(
        ...rowGroup.flatMap(
          ({
            pending,
            kind,
            saleItemId,
            receiptAmountCents,
            receiptAmountSource,
          }) => [
            pending.id,
            kind,
            saleItemId,
            pending.key,
            pending.file.name.slice(0, 200) || 'arquivo',
            pending.file.type,
            pending.file.size,
            receiptAmountCents,
            receiptAmountSource,
          ],
        ),
        storeId,
        saleId,
        userId,
        now,
        userId,
        now,
        saleId,
        storeId,
      );
  });
}

function chunk<T>(values: T[], size: number) {
  const groups: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    groups.push(values.slice(start, start + size));
  }
  return groups;
}

async function hydrateSales(
  db: D1Database,
  storeId: string,
  sales: SaleListRow[],
) {
  const placeholders = sales.map(() => '?').join(', ');
  const ids = sales.map((sale) => sale.id);
  const results = await db.batch([
    db
      .prepare(
        `SELECT id, sale_id AS saleId, product_id AS productId,
                product_name AS productName, product_detail AS productDetail,
                serial, reference_price_cents AS referencePriceCents,
                sold_price_cents AS soldPriceCents
         FROM sale_items
         WHERE store_id = ? AND sale_id IN (${placeholders})
         ORDER BY created_at, id`,
      )
      .bind(storeId, ...ids),
    db
      .prepare(
        `SELECT id, sale_id AS saleId, method, pix_account_id AS pixAccountId,
                account_name AS accountName, amount_cents AS amountCents
         FROM payments
         WHERE store_id = ? AND sale_id IN (${placeholders})
         ORDER BY created_at, id`,
      )
      .bind(storeId, ...ids),
    db
      .prepare(
        `SELECT id, kind, sale_id AS saleId, sale_item_id AS saleItemId,
                 file_name AS name, mime_type AS mimeType,
                 size_bytes AS sizeBytes,
                 receipt_amount_cents AS receiptAmountCents,
                 receipt_amount_source AS receiptAmountSource,
                 receipt_amount_confirmed_at AS receiptAmountConfirmedAt
         FROM attachments
         WHERE store_id = ? AND sale_id IN (${placeholders})
         ORDER BY created_at, id`,
      )
      .bind(storeId, ...ids),
  ]);
  const attachmentRows = resultRows<SaleAttachmentListRow>(results[2]);
  const photosByItem = new Map<string, AttachmentRecord[]>();
  const receiptsBySale = new Map<string, ReceiptAttachmentRecord[]>();
  for (const file of attachmentRows) {
    const attachment = attachmentRecord(file);
    if (file.kind === 'item_photo' && file.saleItemId) {
      const photos = photosByItem.get(file.saleItemId) ?? [];
      photos.push(attachment);
      photosByItem.set(file.saleItemId, photos);
    } else if (file.kind === 'receipt') {
      const receipts = receiptsBySale.get(file.saleId) ?? [];
      receipts.push(attachment);
      receiptsBySale.set(file.saleId, receipts);
    }
  }
  const itemsBySale = new Map<string, SaleItemRecord[]>();
  for (const item of resultRows<SaleItemListRow>(results[0])) {
    const items = itemsBySale.get(item.saleId) ?? [];
    items.push({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productDetail: item.productDetail,
      serial: item.serial,
      referencePriceCents: Number(item.referencePriceCents),
      soldPriceCents: Number(item.soldPriceCents),
      photos: photosByItem.get(item.id) ?? [],
    });
    itemsBySale.set(item.saleId, items);
  }
  const paymentsBySale = new Map<string, SalePaymentRecord[]>();
  for (const payment of resultRows<SalePaymentListRow>(results[1])) {
    const payments = paymentsBySale.get(payment.saleId) ?? [];
    payments.push({
      id: payment.id,
      method: payment.method,
      pixAccountId: payment.pixAccountId,
      accountName: payment.accountName,
      amountCents: Number(payment.amountCents),
    });
    paymentsBySale.set(payment.saleId, payments);
  }
  return sales.map((sale): SaleRecord => {
    const { orderStatusId, orderStatusName, orderStatusColor, ...baseSale } =
      sale;
    const receipts = receiptsBySale.get(sale.id) ?? [];
    const productsTotalCents = Number(sale.productsTotalCents);
    return {
      ...baseSale,
      orderStatus:
        orderStatusId && orderStatusName && orderStatusColor
          ? {
              id: orderStatusId,
              name: orderStatusName,
              color: orderStatusColor,
            }
          : null,
      number: Number(sale.number),
      productsTotalCents,
      receivedTotalCents: Number(sale.receivedTotalCents),
      receivedDifferenceCents: Number(sale.receivedDifferenceCents),
      referenceTotalCents: Number(sale.referenceTotalCents),
      priceDifferenceCents: Number(sale.priceDifferenceCents),
      createdAt: Number(sale.createdAt),
      cancelledAt: sale.cancelledAt === null ? null : Number(sale.cancelledAt),
      items: itemsBySale.get(sale.id) ?? [],
      payments: paymentsBySale.get(sale.id) ?? [],
      receipts,
      reconciliation: deriveReceiptReconciliation(receipts, productsTotalCents),
    };
  });
}

function attachmentRecord(
  file: Omit<ReceiptAttachmentRecord, 'url'>,
): ReceiptAttachmentRecord {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: Number(file.sizeBytes),
    receiptAmountCents:
      file.receiptAmountCents === null ? null : Number(file.receiptAmountCents),
    receiptAmountSource: file.receiptAmountSource,
    receiptAmountConfirmedAt:
      file.receiptAmountConfirmedAt === null
        ? null
        : Number(file.receiptAmountConfirmedAt),
    url: `/api/files/${file.id}`,
  };
}

function salesAggregateStatement(
  db: D1Database,
  filterSql: string,
  bindings: Array<string | number>,
  comparison: {
    bindings: Array<string | number>;
    filterSql: string;
  } | null,
) {
  const currentSql = salesAggregateSql(filterSql);
  if (!comparison) return db.prepare(currentSql).bind(...bindings);
  return db
    .prepare(
      `WITH current_period AS (${currentSql}),
            previous_period AS (${salesAggregateSql(comparison.filterSql)})
       SELECT current_period.*,
              previous_period.amountCents AS previousAmountCents,
              previous_period.saleCount AS previousSaleCount,
              previous_period.itemCount AS previousItemCount,
              previous_period.alertCount AS previousAlertCount
       FROM current_period CROSS JOIN previous_period`,
    )
    .bind(...bindings, ...comparison.bindings);
}

function salesAggregateSql(filterSql: string) {
  return `SELECT COUNT(*) AS total,
                 COALESCE(SUM(CASE WHEN s.status = 'completed'
                   THEN 1 ELSE 0 END), 0) AS saleCount,
                 COALESCE(SUM(CASE WHEN s.status = 'completed'
                   THEN s.products_total_cents ELSE 0 END), 0) AS amountCents,
                 COALESCE(SUM(CASE WHEN s.status = 'completed' THEN (
                   SELECT COUNT(*) FROM sale_items aggregate_item
                   WHERE aggregate_item.sale_id = s.id
                     AND aggregate_item.store_id = s.store_id
                 ) ELSE 0 END), 0) AS itemCount,
                 COALESCE(SUM(CASE WHEN s.status = 'completed'
                   AND ${SALE_ALERT_SQL} THEN 1 ELSE 0 END), 0) AS alertCount
          FROM sales s WHERE ${filterSql}`;
}

function salesGroupStatement(
  db: D1Database,
  group: SalesGrouping,
  filterSql: string,
  bindings: Array<string | number>,
) {
  if (group === 'model') {
    return db
      .prepare(
        `SELECT si.product_name AS key, si.product_name AS label,
                COUNT(DISTINCT s.id) AS saleCount,
                COUNT(si.id) AS itemCount,
                COALESCE(SUM(si.sold_price_cents), 0) AS totalCents
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
         WHERE ${filterSql} AND s.status = 'completed'
         GROUP BY si.product_name
         ORDER BY totalCents DESC, label COLLATE NOCASE
         LIMIT 1000`,
      )
      .bind(...bindings);
  }
  if (group === 'customer') {
    return db
      .prepare(
        `SELECT COALESCE(s.customer_id, 'legacy:' || s.customer_name) AS key,
                COALESCE(c.name, s.customer_name) AS label,
                COUNT(DISTINCT s.id) AS saleCount,
                COUNT(si.id) AS itemCount,
                COALESCE(SUM(si.sold_price_cents), 0) AS totalCents
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
         LEFT JOIN clients c ON c.id = s.customer_id AND c.store_id = s.store_id
         WHERE ${filterSql} AND s.status = 'completed'
         GROUP BY COALESCE(s.customer_id, 'legacy:' || s.customer_name),
                  COALESCE(c.name, s.customer_name)
         ORDER BY totalCents DESC, label COLLATE NOCASE
         LIMIT 5000`,
      )
      .bind(...bindings);
  }
  return db
    .prepare(
      `WITH seller_totals AS (
         SELECT COALESCE(s.seller_user_id, 'legacy:' || s.seller_name) AS key,
                COALESCE(NULLIF(u.display_name, ''), s.seller_name,
                         'Sem vendedor') AS label,
                COUNT(DISTINCT s.id) AS saleCount,
                COUNT(si.id) AS itemCount,
                COALESCE(SUM(si.sold_price_cents), 0) AS totalCents
         FROM sales s
         JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
         LEFT JOIN users u ON u.id = s.seller_user_id
         WHERE ${filterSql} AND s.status = 'completed'
         GROUP BY COALESCE(s.seller_user_id, 'legacy:' || s.seller_name),
                  COALESCE(NULLIF(u.display_name, ''), s.seller_name,
                           'Sem vendedor')
       )
       SELECT key, label, saleCount, itemCount, totalCents,
              DENSE_RANK() OVER (
                ORDER BY itemCount DESC
              ) AS rankByItems,
              DENSE_RANK() OVER (
                ORDER BY totalCents DESC
              ) AS rankByValue
       FROM seller_totals
       ORDER BY itemCount DESC, totalCents DESC, label COLLATE NOCASE
       LIMIT 100`,
    )
    .bind(...bindings);
}

function numericSalesGroups(result: D1Result<unknown>) {
  return resultRows<SalesGroupRecord>(result).map((row) => ({
    ...row,
    saleCount: Number(row.saleCount),
    itemCount: Number(row.itemCount),
    totalCents: Number(row.totalCents),
    rankByItems:
      row.rankByItems === undefined || row.rankByItems === null
        ? undefined
        : Number(row.rankByItems),
    rankByValue:
      row.rankByValue === undefined || row.rankByValue === null
        ? undefined
        : Number(row.rankByValue),
  }));
}

function numericSalesAggregates(
  value:
    | {
        amountCents: number;
        saleCount: number;
        itemCount: number;
        alertCount: number;
      }
    | null
    | undefined,
) {
  return {
    amountCents: Number(value?.amountCents ?? 0),
    saleCount: Number(value?.saleCount ?? 0),
    itemCount: Number(value?.itemCount ?? 0),
    alertCount: Number(value?.alertCount ?? 0),
  };
}

function salesComparison(
  comparison: { label: string } | null,
  value: SalesAggregateRow | null | undefined,
) {
  if (!comparison) return null;
  return {
    label: comparison.label,
    aggregates: numericSalesAggregates({
      amountCents: Number(value?.previousAmountCents ?? 0),
      saleCount: Number(value?.previousSaleCount ?? 0),
      itemCount: Number(value?.previousItemCount ?? 0),
      alertCount: Number(value?.previousAlertCount ?? 0),
    }),
  };
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

function resultRows<T>(result: D1Result<unknown>) {
  return (result.results ?? []) as T[];
}

function firstRow<T>(result: D1Result<unknown>) {
  return resultRows<T>(result)[0] ?? null;
}
