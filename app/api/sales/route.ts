import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  assertFormDataKeys,
  boundedFormData,
  cleanupFiles,
  prepareFile,
  uploadFiles,
  validateFiles,
} from '@/lib/server/files';
import {
  apiError,
  assertSameOrigin,
  HttpError,
  integerField,
  json,
  stringField,
  utf8Prefix,
} from '@/lib/server/http';
import {
  consumeFixedWindowLimits,
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { normalizeSerial } from '@/lib/server/security';
import { releaseUpload, reserveUpload } from '@/lib/server/storage-quota';
import type {
  AttachmentRecord,
  SaleItemRecord,
  SalePaymentRecord,
  SaleRecord,
  SalesGroupRecord,
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
};
type SaleListRow = Omit<SaleRecord, 'items' | 'payments' | 'receipts'>;
type SaleItemListRow = Omit<SaleItemRecord, 'photos'> & { saleId: string };
type SalePaymentListRow = SalePaymentRecord & { saleId: string };
type SaleAttachmentListRow = Omit<AttachmentRecord, 'url'> & {
  kind: 'item_photo' | 'receipt';
  saleId: string;
  saleItemId: string | null;
};

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const storeId = session.storeId!;
    const url = new URL(request.url);
    const grouping = url.searchParams.get('group');
    const group =
      grouping === 'model' || grouping === 'customer' ? grouping : 'sale';
    const pageSize = Math.min(
      99,
      Math.max(10, Math.trunc(Number(url.searchParams.get('limit')) || 50)),
    );
    let from = optionalMillis(url.searchParams.get('from'), 'Data inicial');
    let to = optionalMillis(url.searchParams.get('to'), 'Data final');
    if (from === null && to === null) {
      to = Date.now() + 24 * 60 * 60 * 1000;
      from = to - 367 * 24 * 60 * 60 * 1000;
    }
    if (to === null)
      to = Math.min(
        Date.now() + 24 * 60 * 60 * 1000,
        from! + 367 * 24 * 60 * 60 * 1000,
      );
    if (from === null) from = to - 367 * 24 * 60 * 60 * 1000;
    if (from !== null && to !== null && from >= to) {
      throw new HttpError(400, 'Período inválido.', 'INVALID_PERIOD');
    }
    if (to - from > 367 * 24 * 60 * 60 * 1000) {
      throw new HttpError(
        400,
        'Consulte no máximo 12 meses por vez.',
        'PERIOD_TOO_LARGE',
      );
    }
    const query = utf8Prefix((url.searchParams.get('q') ?? '').trim(), 48);
    const where = ['s.store_id = ?'];
    const bindings: Array<string | number> = [storeId];
    if (from !== null) {
      where.push('s.created_at >= ?');
      bindings.push(from);
    }
    if (to !== null) {
      where.push('s.created_at < ?');
      bindings.push(to);
    }
    if (query) {
      const pattern = `%${query}%`;
      where.push(`(
        CAST(s.number AS TEXT) LIKE ? OR s.customer_name LIKE ? COLLATE NOCASE
        OR s.seller_name LIKE ? COLLATE NOCASE OR EXISTS (
          SELECT 1 FROM sale_items search_item
          WHERE search_item.sale_id = s.id AND search_item.store_id = s.store_id
            AND (search_item.product_name LIKE ? COLLATE NOCASE
              OR search_item.product_detail LIKE ? COLLATE NOCASE
              OR search_item.serial LIKE ? COLLATE NOCASE)
        )
      )`);
      bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const filterSql = where.join(' AND ');
    const db = runtime().DB;
    await consumeStoreReadBudget(
      db,
      Date.now(),
      storeId,
      group === 'sale' ? 10 : 12,
    );
    const aggregateStatement = db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN s.status = 'completed'
                  THEN s.products_total_cents ELSE 0 END), 0) AS amountCents,
                COALESCE(SUM(CASE WHEN s.status = 'completed' THEN (
                  SELECT COUNT(*) FROM sale_items aggregate_item
                  WHERE aggregate_item.sale_id = s.id
                    AND aggregate_item.store_id = s.store_id
                ) ELSE 0 END), 0) AS itemCount,
                COALESCE(SUM(CASE WHEN s.status = 'completed' AND
                  (s.received_difference_cents <> 0 OR s.price_difference_cents <> 0)
                  THEN 1 ELSE 0 END), 0) AS alertCount
         FROM sales s WHERE ${filterSql}`,
      )
      .bind(...bindings);

    if (group !== 'sale') {
      const groupStatement =
        group === 'model'
          ? db
              .prepare(
                `SELECT si.product_name AS key, si.product_name AS label,
                        COUNT(DISTINCT s.id) AS saleCount,
                        COUNT(*) AS itemCount,
                        COALESCE(SUM(si.sold_price_cents), 0) AS totalCents
                 FROM sales s
                 JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id
                 WHERE ${filterSql} AND s.status = 'completed'
                 GROUP BY si.product_name
                 ORDER BY totalCents DESC, label COLLATE NOCASE`,
              )
              .bind(...bindings)
          : db
              .prepare(
                `SELECT COALESCE(s.customer_id, s.customer_name) AS key,
                        s.customer_name AS label, COUNT(*) AS saleCount,
                        COALESCE(SUM((
                          SELECT COUNT(*) FROM sale_items customer_item
                          WHERE customer_item.sale_id = s.id
                            AND customer_item.store_id = s.store_id
                        )), 0) AS itemCount,
                        COALESCE(SUM(s.products_total_cents), 0) AS totalCents
                 FROM sales s
                 WHERE ${filterSql} AND s.status = 'completed'
                 GROUP BY COALESCE(s.customer_id, s.customer_name), s.customer_name
                 ORDER BY totalCents DESC, label COLLATE NOCASE`,
              )
              .bind(...bindings);
      const results = await db.batch([aggregateStatement, groupStatement]);
      const aggregate = firstRow<{
        total: number;
        amountCents: number;
        itemCount: number;
        alertCount: number;
      }>(results[0]);
      return json({
        items: [],
        groups: resultRows<SalesGroupRecord>(results[1]),
        nextCursor: null,
        total: Number(aggregate?.total ?? 0),
        aggregates: numericSalesAggregates(aggregate),
      } satisfies SalesPage);
    }

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
         WHERE ${pageWhere.join(' AND ')}
         ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
      )
      .bind(...pageBindings, pageSize + 1);
    const baseResults = await db.batch([aggregateStatement, listStatement]);
    const aggregate = firstRow<{
      total: number;
      amountCents: number;
      itemCount: number;
      alertCount: number;
    }>(baseResults[0]);
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
          max: 8,
        },
        {
          scope: `multipart:ip:${sourceIp}`,
          windowMs: 60 * 1000,
          max: 16,
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
    const payload = JSON.parse(payloadValue) as Record<string, unknown>;
    const customerId = stringField(payload.customerId, 'Cliente', { max: 80 });
    const items = parseItems(payload.items);
    const payments = parsePayments(payload.payments);
    const customer = await db
      .prepare(
        'SELECT id, name FROM clients WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1',
      )
      .bind(customerId, session.storeId)
      .first<{ id: string; name: string }>();
    if (!customer)
      throw new HttpError(404, 'Cliente não encontrado.', 'CUSTOMER_NOT_FOUND');

    const placeholders = items.map(() => '?').join(',');
    const unitsResult = await db
      .prepare(
        `SELECT iu.id, iu.serial, iu.product_id AS productId,
                p.model AS productName,
                (p.color || ' · ' || p.memory) AS productDetail,
                p.default_price_cents AS referencePriceCents
         FROM inventory_units iu
         JOIN products p ON p.id = iu.product_id AND p.store_id = iu.store_id
         WHERE iu.store_id = ? AND iu.status = 'available'
           AND iu.serial IN (${placeholders})`,
      )
      .bind(session.storeId, ...items.map((item) => item.serial))
      .all<UnitRow>();
    const units = unitsResult.results;
    if (units.length !== items.length) {
      const found = new Set(units.map((unit) => unit.serial));
      const unavailable = items.find((item) => !found.has(item.serial))?.serial;
      throw new HttpError(
        409,
        unavailable
          ? `O SN ${unavailable} não está disponível.`
          : 'Um aparelho não está mais disponível.',
        'SERIAL_UNAVAILABLE',
        { serial: unavailable },
      );
    }
    const unitBySerial = new Map(units.map((unit) => [unit.serial, unit]));

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
    const allFiles = [...itemFiles.flat(), ...receiptFiles];
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
    saleId = crypto.randomUUID();
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
    const receiptUploads = receiptFiles.map((file) => ({
      pending: prepareFile(session.storeId!, `sales/${saleId}/receipts`, file),
    }));
    uploaded.push(
      ...itemUploads.map((value) => value.pending),
      ...receiptUploads.map((value) => value.pending),
    );

    await uploadFiles(uploaded);

    const productsTotalCents = items.reduce(
      (sum, item) => sum + item.priceCents,
      0,
    );
    const receivedTotalCents = payments.reduce(
      (sum, payment) => sum + payment.amountCents,
      0,
    );
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
                  CASE WHEN incoming.pix_account_id IS NULL THEN NULL ELSE (
                    SELECT name FROM pix_accounts
                    WHERE id = incoming.pix_account_id AND store_id = ?
                      AND active = 1
                  ) END,
                  incoming.amount_cents, ?
           FROM incoming`,
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
          session.storeId,
          now,
        );
    });
    const attachmentRows: SaleAttachmentRow[] = [
      ...itemUploads.map(({ itemIndex, pending }) => ({
        pending,
        kind: 'item_photo' as const,
        saleItemId: itemIds[itemIndex],
      })),
      ...receiptUploads.map(({ pending }) => ({
        pending,
        kind: 'receipt' as const,
        saleItemId: null,
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
           SELECT ?, stores.id, stores.next_sale_number, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'completed', ?
           FROM stores WHERE stores.id = ?`,
        )
        .bind(
          saleId,
          customer.id,
          customer.name,
          session.id,
          session.displayName,
          productsTotalCents,
          receivedTotalCents,
          receivedTotalCents - productsTotalCents,
          referenceTotalCents,
          priceDifferenceCents,
          now,
          session.storeId,
        ),
      db
        .prepare(
          `UPDATE stores
           SET next_sale_number = next_sale_number + 1, updated_at = ?
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM sales
             WHERE id = ? AND store_id = stores.id
               AND number = stores.next_sale_number
           )`,
        )
        .bind(now, session.storeId, saleId),
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
               ) = ? AND (
                 SELECT COUNT(*) FROM payments
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
          session.storeId,
          payments.length,
          saleId,
          JSON.stringify({
            items: items.length,
            receivedDifferenceCents: receivedTotalCents - productsTotalCents,
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
    committed = true;
    const numberResult = batchResults.at(-1) as
      | D1Result<{ number: number }>
      | undefined;
    const number = Number(numberResult?.results?.[0]?.number);
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new HttpError(
        500,
        'A venda foi salva, mas o número não pôde ser exibido. Atualize a lista de vendas.',
        'SALE_NUMBER_UNAVAILABLE',
      );
    }
    return json(
      {
        ok: true,
        id: saleId,
        number,
        productsTotalCents,
        receivedTotalCents,
        receivedDifferenceCents: receivedTotalCents - productsTotalCents,
      },
      { status: 201 },
    );
  } catch (error) {
    if (uploaded.length && !committed) {
      if (saleId && storeId) {
        try {
          const saved = await runtime()
            .DB.prepare(
              'SELECT 1 FROM sales WHERE id = ? AND store_id = ? LIMIT 1',
            )
            .bind(saleId, storeId)
            .first();
          if (saved) committed = true;
          else await cleanupFiles(uploaded);
        } catch {
          // Preserve R2 objects when commit status is uncertain. Any reservation
          // left behind expires automatically; deleting could break saved records.
          committed = true;
        }
      } else {
        await cleanupFiles(uploaded);
      }
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
    return apiError(error);
  } finally {
    if (reservationId && !committed) await releaseUpload(reservationId);
  }
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
    const serial = normalizeSerial(
      stringField(record.serial, 'SN', { min: 8, max: 24 }),
    );
    if (serial.length < 8 || serial.length > 18 || !/[A-Z]/.test(serial)) {
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
  if (new Set(items.map((item) => item.serial)).size !== items.length) {
    throw new HttpError(
      409,
      'O mesmo SN aparece mais de uma vez.',
      'DUPLICATE_SERIAL',
    );
  }
  return items;
}

function parsePayments(value: unknown): SaleInputPayment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new HttpError(
      400,
      'Adicione ao menos um pagamento.',
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
  return chunk(rows, 13).map((rowGroup) => {
    const values = rowGroup.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    return db
      .prepare(
        `WITH incoming
           (id, kind, sale_item_id, r2_key, file_name, mime_type, size_bytes) AS
           (VALUES ${values})
         INSERT INTO attachments
           (id, store_id, kind, entry_id, sale_id, sale_item_id, r2_key,
            file_name, mime_type, size_bytes, created_by, created_at)
         SELECT incoming.id, ?, incoming.kind, NULL, ?, incoming.sale_item_id,
                incoming.r2_key, incoming.file_name, incoming.mime_type,
                incoming.size_bytes, ?, ?
         FROM incoming
         WHERE incoming.sale_item_id IS NULL OR EXISTS (
           SELECT 1 FROM sale_items
           WHERE id = incoming.sale_item_id AND sale_id = ? AND store_id = ?
         )`,
      )
      .bind(
        ...rowGroup.flatMap(({ pending, kind, saleItemId }) => [
          pending.id,
          kind,
          saleItemId,
          pending.key,
          pending.file.name.slice(0, 200) || 'arquivo',
          pending.file.type,
          pending.file.size,
        ]),
        storeId,
        saleId,
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
        `SELECT id, sale_id AS saleId, method,
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
                size_bytes AS sizeBytes
         FROM attachments
         WHERE store_id = ? AND sale_id IN (${placeholders})
         ORDER BY created_at, id`,
      )
      .bind(storeId, ...ids),
  ]);
  const attachmentRows = resultRows<SaleAttachmentListRow>(results[2]);
  const photosByItem = new Map<string, AttachmentRecord[]>();
  const receiptsBySale = new Map<string, AttachmentRecord[]>();
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
      accountName: payment.accountName,
      amountCents: Number(payment.amountCents),
    });
    paymentsBySale.set(payment.saleId, payments);
  }
  return sales.map(
    (sale): SaleRecord => ({
      ...sale,
      number: Number(sale.number),
      productsTotalCents: Number(sale.productsTotalCents),
      receivedTotalCents: Number(sale.receivedTotalCents),
      receivedDifferenceCents: Number(sale.receivedDifferenceCents),
      referenceTotalCents: Number(sale.referenceTotalCents),
      priceDifferenceCents: Number(sale.priceDifferenceCents),
      createdAt: Number(sale.createdAt),
      cancelledAt: sale.cancelledAt === null ? null : Number(sale.cancelledAt),
      items: itemsBySale.get(sale.id) ?? [],
      payments: paymentsBySale.get(sale.id) ?? [],
      receipts: receiptsBySale.get(sale.id) ?? [],
    }),
  );
}

function attachmentRecord(file: Omit<AttachmentRecord, 'url'>) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: Number(file.sizeBytes),
    url: `/api/files/${file.id}`,
  } satisfies AttachmentRecord;
}

function numericSalesAggregates(
  value:
    | {
        amountCents: number;
        itemCount: number;
        alertCount: number;
      }
    | null
    | undefined,
) {
  return {
    amountCents: Number(value?.amountCents ?? 0),
    itemCount: Number(value?.itemCount ?? 0),
    alertCount: Number(value?.alertCount ?? 0),
  };
}

function optionalMillis(value: string | null, label: string) {
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new HttpError(400, `${label} inválida.`, 'INVALID_DATE');
  }
  return number;
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
