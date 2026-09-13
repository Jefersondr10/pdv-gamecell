import { randomUUID } from 'node:crypto';
import {
  extractReceiptDocument,
  parseReceiptDocument,
  RECEIPT_READER_REVISION,
} from '../../receipt-document.ts';
import { refreshStoreReceivedTotals } from '../sale-received-totals.ts';

// Retry incomplete old readings once per reader revision, not on every poll.
// A legacy manual amount is evidence history, not a permanent opt-out: it gets
// one pass through the current reader and is then either promoted to OCR or
// retained with fail-closed review metadata.
const incompleteReading = `(a.receipt_details_json IS NULL OR NOT json_valid(a.receipt_details_json) OR
  (CASE WHEN json_valid(a.receipt_details_json) THEN
    COALESCE(json_extract(a.receipt_details_json,'$.blocked'),0)=0 AND
    (COALESCE(json_extract(a.receipt_details_json,'$.state'),'unknown')='unknown' OR json_extract(a.receipt_details_json,'$.ambiguous')=1)
  ELSE 0 END))`;

export async function processReceiptJob(db, files, engineUrl, now = Date.now) {
  const timestamp = now();
  // Bounded catch-up also covers receipts saved by an old client/version.
  await db
    .prepare(`INSERT OR IGNORE INTO receipt_ocr_jobs (attachment_id, status, attempts, generation, next_attempt_at, created_at, updated_at)
    SELECT a.id, 'pending', 0, 1, ?, ?, ? FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id
    WHERE a.kind='receipt' AND s.status='completed'
    AND (a.receipt_amount_source='manual' OR (
      a.receipt_amount_source IS NOT 'manual'
      AND (a.receipt_amount_cents IS NULL OR ${incompleteReading})
      AND (CASE WHEN json_valid(a.receipt_details_json) THEN COALESCE(json_extract(a.receipt_details_json,'$.blocked'),0)=0 ELSE 1 END)
    ))
    AND NOT EXISTS(SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id=a.id) LIMIT 100`)
    .bind(timestamp, timestamp, timestamp)
    .run();
  await db
    .prepare(`UPDATE receipt_ocr_jobs SET status='pending',attempts=0,generation=generation+1,
    next_attempt_at=?,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=?
    WHERE attachment_id IN (SELECT j.attachment_id FROM receipt_ocr_jobs j
      JOIN attachments a ON a.id=j.attachment_id JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id
      WHERE j.status IN ('done','needs_review','cancelled') AND j.reader_revision<?
      AND s.status='completed' AND (a.receipt_amount_source='manual' OR (
        a.receipt_amount_source IS NOT 'manual' AND ${incompleteReading}
        AND (CASE WHEN json_valid(a.receipt_details_json) THEN COALESCE(json_extract(a.receipt_details_json,'$.blocked'),0)=0 ELSE 1 END)
      ))
      ORDER BY j.updated_at LIMIT 100)`)
    .bind(timestamp, timestamp, RECEIPT_READER_REVISION)
    .run();
  await db
    .prepare(`UPDATE receipt_ocr_jobs SET status='cancelled', lease_token=NULL, lease_until=NULL, updated_at=? WHERE status IN ('pending','processing','retry') AND EXISTS (
    SELECT 1 FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id WHERE a.id=attachment_id AND s.status!='completed')`)
    .bind(timestamp)
    .run();
  const token = randomUUID();
  const claimed = await db
    .prepare(`UPDATE receipt_ocr_jobs SET status='processing', attempts=attempts+1, reader_revision=?, lease_token=?, lease_until=?, updated_at=?
    WHERE attachment_id=(SELECT attachment_id FROM receipt_ocr_jobs WHERE ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='processing' AND lease_until<?)) ORDER BY next_attempt_at, created_at LIMIT 1)
    RETURNING attachment_id AS id, generation, attempts`)
    .bind(
      RECEIPT_READER_REVISION,
      token,
      timestamp + 180_000,
      timestamp,
      timestamp,
      timestamp,
    )
    .first();
  if (!claimed) return false;
  try {
    const attachment = await db
      .prepare(
        `SELECT a.store_id AS storeId,a.sale_id AS saleId,a.r2_key AS key, a.mime_type AS mimeType, a.size_bytes AS sizeBytes,
        a.receipt_amount_cents AS previousAmount,a.receipt_amount_source AS previousSource,
        a.receipt_amount_confirmed_by AS previousConfirmedBy,a.receipt_amount_confirmed_at AS previousConfirmedAt,
        a.receipt_details_json AS previousDetails,a.receipt_review_reason AS previousReview
        FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id
        JOIN receipt_ocr_jobs j ON j.attachment_id=a.id
        WHERE a.id=? AND a.kind='receipt' AND s.status='completed'
        AND j.status='processing' AND j.generation=? AND j.lease_token=?`,
      )
      .bind(claimed.id, claimed.generation, token)
      .first();
    if (!attachment) throw new Error('SUPERSEDED');
    if (attachment.sizeBytes > 12 * 1024 * 1024)
      throw new Error('FILE_TOO_LARGE');
    const file = await files.get(attachment.key);
    if (!file) throw new Error('FILE_MISSING');
    const reader = file.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > attachment.sizeBytes || size > 12 * 1024 * 1024)
          throw new Error('FILE_INVALID');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (size !== attachment.sizeBytes) throw new Error('FILE_INVALID');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const response = await fetch(new URL('/read', engineUrl), {
      method: 'POST',
      headers: { 'content-type': attachment.mimeType },
      body: bytes,
      signal: AbortSignal.timeout(125_000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 422 ? 'FILE_INVALID' : 'ENGINE_UNAVAILABLE',
      );
    const result = await response.json();
    const details =
      parseReceiptDocument(result.details) ??
      extractReceiptDocument('').details;
    const amount = result.amountCents;
    if (
      amount !== null &&
      (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000)
    )
      throw new Error('INVALID_RESULT');
    const finished = now();
    const accepted =
      amount !== null &&
      details.automaticEligible &&
      details.state === 'completed' &&
      !details.blocked &&
      !details.ambiguous;
    const preserveLegacyManual =
      attachment.previousSource === 'manual' && !accepted;
    // A recognized document without a recognized amount is still unsafe for a
    // legacy manual value. Persist an explicitly ineligible document so the
    // shared SQL/TypeScript consumers cannot mistake that old value for OCR.
    const storedDetails = preserveLegacyManual
      ? { ...details, automaticEligible: false }
      : details;
    const detailsJson = JSON.stringify(storedDetails);
    const reviewReason =
      amount === null
        ? 'Não foi possível identificar o valor do comprovante. Releia o arquivo.'
        : details.blocked || details.ambiguous || details.state !== 'completed'
          ? 'Confira o documento: pagamento não confirmado ou leitura ambígua.'
          : !details.automaticEligible
            ? 'A leitura não contém identificação suficiente para conciliação automática. Releia o comprovante.'
            : null;
    const nextAmount = preserveLegacyManual
      ? attachment.previousAmount
      : amount;
    const nextSource = preserveLegacyManual
      ? 'manual'
      : amount === null
        ? null
        : 'ocr';
    const nextConfirmedBy = preserveLegacyManual
      ? attachment.previousConfirmedBy
      : null;
    const nextConfirmedAt = preserveLegacyManual
      ? attachment.previousConfirmedAt
      : finished;
    const auditId = `receipt-reading:${claimed.id}:${claimed.generation}`;
    await db.batch([
      db
        .prepare(`UPDATE attachments SET receipt_amount_cents=?,receipt_amount_source=?,receipt_amount_confirmed_by=?,receipt_amount_confirmed_at=?,receipt_details_json=?,receipt_review_reason=?
        WHERE id=? AND kind='receipt' AND receipt_amount_cents IS ? AND receipt_amount_source IS ?
        AND receipt_amount_confirmed_by IS ? AND receipt_amount_confirmed_at IS ?
        AND receipt_details_json IS ? AND receipt_review_reason IS ?
        AND EXISTS(SELECT 1 FROM sales s WHERE s.id=attachments.sale_id AND s.store_id=attachments.store_id AND s.status='completed')
        AND EXISTS(SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id=attachments.id AND j.status='processing' AND j.generation=? AND j.lease_token=?)`)
        .bind(
          nextAmount,
          nextSource,
          nextConfirmedBy,
          nextConfirmedAt,
          detailsJson,
          reviewReason,
          claimed.id,
          attachment.previousAmount,
          attachment.previousSource,
          attachment.previousConfirmedBy,
          attachment.previousConfirmedAt,
          attachment.previousDetails,
          attachment.previousReview,
          claimed.generation,
          token,
        ),
      db
        .prepare(`INSERT OR IGNORE INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
        SELECT ?,a.store_id,a.created_by,'sale.receipt_read_automatically','sale',a.sale_id,?,?
        FROM attachments a WHERE a.id=? AND a.receipt_amount_cents IS ? AND a.receipt_amount_source IS ?
        AND a.receipt_amount_confirmed_by IS ? AND a.receipt_amount_confirmed_at IS ?
        AND a.receipt_details_json IS ? AND a.receipt_review_reason IS ?
        AND EXISTS(SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id=a.id AND j.status='processing' AND j.generation=? AND j.lease_token=?)`)
        .bind(
          auditId,
          JSON.stringify({
            attachmentId: claimed.id,
            readerRevision: RECEIPT_READER_REVISION,
            generation: claimed.generation,
            accepted,
            before: {
              amountCents: attachment.previousAmount,
              source: attachment.previousSource,
              confirmedBy: attachment.previousConfirmedBy,
              confirmedAt: attachment.previousConfirmedAt,
              details: attachment.previousDetails,
              review: attachment.previousReview,
            },
            after: {
              amountCents: nextAmount,
              source: nextSource,
              confirmedBy: nextConfirmedBy,
              confirmedAt: nextConfirmedAt,
              details: storedDetails,
              review: reviewReason,
            },
          }),
          finished,
          claimed.id,
          nextAmount,
          nextSource,
          nextConfirmedBy,
          nextConfirmedAt,
          detailsJson,
          reviewReason,
          claimed.generation,
          token,
        ),
      // A completed reader pass supersedes the old manual settlement mode. A
      // safe reading is applied; an unsafe one is routed to review without
      // counting the retained historical amount.
      db
        .prepare(`INSERT INTO sale_receipt_payment_sync(sale_id,store_id,request_id,requested_by,target_payment_id,status,updated_at)
        SELECT a.sale_id,a.store_id,?,COALESCE(q.requested_by,a.created_by),NULL,'pending',?
        FROM attachments a LEFT JOIN sale_receipt_payment_sync q ON q.sale_id=a.sale_id AND q.store_id=a.store_id
        WHERE a.id=? AND EXISTS(SELECT 1 FROM audit_events e WHERE e.id=? AND e.store_id=a.store_id AND e.entity_id=a.sale_id)
        AND EXISTS(SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id=a.id AND j.status='processing' AND j.generation=? AND j.lease_token=?)
        ON CONFLICT(sale_id) DO UPDATE SET request_id=excluded.request_id,requested_by=excluded.requested_by,target_payment_id=NULL,status='pending',updated_at=excluded.updated_at`)
        .bind(
          `receipt-ocr:${claimed.id}:${claimed.generation}`,
          finished,
          claimed.id,
          auditId,
          claimed.generation,
          token,
        ),
      db
        .prepare(`UPDATE receipt_ocr_jobs SET status=CASE
        WHEN EXISTS(SELECT 1 FROM audit_events e JOIN attachments a ON a.id=attachment_id WHERE e.id=? AND e.store_id=a.store_id AND e.entity_id=a.sale_id) THEN ?
        ELSE 'cancelled' END,
        confidence=?,error_code=CASE WHEN EXISTS(SELECT 1 FROM audit_events e JOIN attachments a ON a.id=attachment_id WHERE e.id=? AND e.store_id=a.store_id AND e.entity_id=a.sale_id) THEN ? ELSE 'SUPERSEDED' END,
        lease_token=NULL,lease_until=NULL,updated_at=? WHERE attachment_id=? AND generation=? AND lease_token=? AND status='processing'`)
        .bind(
          auditId,
          accepted ? 'done' : 'needs_review',
          ['high', 'medium'].includes(result.confidence)
            ? result.confidence
            : null,
          auditId,
          amount === null
            ? 'VALUE_NOT_FOUND'
            : accepted
              ? null
              : 'DOCUMENT_REVIEW',
          finished,
          claimed.id,
          claimed.generation,
          token,
        ),
      refreshStoreReceivedTotals(db, attachment.storeId, {
        auditId,
        auditAction: 'sale.receipt_read_automatically',
        auditEntityId: attachment.saleId,
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = [
      'SUPERSEDED',
      'FILE_TOO_LARGE',
      'FILE_MISSING',
      'FILE_INVALID',
      'INVALID_RESULT',
    ].includes(message)
      ? message
      : 'ENGINE_UNAVAILABLE';
    const retry = code === 'ENGINE_UNAVAILABLE' && claimed.attempts < 5;
    const finished = now();
    await db
      .prepare(
        `UPDATE receipt_ocr_jobs SET status=?, error_code=?, next_attempt_at=?, lease_token=NULL, lease_until=NULL, updated_at=? WHERE attachment_id=? AND generation=? AND lease_token=? AND status='processing'`,
      )
      .bind(
        code === 'SUPERSEDED' ? 'cancelled' : retry ? 'retry' : 'needs_review',
        code,
        finished + Math.min(3600_000, 30_000 * 2 ** claimed.attempts),
        finished,
        claimed.id,
        claimed.generation,
        token,
      )
      .run();
  }
  return true;
}

export function startReceiptJobs(db, files, engineUrl) {
  let stopped = false;
  let timer;
  async function run() {
    let found = false;
    try {
      found = await processReceiptJob(db, files, engineUrl);
    } catch {
      console.error('Receipt queue cycle failed; pending jobs remain saved.');
    }
    if (!stopped) {
      timer = setTimeout(run, found ? 500 : 10_000);
      timer.unref?.();
    }
  }
  timer = setTimeout(run, 1000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
