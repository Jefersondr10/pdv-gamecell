import { oauthCookie, encodeOAuthCookie } from '@/lib/server/auth';
import { requiredSecret } from '@/lib/server/runtime';
import { randomToken, sha256 } from '@/lib/server/security';
import { safeReportReturnTo } from '@/lib/sales-report-link';

export async function GET(request: Request) {
  const state = randomToken(24);
  const verifier = randomToken(48);
  const nonce = randomToken(24);
  const redirectUri = new URL(
    '/api/auth/google/callback',
    request.url,
  ).toString();
  const transaction = await encodeOAuthCookie({
    returnTo: safeReportReturnTo(
      new URL(request.url).searchParams.get('returnTo'),
    ),
    state,
    verifier,
    nonce,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.searchParams.set('client_id', requiredSecret('GOOGLE_CLIENT_ID'));
  target.searchParams.set('redirect_uri', redirectUri);
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('scope', 'openid email profile');
  target.searchParams.set('state', state);
  target.searchParams.set('nonce', nonce);
  target.searchParams.set('code_challenge', await sha256(verifier));
  target.searchParams.set('code_challenge_method', 'S256');
  target.searchParams.set('prompt', 'select_account');
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': oauthCookie(request, transaction),
      'cache-control': 'no-store',
    },
  });
}
