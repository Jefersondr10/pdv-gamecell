import { apiError, HttpError } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { sha256 } from '@/lib/server/security';
import { readPublicReport } from '@/lib/server/report-shares';
import { consumeFixedWindowLimits } from '@/lib/server/rate-limit';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new HttpError(404, 'Link indisponível, expirado ou revogado.');
    const { DB: db, FILES: files } = runtime();
    const now = Date.now();
    await consumeFixedWindowLimits(
      db,
      now,
      [
        {
          scope: 'public-report-download',
          windowMs: 60000,
          max: 300,
          global: true,
        },
      ],
      {
        message: 'Tente abrir o relatório em instantes.',
        code: 'REPORT_LIMIT',
      },
      'global-first',
      0,
      'read',
    );
    const row = await readPublicReport(db, await sha256(token), now);
    const object = await files.get(row.key);
    // Re-check after file I/O so expiry or revocation during loading also closes access.
    await readPublicReport(db, await sha256(token), Date.now());
    if (!object?.body) throw new HttpError(404, 'Relatório indisponível.');
    return new Response(object.body, {
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(object.size),
        'content-disposition': 'inline; filename="relatorio.pdf"',
        'cache-control': 'private, no-store, max-age=0',
        pragma: 'no-cache',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "sandbox; default-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (error) {
    const response = apiError(error);
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    response.headers.set('referrer-policy', 'no-referrer');
    return response;
  }
}
