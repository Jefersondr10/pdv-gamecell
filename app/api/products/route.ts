import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  apiError,
  assertJsonRequest,
  assertSameOrigin,
  boundedJson,
  HttpError,
  integerField,
  json,
  stringField,
} from '@/lib/server/http';
import { consumeStoreWriteBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import { normalizeCommercialCode } from '@/lib/server/security';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertJsonRequest(request);
    const session = await requireSession(request, {
      roles: ['owner', 'admin'],
    });
    assertCsrf(request, session);
    const body = (await boundedJson(request)) as Record<string, unknown>;
    const model = stringField(body.model, 'Modelo', { max: 100 });
    const color = stringField(body.color, 'Cor', { max: 80 });
    const memory = stringField(body.memory, 'Memória', { max: 60 });
    const defaultPriceCents = integerField(
      body.defaultPriceCents ?? 0,
      'Preço',
      {
        min: 0,
        max: 1_000_000_000,
      },
    );
    if (
      !Array.isArray(body.codes) ||
      body.codes.length === 0 ||
      body.codes.length > 10
    ) {
      throw new HttpError(
        400,
        'Informe ao menos um UPC ou EAN.',
        'CODES_REQUIRED',
      );
    }
    const codes = Array.from(
      new Set(
        body.codes.map((value) =>
          normalizeCommercialCode(
            stringField(value, 'Código', { min: 8, max: 18 }),
          ),
        ),
      ),
    );
    if (codes.some((code) => code.length !== 14)) {
      throw new HttpError(400, 'UPC ou EAN inválido.', 'INVALID_CODE');
    }
    const db = runtime().DB;
    const now = Date.now();
    await consumeStoreWriteBudget(db, now, session.storeId!, codes.length + 2);
    if (
      await db
        .prepare('SELECT 1 FROM products WHERE store_id = ? LIMIT 1 OFFSET 999')
        .bind(session.storeId)
        .first()
    ) {
      throw new HttpError(
        409,
        'Esta loja atingiu o limite de 1.000 variações de produto.',
        'PRODUCT_LIMIT',
      );
    }
    const placeholders = codes.map(() => '?').join(',');
    const codeConflict = await db
      .prepare(
        `SELECT code FROM product_codes WHERE store_id = ? AND code IN (${placeholders}) LIMIT 1`,
      )
      .bind(session.storeId, ...codes)
      .first<{ code: string }>();
    if (codeConflict) {
      throw new HttpError(
        409,
        'Um dos códigos já está vinculado a outro produto.',
        'CODE_EXISTS',
      );
    }
    const variationConflict = await db
      .prepare(
        `SELECT 1 FROM products
         WHERE store_id = ? AND model = ? AND color = ? AND memory = ? LIMIT 1`,
      )
      .bind(session.storeId, model, color, memory)
      .first();
    if (variationConflict) {
      throw new HttpError(
        409,
        'Esta variação já está cadastrada.',
        'PRODUCT_EXISTS',
      );
    }
    const productId = crypto.randomUUID();
    const statements = [
      db
        .prepare(
          `INSERT INTO products
           (id, store_id, model, color, memory, default_price_cents,
            active, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(
          productId,
          session.storeId,
          model,
          color,
          memory,
          defaultPriceCents,
          session.id,
          now,
          now,
        ),
      ...codes.map((code) =>
        db
          .prepare(
            `INSERT INTO product_codes
             (id, store_id, product_id, code, kind, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            session.storeId,
            productId,
            code,
            classifyCode(code),
            now,
          ),
      ),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, ?, ?, 'product.created', 'product', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          productId,
          JSON.stringify({ codes: codes.length }),
          now,
        ),
    ];
    await db.batch(statements);
    return json({ ok: true, id: productId }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function classifyCode(code: string) {
  const unpadded = code.replace(/^0+/, '');
  if (unpadded.length <= 12) return 'UPC';
  return 'EAN';
}
