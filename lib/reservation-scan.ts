import type { InventoryDetailRecord } from './pdv-types';
import type { ScanCandidate } from './scanner';

export type ReservationUnit = Pick<
  InventoryDetailRecord,
  'id' | 'serial' | 'productName' | 'productDetail' | 'status'
>;

export type ReservationSerialMatch = {
  unitId: string;
  serial: string;
  status: ReservationUnit['status'];
  product: string;
  detail: string;
  defaultPriceCents: number;
};

// Use the exact, store-scoped serial lookup, never the first text-search result.
export async function resolveReservationScan(
  candidate: ScanCandidate,
  lookup: (
    query: URLSearchParams,
  ) => Promise<{ matches: ReservationSerialMatch[] }>,
): Promise<ReservationUnit> {
  const query = new URLSearchParams({ serial: candidate.normalizedValue });
  if (candidate.alternateValue)
    query.append('serial', candidate.alternateValue);
  const { matches } = await lookup(query);
  const unique = [
    ...new Map(matches.map((item) => [item.unitId, item])).values(),
  ];
  if (!unique.length)
    throw new Error('SN não encontrado nesta loja. Confira a etiqueta.');
  if (unique.length > 1)
    throw new Error(
      'SN com mais de um resultado. Pesquise no estoque e escolha o aparelho.',
    );
  const item = unique[0];
  if (item.status === 'sold')
    throw new Error('Este aparelho já foi vendido. Leia outro SN.');
  if (item.status === 'reserved')
    throw new Error('Este aparelho já está reservado. Leia outro SN.');
  if (item.status !== 'available')
    throw new Error('Este aparelho não está disponível para reserva.');
  return {
    id: item.unitId,
    serial: item.serial,
    status: item.status,
    productName: item.product,
    productDetail: item.detail,
  };
}

export function addReservationUnit(
  selected: ReservationUnit[],
  item: ReservationUnit,
) {
  if (selected.some((entry) => entry.id === item.id))
    throw new Error(`SN ${item.serial} já está selecionado nesta reserva.`);
  if (selected.length >= 50)
    throw new Error('Limite de 50 aparelhos por reserva.');
  if (item.status !== 'available')
    throw new Error('Este aparelho não está disponível para reserva.');
  return [...selected, item];
}
