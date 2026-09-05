import { requireSession } from '@/lib/server/auth';
import { apiError, HttpError, json } from '@/lib/server/http';
import { runtime } from '@/lib/server/runtime';
import { normalizeAppleSerial, serialAliases } from '@/lib/server/security';

type SerialLookupRow = {
  serial: string;
  status: 'available' | 'sold';
  product: string;
  detail: string;
  defaultPriceCents: number;
};

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const requested = Array.from(
      new Set(
        new URL(request.url).searchParams
          .getAll('serial')
          .slice(0, 2)
          .map(normalizeAppleSerial),
      ),
    );
    if (
      requested.length === 0 ||
      requested.some(
        (serial) =>
          serial.length < 8 || serial.length > 17 || !/[A-Z]/.test(serial),
      )
    ) {
      throw new HttpError(400, 'SN inválido.', 'INVALID_SERIAL');
    }
    const values = Array.from(new Set(requested.flatMap(serialAliases)));
    const db = runtime().DB;
    const result = await db
      .prepare(
        `SELECT iu.serial, iu.status, p.model AS product,
                (p.color || ' · ' || p.memory) AS detail,
                p.default_price_cents AS defaultPriceCents
         FROM inventory_units iu
         JOIN products p ON p.id = iu.product_id AND p.store_id = iu.store_id
         WHERE iu.store_id = ?
           AND iu.serial IN (${values.map(() => '?').join(', ')})`,
      )
      .bind(session.storeId, ...values)
      .all<SerialLookupRow>();
    return json({ matches: result.results });
  } catch (error) {
    return apiError(error);
  }
}
