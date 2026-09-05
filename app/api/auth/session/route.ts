import { apiError, json } from '@/lib/server/http';
import { getSession } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return json({ authenticated: false });
    return json({
      authenticated: true,
      csrfToken: session.csrfToken,
      user: {
        id: session.id,
        displayName: session.displayName,
        email: session.email,
        username: session.username,
        role: session.role,
        authKind: session.authKind,
        photoUrl: session.photoUrl,
        mustChangePassword: session.mustChangePassword,
      },
      store: session.storeId
        ? {
            id: session.storeId,
            name: session.storeName,
            code: session.storeCode,
          }
        : null,
    });
  } catch (error) {
    return apiError(error);
  }
}
