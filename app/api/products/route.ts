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
import { classifyCommercialCode, normalizeCommercialCode } from '@/lib/gtin';

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
      body.codes.length > 20
    ) {
      throw new HttpError(
        400,
        'Informe ao menos um UPC ou EAN.',
        'CODES_REQUIRED',
      );
    }
    const codes = Array.from(
      new Map(
        body.codes.map((value) => {
          const raw = stringField(value, 'Código', { min: 8, max: 18 });
          const code = normalizeCommercialCode(raw);
          return [code, { code, kind: classifyCommercialCode(raw, code) }];
        }),
      ).values(),
    );
    if (codes.some(({ code }) => code.length !== 14)) {
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
      .bind(session.storeId, ...codes.map(({ code }) => code))
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
           SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
           WHERE (
             SELECT COUNT(*) FROM products WHERE store_id = ?
           ) < 1000`,
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
          session.storeId,
        ),
      ...codes.map(({ code, kind }) =>
        db
          .prepare(
            `INSERT INTO product_codes
             (id, store_id, product_id, code, kind, created_at)
             SELECT ?, p.store_id, p.id, ?, ?, ?
             FROM products p
             WHERE p.id = ? AND p.store_id = ?`,
          )
          .bind(
            crypto.randomUUID(),
            code,
            kind,
            now,
            productId,
            session.storeId,
          ),
      ),
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           SELECT ?, ?, ?, 'product.created', 'product', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM products WHERE id = ? AND store_id = ?
           )`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          productId,
          JSON.stringify({ codes: codes.length }),
          now,
          productId,
          session.storeId,
        ),
    ];
    try {
      const results = await db.batch(statements);
      if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
        throw new HttpError(
          409,
          'Esta loja atingiu o limite de 1.000 variações de produto.',
          'PRODUCT_LIMIT',
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*product_codes\.(?:store_id|code)/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'Um dos códigos já está vinculado a outro produto.',
          'CODE_EXISTS',
        );
      }
      if (
        error instanceof Error &&
        /UNIQUE constraint failed:.*products\.(?:store_id|model|color|memory)/i.test(
          error.message,
        )
      ) {
        throw new HttpError(
          409,
          'Esta variação já está cadastrada.',
          'PRODUCT_EXISTS',
        );
      }
      throw error;
    }
    return json({ ok: true, id: productId }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
