import { randomUUID } from 'node:crypto';
import { parseReceiptDocument } from '../../receipt-document.ts';

export async function processReceiptJob(db, files, engineUrl, now = Date.now) {
  const timestamp = now();
  // Bounded catch-up also covers receipts saved by an old client/version.
  await db
    .prepare(`INSERT OR IGNORE INTO receipt_ocr_jobs (attachment_id, status, attempts, generation, next_attempt_at, created_at, updated_at)
    SELECT a.id, 'pending', 0, 1, ?, ?, ? FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id
    WHERE a.kind='receipt' AND a.receipt_amount_cents IS NULL AND s.status='completed' AND NOT EXISTS(SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id=a.id) LIMIT 100`)
    .bind(timestamp, timestamp, timestamp)
    .run();
  await db
    .prepare(`UPDATE receipt_ocr_jobs SET status='cancelled', lease_token=NULL, lease_until=NULL, updated_at=? WHERE status IN ('pending','processing','retry') AND EXISTS (
    SELECT 1 FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id WHERE a.id=attachment_id AND (a.receipt_amount_cents IS NOT NULL OR s.status!='completed'))`)
    .bind(timestamp)
    .run();
  const token = randomUUID();
  const claimed = await db
    .prepare(`UPDATE receipt_ocr_jobs SET status='processing', attempts=attempts+1, lease_token=?, lease_until=?, updated_at=?
    WHERE attachment_id=(SELECT attachment_id FROM receipt_ocr_jobs WHERE ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='processing' AND lease_until<?)) ORDER BY next_attempt_at, created_at LIMIT 1)
    RETURNING attachment_id AS id, generation, attempts`)
    .bind(token, timestamp + 180_000, timestamp, timestamp, timestamp)
    .first();
  if (!claimed) return false;
  try {
    const attachment = await db
      .prepare(
        `SELECT a.r2_key AS key, a.mime_type AS mimeType, a.size_bytes AS sizeBytes FROM attachments a JOIN sales s ON s.id=a.sale_id AND s.store_id=a.store_id WHERE a.id=? AND a.kind='receipt' AND a.receipt_amount_cents IS NULL AND s.status='completed'`,
      )
      .bind(claimed.id)
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
    const details = parseReceiptDocument(result.details);
    const amount = result.amountCents;
    if (
      amount !== null &&
      (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000)
    )
      throw new Error('INVALID_RESULT');
    const finished = now();
    await db.batch([
      db
        .prepare(`UPDATE attachments SET receipt_amount_cents=?, receipt_amount_source=CASE WHEN ? IS NULL THEN NULL ELSE 'ocr' END, receipt_amount_confirmed_by=NULL, receipt_amount_confirmed_at=?, receipt_details_json=?, receipt_review_reason=?
        WHERE id=? AND kind='receipt' AND receipt_amount_cents IS NULL
        AND EXISTS(SELECT 1 FROM sales s WHERE s.id=attachments.sale_id AND s.store_id=attachments.store_id AND s.status='completed')
        AND EXISTS(SELECT 1 FROM receipt_ocr_jobs j WHERE j.attachment_id=attachments.id AND j.status='processing' AND j.generation=? AND j.lease_token=?)`)
        .bind(
          amount,
          amount,
          finished,
          details ? JSON.stringify(details) : null,
          details &&
            (details.blocked ||
              details.ambiguous ||
              details.state !== 'completed')
            ? 'Confira o documento: pagamento não confirmado ou leitura ambígua.'
            : null,
          claimed.id,
          claimed.generation,
          token,
        ),
      db
        .prepare(`UPDATE receipt_ocr_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM attachments a WHERE a.id=attachment_id AND a.receipt_amount_source='ocr' AND a.receipt_amount_confirmed_at=?) THEN 'done'
        WHEN EXISTS(SELECT 1 FROM attachments a JOIN sales s ON s.id=a.sale_id WHERE a.id=attachment_id AND (a.receipt_amount_cents IS NOT NULL OR s.status!='completed')) THEN 'cancelled' ELSE 'needs_review' END,
        confidence=?, error_code=?, lease_token=NULL, lease_until=NULL, updated_at=? WHERE attachment_id=? AND generation=? AND lease_token=? AND status='processing'`)
        .bind(
          finished,
          ['high', 'medium'].includes(result.confidence)
            ? result.confidence
            : null,
          amount === null ? 'VALUE_NOT_FOUND' : null,
          finished,
          claimed.id,
          claimed.generation,
          token,
        ),
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
