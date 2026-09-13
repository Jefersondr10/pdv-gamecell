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
  preparedSessionInsert,
  prepareSession,
  sessionCookie,
} from '@/lib/server/auth';
import {
  consumeFixedWindowLimits,
  consumeWriteCredits,
} from '@/lib/server/rate-limit';
import { requiredSecret, runtime } from '@/lib/server/runtime';
import {
  credentialLoginAttemptKey,
  hmac,
  normalizeEmail,
  normalizeStoreCode,
  normalizeUsername,
  PASSWORD_ITERATIONS,
  toBase64Url,
  verifyPassword,
} from '@/lib/server/security';

type LoginRow = {
  id: string;
  passwordHash: string | null;
  passwordSalt: string | null;
  passwordIterations: number | null;
  sessionVersion: number;
  active: number;
};

const GENERIC_ERROR = 'Loja, usuário ou senha inválidos.';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const forwarded = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const db = runtime().DB;
    const checkedAt = Date.now();
    const rateError = {
      message: 'Muitas tentativas. Aguarde um minuto.',
      code: 'LOGIN_RATE_LIMIT',
    };
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const password = passwordField(body.password);
    const mode = body.mode === 'staff' ? 'staff' : 'owner';
    const login =
      mode === 'staff'
        ? normalizeUsername(stringField(body.username, 'Usuário', { max: 80 }))
        : normalizeEmail(stringField(body.email, 'E-mail', { max: 180 }));
    const storeCode =
      mode === 'staff'
        ? normalizeStoreCode(
            stringField(body.storeCode, 'Código da loja', { max: 80 }),
          )
        : '';
    await consumeFixedWindowLimits(
      db,
      checkedAt,
      [
        {
          scope: 'login-request:global',
          windowMs: 60 * 1000,
          max: 300,
          global: true,
        },
        {
          scope: `login-request:ip:${forwarded}`,
          windowMs: 60 * 1000,
          max: 8,
        },
        {
          scope: `login-request:ip-hour:${forwarded}`,
          windowMs: 60 * 60 * 1000,
          max: 30,
        },
        {
          scope: `login-request:ip-day:${forwarded}`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 120,
        },
        {
          scope: `login-request:credential:${storeCode}:${login}`,
          windowMs: 60 * 1000,
          max: 5,
        },
      ],
      rateError,
      'specific-first',
      2,
      'public-login',
    );
    const rateLimitSecret = requiredSecret('RATE_LIMIT_SECRET_V1');
    const [credentialAttemptKey, originAttemptKey] = await Promise.all([
      credentialLoginAttemptKey(storeCode, login),
      hmac(`origin\u0000${forwarded}`, rateLimitSecret),
    ]);
    const attempt = await db
      .prepare(
        `SELECT MAX(blocked_until) AS blockedUntil
         FROM login_attempts WHERE key_hash IN (?, ?)`,
      )
      .bind(credentialAttemptKey, originAttemptKey)
      .first<{ blockedUntil: number | null }>();
    if (attempt?.blockedUntil && attempt.blockedUntil > checkedAt) {
      throw new HttpError(
        429,
        'Muitas tentativas. Aguarde alguns minutos.',
        'LOGIN_BLOCKED',
      );
    }

    const row =
      mode === 'staff'
        ? await db
            .prepare(
              `SELECT u.id, u.password_hash AS passwordHash,
                      u.password_salt AS passwordSalt,
                      u.password_iterations AS passwordIterations,
                      u.session_version AS sessionVersion, u.active AS active
               FROM users u
               JOIN stores s ON s.id = u.store_id
               WHERE s.code = ? AND u.username_normalized = ?
                 AND u.auth_kind = 'password'
               LIMIT 1`,
            )
            .bind(storeCode, login)
            .first<LoginRow>()
        : await db
            .prepare(
              `SELECT id, password_hash AS passwordHash,
                      password_salt AS passwordSalt,
                      password_iterations AS passwordIterations,
                      session_version AS sessionVersion, active
               FROM users
               WHERE email = ? AND role = 'owner' AND auth_kind = 'password'
               LIMIT 1`,
            )
            .bind(login)
            .first<LoginRow>();

    const dummySalt = toBase64Url(new Uint8Array(16));
    const valid = await verifyPassword(
      password,
      row?.passwordSalt ?? dummySalt,
      row?.passwordIterations ?? PASSWORD_ITERATIONS,
      row?.passwordHash ?? 'invalid-password-hash',
    );
    if (!row || !valid || !row.active) {
      const failedAt = Date.now();
      await db.batch([
        loginFailureStatement(db, credentialAttemptKey, 5, failedAt),
        loginFailureStatement(db, originAttemptKey, 25, failedAt),
      ]);
      throw new HttpError(401, GENERIC_ERROR, 'INVALID_CREDENTIALS');
    }

    const now = Date.now();
    await consumeWriteCredits(db, now, 'public-login', 15);
    const loginSession = await prepareSession(row.id, row.sessionVersion, now);
    try {
      await db.batch([
        db
          .prepare('DELETE FROM login_attempts WHERE key_hash = ?')
          .bind(credentialAttemptKey),
        db
          .prepare(
            `UPDATE users SET last_login_at = ?, updated_at = ?
             WHERE id = ? AND active = 1 AND session_version = ?
               AND password_hash = ?`,
          )
          .bind(now, now, row.id, row.sessionVersion, row.passwordHash),
        preparedSessionInsert(db, loginSession),
        db
          .prepare(
            `DELETE FROM sessions
             WHERE user_id = ? AND id_hash NOT IN (
               SELECT id_hash FROM sessions
               WHERE user_id = ?
               ORDER BY created_at DESC, id_hash DESC LIMIT 10
             )`,
          )
          .bind(row.id, row.id),
        db
          .prepare(
            `UPDATE sessions SET last_seen_at = CASE WHEN EXISTS (
               SELECT 1 FROM users
               WHERE id = ? AND active = 1 AND session_version = ?
                 AND password_hash = ? AND updated_at = ?
             ) THEN last_seen_at ELSE NULL END
             WHERE id_hash = ?`,
          )
          .bind(
            row.id,
            row.sessionVersion,
            row.passwordHash,
            now,
            loginSession.idHash,
          ),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /NOT NULL constraint failed:\s*sessions\.last_seen_at/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'A conta foi alterada durante a entrada. Tente novamente.',
          'LOGIN_STATE_CHANGED',
        );
      }
      throw error;
    }
    return json(
      { ok: true },
      {
        headers: {
          'set-cookie': sessionCookie(request, loginSession.token),
        },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}

function loginFailureStatement(
  db: D1Database,
  key: string,
  threshold: number,
  now: number,
) {
  const windowStart = now - 15 * 60 * 1000;
  return db
    .prepare(
      `INSERT INTO login_attempts (key_hash, attempts, blocked_until, updated_at)
       VALUES (?, 1, NULL, ?)
       ON CONFLICT(key_hash) DO UPDATE SET
         attempts = CASE
           WHEN login_attempts.updated_at < ? THEN 1
           ELSE login_attempts.attempts + 1
         END,
         blocked_until = CASE
           WHEN login_attempts.updated_at < ? THEN NULL
           WHEN login_attempts.attempts + 1 >= ? THEN ?
           ELSE login_attempts.blocked_until
         END,
         updated_at = excluded.updated_at`,
    )
    .bind(key, now, windowStart, windowStart, threshold, now + 15 * 60 * 1000);
}
