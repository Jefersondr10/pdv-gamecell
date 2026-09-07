import { assertCsrf, requireSession } from '@/lib/server/auth';
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
import { consumeControlWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import {
  hashPassword,
  normalizeUsername,
  validatePassword,
} from '@/lib/server/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const body = (await boundedJson(request)) as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) =>
          key !== 'displayName' &&
          key !== 'username' &&
          key !== 'password' &&
          key !== 'role',
      )
    ) {
      throw new HttpError(
        400,
        'O usuário contém um campo não reconhecido.',
        'UNKNOWN_FIELD',
      );
    }
    const displayName = stringField(body.displayName, 'Nome', { max: 100 });
    const username = normalizeUsername(
      stringField(body.username, 'Usuário', { max: 50 }),
    );
    const password = passwordField(body.password);
    if (body.role !== 'admin' && body.role !== 'operator') {
      throw new HttpError(400, 'Função de usuário inválida.', 'INVALID_ROLE');
    }
    const role = body.role;
    if (role === 'admin' && session.role !== 'owner') {
      throw new HttpError(
        403,
        'Somente o proprietário cria administradores.',
        'FORBIDDEN',
      );
    }
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
      throw new HttpError(
        400,
        'O usuário deve ter 3 a 50 caracteres, sem espaços.',
        'INVALID_USERNAME',
      );
    }
    const passwordError = validatePassword(password);
    if (passwordError) throw new HttpError(400, passwordError, 'WEAK_PASSWORD');
    const db = runtime().DB;
    await consumeControlWriteBudget(
      db,
      Date.now(),
      session.storeId!,
      session.id,
      5,
    );
    if (
      await db
        .prepare('SELECT 1 FROM users WHERE store_id = ? LIMIT 1 OFFSET 99')
        .bind(session.storeId)
        .first()
    ) {
      throw new HttpError(
        409,
        'Esta loja atingiu o limite de 100 usuários.',
        'USER_LIMIT',
      );
    }
    if (
      await db
        .prepare(
          'SELECT 1 FROM users WHERE store_id = ? AND username_normalized = ? LIMIT 1',
        )
        .bind(session.storeId, username)
        .first()
    ) {
      throw new HttpError(
        409,
        'Este usuário já existe nesta loja.',
        'USERNAME_EXISTS',
      );
    }
    const passwordData = await hashPassword(password);
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO users
           (id, store_id, role, auth_kind, username_normalized, display_name,
            password_hash, password_salt, password_iterations,
            must_change_password, active, session_version, created_by,
            created_at, updated_at)
           SELECT ?, ?, ?, 'password', ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?
           WHERE (SELECT COUNT(*) FROM users WHERE store_id = ?) < 100`,
          )
          .bind(
            id,
            session.storeId,
            role,
            username,
            displayName,
            passwordData.hash,
            passwordData.salt,
            passwordData.iterations,
            session.id,
            now,
            now,
            session.storeId,
          ),
        db
          .prepare(
            `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, ?, ?, 'user.created', 'user',
             CASE WHEN EXISTS (
               SELECT 1 FROM users WHERE id = ? AND store_id = ?
             ) THEN ? ELSE NULL END, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            session.storeId,
            id,
            JSON.stringify({ role }),
            now,
          ),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        (/NOT NULL constraint failed:\s*audit_events\.entity_id/i.test(
          error.message,
        ) ||
          /UNIQUE constraint failed:\s*users/i.test(error.message))
      ) {
        const usernameExists = await db
          .prepare(
            'SELECT 1 FROM users WHERE store_id = ? AND username_normalized = ? LIMIT 1',
          )
          .bind(session.storeId, username)
          .first();
        throw usernameExists
          ? new HttpError(
              409,
              'Este usuário já existe nesta loja.',
              'USERNAME_EXISTS',
            )
          : new HttpError(
              409,
              'Esta loja atingiu o limite de 100 usuários.',
              'USER_LIMIT',
            );
      }
      throw error;
    }
    return json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
