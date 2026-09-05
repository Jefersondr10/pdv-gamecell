import {
  assertCsrf,
  preparedSessionInsert,
  prepareSession,
  requireSession,
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
} from '@/lib/server/http';
import {
  consumeFixedWindowLimits,
  consumeWriteCredits,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from '@/lib/server/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      store: false,
      allowPasswordChangeRequired: true,
    });
    assertCsrf(request, session);
    if (session.authKind !== 'password') {
      throw new HttpError(
        400,
        'Esta conta entra pelo Google.',
        'GOOGLE_ACCOUNT',
      );
    }
    const db = runtime().DB;
    const attemptAt = Date.now();
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    await consumeFixedWindowLimits(
      db,
      attemptAt,
      [
        {
          scope: 'password-change:global',
          windowMs: 60 * 60 * 1000,
          max: 200,
          global: true,
        },
        {
          scope: `password-change:user:${session.id}`,
          windowMs: 60 * 60 * 1000,
          max: 10,
        },
        {
          scope: `password-change:ip:${sourceIp}`,
          windowMs: 60 * 60 * 1000,
          max: 20,
        },
      ],
      {
        message: 'Muitas tentativas. Tente novamente mais tarde.',
        code: 'PASSWORD_RATE_LIMIT',
      },
      'specific-first',
      0,
      'account-security',
    );
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const currentPassword = passwordField(body.currentPassword);
    const newPassword = passwordField(body.newPassword);
    const validation = validatePassword(newPassword);
    if (validation) throw new HttpError(400, validation, 'WEAK_PASSWORD');
    if (newPassword === currentPassword) {
      throw new HttpError(
        400,
        'A nova senha precisa ser diferente da senha inicial.',
        'PASSWORD_UNCHANGED',
      );
    }
    const row = await db
      .prepare(
        `SELECT password_hash AS passwordHash, password_salt AS passwordSalt,
                password_iterations AS passwordIterations,
                session_version AS sessionVersion
         FROM users WHERE id = ? LIMIT 1`,
      )
      .bind(session.id)
      .first<{
        passwordHash: string;
        passwordSalt: string;
        passwordIterations: number;
        sessionVersion: number;
      }>();
    if (
      !row ||
      !(await verifyPassword(
        currentPassword,
        row.passwordSalt,
        row.passwordIterations,
        row.passwordHash,
      ))
    ) {
      throw new HttpError(
        401,
        'A senha atual não confere.',
        'INVALID_CURRENT_PASSWORD',
      );
    }
    if (!session.storeId) {
      throw new HttpError(409, 'Conclua o cadastro da loja.', 'STORE_REQUIRED');
    }
    await consumeWriteCredits(db, attemptAt, 'account-security', 25);
    const next = await hashPassword(newPassword);
    const now = Date.now();
    const nextVersion = row.sessionVersion + 1;
    const replacementSession = await prepareSession(
      session.id,
      nextVersion,
      now,
    );
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE users SET password_hash = ?, password_salt = ?,
             password_iterations = ?, must_change_password = 0,
             session_version = ?, updated_at = ?
             WHERE id = ? AND store_id = ? AND active = 1
               AND auth_kind = 'password' AND session_version = ?
               AND password_hash = ?`,
          )
          .bind(
            next.hash,
            next.salt,
            next.iterations,
            nextVersion,
            now,
            session.id,
            session.storeId,
            row.sessionVersion,
            row.passwordHash,
          ),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(session.id),
        preparedSessionInsert(db, replacementSession),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id,
              details_json, created_at)
             VALUES (?, ?, ?, 'user.password_changed', 'user',
               CASE WHEN EXISTS (
                 SELECT 1 FROM users
                 WHERE id = ? AND store_id = ? AND session_version = ?
                   AND password_hash = ? AND updated_at = ?
               ) THEN ? ELSE NULL END,
               NULL, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            session.id,
            session.storeId,
            nextVersion,
            next.hash,
            now,
            session.id,
            now,
          ),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'Sua senha acabou de ser alterada em outra sessão. Entre novamente.',
          'PASSWORD_CHANGED',
        );
      }
      throw error;
    }
    return json(
      { ok: true },
      {
        headers: {
          'set-cookie': sessionCookie(request, replacementSession.token),
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
