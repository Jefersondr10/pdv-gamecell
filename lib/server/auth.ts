import { HttpError, cookieHeader, readCookies } from '@/lib/server/http';
import { requiredSecret, runtime } from '@/lib/server/runtime';
import {
  fromBase64Url,
  hmac,
  randomToken,
  sha256,
  timingSafeEqual,
  toBase64Url,
} from '@/lib/server/security';

const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type PreparedSession = {
  token: string;
  idHash: string;
  userId: string;
  sessionVersion: number;
  expiresAt: number;
  createdAt: number;
};

export type SessionUser = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  storeCode: string | null;
  role: 'owner' | 'admin' | 'operator';
  authKind: 'google' | 'password';
  email: string | null;
  username: string | null;
  displayName: string;
  photoUrl: string | null;
  mustChangePassword: boolean;
  csrfToken: string;
  sessionHash: string;
};

type SessionRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  storeCode: string | null;
  role: SessionUser['role'];
  authKind: SessionUser['authKind'];
  email: string | null;
  username: string | null;
  displayName: string;
  photoUrl: string | null;
  mustChangePassword: number;
  lastSeenAt: number;
};

export function sessionCookieName(request: Request) {
  return new URL(request.url).protocol === 'https:'
    ? '__Host-atacadoapple_session'
    : 'atacadoapple_session';
}

export function oauthCookieName(request: Request) {
  return new URL(request.url).protocol === 'https:'
    ? '__Host-atacadoapple_oauth'
    : 'atacadoapple_oauth';
}

export async function createSession(userId: string, sessionVersion: number) {
  const prepared = await prepareSession(userId, sessionVersion);
  const db = runtime().DB;
  await db.batch([
    preparedSessionInsert(db, prepared),
    db
      .prepare(
        `DELETE FROM sessions
         WHERE user_id = ? AND id_hash NOT IN (
           SELECT id_hash FROM sessions
           WHERE user_id = ?
           ORDER BY created_at DESC, id_hash DESC LIMIT 10
         )`,
      )
      .bind(userId, userId),
  ]);
  return prepared.token;
}

export async function prepareSession(
  userId: string,
  sessionVersion: number,
  now = Date.now(),
): Promise<PreparedSession> {
  const token = randomToken();
  return {
    token,
    idHash: await sessionHash(token),
    userId,
    sessionVersion,
    expiresAt: now + SESSION_SECONDS * 1000,
    createdAt: now,
  };
}

