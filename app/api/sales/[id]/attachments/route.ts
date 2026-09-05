import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  assertFormDataKeys,
  boundedFormData,
  cleanupFiles,
  prepareFile,
  uploadFiles,
  validateFiles,
} from '@/lib/server/files';
import { apiError, assertSameOrigin, HttpError, json } from '@/lib/server/http';
import {
  consumeFixedWindowLimits,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import { parseReceiptValues } from '@/lib/server/receipt-values';
import { runtime } from '@/lib/server/runtime';
import { releaseUpload, reserveUpload } from '@/lib/server/storage-quota';

import type { ReceiptValueInput } from '@/lib/receipt-reconciliation';

export const dynamic = 'force-dynamic';

const MAX_RECEIPTS = 8;
const MAX_ITEM_PHOTOS = 6;
const MAX_SALE_ATTACHMENTS = 60;
const MAX_SALE_BYTES = 45 * 1024 * 1024;

type AttachmentInput = {
  pending: ReturnType<typeof prepareFile>;
  kind: 'item_photo' | 'receipt';
  saleItemId: string | null;
  receiptAmountCents: number | null;
  receiptAmountSource: 'ocr' | 'manual' | null;
};

type ExistingTotals = {
  attachmentCount: number;
  sizeBytes: number;
  receiptCount: number;
};

type SaleItemCount = { id: string; photoCount: number };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const uploaded: ReturnType<typeof prepareFile>[] = [];
  let committed = false;
  let reservationId: string | null = null;
  let storeId: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    storeId = session.storeId!;
    assertCsrf(request, session);
    const { id: saleId } = await context.params;
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
      tooLargeMessage: 'Os novos anexos ultrapassam 45 MB.',
    });
    assertFormDataKeys(
      form,
      (key) =>
        key === 'receipts' ||
        key === 'receiptValues' ||
        /^itemPhotos:[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key),
    );
    const receiptFiles = validateFiles(form.getAll('receipts'), {
      receipts: true,
      max: MAX_RECEIPTS,
    });
    const receiptValueFields = form.getAll('receiptValues');
    if (receiptValueFields.length > 1) {
      throw new HttpError(
        400,
        'Os valores dos comprovantes foram enviados mais de uma vez.',
        'INVALID_RECEIPT_VALUES',
      );
    }
    const receiptValues = receiptValuesFromForm(
      receiptValueFields[0] ?? null,
      receiptFiles.length,
    );
    const requestedItemIds = Array.from(
      new Set(
        Array.from(form.keys())
          .filter((key) => key.startsWith('itemPhotos:'))
          .map((key) => key.slice('itemPhotos:'.length)),
      ),
    );
    const itemFiles = requestedItemIds.map((itemId) => ({
      itemId,
      files: validateFiles(form.getAll(`itemPhotos:${itemId}`), {
        required: true,
        max: MAX_ITEM_PHOTOS,
      }),
    }));
    const allFiles = [
      ...receiptFiles,
      ...itemFiles.flatMap((selection) => selection.files),
    ];
    if (allFiles.length === 0) {
      throw new HttpError(
        400,
        'Selecione ao menos uma foto ou comprovante.',
        'ATTACHMENT_REQUIRED',
      );
    }
    const incomingBytes = allFiles.reduce(
      (total, file) => total + file.size,
      0,
    );
    if (
      allFiles.length > MAX_SALE_ATTACHMENTS ||
      incomingBytes > MAX_SALE_BYTES
    ) {
      throw saleAttachmentLimitError();
    }

    const sale = await db
      .prepare('SELECT status FROM sales WHERE id = ? AND store_id = ? LIMIT 1')
      .bind(saleId, session.storeId)
      .first<{ status: 'completed' | 'cancelled' }>();
    if (!sale) {
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    }
    if (sale.status === 'cancelled') {
      throw new HttpError(
        409,
        'Uma venda cancelada não pode receber novos anexos.',
        'SALE_CANCELLED',
      );
    }

    const itemStatement = requestedItemIds.length
      ? db
          .prepare(
            `SELECT si.id, COUNT(a.id) AS photoCount
             FROM sale_items si
             LEFT JOIN attachments a
               ON a.sale_item_id = si.id AND a.kind = 'item_photo'
             WHERE si.sale_id = ? AND si.store_id = ?
               AND si.id IN (${requestedItemIds.map(() => '?').join(', ')})
             GROUP BY si.id`,
          )
          .bind(saleId, session.storeId, ...requestedItemIds)
      : db.prepare('SELECT NULL AS id, 0 AS photoCount WHERE 0');
    const currentResults = await db.batch([
      db
        .prepare(
          `SELECT COUNT(*) AS attachmentCount,
                  COALESCE(SUM(size_bytes), 0) AS sizeBytes,
                  COALESCE(SUM(CASE WHEN kind = 'receipt' THEN 1 ELSE 0 END), 0)
                    AS receiptCount
           FROM attachments WHERE sale_id = ? AND store_id = ?`,
        )
        .bind(saleId, session.storeId),
      itemStatement,
    ]);
    const totals = (currentResults[0].results?.[0] ?? {
      attachmentCount: 0,
      sizeBytes: 0,
      receiptCount: 0,
    }) as ExistingTotals;
    const currentItems = (currentResults[1].results ?? []) as SaleItemCount[];
    if (currentItems.length !== requestedItemIds.length) {
      throw new HttpError(
        404,
        'Um dos aparelhos desta venda não foi encontrado.',
        'SALE_ITEM_NOT_FOUND',
      );
    }
    const countByItem = new Map(
      currentItems.map((item) => [item.id, Number(item.photoCount)]),
    );
    if (
      Number(totals.receiptCount) + receiptFiles.length > MAX_RECEIPTS ||
      itemFiles.some(
        ({ itemId, files }) =>
          (countByItem.get(itemId) ?? 0) + files.length > MAX_ITEM_PHOTOS,
      ) ||
      Number(totals.attachmentCount) + allFiles.length > MAX_SALE_ATTACHMENTS ||
      Number(totals.sizeBytes) + incomingBytes > MAX_SALE_BYTES
    ) {
      throw saleAttachmentLimitError();
    }

    await consumeStoreWriteBudget(
      db,
      Date.now(),
      session.storeId!,
      5 + allFiles.length,
    );
    reservationId = await reserveUpload(session.storeId!, incomingBytes);
    const receiptUploads: AttachmentInput[] = receiptFiles.map(
      (file, index) => ({
        pending: prepareFile(
          session.storeId!,
          `sales/${saleId}/receipts`,
          file,
        ),
        kind: 'receipt',
        saleItemId: null,
        receiptAmountCents: receiptValues[index].amountCents,
        receiptAmountSource: receiptValues[index].source,
      }),
    );
    const itemUploads: AttachmentInput[] = itemFiles.flatMap(
      ({ itemId, files }) =>
        files.map((file) => ({
          pending: prepareFile(
            session.storeId!,
            `sales/${saleId}/items/${itemId}`,
            file,
          ),
          kind: 'item_photo' as const,
          saleItemId: itemId,
          receiptAmountCents: null,
          receiptAmountSource: null,
        })),
    );
    const rows = [...receiptUploads, ...itemUploads];
    uploaded.push(...rows.map((row) => row.pending));
    await uploadFiles(uploaded);

    const now = Date.now();
    const attachmentStatements = buildAttachmentStatements(
      db,
      session.storeId!,
      session.id,
      saleId,
      now,
      rows,
    );
    const intendedPlaceholders = rows.map(() => '?').join(', ');
    const auditGuard = [
      `EXISTS (
         SELECT 1 FROM sales
         WHERE id = ? AND store_id = ? AND status = 'completed'
       )`,
      `(SELECT COUNT(*) FROM attachments
        WHERE sale_id = ? AND store_id = ?) <= ${MAX_SALE_ATTACHMENTS}`,
      `(SELECT COALESCE(SUM(size_bytes), 0) FROM attachments
        WHERE sale_id = ? AND store_id = ?) <= ${MAX_SALE_BYTES}`,
      `(SELECT COUNT(*) FROM attachments
        WHERE sale_id = ? AND store_id = ?
          AND kind = 'receipt') <= ${MAX_RECEIPTS}`,
      `(SELECT COUNT(*) FROM attachments
        WHERE id IN (${intendedPlaceholders}) AND store_id = ?) = ?`,
      `NOT EXISTS (
         SELECT 1 FROM attachments
         WHERE sale_id = ? AND store_id = ? AND kind = 'item_photo'
         GROUP BY sale_item_id HAVING COUNT(*) > ${MAX_ITEM_PHOTOS}
       )`,
    ]
      .filter(Boolean)
      .join(' AND ');
    const batchResults = await db.batch([
      ...attachmentStatements,
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id,
            details_json, created_at)
           SELECT ?, ?, ?, 'sale.attachments_added', 'sale',
                  CASE WHEN ${auditGuard} THEN ? ELSE NULL END,
                  ?, ?`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          saleId,
          session.storeId,
          saleId,
          session.storeId,
          saleId,
          session.storeId,
          saleId,
          session.storeId,
          ...rows.map((row) => row.pending.id),
          session.storeId,
          rows.length,
          saleId,
          session.storeId,
          saleId,
          JSON.stringify({
            receiptsAdded: receiptUploads.length,
            receiptValuesConfirmed: receiptValues.filter(
              (value) => value.amountCents !== null,
            ).length,
            itemPhotosAdded: itemUploads.length,
            sizeBytes: incomingBytes,
          }),
          now,
        ),
      db
        .prepare(
          'DELETE FROM upload_reservations WHERE id = ? AND store_id = ?',
        )
        .bind(reservationId, session.storeId),
    ]);
    const inserted = batchResults
      .slice(0, attachmentStatements.length)
      .reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
    if (inserted !== rows.length) {
      throw new HttpError(
        500,
        'Os anexos foram salvos parcialmente. Atualize a venda antes de tentar novamente.',
        'ATTACHMENTS_PARTIAL',
      );
    }
    committed = true;
    return json({
      ok: true,
      addedCount: rows.length,
      receiptsAdded: receiptUploads.length,
      itemPhotosAdded: itemUploads.length,
    });
  } catch (error) {
    if (uploaded.length && !committed) {
      try {
        const placeholders = uploaded.map(() => '?').join(', ');
        const saved = await runtime()
          .DB.prepare(
            `SELECT COUNT(*) AS saved FROM attachments
             WHERE store_id = ? AND id IN (${placeholders})`,
          )
          .bind(storeId, ...uploaded.map((file) => file.id))
          .first<{ saved: number }>();
        if (Number(saved?.saved ?? 0) === uploaded.length) committed = true;
        else await cleanupFiles(uploaded);
      } catch {
        // Preserve objects when the database result is uncertain. Orphaned
        // reservations expire; deleting could break records that were saved.
        committed = true;
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
          'A venda foi alterada ou atingiu o limite de anexos. Atualize e tente novamente.',
          'SALE_ATTACHMENTS_CHANGED',
        ),
      );
    }
    return apiError(error);
  } finally {
    if (reservationId && !committed) await releaseUpload(reservationId);
  }
}

function buildAttachmentStatements(
  db: D1Database,
  storeId: string,
  userId: string,
  saleId: string,
  now: number,
  rows: AttachmentInput[],
) {
  return chunk(rows, 10).map((group) => {
    const values = group.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
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
        ...group.flatMap(
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

function receiptValuesFromForm(
  value: FormDataEntryValue | null,
  expectedLength: number,
): ReceiptValueInput[] {
  if (value === null) return parseReceiptValues(undefined, expectedLength);
  if (typeof value !== 'string' || value.length > 8 * 1024) {
    throw new HttpError(
      400,
      'Os valores dos comprovantes são inválidos.',
      'INVALID_RECEIPT_VALUES',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(
      400,
      'Os valores dos comprovantes são inválidos.',
      'INVALID_RECEIPT_VALUES',
    );
  }
  return parseReceiptValues(parsed, expectedLength);
}

function chunk<T>(values: T[], size: number) {
  const groups: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    groups.push(values.slice(start, start + size));
  }
  return groups;
}

function saleAttachmentLimitError() {
  return new HttpError(
    409,
    'Esta venda atingiu o limite de comprovantes, fotos ou 45 MB em anexos.',
    'SALE_ATTACHMENTS_LIMIT',
  );
}
