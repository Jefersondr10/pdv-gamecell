import {
  requestReceiptPaymentSync,
  settleReceiptPaymentSync,
  stopReceiptPaymentSync,
} from '@/lib/server/receipt-payment-sync';
import { can } from '@/lib/permissions';
import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  integerField,
  json,
  operationIdField,
  stringField,
} from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';

import type {
  ReceiptAmountSource,
  ReceiptValueInput,
} from '@/lib/receipt-reconciliation';

export const dynamic = 'force-dynamic';

type ReceiptUpdate = ReceiptValueInput & { id: string };

type CurrentReceipt = {
  id: string;
  receiptAmountCents: number | null;
  receiptAmountConfirmedAt: number | null;
  receiptAmountConfirmedBy: string | null;
  receiptAmountSource: ReceiptAmountSource | null;
};

type ExistingOperation = {
  action: string;
  detailsJson: string | null;
  entityId: string;
  storeId: string;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let operationId: string | null = null;
  let fingerprint = '';
  let saleId = '';
  let storeId = '';
  let requestedCount = 0;
  let onlyIfPending = false;
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    storeId = session.storeId!;
    assertCsrf(request, session);
    ({ id: saleId } = await context.params);
    const body = await boundedJson(request, 16 * 1024);
    if (
      Object.keys(body).some(
        (key) =>
          key !== 'operationId' &&
          key !== 'receipts' &&
          key !== 'preservePayments' &&
          key !== 'onlyIfPending',
      )
    ) {
      throw new HttpError(
        400,
        'A alteração contém um campo não reconhecido.',
        'UNKNOWN_FIELD',
      );
    }
    if (
      Object.hasOwn(body, 'onlyIfPending') &&
      typeof body.onlyIfPending !== 'boolean'
    ) {
      throw new HttpError(
        400,
        'A proteção da leitura automática é inválida.',
        'INVALID_ONLY_IF_PENDING',
      );
    }
    onlyIfPending = body.onlyIfPending === true;
    if (
      body.preservePayments !== undefined &&
      typeof body.preservePayments !== 'boolean'
    )
      throw new HttpError(
        400,
        'Preferência de pagamento inválida.',
        'INVALID_FIELDS',
      );
    const preservePayments = body.preservePayments === true;
    if (preservePayments && !can(session, 'sales.payments'))
      throw new HttpError(
        403,
        'Sem permissão para alterar pagamentos.',
        'PERMISSION_DENIED',
      );
    operationId = operationIdField(body.operationId);
    const receipts = parseReceiptUpdates(body.receipts);
    requestedCount = receipts.length;
    const normalized = [...receipts].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    fingerprint = JSON.stringify(
      onlyIfPending
        ? { saleId, receipts: normalized, onlyIfPending: true }
        : { saleId, receipts: normalized },
    );
    if (preservePayments) fingerprint = `manual:${fingerprint}`;
    const db = runtime().DB;

    const replay = await findOperation(db, operationId);
    if (replay) {
      const updatedCount = assertSameOperation(
        replay,
        storeId,
        saleId,
        fingerprint,
        receipts.length,
      );
      return json({ ok: true, updatedCount, replayed: true });
    }

    const sale = await db
      .prepare('SELECT status FROM sales WHERE id = ? AND store_id = ? LIMIT 1')
      .bind(saleId, storeId)
      .first<{ status: 'completed' | 'cancelled' }>();
    if (!sale) {
      throw new HttpError(404, 'Venda não encontrada.', 'SALE_NOT_FOUND');
    }
    if (sale.status === 'cancelled') {
      throw new HttpError(
        409,
        'Uma venda cancelada não pode ter comprovantes alterados.',
        'SALE_CANCELLED',
      );
    }

    const placeholders = receipts.map(() => '?').join(', ');
    const current = (
      await db
        .prepare(
          `SELECT id, receipt_amount_cents AS receiptAmountCents,
                  receipt_amount_source AS receiptAmountSource,
                  receipt_amount_confirmed_by AS receiptAmountConfirmedBy,
                  receipt_amount_confirmed_at AS receiptAmountConfirmedAt
           FROM attachments
           WHERE store_id = ? AND sale_id = ? AND kind = 'receipt'
             AND id IN (${placeholders})`,
        )
        .bind(storeId, saleId, ...receipts.map((receipt) => receipt.id))
        .all<CurrentReceipt>()
    ).results;
    if (current.length !== receipts.length) {
      throw new HttpError(
        404,
        'Um dos comprovantes não pertence a esta venda.',
        'RECEIPT_NOT_FOUND',
      );
    }
    const currentById = new Map(
      current.map((receipt) => [receipt.id, receipt]),
    );
    const receiptsToUpdate = onlyIfPending
      ? receipts.filter(
          (receipt) => currentById.get(receipt.id)!.receiptAmountCents === null,
        )
      : receipts;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, storeId, 3 + receipts.length);

    const updateStatements = receiptsToUpdate.map((receipt) => {
      const previous = currentById.get(receipt.id)!;
      return db
        .prepare(
          `UPDATE attachments
           SET receipt_amount_cents = ?, receipt_amount_source = ?,
               receipt_amount_confirmed_by = ?, receipt_amount_confirmed_at = ?
           WHERE id = ? AND store_id = ? AND sale_id = ? AND kind = 'receipt'
             AND receipt_amount_cents IS ? AND receipt_amount_source IS ?
             AND receipt_amount_confirmed_by IS ?
             AND receipt_amount_confirmed_at IS ?
             AND EXISTS (
               SELECT 1 FROM sales
               WHERE id = attachments.sale_id
                 AND store_id = attachments.store_id
                 AND status = 'completed'
             )`,
        )
        .bind(
          receipt.amountCents,
          receipt.source,
          receipt.amountCents === null ? null : session.id,
          receipt.amountCents === null ? null : now,
          receipt.id,
          storeId,
          saleId,
          previous.receiptAmountCents,
          previous.receiptAmountSource,
          previous.receiptAmountConfirmedBy,
          previous.receiptAmountConfirmedAt,
        );
    });
    const desiredGuards =
      receiptsToUpdate
        .map(
          () =>
            `EXISTS (
             SELECT 1 FROM attachments
             WHERE id = ? AND store_id = ? AND sale_id = ? AND kind = 'receipt'
               AND receipt_amount_cents IS ? AND receipt_amount_source IS ?
               AND receipt_amount_confirmed_by IS ?
               AND receipt_amount_confirmed_at IS ?
           )`,
        )
        .join(' AND ') || '1 = 1';
    try {
      const results = await db.batch([
        ...updateStatements,
        ...(receiptsToUpdate.length
          ? preservePayments
            ? [stopReceiptPaymentSync(db, storeId, saleId, now)]
            : !onlyIfPending
              ? requestReceiptPaymentSync(
                  db,
                  { storeId, saleId, actorId: session.id, subject: session },
                  operationId,
                  now,
                )
              : []
          : []),
        ...receiptsToUpdate.map((receipt) =>
          db
            .prepare(
              `UPDATE receipt_ocr_jobs SET generation=generation+1, status=?, attempts=0, next_attempt_at=?, lease_token=NULL, lease_until=NULL, error_code=NULL, updated_at=? WHERE attachment_id=?`,
            )
            .bind(
              receipt.amountCents === null ? 'pending' : 'cancelled',
              now,
              now,
              receipt.id,
            ),
        ),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id,
              details_json, created_at)
             SELECT ?, ?, ?, 'sale.receipt_values_updated', 'sale',
                    CASE WHEN EXISTS (
                      SELECT 1 FROM sales
                      WHERE id = ? AND store_id = ? AND status = 'completed'
                    ) AND ${desiredGuards} THEN ? ELSE NULL END,
                    ?, ?`,
          )
          .bind(
            operationId,
            storeId,
            session.id,
            saleId,
            storeId,
            ...receiptsToUpdate.flatMap((receipt) => [
              receipt.id,
              storeId,
              saleId,
              receipt.amountCents,
              receipt.source,
              receipt.amountCents === null ? null : session.id,
              receipt.amountCents === null ? null : now,
            ]),
            saleId,
            JSON.stringify({
              fingerprint,
              updatedCount: receiptsToUpdate.length,
            }),
            now,
          ),
      ]);
      const auditResult = results.at(-1);
      if (Number(auditResult?.meta?.changes ?? 0) !== 1) {
        throw saleChangedError();
      }
      await settleReceiptPaymentSync(db, storeId, saleId).catch(() => {});
    } catch (error) {
      const saved = await findOperation(db, operationId);
      if (saved) {
        const updatedCount = assertSameOperation(
          saved,
          storeId,
          saleId,
          fingerprint,
          receipts.length,
        );
        return json({
          ok: true,
          updatedCount,
          replayed: true,
        });
      }
      if (
        error instanceof Error &&
        /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
          error.message,
        )
      ) {
        throw saleChangedError();
      }
      throw error;
    }

    return json({
      ok: true,
      updatedCount: receiptsToUpdate.length,
      replayed: false,
    });
  } catch (error) {
    if (
      !(error instanceof HttpError) &&
      operationId &&
      fingerprint &&
      saleId &&
      storeId
    ) {
      try {
        const saved = await findOperation(runtime().DB, operationId);
        if (saved) {
          const updatedCount = assertSameOperation(
            saved,
            storeId,
            saleId,
            fingerprint,
            requestedCount,
          );
          return json({
            ok: true,
            updatedCount,
            replayed: true,
          });
        }
      } catch (replayError) {
        return apiError(replayError);
      }
    }
    return apiError(error);
  }
}

function parseReceiptUpdates(value: unknown): ReceiptUpdate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new HttpError(
      400,
      'Informe de um a oito comprovantes.',
      'INVALID_RECEIPT_VALUES',
    );
  }
  const updates = value.map((raw): ReceiptUpdate => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw invalidReceiptValue();
    }
    const record = raw as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => key !== 'id' && key !== 'amountCents' && key !== 'source',
      ) ||
      !Object.hasOwn(record, 'amountCents') ||
      !Object.hasOwn(record, 'source')
    ) {
      throw invalidReceiptValue();
    }
    const id = stringField(record.id, 'Comprovante', { min: 36, max: 36 });
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      throw invalidReceiptValue();
    }
    if (record.amountCents === null && record.source === null) {
      return { id, amountCents: null, source: null };
    }
    const source: ReceiptAmountSource | null =
      record.source === 'ocr'
        ? 'ocr'
        : record.source === 'manual'
          ? 'manual'
          : null;
    if (!source) throw invalidReceiptValue();
    return {
      id,
      amountCents: integerField(record.amountCents, 'Valor do comprovante', {
        min: 1,
        max: 1_000_000_000,
      }),
      source,
    };
  });
  if (new Set(updates.map((receipt) => receipt.id)).size !== updates.length) {
    throw new HttpError(
      400,
      'O mesmo comprovante foi informado mais de uma vez.',
      'DUPLICATE_RECEIPT',
    );
  }
  return updates;
}

async function findOperation(db: D1Database, operationId: string) {
  return db
    .prepare(
      `SELECT store_id AS storeId, action, entity_id AS entityId,
              details_json AS detailsJson
       FROM audit_events WHERE id = ? LIMIT 1`,
    )
    .bind(operationId)
    .first<ExistingOperation>();
}

function assertSameOperation(
  operation: ExistingOperation,
  storeId: string,
  saleId: string,
  fingerprint: string,
  legacyUpdatedCount: number,
) {
  let savedFingerprint = operation.detailsJson;
  let updatedCount = legacyUpdatedCount;
  try {
    const details = JSON.parse(operation.detailsJson ?? '') as {
      fingerprint?: unknown;
      updatedCount?: unknown;
    };
    if (
      typeof details.fingerprint === 'string' &&
      Number.isSafeInteger(details.updatedCount) &&
      Number(details.updatedCount) >= 0
    ) {
      savedFingerprint = details.fingerprint;
      updatedCount = Number(details.updatedCount);
    }
  } catch {
    // Operações anteriores guardavam somente a impressão digital.
  }
  if (
    operation.storeId !== storeId ||
    operation.action !== 'sale.receipt_values_updated' ||
    operation.entityId !== saleId ||
    savedFingerprint !== fingerprint
  ) {
    throw new HttpError(
      409,
      'Esta operação já foi usada em outra alteração.',
      'OPERATION_ALREADY_USED',
    );
  }
  return updatedCount;
}

function invalidReceiptValue() {
  return new HttpError(
    400,
    'O valor de um comprovante é inválido.',
    'INVALID_RECEIPT_VALUE',
  );
}

function saleChangedError() {
  return new HttpError(
    409,
    'A venda ou um comprovante foi alterado. Atualize e tente novamente.',
    'SALE_CHANGED',
  );
}
