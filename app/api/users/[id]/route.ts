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
import { consumeControlWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { hashPassword, sha256, validatePassword } from '@/lib/server/security';

type TargetUser = {
  id: string;
  role: 'owner' | 'admin' | 'operator';
  authKind: 'google' | 'password';
  username: string | null;
  active: number;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const { id } = await context.params;
    if (id === session.id) {
      throw new HttpError(
        400,
        'Use a área do seu perfil para alterar sua conta.',
        'SELF_CHANGE',
      );
    }
    const db = runtime().DB;
    const target = await db
      .prepare(
        `SELECT id, role, auth_kind AS authKind,
                username_normalized AS username, active
         FROM users WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(id, session.storeId)
      .first<TargetUser>();
    if (!target)
      throw new HttpError(404, 'Usuário não encontrado.', 'NOT_FOUND');
    if (target.role === 'owner') {
      throw new HttpError(
        403,
        'A conta proprietária não pode ser alterada aqui.',
        'OWNER_PROTECTED',
      );
    }
    if (session.role === 'admin' && target.role !== 'operator') {
      throw new HttpError(
        403,
        'Administradores só gerenciam operadores.',
        'FORBIDDEN',
      );
    }
    const body = (await boundedJson(request)) as Record<string, unknown>;
    await consumeControlWriteBudget(
      db,
      Date.now(),
      session.storeId!,
      session.id,
      body.password === undefined ? 3 : 6,
    );
    const updates: string[] = [];
    const bindings: unknown[] = [];
    let revoke = false;
    if (typeof body.active === 'boolean') {
      updates.push('active = ?');
      bindings.push(body.active ? 1 : 0);
      revoke = !body.active;
    }
    if (body.role !== undefined) {
      if (body.role !== 'operator' && body.role !== 'admin') {
        throw new HttpError(400, 'Função inválida.', 'INVALID_ROLE');
      }
      if (body.role === 'admin' && session.role !== 'owner') {
        throw new HttpError(
          403,
          'Somente o proprietário promove administradores.',
          'FORBIDDEN',
        );
      }
      updates.push('role = ?');
      bindings.push(body.role);
      revoke = true;
    }
    if (body.password !== undefined) {
      if (target.authKind !== 'password') {
        throw new HttpError(
          400,
          'Contas Google não usam senha interna.',
          'GOOGLE_ACCOUNT_PASSWORD',
        );
      }
      const password = passwordField(body.password);
      const validation = validatePassword(password);
      if (validation) throw new HttpError(400, validation, 'WEAK_PASSWORD');
      const next = await hashPassword(password);
      updates.push(
        'password_hash = ?',
        'password_salt = ?',
        'password_iterations = ?',
        'must_change_password = 1',
      );
      bindings.push(next.hash, next.salt, next.iterations);
      revoke = true;
    }
    if (updates.length === 0) {
      throw new HttpError(
        400,
        'Nenhuma alteração foi informada.',
        'NO_CHANGES',
      );
    }
    if (revoke) updates.push('session_version = session_version + 1');
    updates.push('updated_at = ?');
    const now = Date.now();
    const roleGuard = session.role === 'admin' ? " AND role = 'operator'" : '';
    bindings.push(now, id, session.storeId);
    const credentialAttemptKey =
      body.password !== undefined && target.username && session.storeCode
        ? await sha256(
            `credential\u0000${session.storeCode}\u0000${target.username}`,
          )
        : null;
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE users SET ${updates.join(', ')}
             WHERE id = ? AND store_id = ?${roleGuard}`,
          )
          .bind(...bindings),
        ...(revoke
          ? [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]
          : []),
        ...(credentialAttemptKey
          ? [
              db
                .prepare('DELETE FROM login_attempts WHERE key_hash = ?')
                .bind(credentialAttemptKey),
            ]
          : []),
        db
          .prepare(
            `INSERT INTO audit_events
             (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
             VALUES (?, ?, ?, 'user.updated', 'user',
               CASE WHEN EXISTS (
                 SELECT 1 FROM users
                 WHERE id = ? AND store_id = ? AND updated_at = ?${roleGuard}
               ) THEN ? ELSE NULL END,
               ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            session.id,
            id,
            session.storeId,
            now,
            id,
            JSON.stringify({
              active:
                typeof body.active === 'boolean' ? body.active : undefined,
              role: body.role,
              passwordReset: body.password !== undefined,
            }),
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
          'Este usuário acabou de ser alterado. Atualize e tente novamente.',
          'USER_CHANGED',
        );
      }
      throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
