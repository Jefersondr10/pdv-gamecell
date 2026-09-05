import {
  preparedSessionInsert,
  prepareSession,
  sessionCookie,
} from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  passwordField,
  stringField,
} from '@/lib/server/http';
import {
  consumeFixedWindowLimits,
  consumeWriteCredits,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import {
  createRecoveryCodeSet,
  hashPassword,
  hashRecoveryCode,
  normalizeEmail,
  normalizeRecoveryCode,
  sha256,
  validatePassword,
} from '@/lib/server/security';

type RecoveryOwner = {
  id: string;
  storeId: string;
  setId: string;
  sessionVersion: number;
};

const INVALID_RECOVERY = new HttpError(
  401,
  'E-mail ou código de recuperação inválido.',
  'INVALID_RECOVERY',
);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const db = runtime().DB;
    const now = Date.now();
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const rateError = {
      message: 'Muitas tentativas. Aguarde um minuto.',
      code: 'RECOVERY_RATE_LIMIT',
    };
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const email = normalizeEmail(
      stringField(body.email, 'E-mail', { max: 180 }),
    );
    const code = normalizeRecoveryCode(
      stringField(body.code, 'Código de recuperação', { max: 40 }),
    );
    const newPassword = passwordField(body.newPassword);
    const passwordError = validatePassword(newPassword);
    if (passwordError) throw new HttpError(400, passwordError, 'WEAK_PASSWORD');
    await consumeFixedWindowLimits(
      db,
      now,
      [
        {
          scope: 'recover-password:global',
          windowMs: 60 * 1000,
          max: 200,
          global: true,
        },
        {
          scope: `recover-password:ip:${sourceIp}`,
          windowMs: 60 * 1000,
          max: 8,
        },
        {
          scope: `recover-password:ip-hour:${sourceIp}`,
          windowMs: 60 * 60 * 1000,
          max: 20,
        },
        {
          scope: `recover-password:ip-day:${sourceIp}`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 50,
        },
        {
          scope: `recover-password:email:${email}`,
          windowMs: 60 * 1000,
          max: 5,
        },
      ],
      rateError,
      'specific-first',
      0,
      'public-recovery',
    );

    const codeHash = code ? await hashRecoveryCode(code) : '';
    const [owner, passwordData, recovery] = await Promise.all([
      db
        .prepare(
          `SELECT u.id, u.store_id AS storeId,
                  u.recovery_code_set_id AS setId,
                  u.session_version AS sessionVersion
           FROM users u
           JOIN account_recovery_codes recovery
             ON recovery.user_id = u.id
            AND recovery.set_id = u.recovery_code_set_id
           WHERE u.email = ? AND u.role = 'owner'
             AND u.auth_kind = 'password' AND u.active = 1
             AND recovery.code_hash = ?
           LIMIT 1`,
        )
        .bind(email, codeHash)
        .first<RecoveryOwner>(),
      hashPassword(newPassword),
      createRecoveryCodeSet(),
    ]);
    if (!owner || !codeHash) throw INVALID_RECOVERY;

    await consumeWriteCredits(db, now, 'account-security', 60);
    const credentialAttemptKey = await sha256(`credential\u0000\u0000${email}`);
    const auditId = crypto.randomUUID();
    const nextVersion = owner.sessionVersion + 1;
    const replacementSession = await prepareSession(owner.id, nextVersion, now);
    await db.batch([
      db
        .prepare(
          `UPDATE users
           SET password_hash = ?, password_salt = ?, password_iterations = ?,
               recovery_code_set_id = ?, session_version = ?,
               must_change_password = 0, updated_at = ?
           WHERE id = ? AND recovery_code_set_id = ? AND session_version = ?
             AND EXISTS (
             SELECT 1 FROM account_recovery_codes
             WHERE code_hash = ? AND user_id = users.id
               AND set_id = users.recovery_code_set_id
           )`,
        )
        .bind(
          passwordData.hash,
          passwordData.salt,
          passwordData.iterations,
          recovery.setId,
          nextVersion,
          now,
          owner.id,
          owner.setId,
          owner.sessionVersion,
          codeHash,
        ),
      db
        .prepare(
          `DELETE FROM sessions WHERE user_id = ? AND EXISTS (
             SELECT 1 FROM users
             WHERE id = ? AND recovery_code_set_id = ?
           )`,
        )
        .bind(owner.id, owner.id, recovery.setId),
      db
        .prepare(
          'DELETE FROM account_recovery_codes WHERE user_id = ? AND set_id = ?',
        )
        .bind(owner.id, owner.setId),
      db
        .prepare('DELETE FROM login_attempts WHERE key_hash = ?')
        .bind(credentialAttemptKey),
      preparedSessionInsert(db, replacementSession),
      ...recovery.hashes.map((hash) =>
        db
          .prepare(
            `INSERT INTO account_recovery_codes
             (code_hash, user_id, set_id, created_at)
             SELECT ?, users.id, ?, ? FROM users
             WHERE users.id = ? AND users.recovery_code_set_id = ?`,
          )
          .bind(hash, recovery.setId, now, owner.id, recovery.setId),
      ),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id,
            details_json, created_at)
           VALUES (?, ?, ?, 'owner.password_recovered', 'user',
             CASE WHEN EXISTS (
               SELECT 1 FROM users
               WHERE id = ? AND recovery_code_set_id = ?
             ) THEN ? ELSE NULL END,
             NULL, ?)`,
        )
        .bind(
          auditId,
          owner.storeId,
          owner.id,
          owner.id,
          recovery.setId,
          owner.id,
          now,
        ),
    ]);
    return json(
      { ok: true, recoveryCodes: recovery.codes },
      {
        headers: {
          'set-cookie': sessionCookie(request, replacementSession.token),
        },
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
        error.message,
      )
    ) {
      return apiError(INVALID_RECOVERY);
    }
    return apiError(error);
  }
}
