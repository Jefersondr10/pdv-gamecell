import { type NextRequest, NextResponse } from 'next/server';

import { runtime } from '@/lib/server/runtime';
import { timingSafeEqual } from '@/lib/server/security';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

export function proxy(request: NextRequest) {
  const environment = runtime();
  if (
    environment.MIGRATION_READ_ONLY === '1' &&
    request.nextUrl.pathname.startsWith('/api/') &&
    request.nextUrl.pathname !== '/api/system/migration-export' &&
    request.nextUrl.pathname !== '/api/system/vps-backup'
  ) {
    return NextResponse.json(
      {
        error:
          'Estamos transferindo o sistema com segurança. Aguarde alguns minutos antes de continuar.',
        code: 'MIGRATION_READ_ONLY',
      },
      {
        status: 503,
        headers: { 'retry-after': '60', 'cache-control': 'no-store' },
      },
    );
  }
  const maintenance = environment.PRODUCTION_MAINTENANCE === '1';
  const bypassSecret = environment.PRODUCTION_MAINTENANCE_BYPASS_V1?.trim();
  const bypassHeader = request.headers.get('x-production-maintenance-bypass');
  const bypass = Boolean(
    bypassSecret && bypassHeader && timingSafeEqual(bypassHeader, bypassSecret),
  );
  const resetPath = '/api/system/production-reset';
  const response =
    maintenance &&
    !bypass &&
    request.nextUrl.pathname.startsWith('/api/') &&
    request.nextUrl.pathname !== resetPath
      ? NextResponse.json(
          {
            error: 'O sistema está concluindo a preparação da produção.',
            code: 'MAINTENANCE',
          },
          { status: 503 },
        )
      : NextResponse.next();
  if (maintenance) response.headers.set('cache-control', 'no-store');
  response.headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('strict-transport-security', 'max-age=31536000');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'permissions-policy',
    'camera=(self), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set('cross-origin-opener-policy', 'same-origin');
  response.headers.set('cross-origin-resource-policy', 'same-origin');
  return response;
}

export const config = {
  matcher: '/:path*',
};
