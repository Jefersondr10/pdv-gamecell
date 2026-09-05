import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  json,
  passwordField,
} from '@/lib/server/http';
import {
  consumeFixedWindowLimits,
  consumeWriteCredits,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { createRecoveryCodeSet, verifyPassword } from '@/lib/server/security';

type PasswordOwner = {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  setId: string | null;
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, { roles: ['owner'] });
    assertCsrf(request, session);
    if (session.authKind !== 'password') {
      throw new HttpError(
        400,
        'Sua conta usa o Google e não precisa de códigos de recuperação.',
        'GOOGLE_ACCOUNT',
      );
    }
    const db = runtime().DB;
    const now = Date.now();
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    await consumeFixedWindowLimits(
      db,
      now,
      [
        {
          scope: 'recovery-codes:global',
          windowMs: 60 * 60 * 1000,
          max: 100,
          global: true,
        },
        {
          scope: `recovery-codes:user:${session.id}`,
          windowMs: 60 * 60 * 1000,
          max: 5,
        },
        {
          scope: `recovery-codes:ip:${sourceIp}`,
          windowMs: 60 * 60 * 1000,
          max: 10,
        },
      ],
      {
        message: 'Muitas tentativas. Tente novamente mais tarde.',
        code: 'RECOVERY_RATE_LIMIT',
      },
      'specific-first',
      0,
      'account-security',
    );
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const currentPassword = passwordField(body.currentPassword);
    const owner = await db
      .prepare(
        `SELECT password_hash AS passwordHash, password_salt AS passwordSalt,
                password_iterations AS passwordIterations,
                recovery_code_set_id AS setId
         FROM users
         WHERE id = ? AND store_id = ? AND role = 'owner'
           AND auth_kind = 'password' AND active = 1
         LIMIT 1`,
      )
      .bind(session.id, session.storeId)
      .first<PasswordOwner>();
    const valid = owner
      ? await verifyPassword(
          currentPassword,
          owner.passwordSalt,
          owner.passwordIterations,
          owner.passwordHash,
        )
      : false;
    if (!owner || !valid) {
      throw new HttpError(401, 'Senha atual incorreta.', 'INVALID_PASSWORD');
    }

    await consumeWriteCredits(db, now, 'account-security', 50);
    const recovery = await createRecoveryCodeSet();
    await db.batch([
      db
        .prepare(
          `UPDATE users SET recovery_code_set_id = ?, updated_at = ?
           WHERE id = ? AND store_id = ?
             AND recovery_code_set_id IS ?`,
        )
        .bind(recovery.setId, now, session.id, session.storeId, owner.setId),
      owner.setId
        ? db
            .prepare(
              `DELETE FROM account_recovery_codes
               WHERE user_id = ? AND set_id = ?`,
            )
            .bind(session.id, owner.setId)
        : db.prepare('SELECT 1'),
      ...recovery.hashes.map((hash) =>
        db
          .prepare(
            `INSERT INTO account_recovery_codes
             (code_hash, user_id, set_id, created_at)
             SELECT ?, users.id, ?, ? FROM users
             WHERE users.id = ? AND users.store_id = ?
               AND users.recovery_code_set_id = ?`,
          )
          .bind(
            hash,
            recovery.setId,
            now,
            session.id,
            session.storeId,
            recovery.setId,
          ),
      ),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id,
            details_json, created_at)
           VALUES (?, ?, ?, 'owner.recovery_codes_rotated', 'user',
             CASE WHEN EXISTS (
               SELECT 1 FROM users WHERE id = ? AND store_id = ?
                 AND recovery_code_set_id = ?
             ) THEN ? ELSE NULL END,
             NULL, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          session.id,
          session.storeId,
          recovery.setId,
          session.id,
          now,
        ),
    ]);
    return json({ ok: true, recoveryCodes: recovery.codes });
  } catch (error) {
    if (
      error instanceof Error &&
      /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
        error.message,
      )
    ) {
      return apiError(
        new HttpError(
          409,
          'Os códigos foram alterados em outra sessão. Atualize e tente novamente.',
          'RECOVERY_CODES_CHANGED',
        ),
      );
    }
    return apiError(error);
  }
}
