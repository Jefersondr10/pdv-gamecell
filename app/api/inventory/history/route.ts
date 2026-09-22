import { requireSession } from '@/lib/server/auth';
import { inventoryStatusSql } from '@/lib/server/reservations';
import { can } from '@/lib/permissions';
import { apiError, HttpError, json } from '@/lib/server/http';
import { consumeStoreReadBudget } from '@/lib/server/rate-limit';
import { runtime } from '@/lib/server/runtime';
import {
  isValidAppleSerial,
  normalizeAppleSerial,
  serialAliases,
} from '@/lib/server/security';
import type { AttachmentRecord } from '@/lib/pdv-types';
import type {
  SerialHistoryResponse,
  SerialHistorySale,
} from '@/lib/serial-history';
import { restrictSerialHistoryDetails } from '@/lib/serial-history';

export const dynamic = 'force-dynamic';

type UnitRow = {
  id: string;
  serial: string;
  status: 'available' | 'sold' | 'reserved';
  entryId: string;
  productName: string;
  productDetail: string;
  entryCreatedAt: number;
  operatorName: string;
  entryNote: string | null;
};

type SaleRow = Omit<SerialHistorySale, 'photos'> & { itemId: string };
type PhotoRow = Omit<AttachmentRecord, 'url'> & {
  entryId: string | null;
  saleItemId: string | null;
};

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const storeId = session.storeId!;
    const canViewEntryDetails = can(session, 'entries');
    const canViewSaleDetails = can(session, 'sales');
    const rawSerial = new URL(request.url).searchParams.get('serial') ?? '';
    const serial = normalizeAppleSerial(rawSerial.slice(0, 48));
    if (!isValidAppleSerial(serial))
      throw new HttpError(400, 'SN inválido.', 'INVALID_SERIAL');

    const db = runtime().DB;
    await consumeStoreReadBudget(db, Date.now(), storeId, 10);
    const aliases = serialAliases(serial);
    const unit = await db
      .prepare(
        `SELECT iu.id,iu.serial,${inventoryStatusSql()} AS status,iu.entry_id AS entryId,
          COALESCE(json_extract(entry_audit.details_json,'$.productName'),p.model) AS productName,
          (COALESCE(json_extract(entry_audit.details_json,'$.productColor'),p.color) || ' · ' ||
           COALESCE(json_extract(entry_audit.details_json,'$.productMemory'),p.memory)) AS productDetail,
          e.created_at AS entryCreatedAt,
          COALESCE(json_extract(entry_audit.details_json,'$.operatorName'),operator.display_name) AS operatorName,
          e.note AS entryNote
        FROM inventory_units iu
        JOIN entries e ON e.id=iu.entry_id AND e.store_id=iu.store_id
        JOIN products p ON p.id=iu.product_id AND p.store_id=iu.store_id
        JOIN users operator ON operator.id=e.operator_user_id AND operator.store_id=e.store_id
        LEFT JOIN audit_events entry_audit ON entry_audit.store_id=e.store_id
          AND entry_audit.entity_id=e.id AND entry_audit.action='entry.created'
        WHERE iu.store_id=? AND iu.serial IN (${aliases.map(() => '?').join(',')})
        ORDER BY CASE WHEN iu.serial=? THEN 0 ELSE 1 END LIMIT 1`,
      )
      .bind(storeId, ...aliases, serial)
      .first<UnitRow>();
    if (!unit)
      throw new HttpError(404, 'SN não encontrado.', 'SERIAL_NOT_FOUND');

    const [saleResult, photoResult] = await db.batch([
      db
        .prepare(
          `SELECT si.id AS itemId,s.id,s.number,s.created_at AS createdAt,s.status,
            s.cancelled_at AS cancelledAt,cancelled_by.display_name AS cancelledByName,
            s.cancellation_reason AS cancellationReason,s.customer_name AS customerName,
            s.seller_name AS sellerName,si.sold_price_cents AS soldPriceCents,
            si.reference_price_cents AS referencePriceCents
          FROM sale_items si JOIN sales s ON s.id=si.sale_id AND s.store_id=si.store_id
          LEFT JOIN users cancelled_by ON cancelled_by.id=s.cancelled_by AND cancelled_by.store_id=s.store_id
          WHERE si.store_id=? AND si.inventory_unit_id=?
          ORDER BY s.created_at,s.id`,
        )
        .bind(storeId, unit.id),
      db
        .prepare(
          `SELECT id,entry_id AS entryId,sale_item_id AS saleItemId,file_name AS name,
            mime_type AS mimeType,size_bytes AS sizeBytes
          FROM attachments WHERE store_id=? AND
            ((kind='entry_photo' AND entry_id=?) OR
             (kind='item_photo' AND sale_item_id IN
               (SELECT id FROM sale_items WHERE store_id=? AND inventory_unit_id=?)))
          ORDER BY created_at,id`,
        )
        .bind(storeId, unit.entryId, storeId, unit.id),
    ]);

    const photos = (photoResult.results as PhotoRow[]).map((photo) => ({
      ...photo,
      sizeBytes: Number(photo.sizeBytes),
      url: `/api/files/${encodeURIComponent(photo.id)}`,
    }));
    const sales = (saleResult.results as SaleRow[]).map(
      (sale): SerialHistorySale => ({
        id: sale.id,
        createdAt: Number(sale.createdAt),
        status: sale.status,
        customerName: sale.customerName,
        sellerName: sale.sellerName,
        number: Number(sale.number),
        cancelledAt:
          sale.cancelledAt === null ? null : Number(sale.cancelledAt),
        cancelledByName: sale.cancelledByName,
        cancellationReason: sale.cancellationReason,
        soldPriceCents: Number(sale.soldPriceCents),
        referencePriceCents: Number(sale.referencePriceCents),
        photos: photos
          .filter((photo) => photo.saleItemId === sale.itemId)
          .map(
            ({ entryId: _entryId, saleItemId: _saleItemId, ...photo }) => photo,
          ),
      }),
    );
    const response: SerialHistoryResponse = {
      canViewEntryDetails,
      canViewSaleDetails,
      unit: {
        id: unit.id,
        serial: unit.serial,
        productName: unit.productName,
        productDetail: unit.productDetail,
        status: unit.status,
      },
      entry: {
        id: unit.entryId,
        createdAt: Number(unit.entryCreatedAt),
        operatorName: unit.operatorName,
        note: unit.entryNote,
        photos: photos
          .filter((photo) => photo.entryId === unit.entryId)
          .map(
            ({ entryId: _entryId, saleItemId: _saleItemId, ...photo }) => photo,
          ),
      },
      sales,
    };
    return json(
      restrictSerialHistoryDetails(response, {
        entries: canViewEntryDetails,
        sales: canViewSaleDetails,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
