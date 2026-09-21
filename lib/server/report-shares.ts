import { PDFDocument } from 'pdf-lib';
import { HttpError } from './http.ts';
export { expireReportFiles } from './report-file-expiry.ts';

export const REPORT_MAX_BYTES = 20 * 1024 * 1024;
export function reportExpiry(hours: number, now: number) {
  if (![1, 24, 168].includes(hours))
    throw new HttpError(400, 'Escolha validade de 1 hora, 24 horas ou 7 dias.');
  return now + hours * 3600_000;
}

// Embed pages into a fresh document: no source annotations, forms, scripts,
// embedded files, hyperlinks or launch actions are carried into public PDFs.
export async function safePublicPdf(input: Uint8Array) {
  if (
    !input.length ||
    input.length > REPORT_MAX_BYTES ||
    new TextDecoder().decode(input.subarray(0, 5)) !== '%PDF-'
  )
    throw new HttpError(400, 'Envie um relatório PDF com até 20 MB.');
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input);
  } catch {
    throw new HttpError(
      400,
      'O PDF não pôde ser aberto. Gere o relatório novamente.',
    );
  }
  if (!source.getPageCount() || source.getPageCount() > 300)
    throw new HttpError(400, 'O relatório público aceita até 300 páginas.');
  const target = await PDFDocument.create();
  for (const page of source.getPages()) {
    const { width, height } = page.getSize();
    if (
      !Number.isFinite(width + height) ||
      width < 1 ||
      height < 1 ||
      width > 15000 ||
      height > 15000
    )
      throw new HttpError(400, 'Dimensão de página inválida.');
    const embedded = await target.embedPage(page);
    target.addPage([width, height]).drawPage(embedded);
  }
  target.setTitle('Relatório compartilhado');
  const result = await target.save();
  if (result.byteLength > REPORT_MAX_BYTES)
    throw new HttpError(400, 'O relatório excede 20 MB. Reduza os anexos.');
  return result;
}

export async function readPublicReport(
  db: D1Database,
  hash: string,
  now: number,
) {
  const row = await db
    .prepare(`SELECT a.r2_key AS key, r.title, r.expires_at AS expiresAt
    FROM report_shares r JOIN attachments a ON a.id=r.attachment_id AND a.store_id=r.store_id
    WHERE r.token_hash=? AND r.revoked_at IS NULL AND r.expires_at>? AND a.kind='report'`)
    .bind(hash, now)
    .first<{ key: string; title: string; expiresAt: number }>();
  if (!row)
    throw new HttpError(
      404,
      'Link indisponível, expirado ou revogado.',
      'REPORT_UNAVAILABLE',
    );
  return row;
}

export async function revokeReport(
  db: D1Database,
  storeId: string,
  id: string,
  now: number,
) {
  const row = await db
    .prepare(
      'UPDATE report_shares SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND store_id=? RETURNING id',
    )
    .bind(now, id, storeId)
    .first();
  if (!row) throw new HttpError(404, 'Relatório não encontrado.');
}
