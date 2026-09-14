import type { AttachmentRecord } from './pdv-types.ts';

export type SerialHistoryEntry = {
  id: string;
  createdAt: number;
  operatorName: string | null;
  note: string | null;
  photos: AttachmentRecord[];
};

export type SerialHistorySale = {
  id: string;
  number: number;
  createdAt: number;
  status: 'completed' | 'cancelled';
  cancelledAt: number | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  customerName: string | null;
  sellerName: string | null;
  soldPriceCents: number | null;
  referencePriceCents: number | null;
  photos: AttachmentRecord[];
};

export type SerialHistoryResponse = {
  canViewEntryDetails: boolean;
  canViewSaleDetails: boolean;
  unit: {
    id: string;
    serial: string;
    productName: string;
    productDetail: string;
    status: 'available' | 'sold';
  };
  entry: SerialHistoryEntry;
  sales: SerialHistorySale[];
};

export function serialMatchingQuery(serials: string[], query: string) {
  const normalizedQuery = query.replace(/[^a-z0-9]/gi, '').toUpperCase();
  // Numeric searches are sale numbers, values or dates. Apple serials are
  // alphanumeric, so only switch a result row into SN-history mode when the
  // user actually typed a plausible serial fragment.
  if (normalizedQuery.length < 5 || !/[A-Z]/.test(normalizedQuery)) return null;
  return (
    serials.find((serial) =>
      serial
        .replace(/[^a-z0-9]/gi, '')
        .toUpperCase()
        .includes(normalizedQuery),
    ) ?? null
  );
}

export function restrictSerialHistoryDetails(
  history: SerialHistoryResponse,
  access: { entries: boolean; sales: boolean },
): SerialHistoryResponse {
  return {
    ...history,
    canViewEntryDetails: access.entries,
    canViewSaleDetails: access.sales,
    entry: access.entries
      ? history.entry
      : {
          ...history.entry,
          operatorName: null,
          note: null,
          photos: [],
        },
    sales: access.sales
      ? history.sales
      : history.sales.map((sale) => ({
          ...sale,
          cancelledByName: null,
          cancellationReason: null,
          customerName: null,
          sellerName: null,
          soldPriceCents: null,
          referencePriceCents: null,
          photos: [],
        })),
  };
}

export type SerialMovement =
  | {
      key: string;
      kind: 'entry';
      at: number;
      entry: SerialHistoryEntry;
    }
  | {
      key: string;
      kind: 'sale';
      at: number;
      sale: SerialHistorySale;
    }
  | {
      key: string;
      kind: 'cancellation';
      at: number;
      sale: SerialHistorySale;
    };

export function serialMovements(history: SerialHistoryResponse) {
  const movements: SerialMovement[] = [
    {
      key: `entry:${history.entry.id}`,
      kind: 'entry',
      at: history.entry.createdAt,
      entry: history.entry,
    },
  ];
  for (const sale of history.sales) {
    movements.push({
      key: `sale:${sale.id}`,
      kind: 'sale',
      at: sale.createdAt,
      sale,
    });
    if (sale.status === 'cancelled' && sale.cancelledAt !== null)
      movements.push({
        key: `cancellation:${sale.id}`,
        kind: 'cancellation',
        at: sale.cancelledAt,
        sale,
      });
  }
  return movements.sort((left, right) => left.at - right.at);
}
