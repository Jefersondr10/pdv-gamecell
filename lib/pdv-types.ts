export const GUIDE_VERSION = '2026.09.05-production-multiloja-v1';

export type AppRole = 'owner' | 'admin' | 'operator';

export type AttachmentRecord = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

export type ProductRecord = {
  id: string;
  model: string;
  color: string;
  memory: string;
  detail: string;
  defaultPriceCents: number;
  active: boolean;
  codes: Array<{ id: string; code: string; kind: string }>;
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
  id: string;
  method: 'pix' | 'cash';
  accountName: string | null;
  amountCents: number;
};

export type SaleRecord = {
  id: string;
  number: number;
  customerId: string | null;
  customerName: string;
  sellerName: string;
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
  receipts: AttachmentRecord[];
};

export type SalesGroupRecord = {
  key: string;
  label: string;
  saleCount: number;
  itemCount: number;
  totalCents: number;
};

export type SalesPage = {
  items: SaleRecord[];
  groups: SalesGroupRecord[];
  nextCursor: string | null;
  total: number;
  aggregates: {
    amountCents: number;
    itemCount: number;
    alertCount: number;
  };
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
  authKind: 'google' | 'password';
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
};

export type BootstrapData = {
  csrfToken: string;
  user: UserRecord & { photoUrl: string | null };
  store: { id: string; name: string; code: string };
  products: ProductRecord[];
  clients: ClientRecord[];
  pixAccounts: PixAccountRecord[];
  metrics: { soldTodayItems: number };
  users: UserRecord[];
  guideRequired: boolean;
  guideVersion: string;
};
