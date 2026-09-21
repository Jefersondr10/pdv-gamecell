import type { Permission } from './permissions';
export const GUIDE_VERSION = '2026.09.13-comprovantes-historico-sn-v26';

export type AppRole = 'owner' | 'admin' | 'operator';

export const ORDER_STATUS_COLORS = [
  'slate',
  'blue',
  'amber',
  'orange',
  'green',
  'red',
  'purple',
  'pink',
] as const;

export type OrderStatusColor = (typeof ORDER_STATUS_COLORS)[number];

export type AttachmentRecord = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

export type ReceiptAttachmentRecord = AttachmentRecord & {
  receiptDetails?: import('./receipt-document').ReceiptDocument | null;
  receiptReviewReason?: string | null;
  receiptPaymentId?: string | null;
  receiptOcrStatus?: string | null;
  receiptAmountCents: number | null;
  receiptAmountSource: 'ocr' | 'manual' | null;
  receiptAmountConfirmedAt: number | null;
};

export type ProductRecord = {
  id: string;
  model: string;
  color: string;
  memory: string;
  detail: string;
  defaultPriceCents: number;
  active: boolean;
  codes: Array<{
    id: string;
    code: string;
    kind: string;
    market: string | null;
  }>;
};

export type InventoryUnitRecord = {
  id: string;
  productId: string;
  entryId: string;
  serial: string;
  status: 'available' | 'sold';
  saleId: string | null;
  createdAt: number;
};

export type StockSummaryRecord = {
  productId: string;
  received: number;
  available: number;
  sold: number;
};

export type InventoryDetailRecord = {
  id: string;
  productId: string;
  entryId: string;
  productName: string;
  productDetail: string;
  serial: string;
  status: 'available' | 'sold';
  saleId: string | null;
  saleNumber: number | null;
  createdAt: number;
  photos: AttachmentRecord[];
};

export type InventoryPage = {
  items: InventoryDetailRecord[];
  nextCursor: string | null;
  total: number | null;
};

export type StockSummaryResponse = {
  rows: StockSummaryRecord[];
  availableTotal: number;
};

export type ClientRecord = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
};

export type PixAccountRecord = {
  id: string;
  name: string;
  details: string | null;
  receiptBank?: string | null;
  receiptRecipientDocument?: string | null;
  active: boolean;
};

export type OrderStatusRecord = {
  id: string;
  name: string;
  color: OrderStatusColor;
  active: boolean;
};

export type EntryRecord = {
  id: string;
  productId: string;
  productName: string;
  productDetail: string;
  quantity: number;
  operatorName: string;
  createdAt: number;
  serials: string[];
  photos: AttachmentRecord[];
};

export type SaleItemRecord = {
  id: string;
  productId: string;
  productName: string;
  productDetail: string;
  serial: string;
  referencePriceCents: number;
  soldPriceCents: number;
  photos: AttachmentRecord[];
};

export type SalePaymentRecord = {
  createdAt?: number;
  id: string;
  method: 'pix' | 'cash';
  pixAccountId: string | null;
  accountName: string | null;
  amountCents: number;
};

export type SaleRecord = {
  id: string;
  number: number;
  customerId: string | null;
  customerName: string;
  sellerName: string;
  orderStatus: Pick<OrderStatusRecord, 'id' | 'name' | 'color'> | null;
  productsTotalCents: number;
  receivedTotalCents: number;
  receivedDifferenceCents: number;
  referenceTotalCents: number;
  priceDifferenceCents: number;
  status: 'completed' | 'cancelled';
  createdAt: number;
  cancelledAt: number | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  items: SaleItemRecord[];
  payments: SalePaymentRecord[];
  receipts: ReceiptAttachmentRecord[];
  reconciliation: import('./receipt-reconciliation').ReceiptReconciliation;
};

export type SalesGroupRecord = {
  key: string;
  label: string;
  saleCount: number;
  itemCount: number;
  totalCents: number;
  rankByItems?: number | null;
  rankByValue?: number | null;
};

export type SalesGrouping = 'model' | 'customer' | 'seller';

export type RankingDimension = 'customer' | 'seller' | 'product';
export type RankingOrder = 'items' | 'value';
export type RankingRecord = SalesGroupRecord & {
  position: number;
  color: string | null;
  memory: string | null;
};
export type RankingPage = {
  items: RankingRecord[];
  nextOffset: number | null;
  totals: { participants: number; itemCount: number; amountCents: number };
};

export type SalesAggregates = {
  amountCents: number;
  saleCount: number;
  itemCount: number;
  alertCount: number;
};

export type SalesComparison = {
  aggregates: SalesAggregates;
  label: string;
};

export type SalesPage = {
  items: SaleRecord[];
  groups: SalesGroupRecord[];
  nextCursor: string | null;
  total: number;
  aggregates: SalesAggregates;
  comparison: SalesComparison | null;
};

export type ClientHistoryPage = Omit<SalesPage, 'items'> & {
  items: (Pick<
    SaleRecord,
    | 'id'
    | 'number'
    | 'customerId'
    | 'customerName'
    | 'sellerName'
    | 'orderStatus'
    | 'productsTotalCents'
    | 'receivedTotalCents'
    | 'status'
    | 'createdAt'
    | 'cancelledAt'
    | 'cancellationReason'
  > & {
    automaticStatus: import('./sale-display-status').SystemSaleStatusKey | null;
    displayStatus: import('./sale-display-status').SaleDisplayStatus;
    issueKeys: import('./sale-display-status').SaleIssueKey[];
    pixCents: number;
    cashCents: number;
    items: Pick<
      SaleItemRecord,
      'id' | 'productName' | 'productDetail' | 'serial' | 'soldPriceCents'
    >[];
  })[];
};

export type SalesAnalytics = {
  groups: Record<SalesGrouping, SalesGroupRecord[]>;
  total: number;
  aggregates: SalesAggregates;
  comparison: SalesComparison | null;
};

export type SalesGroupDetailRecord = {
  id: string;
  serial: string;
  productId: string;
  productName: string;
  productDetail: string;
  referencePriceCents: number;
  soldPriceCents: number;
  saleId: string;
  saleNumber: number;
  saleCreatedAt: number;
  customerName: string;
  sellerName: string;
};

export type SalesGroupDetailPage = {
  items: SalesGroupDetailRecord[];
  nextCursor: string | null;
};

export type EntriesPage = {
  items: EntryRecord[];
  nextCursor: string | null;
  total: number;
  aggregates: {
    entryCount: number;
    unitCount: number;
    photoCount: number;
  };
};

export type UserRecord = {
  id: string;
  displayName: string;
  username: string | null;
  email: string | null;
  role: AppRole;
  permissions?: Permission[];
  authKind: 'google' | 'password';
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
};

export type BootstrapData = {
  serverReceiptOcr: boolean;
  csrfToken: string;
  user: UserRecord & { photoUrl: string | null };
  store: { id: string; name: string; code: string };
  products: ProductRecord[];
  clients: ClientRecord[];
  pixAccounts: PixAccountRecord[];
  orderStatuses: OrderStatusRecord[];
  metrics: { soldTodayItems: number };
  users: UserRecord[];
  sellers: Array<Pick<UserRecord, 'id' | 'displayName'>>;
  systemCatalog: {
    currentVersion: number;
    syncedVersion: number;
    updateAvailable: boolean;
  };
  guideRequired: boolean;
  guideVersion: string;
};
