import { assertCsrf, requireSession } from '@/lib/server/auth';
import { apiError, assertSameOrigin, json } from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { syncSystemCatalog } from '@/lib/server/system-catalog-sync';
import { SYSTEM_CATALOG_PRODUCTS } from '@/lib/system-catalog';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    assertCsrf(request, session);
    const db = runtime().DB;
    const estimatedWrites = SYSTEM_CATALOG_PRODUCTS.reduce(
      (total, product) => total + product.codes.length + 1,
      3,
    );
    await consumeStoreWriteBudget(
      db,
      Date.now(),
      session.storeId!,
      Math.min(500, estimatedWrites),
    );
    const result = await syncSystemCatalog(db, session.storeId!, session.id);
    return json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