export function preparedSessionInsert(
  db: D1Database,
  session: PreparedSession,
) {
  return db
    .prepare(
      `INSERT INTO sessions
       (id_hash, user_id, session_version, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.idHash,
      session.userId,
      session.sessionVersion,
      session.expiresAt,
      session.createdAt,
      session.createdAt,
    );
}

export function sessionCookie(request: Request, token: string) {
  return cookieHeader(sessionCookieName(request), token, {
    maxAge: SESSION_SECONDS,
    secure: new URL(request.url).protocol === 'https:',
  });
}

export function clearSessionCookie(request: Request) {
  return cookieHeader(sessionCookieName(request), '', {
    maxAge: 0,
    secure: new URL(request.url).protocol === 'https:',
  });
}

export async function getSession(
  request: Request,
): Promise<SessionUser | null> {
  const token = readCookies(request).get(sessionCookieName(request));
  if (!token || token.length < 30 || token.length > 200) return null;
  const idHash = await sessionHash(token);
  const now = Date.now();
  const row = await runtime()
    .DB.prepare(
      `SELECT
         u.id AS id,
         u.store_id AS storeId,
         st.name AS storeName,
         st.code AS storeCode,
         u.role AS role,
         u.auth_kind AS authKind,
         u.email AS email,
         u.username_normalized AS username,
         u.display_name AS displayName,
         u.photo_url AS photoUrl,
         u.must_change_password AS mustChangePassword,
         s.last_seen_at AS lastSeenAt
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN stores st ON st.id = u.store_id
       WHERE s.id_hash = ?
         AND s.expires_at > ?
         AND s.session_version = u.session_version
         AND u.active = 1
       LIMIT 1`,
    )
    .bind(idHash, now)
    .first<SessionRow>();
  if (!row) return null;
  if (now - row.lastSeenAt > 60 * 60 * 1000) {
    void runtime()
      .DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?')
      .bind(now, idHash)
      .run();
  }
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: row.storeName,
    storeCode: row.storeCode,
    role: row.role,
    authKind: row.authKind,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    photoUrl: row.photoUrl,
    mustChangePassword: Boolean(row.mustChangePassword),
    csrfToken: await hmac(
      `csrf:${idHash}`,
      requiredSecret('SESSION_TOKEN_PEPPER_V1'),
    ),
    sessionHash: idHash,
  };
}

export async function requireSession(
  request: Request,
  options: {
    store?: boolean;
    roles?: SessionUser['role'][];
    allowPasswordChangeRequired?: boolean;
  } = {},
) {
  const session = await getSession(request);
  if (!session)
    throw new HttpError(
      401,
      'Entre novamente para continuar.',
      'UNAUTHENTICATED',
    );
  if (session.mustChangePassword && !options.allowPasswordChangeRequired) {
    throw new HttpError(
      403,
      'Troque a senha inicial para continuar.',
      'PASSWORD_CHANGE_REQUIRED',
    );
  }
  if (options.store !== false && !session.storeId) {
    throw new HttpError(
      409,
      'Crie ou selecione uma loja para continuar.',
      'STORE_REQUIRED',
    );
  }
  if (options.roles && !options.roles.includes(session.role)) {
    throw new HttpError(
      403,
      'Seu usuário não possui essa permissão.',
      'FORBIDDEN',
    );
  }
  return session;
}

export function assertCsrf(request: Request, session: SessionUser) {
  const value = request.headers.get('x-csrf-token');
  if (!value || !timingSafeEqual(value, session.csrfToken)) {
    throw new HttpError(
      403,
      'Atualize a página e tente novamente.',
      'BAD_CSRF',
    );
  }
}

export async function deleteCurrentSession(request: Request) {
  const token = readCookies(request).get(sessionCookieName(request));
  if (!token) return;
  await runtime()
    .DB.prepare('DELETE FROM sessions WHERE id_hash = ?')
    .bind(await sessionHash(token))
    .run();
}

export async function revokeUserSessions(userId: string) {
  await runtime().DB.batch([
    runtime()
      .DB.prepare(
        'UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE id = ?',
      )
      .bind(Date.now(), userId),
    runtime().DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
  ]);
}

export type OAuthCookiePayload = {
  state: string;
  verifier: string;
  nonce: string;
  expiresAt: number;
};

export async function encodeOAuthCookie(payload: OAuthCookiePayload) {
  const encoded = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await hmac(
    encoded,
    requiredSecret('OAUTH_STATE_SECRET_V1'),
  );
  return `${encoded}.${signature}`;
}

export async function decodeOAuthCookie(
  value: string | undefined,
): Promise<OAuthCookiePayload | null> {
  if (!value) return null;
  const [encoded, signature, extra] = value.split('.');
  if (!encoded || !signature || extra) return null;
  const expected = await hmac(encoded, requiredSecret('OAUTH_STATE_SECRET_V1'));
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(fromBase64Url(encoded)),
    ) as OAuthCookiePayload;
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.verifier !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt < Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function oauthCookie(request: Request, value: string, maxAge = 600) {
  return cookieHeader(oauthCookieName(request), value, {
    maxAge,
    secure: new URL(request.url).protocol === 'https:',
  });
}

async function sessionHash(token: string) {
  return sha256(`${token}\u0000${requiredSecret('SESSION_TOKEN_PEPPER_V1')}`);
}
