import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  operationIdField,
  stringField,
} from '@/lib/server/http';
import { boundedFormData, prepareFile } from '@/lib/server/files';
import { assertPermission } from '@/lib/server/permissions';
import { requiredSecret, runtime } from '@/lib/server/runtime';
import { hmac, sha256 } from '@/lib/server/security';
import { reserveUpload, releaseUpload } from '@/lib/server/storage-quota';
import { consumeFixedWindowLimits } from '@/lib/server/rate-limit';
import {
  expireReportFiles,
  REPORT_MAX_BYTES,
  reportExpiry,
  revokeReport,
  safePublicPdf,
} from '@/lib/server/report-shares';

export const dynamic = 'force-dynamic';
type Share = {
  id: string;
  title: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
};
const tokenFor = (storeId: string, id: string) =>
  hmac(
    `report-share-v1:${storeId}:${id}`,
    requiredSecret('SESSION_TOKEN_PEPPER_V1'),
  );
async function view(request: Request, storeId: string, row: Share) {
  const token = await tokenFor(storeId, row.id);
  return {
    ...row,
    url: new URL(`/api/public-reports/${token}`, request.url).toString(),
  };
}
async function authorize(request: Request) {
  const session = await requireSession(request);
  assertPermission(session, 'sales');
  if (!session.storeId) throw new HttpError(403, 'Loja não selecionada.');
  return { ...session, storeId: session.storeId };
}
export async function GET(request: Request) {
  try {
    const session = await authorize(request);
    const rows = await runtime()
      .DB.prepare(`SELECT id,title,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt
      FROM report_shares WHERE store_id=? ORDER BY created_at DESC LIMIT 30`)
      .bind(session.storeId)
      .all<Share>();
    return json({
      items: await Promise.all(
        rows.results.map((row) => view(request, session.storeId, row)),
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  let reservation: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await authorize(request);
    assertCsrf(request, session);
    const { DB: db, FILES: files } = runtime();
    const now = Date.now();
    await consumeFixedWindowLimits(
      db,
      now,
      [
        {
          scope: `report-create:${session.storeId}`,
          windowMs: 3600_000,
          max: 30,
        },
      ],
      {
        message: 'Limite de relatórios públicos atingido. Tente mais tarde.',
        code: 'REPORT_LIMIT',
      },
      'specific-first',
      8,
      'business',
    );
    const form = await boundedFormData(request, {
      maxBytes: REPORT_MAX_BYTES + 16384,
      tooLargeMessage: 'O relatório público aceita até 20 MB.',
    });
    const operationId = operationIdField(form.get('operationId'));
    const previous = await db
      .prepare(
        `SELECT id,title,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM report_shares WHERE store_id=? AND operation_id=?`,
      )
      .bind(session.storeId, operationId)
      .first<Share>();
    if (previous) return json(await view(request, session.storeId, previous));
    if (form.get('consent') !== 'public')
      throw new HttpError(400, 'Confirme o compartilhamento público.');
    const expiresAt = reportExpiry(Number(form.get('hours')), now);
    const title = stringField(form.get('title'), 'Título', { max: 120 });
    const input = form.get('file');
    if (!(input instanceof File)) throw new HttpError(400, 'PDF ausente.');
    const bytes = await safePublicPdf(
      new Uint8Array(await input.arrayBuffer()),
    );
    await expireReportFiles(db, now);
    reservation = await reserveUpload(session.storeId, bytes.byteLength);
    const id = crypto.randomUUID();
    const token = await tokenFor(session.storeId, id);
    const pending = prepareFile(
      session.storeId,
      'reports',
      new File([bytes as BlobPart], 'relatorio.pdf', {
        type: 'application/pdf',
      }),
    );
    // Queue cleanup BEFORE writing, so interrupted uploads cannot become orphaned.
    const cleanupId = `report-upload:${pending.id}`;
    await db
      .prepare(
        'INSERT INTO file_deletion_jobs (operation_id,r2_key,attempts,next_attempt_at,created_at) VALUES (?,?,0,?,?)',
      )
      .bind(cleanupId, pending.key, now + 3600_000, now)
      .run();
    await files.put(pending.key, pending.file.stream(), {
      httpMetadata: { contentType: 'application/pdf' },
    });
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO attachments(id,store_id,kind,r2_key,file_name,mime_type,size_bytes,created_by,created_at) VALUES (?,?,'report',?,'relatorio.pdf','application/pdf',?,?,?)`,
          )
          .bind(
            pending.id,
            session.storeId,
            pending.key,
            bytes.byteLength,
            session.id,
            now,
          ),
        db
          .prepare(
            `INSERT INTO report_shares(id,store_id,created_by,token_hash,attachment_id,title,created_at,expires_at,operation_id) VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            session.storeId,
            session.id,
            await sha256(token),
            pending.id,
            title,
            now,
            expiresAt,
            operationId,
          ),
        db
          .prepare('DELETE FROM file_deletion_jobs WHERE operation_id=?')
          .bind(cleanupId),
        db
          .prepare(
            `INSERT INTO audit_events(id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,'report.shared','report',?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            JSON.stringify({ title, expiresAt }),
            now,
          ),
      ]);
    } catch (error) {
      // Idempotent concurrent retry returns the successful snapshot, never a second grant.
      const winner = await db
        .prepare(
          `SELECT id,title,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM report_shares WHERE store_id=? AND operation_id=?`,
        )
        .bind(session.storeId, operationId)
        .first<Share>();
      if (winner) return json(await view(request, session.storeId, winner));
      throw error;
    }
    return json(
      await view(request, session.storeId, {
        id,
        title,
        createdAt: now,
        expiresAt,
        revokedAt: null,
      }),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  } finally {
    if (reservation) await releaseUpload(reservation);
  }
}
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await authorize(request);
    assertCsrf(request, session);
    const body = await boundedJson(request);
    const id = stringField(body.id, 'Relatório', { max: 36 });
    await revokeReport(runtime().DB, session.storeId, id, Date.now());
    await expireReportFiles(runtime().DB);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
