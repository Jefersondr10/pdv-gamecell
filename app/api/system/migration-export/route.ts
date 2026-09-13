import {
  apiError,
  boundedJson,
  HttpError,
  integerField,
  json,
} from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import {
  fromBase64Url,
  timingSafeEqual,
  toBase64Url,
} from '@/lib/server/security';
import { MIGRATION_TABLES } from '@/lib/server/database-lifecycle';

export const dynamic = 'force-dynamic';
const secretKeys = [
  'APP_ORIGIN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_TOKEN_PEPPER_V1',
  'PASSWORD_PEPPER_V1',
  'OAUTH_STATE_SECRET_V1',
  'RATE_LIMIT_SECRET_V1',
  'PRIMARY_STORE_SETUP_TOKEN_V1',
  'PASSWORD_SIGNUP_TOKEN_V1',
  'RECOVERY_CODE_PEPPER_V1',
] as const;

// Disabled unless an operator explicitly configures a short-lived export token.
// All exported contents are encrypted; no store user can request a global export.
export async function POST(request: Request) {
  try {
    const environment = runtime();
    const token = environment.MIGRATION_EXPORT_TOKEN ?? '';
    const expiresAt = Number(environment.MIGRATION_EXPORT_EXPIRES_AT ?? 0);
    if (
      token.length < 43 ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      expiresAt > Date.now() + 86_400_000 ||
      !timingSafeEqual(
        request.headers.get('authorization') ?? '',
        `Bearer ${token}`,
      )
    ) {
      throw new HttpError(404, 'Recurso não encontrado.', 'NOT_FOUND');
    }
    const body = await boundedJson(request, 2048);
    const encryptionKey = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(token),
      'AES-GCM',
      false,
      ['encrypt'],
    );
    const encrypted = async (bytes: ArrayBuffer) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        encryptionKey,
        bytes,
      );
      return new Response(ciphertext, {
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
          'x-export-iv': toBase64Url(iv),
          'x-content-type-options': 'nosniff',
        },
      });
    };
    const exportJson = (value: unknown) =>
      encrypted(new TextEncoder().encode(JSON.stringify(value)).buffer);
    const db = environment.DB;
    if (body.action === 'manifest') {
      const schema = await db
        .prepare(`SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema
        WHERE sql IS NOT NULL AND type IN ('table', 'index') AND tbl_name IN (${MIGRATION_TABLES.map(() => '?').join(',')})
        ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`)
        .bind(...MIGRATION_TABLES)
        .all();
      const counts = await db.batch(
        MIGRATION_TABLES.map((name) =>
          db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`),
        ),
      );
      return exportJson({
        version: 1,
        capturedAt: Date.now(),
        readOnly: environment.MIGRATION_READ_ONLY === '1',
        schema: schema.results,
        tables: MIGRATION_TABLES.map((name, index) => ({
          name,
          count: (counts[index].results[0] as { count: number }).count,
        })),
        environment: Object.fromEntries(
          secretKeys.map((key) => [key, environment[key] ?? '']),
        ),
      });
    }
    if (
      body.action === 'table' &&
      typeof body.table === 'string' &&
      MIGRATION_TABLES.includes(
        body.table as (typeof MIGRATION_TABLES)[number],
      )
    ) {
      const offset = integerField(body.offset, 'Página', {
        min: 0,
        max: 100_000_000,
      });
      const rows = await db
        .prepare(
          `SELECT * FROM "${body.table}" ORDER BY rowid LIMIT 250 OFFSET ?`,
        )
        .bind(offset)
        .all();
      return exportJson({ rows: rows.results });
    }
    if (
      body.action === 'file' &&
      typeof body.id === 'string' &&
      body.id.length <= 80
    ) {
      const file = await db
        .prepare('SELECT r2_key AS key FROM attachments WHERE id = ?')
        .bind(body.id)
        .first<{ key: string }>();
      const object = file ? await environment.FILES.get(file.key) : null;
      if (!object || object.size > 10 * 1024 * 1024)
        throw new HttpError(404, 'Arquivo não encontrado.', 'NOT_FOUND');
      return encrypted(await new Response(object.body).arrayBuffer());
    }
    return json({ error: 'Operação inválida.' }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
