import { assertSameOrigin, apiError, json } from '@/lib/server/http';
import {
  assertCsrf,
  clearSessionCookie,
  deleteCurrentSession,
  getSession,
} from '@/lib/server/auth';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSession(request);
    if (session) assertCsrf(request, session);
    await deleteCurrentSession(request);
    return json(
      { ok: true },
      { headers: { 'set-cookie': clearSessionCookie(request) } },
    );
  } catch (error) {
    return apiError(error);
  }
}
