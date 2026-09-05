import { requireSession } from '@/lib/server/auth';
import { apiError, HttpError } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';

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
        `SELECT r2_key AS r2Key, file_name AS fileName, mime_type AS mimeType
         FROM attachments WHERE id = ? AND store_id = ? LIMIT 1`,
      )
      .bind(id, session.storeId)
      .first<{ r2Key: string; fileName: string; mimeType: string }>();
    if (!metadata)
      throw new HttpError(404, 'Arquivo não encontrado.', 'NOT_FOUND');
    const object = await runtime().FILES.get(metadata.r2Key);
    if (!object?.body)
      throw new HttpError(404, 'Arquivo não encontrado.', 'NOT_FOUND');
    const headers = new Headers();
    headers.set('content-type', metadata.mimeType);
    headers.set('content-length', String(object.size));
    headers.set('cache-control', 'private, no-store');
    headers.set('x-content-type-options', 'nosniff');
    headers.set(
      'content-disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(metadata.fileName)}`,
    );
    return new Response(object.body, { headers });
  } catch (error) {
    return apiError(error);
  }
}
