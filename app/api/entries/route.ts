import { assertCsrf, requireSession } from '@/lib/server/auth';
import {
  assertFormDataKeys,
  boundedFormData,
  cleanupFiles,
  prepareFile,
  uploadFiles,
  validateFiles,
} from '@/lib/server/files';
import {
  apiError,
  assertSameOrigin,
  HttpError,
  json,
  parseJsonObject,
  stringField,
  utf8Prefix,
} from '@/lib/server/http';
import {
  consumeFixedWindowLimits,
  consumeStoreReadBudget,
  consumeStoreWriteBudget,
} from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import {
  normalizeAppleSerial,
  normalizeCommercialCode,
  serialAliases,
} from '@/lib/server/security';
import { releaseUpload, reserveUpload } from '@/lib/server/storage-quota';
import type {
  AttachmentRecord,
  EntriesPage,
  EntryRecord,
} from '@/lib/pdv-types';

type EntryListRow = Omit<EntryRecord, 'serials' | 'photos'>;

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const storeId = session.storeId!;
    const url = new URL(request.url);
    const pageSize = Math.min(
      99,
      Math.max(10, Math.trunc(Number(url.searchParams.get('limit')) || 50)),
    );
    let from = optionalMillis(url.searchParams.get('from'), 'Data inicial');
    let to = optionalMillis(url.searchParams.get('to'), 'Data final');
    if (from === null && to === null) {
      to = Date.now() + 24 * 60 * 60 * 1000;
      from = to - 367 * 24 * 60 * 60 * 1000;
    }
    if (to === null)
      to = Math.min(
        Date.now() + 24 * 60 * 60 * 1000,
        from! + 367 * 24 * 60 * 60 * 1000,
      );
    if (from === null) from = to - 367 * 24 * 60 * 60 * 1000;
    if (from !== null && to !== null && from >= to) {
      throw new HttpError(400, 'Período inválido.', 'INVALID_PERIOD');
    }
    if (to - from > 367 * 24 * 60 * 60 * 1000) {
      throw new HttpError(
        400,
        'Consulte no máximo 12 meses por vez.',
        'PERIOD_TOO_LARGE',
      );
    }
    const query = utf8Prefix((url.searchParams.get('q') ?? '').trim(), 48);
    const where = ['e.store_id = ?'];
    const bindings: Array<string | number> = [storeId];
    if (from !== null) {
      where.push('e.created_at >= ?');
      bindings.push(from);
    }
    if (to !== null) {
      where.push('e.created_at < ?');
      bindings.push(to);
    }
    if (query) {
      const pattern = `%${query}%`;
      where.push(`(
        p.model LIKE ? COLLATE NOCASE OR p.color LIKE ? COLLATE NOCASE
        OR p.memory LIKE ? COLLATE NOCASE
        OR operator.display_name LIKE ? COLLATE NOCASE OR EXISTS (
          SELECT 1 FROM inventory_units search_unit
          WHERE search_unit.entry_id = e.id
            AND search_unit.store_id = e.store_id
            AND search_unit.serial LIKE ? COLLATE NOCASE
        )
      )`);
      bindings.push(pattern, pattern, pattern, pattern, pattern);
    }
    const cursor = parseCursor(url.searchParams.get('cursor'));
    if (cursor) {
      where.push('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))');
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const filterSql = where.join(' AND ');
    const aggregateWhere = where.filter(
      (clause) => !clause.startsWith('(e.created_at < ?'),
    );
    const aggregateBindings = cursor ? bindings.slice(0, -3) : bindings;
    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), storeId, 10);
    const results = await db.batch([
      db
        .prepare(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(e.quantity), 0) AS unitCount,
                  COALESCE(SUM((
                    SELECT COUNT(*) FROM attachments aggregate_file
                    WHERE aggregate_file.entry_id = e.id
                      AND aggregate_file.store_id = e.store_id
                      AND aggregate_file.kind = 'entry_photo'
                  )), 0) AS photoCount
           FROM entries e
           JOIN products p ON p.id = e.product_id AND p.store_id = e.store_id
           JOIN users operator ON operator.id = e.operator_user_id
           WHERE ${aggregateWhere.join(' AND ')}`,
        )
        .bind(...aggregateBindings),
      db
        .prepare(
          `SELECT e.id, e.product_id AS productId, p.model AS productName,
                  (p.color || ' · ' || p.memory) AS productDetail,
                  e.quantity, operator.display_name AS operatorName,
                  e.created_at AS createdAt
           FROM entries e
           JOIN products p ON p.id = e.product_id AND p.store_id = e.store_id
           JOIN users operator ON operator.id = e.operator_user_id
           WHERE ${filterSql}
           ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
        )
        .bind(...bindings, pageSize + 1),
    ]);
    const aggregate = firstRow<{
      total: number;
      unitCount: number;
      photoCount: number;
    }>(results[0]);
    const listed = resultRows<EntryListRow>(results[1]);
    const hasMore = listed.length > pageSize;
    const visible = listed.slice(0, pageSize);
    const items = visible.length
      ? await hydrateEntries(db, storeId, visible)
      : [];
    const last = visible.at(-1);
    return json({
      items,
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      total: Number(aggregate?.total ?? 0),
      aggregates: {
        entryCount: Number(aggregate?.total ?? 0),
        unitCount: Number(aggregate?.unitCount ?? 0),
        photoCount: Number(aggregate?.photoCount ?? 0),
      },
    } satisfies EntriesPage);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const uploaded: ReturnType<typeof prepareFile>[] = [];
  let reservationId: string | null = null;
  let committed = false;
  let entryId: string | null = null;
  let storeId: string | null = null;
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    storeId = session.storeId!;
    assertCsrf(request, session);
    const db = runtime().DB;
    const uploadAt = Date.now();
    const sourceIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    await consumeFixedWindowLimits(
      db,
      uploadAt,
      [
        {
          scope: 'multipart:global',
          windowMs: 60 * 1000,
          max: 80,
          global: true,
        },
        {
          scope: `multipart:user:${session.id}`,
          windowMs: 60 * 1000,
          max: 8,
        },
        {
          scope: `multipart:ip:${sourceIp}`,
          windowMs: 60 * 1000,
          max: 16,
        },
        {
          scope: `multipart:store:${session.storeId}:minute`,
          windowMs: 60 * 1000,
          max: 40,
        },
        {
          scope: `multipart:store:${session.storeId}:hour`,
          windowMs: 60 * 60 * 1000,
          max: 200,
        },
        {
          scope: `multipart:store:${session.storeId}:day`,
          windowMs: 24 * 60 * 60 * 1000,
          max: 1_000,
        },
      ],
      {
        message: 'Muitos envios foram iniciados. Aguarde um minuto.',
        code: 'UPLOAD_RATE_LIMIT',
      },
      'specific-first',
      0,
      'business',
    );
    const form = await boundedFormData(request, {
      maxBytes: 50 * 1024 * 1024,
      tooLargeMessage: 'As fotos desta entrada ultrapassam 45 MB.',
    });
    assertFormDataKeys(form, (key) => key === 'payload' || key === 'photos');
    const payloadValue = form.get('payload');
    if (typeof payloadValue !== 'string') {
      throw new HttpError(400, 'Dados da entrada ausentes.', 'INVALID_PAYLOAD');
    }
    if (payloadValue.length > 16 * 1024) {
      throw new HttpError(
        413,
        'Dados da entrada muito grandes.',
        'PAYLOAD_TOO_LARGE',
      );
    }
    const payload = parseJsonObject(
      payloadValue,
      'Dados da entrada inválidos.',
    );
    const productId = stringField(payload.productId, 'Produto', { max: 80 });
    const gtin14 = normalizeCommercialCode(
      stringField(payload.gtin14, 'UPC ou EAN', { min: 8, max: 18 }),
    );
    if (!gtin14) {
      throw new HttpError(400, 'UPC ou EAN inválido.', 'INVALID_CODE');
    }
    if (
      !Array.isArray(payload.serials) ||
      payload.serials.length === 0 ||
      payload.serials.length > 200
    ) {
      throw new HttpError(
        400,
        'Informe de 1 a 200 números de série.',
        'INVALID_SERIALS',
      );
    }
    const serials = Array.from(
      new Set(
        payload.serials.map((value) =>
          normalizeAppleSerial(stringField(value, 'SN', { min: 8, max: 24 })),
        ),
      ),
    );
    if (serials.length !== payload.serials.length) {
      throw new HttpError(
        409,
        'Há SN repetido nesta entrada.',
        'INVALID_SERIALS',
      );
    }
    if (
      serials.some(
        (serial) =>
          serial.length < 8 || serial.length > 17 || !/[A-Z]/.test(serial),
      )
    ) {
      throw new HttpError(
        400,
        'Há SN inválido nesta entrada.',
        'INVALID_SERIALS',
      );
    }
    const photos = validateFiles(form.getAll('photos'), {
      required: true,
      max: 8,
    });
    const filesSizeBytes = photos.reduce((total, file) => total + file.size, 0);
    if (filesSizeBytes > 45 * 1024 * 1024) {
      throw new HttpError(
        400,
        'As fotos desta entrada ultrapassam 45 MB.',
        'ENTRY_FILES_LIMIT',
      );
    }
    await consumeStoreWriteBudget(
      db,
      Date.now(),
      session.storeId!,
      6 + serials.length + photos.length,
    );
    const product = await db
      .prepare(
        `SELECT p.id FROM products p
         JOIN product_codes pc
           ON pc.product_id = p.id AND pc.store_id = p.store_id
         WHERE p.id = ? AND p.store_id = ? AND p.active = 1
           AND pc.code = ? LIMIT 1`,
      )
      .bind(productId, session.storeId, gtin14)
      .first();
    if (!product) {
      throw new HttpError(
        409,
        'O código do produto foi alterado. Bipe o UPC ou EAN novamente.',
        'PRODUCT_CODE_CHANGED',
      );
    }
    let duplicate: { serial: string } | null = null;
    // Cada SN pode gerar duas formas equivalentes (com e sem o prefixo S).
    // Mantemos no máximo 91 binds por consulta para respeitar o limite do D1.
    for (let start = 0; start < serials.length && !duplicate; start += 45) {
      const batch = serials.slice(start, start + 45);
      const aliases = Array.from(new Set(batch.flatMap(serialAliases)));
      const placeholders = aliases.map(() => '?').join(',');
      duplicate = await db
        .prepare(
          `SELECT serial FROM inventory_units
           WHERE store_id = ? AND serial IN (${placeholders}) LIMIT 1`,
        )
        .bind(session.storeId, ...aliases)
        .first<{ serial: string }>();
    }
    if (duplicate) {
      throw new HttpError(
        409,
        `O SN ${duplicate.serial} já está cadastrado.`,
        'SERIAL_EXISTS',
        { serial: duplicate.serial },
      );
    }
    reservationId = await reserveUpload(session.storeId!, filesSizeBytes);
    entryId = crypto.randomUUID();
    uploaded.push(
      ...photos.map((file) =>
        prepareFile(session.storeId!, `entries/${entryId}`, file),
      ),
    );
    await uploadFiles(uploaded);
    const now = Date.now();
    const inventoryStatements = chunk(serials, 48).map((serialGroup) => {
      const values = serialGroup.map(() => '(?, ?)').join(', ');
      return db
        .prepare(
          `WITH incoming (id, serial) AS (VALUES ${values})
           INSERT INTO inventory_units
             (id, store_id, product_id, entry_id, serial, status, sale_id, created_at, sold_at)
           SELECT incoming.id, ?, ?, ?, incoming.serial,
                  'available', NULL, ?, NULL
           FROM incoming`,
        )
        .bind(
          ...serialGroup.flatMap((serial) => [crypto.randomUUID(), serial]),
          session.storeId,
          productId,
          entryId,
          now,
        );
    });
    const attachmentStatements = chunk(uploaded, 19).map((fileGroup) => {
      const values = fileGroup.map(() => '(?, ?, ?, ?, ?)').join(', ');
      return db
        .prepare(
          `WITH incoming (id, r2_key, file_name, mime_type, size_bytes) AS
             (VALUES ${values})
           INSERT INTO attachments
             (id, store_id, kind, entry_id, sale_id, sale_item_id, r2_key,
              file_name, mime_type, size_bytes, created_by, created_at)
           SELECT incoming.id, ?, 'entry_photo', ?, NULL, NULL,
                  incoming.r2_key, incoming.file_name, incoming.mime_type,
                  incoming.size_bytes, ?, ?
           FROM incoming`,
        )
        .bind(
          ...fileGroup.flatMap((pending) => [
            pending.id,
            pending.key,
            pending.file.name.slice(0, 200) || 'foto',
            pending.file.type,
            pending.file.size,
          ]),
          session.storeId,
          entryId,
          session.id,
          now,
        );
    });
    await db.batch([
      db
        .prepare(
          `INSERT INTO entries
           (id, store_id, product_id, operator_user_id, quantity, note, created_at)
           SELECT ?, ?, p.id, ?, ?, NULL, ?
           FROM products p
           JOIN product_codes pc
             ON pc.product_id = p.id AND pc.store_id = p.store_id
           WHERE p.id = ? AND p.store_id = ? AND p.active = 1
             AND pc.code = ?
           LIMIT 1`,
        )
        .bind(
          entryId,
          session.storeId,
          session.id,
          serials.length,
          now,
          productId,
          session.storeId,
          gtin14,
        ),
      ...inventoryStatements,
      ...attachmentStatements,
      db
        .prepare(
          `INSERT INTO audit_events
           (id, store_id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
           VALUES (?, ?, ?, 'entry.created', 'entry', ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          session.storeId,
          session.id,
          entryId,
          JSON.stringify({ quantity: serials.length }),
          now,
        ),
      db
        .prepare(
          'DELETE FROM upload_reservations WHERE id = ? AND store_id = ?',
        )
        .bind(reservationId, session.storeId),
    ]);
    committed = true;
    return json(
      { ok: true, id: entryId, added: serials.length },
      { status: 201 },
    );
  } catch (error) {
    if (uploaded.length && !committed) {
      if (entryId && storeId) {
        try {
          const saved = await runtime()
            .DB.prepare(
              'SELECT 1 FROM entries WHERE id = ? AND store_id = ? LIMIT 1',
            )
            .bind(entryId, storeId)
            .first();
          if (saved) committed = true;
          else await cleanupFiles(uploaded);
        } catch {
          // Preserve R2 objects when commit status is uncertain. Any reservation
          // left behind expires automatically; deleting could break saved records.
          committed = true;
        }
      } else {
        await cleanupFiles(uploaded);
      }
    }
    if (
      error instanceof Error &&
      /UNIQUE constraint failed:\s*inventory_units\.(?:store_id|serial)/i.test(
        error.message,
      )
    ) {
      return apiError(
        new HttpError(
          409,
          'Um dos SNs acabou de ser cadastrado em outra entrada. Atualize e tente novamente.',
          'SERIAL_EXISTS',
        ),
      );
    }
    if (
      error instanceof Error &&
      /FOREIGN KEY constraint failed/i.test(error.message)
    ) {
      return apiError(
        new HttpError(
          409,
          'O produto ou o código foi alterado durante a entrada. Bipe o UPC ou EAN novamente.',
          'PRODUCT_CODE_CHANGED',
        ),
      );
    }
    return apiError(error);
  } finally {
    if (reservationId && !committed) await releaseUpload(reservationId);
  }
}

function chunk<T>(values: T[], size: number) {
  const groups: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    groups.push(values.slice(start, start + size));
  }
  return groups;
}

async function hydrateEntries(
  db: D1Database,
  storeId: string,
  entries: EntryListRow[],
) {
  const ids = entries.map((entry) => entry.id);
  const placeholders = ids.map(() => '?').join(', ');
  const results = await db.batch([
    db
      .prepare(
        `SELECT entry_id AS entryId, serial FROM inventory_units
         WHERE store_id = ? AND entry_id IN (${placeholders})
         ORDER BY created_at, id`,
      )
      .bind(storeId, ...ids),
    db
      .prepare(
        `SELECT id, entry_id AS entryId, file_name AS name,
                mime_type AS mimeType, size_bytes AS sizeBytes
         FROM attachments
         WHERE store_id = ? AND kind = 'entry_photo'
           AND entry_id IN (${placeholders})
         ORDER BY created_at, id`,
      )
      .bind(storeId, ...ids),
  ]);
  const serialsByEntry = new Map<string, string[]>();
  for (const row of resultRows<{ entryId: string; serial: string }>(
    results[0],
  )) {
    const serials = serialsByEntry.get(row.entryId) ?? [];
    serials.push(row.serial);
    serialsByEntry.set(row.entryId, serials);
  }
  const photosByEntry = new Map<string, AttachmentRecord[]>();
  for (const row of resultRows<
    Omit<AttachmentRecord, 'url'> & { entryId: string }
  >(results[1])) {
    const photos = photosByEntry.get(row.entryId) ?? [];
    photos.push({
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      url: `/api/files/${row.id}`,
    });
    photosByEntry.set(row.entryId, photos);
  }
  return entries.map(
    (entry): EntryRecord => ({
      ...entry,
      quantity: Number(entry.quantity),
      createdAt: Number(entry.createdAt),
      serials: serialsByEntry.get(entry.id) ?? [],
      photos: photosByEntry.get(entry.id) ?? [],
    }),
  );
}

function optionalMillis(value: string | null, label: string) {
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new HttpError(400, `${label} inválida.`, 'INVALID_DATE');
  }
  return number;
}

function encodeCursor(createdAt: number, id: string) {
  return btoa(`${createdAt}|${id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseCursor(value: string | null) {
  if (!value) return null;
  try {
    const decoded = atob(
      value.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (value.length % 4)) % 4),
    );
    const separator = decoded.indexOf('|');
    const createdAt = Number(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (
      separator < 1 ||
      !Number.isSafeInteger(createdAt) ||
      createdAt < 0 ||
      !/^[a-f0-9-]{20,80}$/i.test(id)
    ) {
      throw new Error('invalid cursor');
    }
    return { createdAt, id };
  } catch {
    throw new HttpError(400, 'Paginação inválida.', 'INVALID_CURSOR');
  }
}

function resultRows<T>(result: D1Result<unknown>) {
  return (result.results ?? []) as T[];
}

function firstRow<T>(result: D1Result<unknown>) {
  return resultRows<T>(result)[0] ?? null;
}
