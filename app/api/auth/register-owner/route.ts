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
import { consumeFixedWindowLimits } from '@/lib/server/rate-limit';
import { assertPrimaryStoreAccess } from '@/lib/server/primary-store';
import { assertProductionReady } from '@/lib/server/production-readiness';
import { runtime } from '@/lib/server/runtime';
import {
  createRecoveryCodeSet,
  hashPassword,
  normalizeEmail,
  normalizeStoreCode,
  validatePassword,
} from '@/lib/server/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const db = runtime().DB;
    await assertProductionReady(db);
    const registrationAt = Date.now();
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const displayName = stringField(body.displayName, 'Nome', { max: 100 });
    const email = normalizeEmail(
      stringField(body.email, 'E-mail', { max: 180 }),
    );
    const password = passwordField(body.password);
    const storeName = stringField(body.storeName, 'Nome da loja', { max: 100 });
    const storeCode = normalizeStoreCode(
      stringField(body.storeCode ?? storeName, 'Código da loja', { max: 80 }),
    );
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new HttpError(400, 'Informe um e-mail válido.', 'INVALID_EMAIL');
    }
    if (storeCode.length < 3) {
      throw new HttpError(
        400,
        'O código da loja deve ter ao menos 3 caracteres.',
        'INVALID_STORE_CODE',
      );
    }
    assertPrimaryStoreAccess(storeCode, body.setupToken);
    const passwordError = validatePassword(password);
    if (passwordError) throw new HttpError(400, passwordError, 'WEAK_PASSWORD');
    await consumeFixedWindowLimits(
      db,
      registrationAt,
      [
        {
          scope: 'register-request:global',
          windowMs: 10 * 60 * 1000,
          max: 300,
          global: true,
        },
        {
          scope: `register-request:ip:${sourceIp}`,
          windowMs: 10 * 60 * 1000,
          max: 10,
        },
        {
          scope: `register-request:ip-hour:${sourceIp}`,
          windowMs: 60 * 60 * 1000,
          max: 30,
        },
        {
          scope: `register-request:ip-day:${sourceIp}`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 100,
        },
      ],
      undefined,
      'specific-first',
    );

    const [emailExists, codeExists] = await Promise.all([
      db
        .prepare(
          `SELECT 1 FROM users
           WHERE email = ? AND auth_kind = 'password' LIMIT 1`,
        )
        .bind(email)
        .first(),
      db
        .prepare('SELECT 1 FROM stores WHERE code = ? LIMIT 1')
        .bind(storeCode)
        .first(),
    ]);
    if (emailExists) {
      throw new HttpError(
        409,
        'Este e-mail já possui uma conta.',
        'EMAIL_EXISTS',
      );
    }
    if (codeExists) {
      throw new HttpError(
        409,
        'Este código de loja já está em uso.',
        'STORE_CODE_EXISTS',
      );
    }

    await consumeFixedWindowLimits(
      db,
      registrationAt,
      [
        {
          scope: `register-create:ip:${sourceIp}:hour`,
          windowMs: 60 * 60 * 1000,
          max: 3,
        },
        {
          scope: `register-create:ip:${sourceIp}:day`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 5,
        },
        {
          scope: `register-create:email:${email}`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 3,
        },
        {
          scope: 'register-create:global:hour',
          windowMs: 60 * 60 * 1000,
          max: 30,
          global: true,
        },
        {
          scope: 'register-create:global:day',
          windowMs: 24 * 60 * 60 * 1000,
          max: 100,
          global: true,
        },
      ],
      {
        message: 'Muitas contas foram solicitadas. Tente novamente mais tarde.',
        code: 'REGISTRATION_LIMIT',
      },
      'global-first',
      50,
    );

    const now = Date.now();
    const storeId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const passwordData = await hashPassword(password);
    const recovery = await createRecoveryCodeSet();
    const firstSession = await prepareSession(userId, 1, now);
    await db.batch([
      db
        .prepare(
          `INSERT INTO stores
           (id, name, code, next_sale_number, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(storeId, storeName, storeCode, now, now),
      db
        .prepare(
          `INSERT INTO users
           (id, store_id, role, auth_kind, email, username_normalized,
            display_name, password_hash, password_salt, password_iterations,
            recovery_code_set_id, must_change_password, active, session_version,
            created_by, last_login_at, created_at, updated_at)
           VALUES (?, ?, 'owner', 'password', ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?, ?)`,
        )
        .bind(
          userId,
          storeId,
          email,
          email,
          displayName,
          passwordData.hash,
          passwordData.salt,
          passwordData.iterations,
          recovery.setId,
          userId,
          now,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, ?, ?, 'store.created', 'store', ?, NULL, ?)`,
        )
        .bind(crypto.randomUUID(), storeId, userId, storeId, now),
      ...recovery.hashes.map((hash) =>
        db
          .prepare(
            `INSERT INTO account_recovery_codes
             (code_hash, user_id, set_id, created_at) VALUES (?, ?, ?, ?)`,
          )
          .bind(hash, userId, recovery.setId, now),
      ),
      preparedSessionInsert(db, firstSession),
    ]);
    return json(
      { ok: true, recoveryCodes: recovery.codes },
      {
        status: 201,
        headers: { 'set-cookie': sessionCookie(request, firstSession.token) },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
