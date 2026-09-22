export type ReservationItem = {
  unitId: string;
  serial: string;
  product: string;
  detail: string;
  defaultPriceCents: number;
};
export type ReservationRecord = {
  id: string;
  customerId: string;
  customerName: string;
  operatorName: string;
  expiresAt: number;
  createdAt: number;
  status: 'active' | 'expired' | 'released' | 'converted';
  saleId: string | null;
  saleNumber: number | null;
  notes: string;
  revision: number;
  items: ReservationItem[];
};
export type ReservationPage = {
  items: ReservationRecord[];
  nextOffset: number | null;
};
export const reservationLabels = {
  active: 'Ativa',
  expired: 'Vencida',
  released: 'Liberada',
  converted: 'Convertida em venda',
};
