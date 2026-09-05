import { createRemoteJWKSet, jwtVerify } from 'jose';

import {
  decodeOAuthCookie,
  oauthCookie,
  oauthCookieName,
  preparedSessionInsert,
  prepareSession,
  sessionCookie,
} from '@/lib/server/auth';
import { readCookies } from '@/lib/server/http';
import { assertProductionReady } from '@/lib/server/production-readiness';
import { consumeFixedWindowLimits } from '@/lib/server/rate-limit';
import { requiredSecret, runtime } from '@/lib/server/runtime';
import { normalizeEmail, timingSafeEqual } from '@/lib/server/security';

const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const transaction = await decodeOAuthCookie(
    readCookies(request).get(oauthCookieName(request)),
  );
  const clearOAuth = oauthCookie(request, '', 0);
  const fail = (message: string) => {
    const target = new URL('/', request.url);
    target.searchParams.set('auth_error', message);
    const headers = new Headers({ location: target.toString() });
    headers.append('set-cookie', clearOAuth);
    return new Response(null, { status: 302, headers });
  };
  if (requestUrl.searchParams.get('error'))
    return fail('A entrada com Google foi cancelada.');
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  if (
    !transaction ||
    !code ||
    !state ||
    !timingSafeEqual(state, transaction.state)
  ) {
    return fail('A confirmação do Google expirou. Tente novamente.');
  }

  try {
    const db = runtime().DB;
    await assertProductionReady(db);
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const callbackAt = Date.now();
    const oauthRateError = {
      message: 'Muitas entradas pelo Google. Tente novamente mais tarde.',
      code: 'GOOGLE_LOGIN_RATE_LIMIT',
    };
    await consumeFixedWindowLimits(
      db,
      callbackAt,
      [
        {
          scope: 'google-callback:global',
          windowMs: 60 * 1000,
          max: 300,
          global: true,
        },
        {
          scope: `google-callback:ip:${sourceIp}`,
          windowMs: 60 * 1000,
          max: 10,
        },
        {
          scope: `google-callback:ip-hour:${sourceIp}`,
          windowMs: 60 * 60 * 1000,
          max: 30,
        },
        {
          scope: `google-callback:ip-day:${sourceIp}`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 100,
        },
      ],
      oauthRateError,
      'specific-first',
      0,
      'public-oauth',
    );
    const redirectUri = new URL(
      '/api/auth/google/callback',
      request.url,
    ).toString();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: requiredSecret('GOOGLE_CLIENT_ID'),
        client_secret: requiredSecret('GOOGLE_CLIENT_SECRET'),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: transaction.verifier,
      }),
    });
    if (!tokenResponse.ok) return fail('O Google não confirmou a entrada.');
    const tokenData = (await tokenResponse.json()) as { id_token?: string };
    if (!tokenData.id_token)
      return fail('O Google não retornou uma identidade válida.');
    const verified = await jwtVerify(tokenData.id_token, googleKeys, {
      audience: requiredSecret('GOOGLE_CLIENT_ID'),
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
    const claims = verified.payload;
    if (
      claims.nonce !== transaction.nonce ||
      !claims.sub ||
      typeof claims.email !== 'string' ||
      claims.email_verified !== true
    ) {
      return fail('A conta Google não pôde ser verificada.');
    }
    await consumeFixedWindowLimits(
      db,
      Date.now(),
      [
        {
          scope: 'google-session:global',
          windowMs: 60 * 60 * 1000,
          max: 2_000,
          global: true,
        },
        {
          scope: `google-session:subject:${claims.sub}`,
          windowMs: 60 * 60 * 1000,
          max: 30,
        },
        {
          scope: `google-session:ip:${sourceIp}`,
          windowMs: 60 * 60 * 1000,
          max: 60,
        },
      ],
      oauthRateError,
      'specific-first',
      20,
      'public-oauth',
    );
    const email = normalizeEmail(claims.email);
    const displayName =
      typeof claims.name === 'string' && claims.name.trim()
        ? claims.name.trim().slice(0, 100)
        : email;
    const photoUrl =
      typeof claims.picture === 'string' ? claims.picture.slice(0, 500) : null;
    let user = await db
      .prepare(
        `SELECT id, session_version AS sessionVersion, active
         FROM users WHERE google_sub = ? LIMIT 1`,
      )
      .bind(claims.sub)
      .first<{ id: string; sessionVersion: number; active: number }>();
    const now = Date.now();
    let loginSession;
    if (!user) {
      const userId = crypto.randomUUID();
      loginSession = await prepareSession(userId, 1, now);
      await db.batch([
        db
          .prepare(
            `INSERT INTO users
             (id, store_id, role, auth_kind, google_sub, email, display_name,
              photo_url, must_change_password, active, session_version,
              last_login_at, created_at, updated_at)
             VALUES (?, NULL, 'owner', 'google', ?, ?, ?, ?, 0, 1, 1, ?, ?, ?)`,
          )
          .bind(
            userId,
            claims.sub,
            email,
            displayName,
            photoUrl,
            now,
            now,
            now,
          ),
        preparedSessionInsert(db, loginSession),
      ]);
      user = { id: userId, sessionVersion: 1, active: 1 };
    } else {
      if (!user.active) return fail('Esta conta está desativada.');
      loginSession = await prepareSession(user.id, user.sessionVersion, now);
      await db.batch([
        db
          .prepare(
            `UPDATE users SET email = ?, display_name = ?, photo_url = ?,
             last_login_at = ?, updated_at = ?
             WHERE id = ? AND active = 1 AND session_version = ?`,
          )
          .bind(
            email,
            displayName,
            photoUrl,
            now,
            now,
            user.id,
            user.sessionVersion,
          ),
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
          .bind(user.id, user.id),
      ]);
    }
    const headers = new Headers({
      location: new URL('/', request.url).toString(),
    });
    headers.append('set-cookie', clearOAuth);
    headers.append('set-cookie', sessionCookie(request, loginSession.token));
    return new Response(null, { status: 302, headers });
  } catch {
    return fail('Não foi possível concluir a entrada com Google.');
  }
}
