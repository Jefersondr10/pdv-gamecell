import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
} from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import {
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import {
  normalizeBackupAlertEmail,
  type BackupAlertSettings,
} from '@/lib/backup-alert-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request, { roles: ['owner'] });
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), session.storeId!, 1);
    const row = await db
      .prepare(
        'SELECT email, revision, updated_at AS updatedAt FROM store_backup_alert_settings WHERE store_id=?',
      )
      .bind(session.storeId)
      .first<{ email: string | null; revision: number; updatedAt: number }>();
    return json({
      email: row?.email ?? null,
      revision: row?.revision ?? 0,
      updatedAt: row?.updatedAt ?? null,
      deliveryStatus: 'not_configured',
    } satisfies BackupAlertSettings);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, { roles: ['owner'] });
    assertCsrf(request, session);
    const body = await boundedJson(request);
    if (
      Object.keys(body).some((key) => !['email', 'revision'].includes(key)) ||
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 0
    )
      throw new HttpError(400, 'Configuração inválida.', 'INVALID_FIELDS');
    let email: string | null;
    try {
      email = normalizeBackupAlertEmail(body.email);
    } catch {
      throw new HttpError(400, 'Informe um e-mail válido.', 'INVALID_EMAIL');
    }
    const revision = Number(body.revision);
    const db = runtime().DB;
    const now = Date.now();
    const mutation = crypto.randomUUID();
    await consumeStoreWriteBudget(db, now, session.storeId!, 3);
    const result = await db.batch([
      db
        .prepare(`INSERT INTO store_backup_alert_settings (store_id,email,revision,updated_by,mutation_id,created_at,updated_at)
        SELECT ?,?,1,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM store_backup_alert_settings WHERE store_id=? AND revision=?)
        ON CONFLICT(store_id) DO UPDATE SET email=excluded.email,revision=store_backup_alert_settings.revision+1,updated_by=excluded.updated_by,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at
        WHERE store_backup_alert_settings.revision=?`)
        .bind(
          session.storeId,
          email,
          session.id,
          mutation,
          now,
          now,
          revision,
          session.storeId,
          revision,
          revision,
        ),
      db
        .prepare(`INSERT INTO audit_events (id,store_id,actor_user_id,action,entity_type,entity_id,details_json,created_at)
        SELECT ?,?,?,'backup.alert_destination_updated','store',?,?,? WHERE EXISTS(SELECT 1 FROM store_backup_alert_settings WHERE store_id=? AND mutation_id=?)`)
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          session.storeId,
          JSON.stringify({
            emailConfigured: Boolean(email),
            revision: revision + 1,
          }),
          now,
          session.storeId,
          mutation,
        ),
    ]);
    if (Number(result[0].meta.changes) !== 1)
      throw new HttpError(
        409,
        'A configuração mudou em outra tela. Recarregue antes de salvar.',
        'SETTINGS_CHANGED',
      );
    return json({
      email,
      revision: revision + 1,
      updatedAt: now,
      deliveryStatus: 'not_configured',
    } satisfies BackupAlertSettings);
  } catch (error) {
    return apiError(error);
  }
}
