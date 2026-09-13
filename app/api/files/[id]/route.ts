import { requireSession } from '@/lib/server/auth';
import { assertPermission } from '@/lib/server/permissions';
import { apiError, HttpError } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { attachmentReadPermissions } from '@/lib/server/attachment-permissions';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession(request);
    const { id } = await context.params;
    const db = runtime().DB;
    const metadata = await db
      .prepare(
        `SELECT r2_key AS r2Key, file_name AS fileName, mime_type AS mimeType, kind
         FROM attachments WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(id, session.storeId)
      .first<{
        r2Key: string;
        fileName: string;
        mimeType: string;
        kind: string;
      }>();
    if (!metadata)
      throw new HttpError(404, 'Arquivo não encontrado.', 'NOT_FOUND');
    const permissions = attachmentReadPermissions(metadata.kind);
    if (!permissions)
      throw new HttpError(404, 'Arquivo não encontrado.', 'NOT_FOUND');
    assertPermission(session, ...permissions);
    const object = await runtime().FILES.get(metadata.r2Key);
    if (!object?.body)
      throw new HttpError(404, 'Arquivo não encontrado.', 'NOT_FOUND');
    const headers = new Headers();
    const etag = object.httpEtag || `"${object.etag}"`;
    headers.set('cache-control', 'private, no-cache, must-revalidate');
    headers.set('etag', etag);
    headers.set('x-content-type-options', 'nosniff');
    headers.set(
      'content-disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
    );
    if (matchesEtag(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers });
    }
    headers.set('content-type', metadata.mimeType);
    headers.set('content-length', String(object.size));
    return new Response(object.body, { headers });
  } catch (error) {
    return apiError(error);
  }
}

function matchesEtag(headerValue: string | null, etag: string) {
  if (!headerValue) return false;
  const expected = etag.replace(/^W\//, '');
  return headerValue.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || value.replace(/^W\//, '') === expected;
  });
}
