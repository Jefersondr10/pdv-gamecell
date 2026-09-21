import assert from 'node:assert/strict';
import type { SaleRecord } from '../lib/pdv-types.ts';
import type { SalePrices } from '../lib/sale-prices.ts';
import {
  automaticSaleStatus,
  saleDisplayStatus,
  saleIssues,
  SALE_ISSUES,
  type SaleDisplayStatus,
  type SaleIssueKey,
} from '../lib/sale-display-status.ts';
import { defaultPermissions, type Permission } from '../lib/permissions.ts';
import { prepareUploadForm } from '../lib/client-upload.ts';
import { productEditorPayload } from '../lib/product-editor.ts';
import {
  SYSTEM_CATALOG_PRODUCTS,
  SYSTEM_CATALOG_VERSION,
} from '../lib/system-catalog.ts';

const baseUrl = process.env.PDV_TEST_ORIGIN ?? 'http://127.0.0.1:3004';
const targetHost = new URL(baseUrl).hostname;
const localTarget =
  targetHost === 'localhost' ||
  targetHost === '127.0.0.1' ||
  targetHost === '::1';
assert.ok(
  localTarget || process.env.PDV_TEST_ALLOW_REMOTE === '1',
  'O teste cria dados. Para uma origem remota, defina PDV_TEST_ALLOW_REMOTE=1 explicitamente.',
);
const maintenanceBypass = process.env.PDV_TEST_BYPASS;
const primaryStoreToken = process.env.PDV_TEST_PRIMARY_TOKEN;
const runId = Date.now().toString(36);
const testSourceIp =
  process.env.PDV_TEST_SOURCE_IP ??
  `198.51.100.${((Date.now() % 200) + 1).toString()}`;
let ownerCookie = '';
let ownerCsrf = '';

type JsonValue = Record<string, unknown>;

async function call(
  path: string,
  options: RequestInit & { cookie?: string; expected?: number | number[] } = {},
) {
  const headers = new Headers(options.headers);
  headers.set('origin', baseUrl);
  if (maintenanceBypass) {
    headers.set('x-production-maintenance-bypass', maintenanceBypass);
  }
  headers.set('cf-connecting-ip', testSourceIp);
  if (options.cookie) headers.set('cookie', options.cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as JsonValue) : {};
  const expected = options.expected ?? 200;
  const acceptedStatuses = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    acceptedStatuses.includes(response.status),
    `${path}: esperado ${acceptedStatuses.join(' ou ')}, recebido ${response.status}: ${text}`,
  );
  return { response, body };
}

function sessionCookie(response: Response) {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'A resposta não retornou o cookie de sessão.');
  return value.split(';', 1)[0];
}

function jsonBody(value: unknown) {
  return {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

function tinyPhoto() {
  return new Blob(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
    { type: 'image/png' },
  );
}

function tinyPdf() {
  return new Blob(
    ['%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'],
    { type: 'application/pdf' },
  );
}

const ownerPayload = {
  displayName: 'Proprietário Integração',
  email: `owner-${runId}@example.com`,
  password: 'Producao12345',
  storeName: `Loja Integração ${runId}`,
  storeCode: `loja-${runId}`,
};
const crossOriginSignup = await fetch(`${baseUrl}/api/auth/register-owner`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: 'https://untrusted.example',
  },
  body: JSON.stringify(ownerPayload),
});
assert.equal(crossOriginSignup.status, 403);
await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 403,
  ...jsonBody({ ...ownerPayload, storeCode: 'atacadoapple' }),
});
const weakSignup = await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 400,
  ...jsonBody({ ...ownerPayload, password: 'weak' }),
});
assert.equal(weakSignup.body.code, 'WEAK_PASSWORD');
const registration = await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 201,
  ...jsonBody(ownerPayload),
});
const duplicateEmailSignup = await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 409,
  ...jsonBody({ ...ownerPayload, storeCode: `duplicate-email-${runId}` }),
});
assert.equal(duplicateEmailSignup.body.code, 'EMAIL_EXISTS');
const duplicateStoreSignup = await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 409,
  ...jsonBody({
    ...ownerPayload,
    email: `duplicate-store-${runId}@example.com`,
  }),
});
assert.equal(duplicateStoreSignup.body.code, 'STORE_CODE_EXISTS');
ownerCookie = sessionCookie(registration.response);
const initialRecoveryCodes = registration.body.recoveryCodes as string[];
assert.equal(initialRecoveryCodes.length, 8);

const session = await call('/api/auth/session', { cookie: ownerCookie });
ownerCsrf = String(session.body.csrfToken);
assert.equal(session.body.authenticated, true);

const emptyBootstrap = await call('/api/bootstrap', { cookie: ownerCookie });
assert.deepEqual(emptyBootstrap.body.products, []);
assert.deepEqual(emptyBootstrap.body.clients, []);
assert.deepEqual(emptyBootstrap.body.pixAccounts, []);
assert.deepEqual(emptyBootstrap.body.orderStatuses, []);
assert.equal('inventory' in emptyBootstrap.body, false);

const emptyStock = await call('/api/inventory?view=summary', {
  cookie: ownerCookie,
});
assert.deepEqual(emptyStock.body.rows, []);
await call('/api/inventory?view=whatsapp', { expected: 401 });
assert.deepEqual(
  (await call('/api/inventory?view=whatsapp', { cookie: ownerCookie })).body
    .rows,
  [],
);
await call('/api/clients', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: 'null',
});
for (const endpoint of ['/api/entries', '/api/sales']) {
  const invalidForm = new FormData();
  invalidForm.set('payload', '{');
  const invalidPayload = await call(endpoint, {
    method: 'POST',
    cookie: ownerCookie,
    expected: 400,
    headers: { 'x-csrf-token': ownerCsrf },
    body: invalidForm,
  });
  assert.equal(invalidPayload.body.code, 'INVALID_PAYLOAD');
}

const product = await call('/api/products', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'iPhone Integração',
    color: 'Preto',
    memory: '256 GB',
    defaultPriceCents: 500_000,
    codes: ['036000291452'],
  }),
});
const productId = String(product.body.id);
const catalogAfterProduct = await call('/api/bootstrap', {
  cookie: ownerCookie,
});
const primaryCodeId = String(
  (
    catalogAfterProduct.body.products as Array<{
      id: string;
      codes: Array<{ id: string }>;
    }>
  ).find((item) => item.id === productId)!.codes[0].id,
);
const additionalCode = await call(`/api/products/${productId}/codes`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ code: '04252614' }),
});
const catalogWithUpce = await call('/api/bootstrap', { cookie: ownerCookie });
const upceCode = (
  catalogWithUpce.body.products as Array<{
    id: string;
    codes: Array<{ id: string; code: string; kind: string }>;
  }>
)
  .find((item) => item.id === productId)!
  .codes.find((code) => code.id === String(additionalCode.body.id));
assert.equal(upceCode?.code, '00042100005264');
assert.equal(upceCode?.kind, 'UPC');
await call(
  `/api/products/${productId}/codes/${String(additionalCode.body.id)}`,
  {
    method: 'DELETE',
    cookie: ownerCookie,
    headers: { 'x-csrf-token': ownerCsrf },
  },
);
const lastCode = await call(
  `/api/products/${productId}/codes/${primaryCodeId}`,
  {
    method: 'DELETE',
    cookie: ownerCookie,
    expected: 409,
    headers: { 'x-csrf-token': ownerCsrf },
  },
);
assert.equal(lastCode.body.code, 'LAST_PRODUCT_CODE');
await call(`/api/products/${productId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ active: false }),
});
await call(`/api/products/${productId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    active: true,
    defaultPriceCents: 500_000,
    expected: { defaultPriceCents: 500_000 },
  }),
});
const imeiAsSerialForm = new FormData();
imeiAsSerialForm.set(
  'payload',
  JSON.stringify({
    productId,
    gtin14: '00036000291452',
    serials: ['S353915104521117'],
  }),
);
imeiAsSerialForm.append('photos', tinyPhoto(), 'imei-invalido.png');
const invalidSerial = await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: { 'x-csrf-token': ownerCsrf },
  body: imeiAsSerialForm,
});
assert.equal(invalidSerial.body.code, 'INVALID_SERIALS');

const client = await call('/api/clients', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Cliente Integração' }),
});
const clientId = String(client.body.id);
const normalizedDuplicate = await call('/api/clients', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: '  CLIENTE   INTEGRACAO  ' }),
});
assert.equal(normalizedDuplicate.body.code, 'CLIENT_ALREADY_EXISTS');
const concurrentClients = await Promise.all(
  ['Conect teste', '  CONÉCT   TESTE  '].map((name) =>
    call('/api/clients', {
      method: 'POST',
      cookie: ownerCookie,
      expected: [201, 409],
      headers: {
        'x-csrf-token': ownerCsrf,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ operationId: crypto.randomUUID(), name }),
    }),
  ),
);
assert.deepEqual(
  concurrentClients
    .map((result) => result.response.status)
    .sort((a, b) => a - b),
  [201, 409],
);
const secondClientId = String(
  concurrentClients.find((result) => result.response.status === 201)!.body.id,
);
const renameCollision = await call(`/api/clients/${secondClientId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'cliente integração',
    expected: { name: 'Conect teste' },
  }),
});
assert.equal(renameCollision.body.code, 'CLIENT_ALREADY_EXISTS');
await call(`/api/clients/${clientId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    phone: '(11) 99999-0000',
    active: false,
    expected: { phone: null },
  }),
});
await call('/api/clients', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'cliente integração' }),
});
await call(`/api/clients/${clientId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ active: true }),
});

const pix = await call('/api/pix-accounts', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Pix Integração',
    details: 'Conta de ensaio local',
  }),
});
const pixId = String(pix.body.id);
const duplicatePix = await call('/api/pix-accounts', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Pix Integração' }),
});
assert.equal(duplicatePix.body.code, 'PIX_ACCOUNT_EXISTS');
await call(`/api/pix-accounts/${pixId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ details: 'Conta atualizada', active: false }),
});
await call(`/api/pix-accounts/${pixId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ active: true }),
});

const automaticNameConflict = await call('/api/order-statuses', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Conciliado', color: 'green' }),
});
assert.equal(automaticNameConflict.body.code, 'SYSTEM_STATUS_NAME');
const pendingStatus = await call('/api/order-statuses', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Aguardando retirada', color: 'amber' }),
});
const pendingStatusId = String((pendingStatus.body.item as { id: string }).id);
const duplicateStatus = await call('/api/order-statuses', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'aguardando RETIRADA', color: 'red' }),
});
assert.equal(duplicateStatus.body.code, 'ORDER_STATUS_EXISTS');
await call(`/api/order-statuses/${pendingStatusId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Aguardando retirada', color: 'orange' }),
});
const orderStatuses = await call('/api/order-statuses', {
  cookie: ownerCookie,
});
assert.equal((orderStatuses.body.items as unknown[]).length, 1);
// Every pending status is computed, so a manually assigned label cannot imitate it.
for (const { label } of SALE_ISSUES) {
  const rejected = await call('/api/order-statuses', {
    method: 'POST',
    cookie: ownerCookie,
    expected: 400,
    headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
    body: JSON.stringify({ name: label, color: 'amber' }),
  });
  assert.equal(rejected.body.code, 'SYSTEM_STATUS_NAME');
  await call(`/api/order-statuses/${pendingStatusId}`, {
    method: 'PATCH',
    cookie: ownerCookie,
    expected: 400,
    headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
    body: JSON.stringify({ name: label }),
  });
}
for (const active of [false, true])
  await call(`/api/order-statuses/${pendingStatusId}`, {
    method: 'PATCH',
    cookie: ownerCookie,
    headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
    body: JSON.stringify({ active }),
  });

const entryOperationId = crypto.randomUUID();
const entryPayload = {
  operationId: entryOperationId,
  productId,
  gtin14: '00036000291452',
  serials: ['HC9P06R095', 'SHC9P06R096'],
};
const entryForm = new FormData();
entryForm.set('payload', JSON.stringify(entryPayload));
entryForm.append('photos', tinyPhoto(), 'entrada.png');
const entry = await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf },
  body: entryForm,
});
const entryId = String(entry.body.id);
const replayEntryForm = new FormData();
replayEntryForm.set('payload', JSON.stringify(entryPayload));
const replayedEntry = await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf },
  body: replayEntryForm,
});
assert.equal(replayedEntry.body.id, entryId);
assert.equal(replayedEntry.body.replayed, true);
const conflictingEntryForm = new FormData();
conflictingEntryForm.set(
  'payload',
  JSON.stringify({
    ...entryPayload,
    serials: ['HC9P06R095', 'HC9P06R097'],
  }),
);
const conflictingEntry = await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf },
  body: conflictingEntryForm,
});
assert.equal(conflictingEntry.body.code, 'OPERATION_ALREADY_USED');

const duplicateForm = new FormData();
duplicateForm.set(
  'payload',
  JSON.stringify({
    productId,
    gtin14: '00036000291452',
    serials: ['HC9P06R095'],
  }),
);
duplicateForm.append('photos', tinyPhoto(), 'duplicada.png');
const duplicate = await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf },
  body: duplicateForm,
});
assert.equal(duplicate.body.code, 'SERIAL_EXISTS');

const entries = await call('/api/entries?limit=50', { cookie: ownerCookie });
assert.equal(entries.body.total, 1);
assert.equal((entries.body.items as unknown[]).length, 1);

const availableLookup = await call('/api/inventory/lookup?serial=HC9P06R095', {
  cookie: ownerCookie,
});
assert.equal(
  (availableLookup.body.matches as Array<{ status: string }>)[0].status,
  'available',
);
const prefixedLookup = await call('/api/inventory/lookup?serial=SHC9P06R096', {
  cookie: ownerCookie,
});
assert.equal(
  (prefixedLookup.body.matches as Array<{ serial: string; status: string }>)[0]
    .serial,
  'SHC9P06R096',
);
assert.equal(
  (prefixedLookup.body.matches as Array<{ status: string }>)[0].status,
  'available',
);
const unprefixedLookup = await call('/api/inventory/lookup?serial=HC9P06R096', {
  cookie: ownerCookie,
});
assert.equal(
  (
    unprefixedLookup.body.matches as Array<{
      serial: string;
      status: string;
    }>
  )[0].serial,
  'SHC9P06R096',
);
const availableStock = await call('/api/inventory?view=summary', {
  cookie: ownerCookie,
});
for (const serial of ['HC9P06R095', 'SHC9P06R095', 'hc9p06r096']) {
  const search = await call(`/api/inventory?view=serial-search&q=${serial}`, {
    cookie: ownerCookie,
  });
  assert.deepEqual(search.body.productIds, [productId]);
  assert.equal('items' in search.body, false);
  assert.equal('photos' in search.body, false);
}
assert.equal(
  (availableStock.body.rows as Array<{ available: number }>)[0].available,
  2,
);
const inventoryPage = await call('/api/inventory?limit=50&includePhotos=1', {
  cookie: ownerCookie,
});
assert.equal(inventoryPage.body.total, 2);
assert.equal((inventoryPage.body.items as unknown[]).length, 2);
const availableOffer = await call(
  '/api/inventory?view=whatsapp&q=not-a-match&limit=10&includePhotos=1',
  { cookie: ownerCookie },
);
const offerRows = availableOffer.body.rows as Array<Record<string, unknown>>;
assert.equal(offerRows.length, 1);
assert.deepEqual(offerRows[0], {
  model: 'iPhone Integração',
  color: 'Preto',
  memory: '256 GB',
  defaultPriceCents: 500_000,
});
assert.ok(Number.isFinite(availableOffer.body.generatedAt));

// Deactivation is reversible catalog management, not deletion of real stock.
const productBeforeStatus = (
  (await call('/api/bootstrap', { cookie: ownerCookie })).body
    .products as Array<{ id: string; active: boolean }>
).find((row) => row.id === productId)!;
await call(`/api/products/${productId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ active: false }),
});
const inactiveProduct = (
  (await call('/api/bootstrap', { cookie: ownerCookie })).body
    .products as Array<{ id: string; active: boolean }>
).find((row) => row.id === productId)!;
assert.equal(inactiveProduct.active, false);
assert.deepEqual({ ...inactiveProduct, active: true }, productBeforeStatus);
assert.deepEqual(
  (await call('/api/inventory?view=summary', { cookie: ownerCookie })).body,
  availableStock.body,
);
assert.deepEqual(
  (
    await call('/api/inventory?limit=50&includePhotos=1', {
      cookie: ownerCookie,
    })
  ).body,
  inventoryPage.body,
);
assert.deepEqual(
  (await call('/api/entries?limit=50', { cookie: ownerCookie })).body,
  entries.body,
);
assert.deepEqual(
  (await call('/api/inventory?view=whatsapp', { cookie: ownerCookie })).body
    .rows,
  offerRows,
);
assert.equal(
  (
    (
      await call('/api/inventory/lookup?serial=HC9P06R095', {
        cookie: ownerCookie,
      })
    ).body.matches as { status: string }[]
  )[0].status,
  'available',
);
const inactiveEntryForm = new FormData();
inactiveEntryForm.set(
  'payload',
  JSON.stringify({
    operationId: crypto.randomUUID(),
    productId,
    gtin14: '00036000291452',
    serials: ['HC9P06R098'],
  }),
);
inactiveEntryForm.append('photos', tinyPhoto(), 'entrada-bloqueada.png');
const inactiveEntry = await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf },
  body: inactiveEntryForm,
});
assert.equal(inactiveEntry.body.code, 'PRODUCT_CODE_CHANGED');
assert.deepEqual(
  (
    await call('/api/inventory?limit=50&includePhotos=1', {
      cookie: ownerCookie,
    })
  ).body,
  inventoryPage.body,
);

const saleOperationId = crypto.randomUUID();
const salePayload = {
  operationId: saleOperationId,
  customerId: clientId,
  items: [
    { serial: 'HC9P06R095', priceCents: 450_000 },
    { serial: 'HC9P06R096', priceCents: 450_000 },
  ],
  payments: [],
  receiptValues: [{ amountCents: 850_000, source: 'manual' }],
};
const rejectedManualPixSale = new FormData();
rejectedManualPixSale.set(
  'payload',
  JSON.stringify({
    ...salePayload,
    operationId: crypto.randomUUID(),
    payments: [{ method: 'pix', pixAccountId: pixId, amountCents: 850_000 }],
    receiptValues: [],
  }),
);
const rejectedManualPixCreate = await call('/api/sales', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: { 'x-csrf-token': ownerCsrf },
  body: rejectedManualPixSale,
});
assert.equal(rejectedManualPixCreate.body.code, 'PIX_FROM_RECEIPT');
const saleForm = new FormData();
saleForm.set('payload', JSON.stringify(salePayload));
saleForm.append('itemPhotos:0', tinyPhoto(), 'aparelho-1.png');
saleForm.append('itemPhotos:1', tinyPhoto(), 'aparelho-2.png');
saleForm.append('receipts', tinyPdf(), 'comprovante-inicial.pdf');
const sale = await call('/api/sales', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf },
  body: saleForm,
});
assert.equal(sale.body.number, 1);
assert.equal((sale.body.receipts as unknown[]).length, 1);
assert.equal(sale.body.receivedTotalCents, 850_000);
assert.equal(sale.body.receivedDifferenceCents, -50_000);
const saleId = String(sale.body.id);
const saleReceipt = (
  sale.body.receipts as Array<{
    id: string;
    mimeType: string;
    name: string;
    sizeBytes: number;
    url: string;
  }>
)[0];
if (process.env.PDV_TEST_ISOLATED_DATA_DIR) {
  const { DatabaseSync } = await import('node:sqlite');
  const fixturePath = await import('node:path');
  const fixtureDb = new DatabaseSync(
    fixturePath.join(process.env.PDV_TEST_ISOLATED_DATA_DIR, 'pdv.sqlite'),
  );
  const details = JSON.parse(
    fixtureDb
      .prepare(
        "SELECT details_json AS details FROM audit_events WHERE entity_id=? AND action='sale.created'",
      )
      .get(saleId)!.details as string,
  ) as Record<string, unknown>;
  fixtureDb.close();
  assert.equal(details.receivedTotalCents, 850_000);
  assert.equal(details.receivedDifferenceCents, -50_000);
  assert.equal(details.operationFingerprintVersion, 2);
  assert.equal(typeof details.operationFingerprint, 'string');
  assert.equal(typeof details.operationPayloadFingerprint, 'string');
  assert.equal((details.attachmentIds as unknown[]).length, 3);
  assert.deepEqual(details.receipts, sale.body.receipts);
}
const changedReceiptFileReplay = new FormData();
changedReceiptFileReplay.set('payload', JSON.stringify(salePayload));
changedReceiptFileReplay.append('itemPhotos:0', tinyPhoto(), 'aparelho-1.png');
changedReceiptFileReplay.append('itemPhotos:1', tinyPhoto(), 'aparelho-2.png');
changedReceiptFileReplay.append(
  'receipts',
  new Blob(
    [
      '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% conteúdo diferente\ntrailer<</Root 1 0 R>>\n%%EOF',
    ],
    { type: 'application/pdf' },
  ),
  'comprovante-inicial.pdf',
);
assert.equal(
  (
    await call('/api/sales', {
      method: 'POST',
      cookie: ownerCookie,
      expected: 409,
      headers: { 'x-csrf-token': ownerCsrf },
      body: changedReceiptFileReplay,
    })
  ).body.code,
  'OPERATION_ALREADY_USED',
);
let initialReceiptPayment = (
  await call(`/api/sales/${saleId}/receipt-payment`, { cookie: ownerCookie })
).body;
for (let attempt = 0; attempt < 30; attempt++) {
  if (
    (initialReceiptPayment.payments as Array<{ method: string }>).some(
      (payment) => payment.method === 'pix',
    )
  )
    break;
  await new Promise((resolve) => setTimeout(resolve, 200));
  initialReceiptPayment = (
    await call(`/api/sales/${saleId}/receipt-payment`, { cookie: ownerCookie })
  ).body;
}
assert.equal(initialReceiptPayment.receivedTotalCents, 850_000);
assert.equal(
  (initialReceiptPayment.payments as Array<{ method: string }>)[0].method,
  'pix',
);
// Existing SNs of an inactive product can still be sold; reactivation changes no records.
const historyBeforeReactivation = await call(
  '/api/sales?period=all&group=sale',
  { cookie: ownerCookie },
);
await call(`/api/products/${productId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ active: true }),
});
assert.deepEqual(
  (
    (await call('/api/bootstrap', { cookie: ownerCookie })).body.products as {
      id: string;
    }[]
  ).find((row) => row.id === productId),
  productBeforeStatus,
);
assert.deepEqual(
  (await call('/api/sales?period=all&group=sale', { cookie: ownerCookie }))
    .body,
  historyBeforeReactivation.body,
);
console.log(
  'Product activation: reversible status, unchanged codes/prices/photos/history, rejected new entries, existing stock remains sellable and exportable.',
);
const replaySaleForm = new FormData();
replaySaleForm.set('payload', JSON.stringify(salePayload));
const replayedSale = await call('/api/sales', {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf },
  body: replaySaleForm,
});
assert.equal(replayedSale.body.id, saleId);
assert.equal(replayedSale.body.number, 1);
assert.equal(replayedSale.body.replayed, true);
assert.equal((replayedSale.body.receipts as unknown[]).length, 1);
const conflictingSaleForm = new FormData();
conflictingSaleForm.set(
  'payload',
  JSON.stringify({
    ...salePayload,
    receiptValues: [{ amountCents: 849_999, source: 'manual' }],
  }),
);
const conflictingSale = await call('/api/sales', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf },
  body: conflictingSaleForm,
});
assert.equal(conflictingSale.body.code, 'OPERATION_ALREADY_USED');

const soldLookup = await call('/api/inventory/lookup?serial=HC9P06R095', {
  cookie: ownerCookie,
});
assert.equal(
  (soldLookup.body.matches as Array<{ status: string }>)[0].status,
  'sold',
);
const soldStock = await call('/api/inventory?view=summary', {
  cookie: ownerCookie,
});
assert.equal((soldStock.body.rows as Array<{ sold: number }>)[0].sold, 2);
assert.deepEqual(
  (await call('/api/inventory?view=whatsapp', { cookie: ownerCookie })).body
    .rows,
  [],
);
const soldProductDetails = await call(
  `/api/inventory?productId=${encodeURIComponent(productId)}&status=sold&limit=50&includePhotos=1`,
  { cookie: ownerCookie },
);
assert.equal(soldProductDetails.body.total, 2);
const soldInventoryItems = soldProductDetails.body.items as Array<{
  id: string;
  status: string;
  saleId: string | null;
  saleNumber: number | null;
  photos: unknown[];
}>;
assert.deepEqual(
  soldInventoryItems.map((item) => item.status),
  ['sold', 'sold'],
);
assert.ok(soldInventoryItems.every((item) => item.photos.length === 1));
assert.ok(soldInventoryItems.every((item) => item.saleId === saleId));
assert.ok(soldInventoryItems.every((item) => item.saleNumber === 1));
const exactInventoryUnit = await call(
  `/api/inventory?unitId=${encodeURIComponent(soldInventoryItems[0].id)}&status=all&limit=10&includePhotos=1`,
  { cookie: ownerCookie },
);
assert.equal(exactInventoryUnit.body.total, 1);
assert.equal(
  (exactInventoryUnit.body.items as Array<{ saleId: string }>)[0].saleId,
  saleId,
);

const sales = await call('/api/sales?group=sale&limit=50', {
  cookie: ownerCookie,
});
assert.equal(sales.body.total, 1);
assert.equal(
  (sales.body.items as Array<{ items: unknown[] }>)[0].items.length,
  2,
);
assert.equal(
  (sales.body.aggregates as { amountCents: number }).amountCents,
  900_000,
);
assert.equal((sales.body.aggregates as { alertCount: number }).alertCount, 1);
const alertedSales = await call(
  '/api/sales?group=sale&limit=50&period=all&alert=1',
  { cookie: ownerCookie },
);
assert.equal(alertedSales.body.total, 1);
const listedSale = (
  sales.body.items as Array<{
    id: string;
    orderStatus: unknown;
    items: Array<{ id: string; photos: unknown[] }>;
    receipts: unknown[];
  }>
)[0];
assert.equal(listedSale.orderStatus, null);

const partialPaymentOperationId = crypto.randomUUID();
const partialPaymentPayload = {
  operationId: partialPaymentOperationId,
  method: 'cash',
  pixAccountId: null,
  amountCents: 25_000,
};
const partialPayment = await call(`/api/sales/${saleId}/payments`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify(partialPaymentPayload),
});
assert.equal(
  (partialPayment.body.sale as { receivedTotalCents: number })
    .receivedTotalCents,
  875_000,
);
assert.equal(
  (partialPayment.body.sale as { receivedDifferenceCents: number })
    .receivedDifferenceCents,
  -25_000,
);
const replayedPayment = await call(`/api/sales/${saleId}/payments`, {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify(partialPaymentPayload),
});
assert.equal(replayedPayment.body.replayed, true);
assert.equal(
  (replayedPayment.body.sale as { receivedTotalCents: number })
    .receivedTotalCents,
  875_000,
);
const conflictingPayment = await call(`/api/sales/${saleId}/payments`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    ...partialPaymentPayload,
    amountCents: 25_001,
  }),
});
assert.equal(conflictingPayment.body.code, 'OPERATION_ALREADY_USED');
const excessivePayment = await call(`/api/sales/${saleId}/payments`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    method: 'cash',
    pixAccountId: null,
    amountCents: 25_001,
  }),
});
assert.equal(excessivePayment.body.code, 'PAYMENT_EXCEEDS_BALANCE');
const invalidPixPayment = await call(`/api/sales/${saleId}/payments`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    method: 'pix',
    pixAccountId: crypto.randomUUID(),
    amountCents: 1,
  }),
});
assert.equal(invalidPixPayment.body.code, 'PIX_FROM_RECEIPT');

const concurrentPaymentOperationId = crypto.randomUUID();
const concurrentCashPayload = JSON.stringify({
  operationId: concurrentPaymentOperationId,
  method: 'cash',
  pixAccountId: null,
  amountCents: 25_000,
});
const [concurrentCash, replayedConcurrentCash] = await Promise.all([
  call(`/api/sales/${saleId}/payments`, {
    method: 'POST',
    cookie: ownerCookie,
    expected: [200, 201],
    headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
    body: concurrentCashPayload,
  }),
  call(`/api/sales/${saleId}/payments`, {
    method: 'POST',
    cookie: ownerCookie,
    expected: [200, 201],
    headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
    body: concurrentCashPayload,
  }),
]);
assert.deepEqual(
  [concurrentCash.response.status, replayedConcurrentCash.response.status].sort(
    (left, right) => left - right,
  ),
  [200, 201],
);
assert.ok(
  [concurrentCash, replayedConcurrentCash].some(
    (response) => response.body.replayed === true,
  ),
);
const paidSales = await call('/api/sales?group=sale&limit=50&period=all', {
  cookie: ownerCookie,
});
const paidSale = (
  paidSales.body.items as Array<{
    receivedTotalCents: number;
    receivedDifferenceCents: number;
    payments: unknown[];
  }>
)[0];
assert.equal(paidSale.receivedTotalCents, 900_000);
assert.equal(paidSale.receivedDifferenceCents, 0);
assert.equal(paidSale.payments.length, 3);
assert.equal(
  (paidSales.body.aggregates as { alertCount: number }).alertCount,
  0,
);
const alreadyPaid = await call(`/api/sales/${saleId}/payments`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    method: 'cash',
    pixAccountId: null,
    amountCents: 1,
  }),
});
assert.equal(alreadyPaid.body.code, 'SALE_ALREADY_PAID');

type EditablePayment = {
  id: string;
  method: 'pix' | 'cash';
  pixAccountId: string | null;
  amountCents: number;
};
const originalPayments = (paidSale.payments as EditablePayment[]).map(
  ({ id, method, pixAccountId, amountCents }) => ({
    id,
    method,
    pixAccountId,
    amountCents,
  }),
);
const editableCashPayment = originalPayments.find(
  (payment) => payment.method === 'cash',
)!;
const correctionPayload = {
  operationId: crypto.randomUUID(),
  expectedPayments: originalPayments,
  payments: originalPayments.map((payment) =>
    payment.id === editableCashPayment.id
      ? {
          ...payment,
          amountCents: payment.amountCents - 10_000,
        }
      : payment,
  ),
};
const correctPayment = (
  payload: unknown,
  expected: number | number[] = 200,
  csrf = ownerCsrf,
) =>
  call(`/api/sales/${saleId}/payments`, {
    method: 'PATCH',
    cookie: ownerCookie,
    expected,
    headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
await correctPayment(correctionPayload, 403, 'wrong-csrf');
const correctedPayment = await correctPayment(correctionPayload);
assert.equal(
  (correctedPayment.body.sale as { receivedTotalCents: number })
    .receivedTotalCents,
  890_000,
);
assert.equal(
  (correctedPayment.body.sale as { receivedDifferenceCents: number })
    .receivedDifferenceCents,
  -10_000,
);
const replayedCorrection = await correctPayment(correctionPayload);
assert.equal(replayedCorrection.body.replayed, true);
await correctPayment({ ...correctionPayload, payments: originalPayments }, 409);
await correctPayment(
  { ...correctionPayload, operationId: crypto.randomUUID() },
  409,
);
await correctPayment(
  {
    operationId: crypto.randomUUID(),
    expectedPayments: correctionPayload.payments,
    payments: correctionPayload.payments.map((payment) =>
      payment.id === editableCashPayment.id
        ? { ...payment, amountCents: 0 }
        : payment,
    ),
  },
  400,
);
const forbiddenPixCorrection = await correctPayment(
  {
    operationId: crypto.randomUUID(),
    expectedPayments: correctionPayload.payments,
    payments: correctionPayload.payments.map((payment) =>
      payment.id === editableCashPayment.id
        ? { ...payment, method: 'pix', pixAccountId: crypto.randomUUID() }
        : payment,
    ),
  },
  400,
);
assert.equal(forbiddenPixCorrection.body.code, 'PIX_FROM_RECEIPT');
const overpaidPayments = correctionPayload.payments.map((payment) =>
  payment.id === editableCashPayment.id
    ? {
        ...payment,
        amountCents: payment.amountCents + 20_000,
      }
    : payment,
);
const overpaidCorrection = await correctPayment({
  operationId: crypto.randomUUID(),
  expectedPayments: correctionPayload.payments,
  payments: overpaidPayments,
});
assert.equal(
  (overpaidCorrection.body.sale as { receivedDifferenceCents: number })
    .receivedDifferenceCents,
  10_000,
);
const restoredCorrection = await correctPayment({
  operationId: crypto.randomUUID(),
  expectedPayments: overpaidPayments,
  payments: originalPayments,
});
assert.equal(
  (restoredCorrection.body.sale as { receivedDifferenceCents: number })
    .receivedDifferenceCents,
  0,
);
assert.equal((restoredCorrection.body.payments as unknown[]).length, 3);
const replayOlderCorrection = await correctPayment(correctionPayload);
assert.equal(replayOlderCorrection.body.replayed, true);
assert.equal(
  (replayOlderCorrection.body.sale as { receivedTotalCents: number })
    .receivedTotalCents,
  900_000,
);
// A repetição de uma correção antiga não reaplica seus valores sobre os atuais.

const replayAfterPaymentForm = new FormData();
replayAfterPaymentForm.set('payload', JSON.stringify(salePayload));
const replayAfterPayment = await call('/api/sales', {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf },
  body: replayAfterPaymentForm,
});
assert.equal(replayAfterPayment.body.id, saleId);
assert.equal(replayAfterPayment.body.replayed, true);
assert.equal(replayAfterPayment.body.receivedTotalCents, 850_000);
assert.equal(replayAfterPayment.body.receivedDifferenceCents, -50_000);

await call(`/api/sales/${saleId}/receipt-values`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    receipts: [{ id: saleReceipt.id, amountCents: 840_000, source: 'manual' }],
  }),
});
await call(`/api/sales/${saleId}/order-status`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ orderStatusId: pendingStatusId }),
});
const manualSale = (
  await call(`/api/sales?period=all&saleId=${saleId}`, { cookie: ownerCookie })
).body.items as SaleRecord[];
assert.equal(saleDisplayStatus(manualSale[0]).key, 'pending_payment');
assert.equal(saleDisplayStatus(manualSale[0]).label, 'Pagamento incompleto');
assert.equal(manualSale[0].orderStatus?.name, 'Aguardando retirada');
assert.ok(saleIssues(manualSale[0]).length > 0);
assert.equal(
  (
    await call(
      `/api/sales?period=all&saleId=${saleId}&orderStatus=${pendingStatusId}&statusScope=display`,
      { cookie: ownerCookie },
    )
  ).body.total,
  0,
);
const disguisedAttachment = new FormData();
disguisedAttachment.set('operationId', crypto.randomUUID());
disguisedAttachment.append(
  'receipts',
  new Blob(['arquivo disfarçado'], { type: 'image/png' }),
  'comprovante-falso.png',
);
const rejectedDisguisedAttachment = await call(
  `/api/sales/${saleId}/attachments`,
  {
    method: 'POST',
    cookie: ownerCookie,
    expected: 400,
    headers: { 'x-csrf-token': ownerCsrf },
    body: disguisedAttachment,
  },
);
assert.equal(rejectedDisguisedAttachment.body.code, 'INVALID_FILE_SIGNATURE');
const appendedAttachments = new FormData();
const appendedAttachmentOperationId = crypto.randomUUID();
appendedAttachments.set('operationId', appendedAttachmentOperationId);
appendedAttachments.append(
  `itemPhotos:${listedSale.items[0].id}`,
  tinyPhoto(),
  'foto-depois.png',
);
const appended = await call(`/api/sales/${saleId}/attachments`, {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf },
  body: appendedAttachments,
});
assert.equal(appended.body.receiptsAdded, 0);
assert.equal(appended.body.itemPhotosAdded, 1);
const appendedReceipt = saleReceipt;
assert.equal(appendedReceipt.name, 'comprovante-inicial.pdf');
assert.equal(appendedReceipt.mimeType, 'application/pdf');
assert.ok(appendedReceipt.sizeBytes > 0);
assert.equal(appendedReceipt.url, `/api/files/${appendedReceipt.id}`);

const replayedAttachments = await call(`/api/sales/${saleId}/attachments`, {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf },
  body: appendedAttachments,
});
assert.equal(replayedAttachments.body.replayed, true);
assert.equal(replayedAttachments.body.addedCount, 1);
assert.deepEqual(replayedAttachments.body.receipts, []);

const conflictingAttachments = new FormData();
conflictingAttachments.set('operationId', appendedAttachmentOperationId);
conflictingAttachments.append('receipts', tinyPhoto(), 'outro-comprovante.png');
const conflictingAttachmentResult = await call(
  `/api/sales/${saleId}/attachments`,
  {
    method: 'POST',
    cookie: ownerCookie,
    expected: 409,
    headers: { 'x-csrf-token': ownerCsrf },
    body: conflictingAttachments,
  },
);
assert.equal(conflictingAttachmentResult.body.code, 'OPERATION_ALREADY_USED');

const storedFileHeaders = new Headers({
  cookie: ownerCookie,
  'cf-connecting-ip': testSourceIp,
});
if (maintenanceBypass) {
  storedFileHeaders.set('x-production-maintenance-bypass', maintenanceBypass);
}
const storedFile = await fetch(`${baseUrl}${appendedReceipt.url}`, {
  headers: storedFileHeaders,
});
assert.equal(storedFile.status, 200);
assert.equal(
  storedFile.headers.get('cache-control'),
  'private, no-cache, must-revalidate',
);
const storedFileEtag = storedFile.headers.get('etag');
assert.ok(storedFileEtag);
assert.ok((await storedFile.arrayBuffer()).byteLength > 0);
const revalidationHeaders = new Headers(storedFileHeaders);
revalidationHeaders.set('if-none-match', storedFileEtag);
const revalidatedFile = await fetch(`${baseUrl}${appendedReceipt.url}`, {
  headers: revalidationHeaders,
});
assert.equal(revalidatedFile.status, 304);

const salePixProofCents = originalPayments
  .filter((payment) => payment.method === 'pix')
  .reduce((sum, payment) => sum + payment.amountCents, 0);
await call(`/api/sales/${saleId}/receipt-values`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    receipts: [
      {
        id: appendedReceipt.id,
        amountCents: salePixProofCents,
        source: 'manual',
      },
    ],
  }),
});
const protectedAutomaticOperationId = crypto.randomUUID();
const protectedAutomaticPayload = JSON.stringify({
  operationId: protectedAutomaticOperationId,
  onlyIfPending: true,
  receipts: [{ id: appendedReceipt.id, amountCents: 1, source: 'ocr' }],
});
const protectedAutomaticValue = await call(
  `/api/sales/${saleId}/receipt-values`,
  {
    method: 'PATCH',
    cookie: ownerCookie,
    headers: {
      'x-csrf-token': ownerCsrf,
      'content-type': 'application/json',
    },
    body: protectedAutomaticPayload,
  },
);
assert.equal(protectedAutomaticValue.body.updatedCount, 0);
const replayedProtectedAutomaticValue = await call(
  `/api/sales/${saleId}/receipt-values`,
  {
    method: 'PATCH',
    cookie: ownerCookie,
    headers: {
      'x-csrf-token': ownerCsrf,
      'content-type': 'application/json',
    },
    body: protectedAutomaticPayload,
  },
);
assert.equal(replayedProtectedAutomaticValue.body.replayed, true);
assert.equal(replayedProtectedAutomaticValue.body.updatedCount, 0);

await call(`/api/order-statuses/${pendingStatusId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ active: false }),
});
const editedSales = await call('/api/sales?group=sale&limit=50&period=all', {
  cookie: ownerCookie,
});
const editedSale = (
  editedSales.body.items as Array<{
    orderStatus: { id: string; name: string; color: string } | null;
    items: Array<{ id: string; photos: unknown[] }>;
    receipts: Array<{
      id: string;
      receiptAmountCents: number | null;
      receiptAmountSource: string | null;
    }>;
  }>
)[0];
assert.equal(editedSale.orderStatus?.id, pendingStatusId);
assert.equal(editedSale.orderStatus?.name, 'Aguardando retirada');
assert.equal(editedSale.orderStatus?.color, 'orange');
assert.equal(editedSale.receipts.length, 1);
assert.equal(editedSale.receipts[0].receiptAmountCents, salePixProofCents);
assert.equal(editedSale.receipts[0].receiptAmountSource, 'manual');
assert.equal(
  saleDisplayStatus(editedSale as unknown as SaleRecord).key,
  'reconciled',
);
assert.equal(
  (
    await call(
      `/api/sales?period=all&saleId=${saleId}&orderStatus=${pendingStatusId}&statusScope=display`,
      { cookie: ownerCookie },
    )
  ).body.total,
  0,
);
assert.equal(
  (
    await call(
      `/api/sales?period=all&saleId=${saleId}&orderStatus=${pendingStatusId}`,
      { cookie: ownerCookie },
    )
  ).body.total,
  1,
);
assert.equal(
  (editedSales.body.aggregates as { alertCount: number }).alertCount,
  0,
);
const clearedAlerts = await call(
  '/api/sales?group=sale&limit=50&period=all&alert=1',
  { cookie: ownerCookie },
);
assert.equal(clearedAlerts.body.total, 0);
const exactSale = await call(
  `/api/sales?group=sale&period=all&saleId=${encodeURIComponent(saleId)}`,
  { cookie: ownerCookie },
);
assert.equal(exactSale.body.total, 1);
assert.equal((exactSale.body.items as Array<{ id: string }>)[0].id, saleId);
assert.equal(
  editedSale.items.find((item) => item.id === listedSale.items[0].id)?.photos
    .length,
  2,
);
await call(`/api/sales/${saleId}/order-status`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ orderStatusId: null }),
});
const inactiveAssignment = await call(`/api/sales/${saleId}/order-status`, {
  method: 'PATCH',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ orderStatusId: pendingStatusId }),
});
assert.equal(inactiveAssignment.body.code, 'ORDER_STATUS_INVALID');
await call(`/api/order-statuses/${pendingStatusId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ active: true }),
});
await call(`/api/sales/${saleId}/order-status`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ orderStatusId: pendingStatusId }),
});
const longSearch = encodeURIComponent('ação'.repeat(40));
await call(`/api/sales?group=sale&q=${longSearch}`, { cookie: ownerCookie });
await call(`/api/entries?q=${longSearch}`, { cookie: ownerCookie });
await call(`/api/inventory?q=${longSearch}`, { cookie: ownerCookie });

const grouped = await call('/api/sales?group=model', { cookie: ownerCookie });
assert.equal(
  (grouped.body.groups as Array<{ itemCount: number }>)[0].itemCount,
  2,
);

type TestedGroup = {
  key: string;
  label: string;
  saleCount: number;
  itemCount: number;
  totalCents: number;
  rankByItems?: number;
  rankByValue?: number;
};
const analytics = await call('/api/sales?group=all&period=all', {
  cookie: ownerCookie,
});
const analyticsGroups = analytics.body.groups as {
  model: TestedGroup[];
  customer: TestedGroup[];
  seller: TestedGroup[];
};
assert.equal(analyticsGroups.model[0].itemCount, 2);
assert.equal(analyticsGroups.customer[0].label, 'Cliente Integração');
assert.equal(analyticsGroups.customer[0].totalCents, 900_000);
assert.equal(analyticsGroups.seller[0].label, 'Proprietário Integração');
assert.equal(analyticsGroups.seller[0].rankByItems, 1);
assert.equal(analyticsGroups.seller[0].rankByValue, 1);

for (const period of ['today', '7d', '15d'] as const) {
  const filtered = await call(`/api/sales?group=sale&period=${period}`, {
    cookie: ownerCookie,
  });
  assert.equal(filtered.body.total, 1);
}
const yesterdaySales = await call('/api/sales?group=sale&period=yesterday', {
  cookie: ownerCookie,
});
assert.equal(yesterdaySales.body.total, 0);
const currentMonthParts = Object.fromEntries(
  new Intl.DateTimeFormat('en', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .map((part) => [part.type, part.value]),
);
const currentMonth = `${currentMonthParts.year}-${currentMonthParts.month}`;
const currentDay = `${currentMonth}-${currentMonthParts.day}`;
const selectedDaySales = await call(
  `/api/sales?group=sale&period=day&day=${currentDay}`,
  { cookie: ownerCookie },
);
assert.equal(selectedDaySales.body.total, 1);
const monthSales = await call(
  `/api/sales?group=sale&period=month&month=${currentMonth}`,
  { cookie: ownerCookie },
);
assert.equal(monthSales.body.total, 1);

for (const dimension of ['model', 'customer', 'seller'] as const) {
  const group = analyticsGroups[dimension][0];
  const params = new URLSearchParams({
    dimension,
    key: group.key,
    period: 'all',
  });
  const details = await call(`/api/sales/groups?${params.toString()}`, {
    cookie: ownerCookie,
  });
  const detailRows = details.body.items as Array<{
    serial: string;
    sellerName: string;
  }>;
  assert.deepEqual(detailRows.map((item) => item.serial).sort(), [
    'HC9P06R095',
    'SHC9P06R096',
  ]);
  assert.equal(detailRows[0].sellerName, 'Proprietário Integração');
}

await call('/api/sales?group=all&period=month&month=2026-13', {
  cookie: ownerCookie,
  expected: 400,
});
await call('/api/sales?group=all&period=day&day=2026-02-31', {
  cookie: ownerCookie,
  expected: 400,
});
await call('/api/sales?group=sale&period=all&alert=yes', {
  cookie: ownerCookie,
  expected: 400,
});

const cancellationOperationId = crypto.randomUUID();
await call(`/api/sales/${saleId}/cancel`, {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: cancellationOperationId,
    reason: 'Cancelamento do ensaio local',
  }),
});
const replayedCancellation = await call(`/api/sales/${saleId}/cancel`, {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: cancellationOperationId,
    reason: 'Cancelamento do ensaio local',
  }),
});
assert.equal(replayedCancellation.body.replayed, true);
const cancelledPayment = await call(`/api/sales/${saleId}/payments`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    method: 'cash',
    pixAccountId: null,
    amountCents: 1,
  }),
});
assert.equal(cancelledPayment.body.code, 'SALE_CANCELLED');
const cancelledCorrection = await correctPayment(
  { ...correctionPayload, operationId: crypto.randomUUID() },
  409,
);
assert.equal(cancelledCorrection.body.code, 'SALE_CANCELLED');
const cancelledAttachment = new FormData();
cancelledAttachment.set('operationId', crypto.randomUUID());
cancelledAttachment.append('receipts', tinyPhoto(), 'cancelada.png');
await call(`/api/sales/${saleId}/attachments`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf },
  body: cancelledAttachment,
});
await call(`/api/sales/${saleId}/cancel`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    reason: 'Segunda tentativa de cancelamento',
  }),
});

const afterCancel = await call('/api/inventory/lookup?serial=HC9P06R095', {
  cookie: ownerCookie,
});
assert.equal(
  (afterCancel.body.matches as Array<{ status: string }>)[0].status,
  'available',
);

const invalidRoleUser = await call('/api/users', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    displayName: 'Função inválida',
    username: `papel-${runId}`,
    password: 'Temporaria12345',
    role: 'owner',
  }),
});
assert.equal(invalidRoleUser.body.code, 'INVALID_ROLE');

await call('/api/users', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    displayName: 'Operador Integração',
    username: `operador-${runId}`,
    password: 'Inicial12345',
    role: 'operator',
  }),
});

const staffLogin = await call('/api/auth/login', {
  method: 'POST',
  ...jsonBody({
    mode: 'staff',
    storeCode: `loja-${runId}`,
    username: `operador-${runId}`,
    password: 'Inicial12345',
  }),
});
let staffCookie = sessionCookie(staffLogin.response);
const staffSession = await call('/api/auth/session', { cookie: staffCookie });
assert.equal(
  (staffSession.body.user as { mustChangePassword: boolean })
    .mustChangePassword,
  true,
);
const staffCsrf = String(staffSession.body.csrfToken);
await call('/api/bootstrap', { cookie: staffCookie, expected: 403 });
const changedPassword = await call('/api/me/password', {
  method: 'POST',
  cookie: staffCookie,
  headers: { 'x-csrf-token': staffCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    currentPassword: 'Inicial12345',
    newPassword: 'Pessoal67890',
  }),
});
staffCookie = sessionCookie(changedPassword.response);
const changedStaffSession = await call('/api/auth/session', {
  cookie: staffCookie,
});
const changedStaffCsrf = String(changedStaffSession.body.csrfToken);
await call(`/api/products/${productId}`, {
  method: 'PATCH',
  cookie: staffCookie,
  expected: 403,
  headers: {
    'x-csrf-token': changedStaffCsrf,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ active: false }),
});
await call('/api/bootstrap', { cookie: staffCookie });
await call('/api/inventory?view=whatsapp', { cookie: staffCookie });

const staffClientName = `Cliente operador ${runId}`;
const staffClientOperationId = crypto.randomUUID();
const staffClientPayload = {
  operationId: staffClientOperationId,
  name: staffClientName,
  phone: '11955550999',
};
const staffClient = await call('/api/clients', {
  method: 'POST',
  cookie: staffCookie,
  expected: 201,
  headers: {
    'x-csrf-token': changedStaffCsrf,
    'content-type': 'application/json',
  },
  body: JSON.stringify(staffClientPayload),
});
const staffClientId = String(staffClient.body.id);
const replayedStaffClient = await call('/api/clients', {
  method: 'POST',
  cookie: staffCookie,
  headers: {
    'x-csrf-token': changedStaffCsrf,
    'content-type': 'application/json',
  },
  body: JSON.stringify(staffClientPayload),
});
assert.equal(replayedStaffClient.body.id, staffClientId);
assert.equal(replayedStaffClient.body.replayed, true);
const conflictingStaffClient = await call('/api/clients', {
  method: 'POST',
  cookie: staffCookie,
  expected: 409,
  headers: {
    'x-csrf-token': changedStaffCsrf,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ ...staffClientPayload, name: 'Outro cliente' }),
});
assert.equal(conflictingStaffClient.body.code, 'OPERATION_REUSED');

const activeSaleForm = new FormData();
const activeSaleOperationId = crypto.randomUUID();
activeSaleForm.set(
  'payload',
  JSON.stringify({
    operationId: activeSaleOperationId,
    customerId: staffClientId,
    items: [{ serial: 'HC9P06R095', priceCents: 500_000 }],
    payments: [],
  }),
);
activeSaleForm.append('itemPhotos:0', tinyPhoto(), 'aparelho-ativo.png');
const activeSale = await call('/api/sales', {
  method: 'POST',
  cookie: staffCookie,
  expected: 201,
  headers: { 'x-csrf-token': changedStaffCsrf },
  body: activeSaleForm,
});
assert.equal(activeSale.body.number, 2);
assert.equal(activeSale.body.receivedTotalCents, 0);
assert.equal(activeSale.body.receivedDifferenceCents, -500_000);
const unpaidSales = await call(
  '/api/sales?group=sale&period=all&alert=1&limit=50',
  { cookie: staffCookie },
);
const unpaidSale = (
  unpaidSales.body.items as Array<{
    id: string;
    customerName: string;
    payments: unknown[];
    receipts: unknown[];
  }>
).find((item) => item.id === String(activeSale.body.id));
assert.equal(unpaidSale?.customerName, staffClientName);
assert.deepEqual(unpaidSale?.payments, []);
assert.deepEqual(unpaidSale?.receipts, []);

const activeSaleId = String(activeSale.body.id);
const completedPendingPayment = await call(
  `/api/sales/${activeSaleId}/payments`,
  {
    method: 'POST',
    cookie: staffCookie,
    expected: 201,
    headers: {
      'x-csrf-token': changedStaffCsrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      method: 'cash',
      pixAccountId: null,
      amountCents: 500_000,
    }),
  },
);
assert.equal(
  (completedPendingPayment.body.sale as { receivedDifferenceCents: number })
    .receivedDifferenceCents,
  0,
);
const missingReceiptAlerts = await call(
  '/api/sales?group=sale&period=all&alert=1&limit=50',
  { cookie: staffCookie },
);
assert.equal(
  (missingReceiptAlerts.body.items as Array<{ id: string }>).some(
    (item) => item.id === activeSaleId,
  ),
  false,
);
const cashOnlySale = (
  (
    await call(`/api/sales?period=all&saleId=${activeSaleId}`, {
      cookie: staffCookie,
    })
  ).body.items as SaleRecord[]
)[0];
assert.equal(cashOnlySale.reconciliation.status, 'not_required');
assert.equal(automaticSaleStatus(cashOnlySale)?.key, 'reconciled');
const activeReceipt = new FormData();
activeReceipt.set('operationId', crypto.randomUUID());
activeReceipt.append('receipts', tinyPhoto(), 'comprovante-operador.png');
await call(`/api/sales/${activeSaleId}/attachments`, {
  method: 'POST',
  cookie: staffCookie,
  headers: { 'x-csrf-token': changedStaffCsrf },
  body: activeReceipt,
});
const completedSaleAlerts = await call(
  '/api/sales?group=sale&period=all&alert=1&limit=50',
  { cookie: staffCookie },
);
assert.ok(
  (completedSaleAlerts.body.items as Array<{ id: string }>).some(
    (item) => item.id === activeSaleId,
  ),
);

// Client history is exact-ID scoped and includes cancellations without counting
// them as purchases. Operators have the same read access as the sales screen.
const pastClient = await call(`/api/sales?period=all&customerId=${clientId}`, {
  cookie: staffCookie,
});
assert.equal(pastClient.body.total, 1);
assert.equal(
  (pastClient.body.aggregates as { saleCount: number }).saleCount,
  0,
);
assert.equal(
  (pastClient.body.items as { status: string }[])[0].status,
  'cancelled',
);
const staffHistory = await call(
  `/api/sales?period=all&customerId=${staffClientId}`,
  { cookie: staffCookie },
);
assert.equal(staffHistory.body.total, 1);
assert.equal((staffHistory.body.items as { id: string }[])[0].id, activeSaleId);
for (const dimension of ['customer', 'seller', 'product']) {
  const ranked = await call(`/api/rankings?period=all&dimension=${dimension}`, {
    cookie: staffCookie,
  });
  const rows = ranked.body.items as {
    key: string;
    position: number;
    itemCount: number;
    totalCents: number;
  }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].position, 1);
  assert.equal(rows[0].itemCount, 1);
  assert.equal(rows[0].totalCents, 500_000);
  if (dimension === 'customer') assert.equal(rows[0].key, staffClientId);
  if (dimension === 'product') {
    const detail = await call(
      `/api/sales/groups?period=all&dimension=product&key=${rows[0].key}`,
      { cookie: staffCookie },
    );
    assert.ok(
      (detail.body.items as { productId: string }[]).every(
        (row) => row.productId === rows[0].key,
      ),
    );
  }
}
await call('/api/rankings?dimension=customer', { expected: 401 });
await call('/api/rankings?dimension=invalid', {
  cookie: ownerCookie,
  expected: 400,
});
await call('/api/sales?customerId=invalid', {
  cookie: ownerCookie,
  expected: 400,
});
const isolatedOwner = await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 201,
  ...jsonBody({
    ...ownerPayload,
    email: `isolated-${runId}@example.com`,
    storeName: 'Loja isolada ranking',
    storeCode: `isolated-${runId}`,
  }),
});
const isolatedCookie = sessionCookie(isolatedOwner.response);
const isolatedRanking = await call(
  '/api/rankings?period=all&dimension=customer',
  { cookie: isolatedCookie },
);
assert.deepEqual(isolatedRanking.body.items, []);
const isolatedHistory = await call(
  `/api/sales?period=all&customerId=${staffClientId}`,
  { cookie: isolatedCookie },
);
assert.deepEqual(isolatedHistory.body.items, []);
console.log('Client history and all three rankings integration passed.');

// Overview reads metadata only and compares receipts to payments, not prices.
await call('/api/overview?period=all', { expected: 401 });
const overview = await call('/api/overview?period=all', {
  cookie: staffCookie,
});
const overviewTotals = overview.body.totals as {
  saleCount: number;
  receivedCents: number;
  cashCents: number;
  receiptCents: number;
  receiptCount: number;
  pendingCount: number;
  missingCount: number;
};
assert.equal(overviewTotals.saleCount, 1);
assert.equal(overviewTotals.receivedCents, 500_000);
assert.equal(overviewTotals.cashCents, 500_000);
assert.equal(overviewTotals.receiptCents, 0);
assert.equal(overviewTotals.receiptCount, 1);
assert.equal(overviewTotals.pendingCount, 1);
const overviewItems = overview.body.items as {
  id: string;
  receipts: { id: string; url: string; receiptAmountCents: number | null }[];
}[];
assert.equal(overviewItems[0].id, activeSaleId);
assert.equal(overviewItems[0].receipts[0].receiptAmountCents, null);
assert.ok(overviewItems[0].receipts[0].url.startsWith('/api/files/'));
assert.equal(JSON.stringify(overview.body).includes('r2Key'), false);
assert.equal(JSON.stringify(overview.body).includes('base64'), false);
await call('/api/overview?period=all&cursor=invalid', {
  cookie: staffCookie,
  expected: 400,
});
console.log(
  'Overview integration: completed sales only, paid/cash/receipt totals, pending files, lightweight metadata and operator access passed.',
);

const rotatedCodesResult = await call('/api/me/recovery-codes', {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ currentPassword: 'Producao12345' }),
});
const rotatedCodes = rotatedCodesResult.body.recoveryCodes as string[];
assert.equal(rotatedCodes.length, 8);

const recovered = await call('/api/auth/recover-password', {
  method: 'POST',
  ...jsonBody({
    email: `owner-${runId}@example.com`,
    code: rotatedCodes[0],
    newPassword: 'NovaProducao67890',
  }),
});
assert.equal((recovered.body.recoveryCodes as string[]).length, 8);
const recoveredCookie = sessionCookie(recovered.response);
await call('/api/bootstrap', { cookie: recoveredCookie });
await call('/api/bootstrap', { cookie: ownerCookie, expected: 401 });
await call('/api/auth/recover-password', {
  method: 'POST',
  expected: 401,
  ...jsonBody({
    email: `owner-${runId}@example.com`,
    code: rotatedCodes[1],
    newPassword: 'OutraProducao67890',
  }),
});
await call('/api/auth/login', {
  method: 'POST',
  expected: 401,
  ...jsonBody({
    mode: 'owner',
    email: `owner-${runId}@example.com`,
    password: 'Producao12345',
  }),
});
const recoveredLogin = await call('/api/auth/login', {
  method: 'POST',
  ...jsonBody({
    mode: 'owner',
    email: `owner-${runId}@example.com`,
    password: 'NovaProducao67890',
  }),
});
ownerCookie = sessionCookie(recoveredLogin.response);
await call('/api/bootstrap', { cookie: ownerCookie });

if (primaryStoreToken) {
  const primaryPayload = {
    displayName: 'Proprietário Principal Integração',
    email: `principal-${runId}@example.com`,
    password: 'PrincipalTeste12345',
    storeName: 'AtacadoApple Integração',
    storeCode: 'atacadoapple',
  };
  await call('/api/auth/register-owner', {
    method: 'POST',
    expected: 403,
    ...jsonBody(primaryPayload),
  });
  const primaryRegistration = await call('/api/auth/register-owner', {
    method: 'POST',
    expected: 201,
    ...jsonBody({ ...primaryPayload, setupToken: primaryStoreToken }),
  });
  assert.equal((primaryRegistration.body.recoveryCodes as string[]).length, 8);
}

const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);

// Recovery endpoints reveal only this operation's store and initiating user.
const finalSession = await call('/api/auth/session', { cookie: ownerCookie });
const ownerActor = String((finalSession.body.user as { id: string }).id);
for (const [kind, id] of [
  ['entry', entryId],
  ['sale', saleId],
]) {
  const path = `/api/operations?kind=${kind}&id=${id}&actor=${ownerActor}`;
  const lookup = await call(path, { cookie: ownerCookie });
  assert.equal(lookup.body.found, true);
  assert.equal((lookup.body.result as { id: string }).id, id);
  await call(path, { expected: 401 });
  await call(`${path}&id=${id}`, { cookie: ownerCookie, expected: 400 });
  await call(path.replace(ownerActor, crypto.randomUUID()), {
    cookie: ownerCookie,
    expected: 403,
  });
}
const backupState = await call('/api/system/backup-status', {
  cookie: ownerCookie,
});
assert.deepEqual(Object.keys(backupState.body).sort(), [
  'externalAlerts',
  'lastSuccessAt',
  'state',
]);
assert.equal(backupState.body.externalAlerts, false);
await call('/api/system/backup-status', { cookie: staffCookie, expected: 403 });

const secondShop = await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 201,
  ...jsonBody({
    ...ownerPayload,
    email: `isolation-${runId}@example.com`,
    storeCode: `isolation-${runId}`,
  }),
});
const secondShopCookie = sessionCookie(secondShop.response);
assert.deepEqual(
  (
    await call(`/api/inventory?view=whatsapp&productId=${productId}`, {
      cookie: secondShopCookie,
    })
  ).body.rows,
  [],
);
console.log(
  'WhatsApp offer API: live prices, available-only products, no quantities or attachments, authentication and tenant isolation passed.',
);
const secondSession = await call('/api/auth/session', {
  cookie: secondShopCookie,
});
const secondActor = String((secondSession.body.user as { id: string }).id);
const settingsPath = '/api/system/backup-alert-settings';
await call(settingsPath, { expected: 401 });
await call(settingsPath, { cookie: staffCookie, expected: 403 });
const emptyAlerts = await call(settingsPath, { cookie: ownerCookie });
assert.equal(emptyAlerts.body.email, null);
assert.equal(emptyAlerts.body.revision, 0);
const alertsHeaders = {
  'content-type': 'application/json',
  'x-csrf-token': String(finalSession.body.csrfToken),
};
await call(settingsPath, {
  method: 'PATCH',
  cookie: ownerCookie,
  expected: 403,
  ...jsonBody({ email: 'test@example.com', revision: 0 }),
});
for (const payload of [
  { email: 'not-an-email', revision: 0 },
  { email: 'a@example.com\r\nBcc:b@example.com', revision: 0 },
  { email: 'a@example.com', revision: -1 },
  { email: 'a@example.com', revision: 0, storeId: 'other' },
])
  await call(settingsPath, {
    method: 'PATCH',
    cookie: ownerCookie,
    expected: 400,
    headers: alertsHeaders,
    body: JSON.stringify(payload),
  });
await call(settingsPath, {
  method: 'PATCH',
  cookie: ownerCookie,
  expected: 409,
  headers: alertsHeaders,
  body: JSON.stringify({ email: 'a@example.com', revision: 99 }),
});
const savedAlerts = await call(settingsPath, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: alertsHeaders,
  body: JSON.stringify({ email: ' Owner+Backups@Example.COM ', revision: 0 }),
});
assert.equal(savedAlerts.body.email, 'owner+backups@example.com');
assert.equal(savedAlerts.body.deliveryStatus, 'not_configured');
assert.equal(
  (await call(settingsPath, { cookie: ownerCookie })).body.email,
  'owner+backups@example.com',
);
assert.equal(
  (await call(settingsPath, { cookie: secondShopCookie })).body.email,
  null,
);
const competing = await Promise.all(
  ['first@example.com', 'second@example.com'].map((email) =>
    call(settingsPath, {
      method: 'PATCH',
      cookie: ownerCookie,
      expected: [200, 409],
      headers: alertsHeaders,
      body: JSON.stringify({ email, revision: 1 }),
    }),
  ),
);
assert.equal(
  competing.filter((result) => result.response.status === 200).length,
  1,
);
assert.equal(
  competing.filter((result) => result.response.status === 409).length,
  1,
);
const removedAlerts = await call(settingsPath, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: alertsHeaders,
  body: JSON.stringify({ email: '', revision: 2 }),
});
assert.equal(removedAlerts.body.email, null);
assert.equal(removedAlerts.body.revision, 3);
console.log(
  'Backup email settings: validation, persistence, owner access, tenant isolation, concurrent changes and removal passed.',
);
const isolatedLookup = await call(
  `/api/operations?kind=sale&id=${saleId}&actor=${secondActor}`,
  { cookie: secondShopCookie },
);
assert.equal(isolatedLookup.body.found, false);
const isolatedOcr = await call(`/api/sales/${activeSaleId}/receipt-ocr`, {
  cookie: secondShopCookie,
  expected: 404,
});
assert.equal(isolatedOcr.body.code, 'SALE_NOT_FOUND');
const foreignSnSearch = await call(
  '/api/inventory?view=serial-search&q=HC9P06R095',
  { cookie: secondShopCookie },
);
assert.deepEqual(foreignSnSearch.body.productIds, []);
const soldSnSearch = await call(
  '/api/inventory?view=serial-search&q=HC9P06R095',
  { cookie: ownerCookie },
);
assert.deepEqual(soldSnSearch.body.productIds, [productId]);
const isolatedOverview = await call('/api/overview?period=all', {
  cookie: secondShopCookie,
});
assert.equal(
  (isolatedOverview.body.totals as { saleCount: number }).saleCount,
  0,
);
assert.deepEqual(isolatedOverview.body.items, []);
await call(overviewItems[0].receipts[0].url, {
  cookie: secondShopCookie,
  expected: 404,
});
// Receipt values become Pix income while the existing cash remains untouched.
await call(`/api/sales/${activeSaleId}/receipt-values`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': String(finalSession.body.csrfToken),
  },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    receipts: [
      {
        id: overviewItems[0].receipts[0].id,
        amountCents: 410000,
        source: 'manual',
      },
    ],
  }),
});
const cashSync = (
  await call(`/api/sales/${activeSaleId}/receipt-payment`, {
    cookie: ownerCookie,
  })
).body;
assert.equal(cashSync.receivedTotalCents, 910000);
const cashSyncPayments = cashSync.payments as EditablePayment[];
const cashPayment = cashSyncPayments.find(
  (payment) => payment.method === 'cash',
)!;
const receiptPixPayment = cashSyncPayments.find(
  (payment) => payment.method === 'pix',
)!;
assert.equal(cashPayment.method, 'cash');
assert.equal(cashPayment.amountCents, 500000);
assert.equal(receiptPixPayment.amountCents, 410000);
await call(`/api/sales/${activeSaleId}/receipt-payment`, {
  method: 'POST',
  cookie: ownerCookie,
  expected: 400,
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': String(finalSession.body.csrfToken),
  },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    targetPaymentId: cashPayment.id,
    expectedPayments: cashSync.expectedPayments,
    expectedReceipts: cashSync.expectedReceipts,
    expectedRequestId: cashSync.requestId,
  }),
});
const cashSnapshot = cashSyncPayments.map(
  ({ id, method, pixAccountId, amountCents }) => ({
    id,
    method,
    pixAccountId,
    amountCents,
  }),
);
await call(`/api/sales/${activeSaleId}/payments`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': String(finalSession.body.csrfToken),
  },
  expected: 400,
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    expectedPayments: cashSnapshot,
    payments: cashSnapshot.map((payment) =>
      payment.id === cashPayment.id
        ? { ...payment, method: 'pix', pixAccountId: pixId }
        : payment,
    ),
  }),
});
const mixedCashCorrection = await call(`/api/sales/${activeSaleId}/payments`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: {
    'content-type': 'application/json',
    'x-csrf-token': String(finalSession.body.csrfToken),
  },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    expectedPayments: cashSnapshot,
    payments: cashSnapshot.map((payment) =>
      payment.id === cashPayment.id
        ? { ...payment, amountCents: 100_000 }
        : payment,
    ),
  }),
});
const mixedPaymentSnapshot = (
  mixedCashCorrection.body.payments as EditablePayment[]
).map(({ id, method, pixAccountId, amountCents }) => ({
  id,
  method,
  pixAccountId,
  amountCents,
}));
assert.equal(
  mixedPaymentSnapshot.find((payment) => payment.method === 'cash')
    ?.amountCents,
  100_000,
);
for (const amountCents of [400_000, 399_999]) {
  await call(`/api/sales/${activeSaleId}/receipt-values`, {
    method: 'PATCH',
    cookie: ownerCookie,
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': String(finalSession.body.csrfToken),
    },
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      receipts: [
        { id: overviewItems[0].receipts[0].id, amountCents, source: 'manual' },
      ],
    }),
  });
  const refreshedOverview = await call('/api/overview?period=all', {
    cookie: ownerCookie,
  });
  const refreshedTotals = refreshedOverview.body.totals as {
    receiptCents: number;
    receivedCents: number;
    pendingCount: number;
    divergentCount: number;
  };
  assert.equal(refreshedTotals.receiptCents, amountCents);
  assert.equal(refreshedTotals.receivedCents, amountCents + 100_000);
  assert.equal(refreshedTotals.pendingCount, 0);
  // Document/payment agreement cannot conceal a difference against the sale.
  assert.equal(refreshedTotals.divergentCount, amountCents === 400_000 ? 0 : 1);
  const reconciledFilter = await call(
    '/api/sales?group=sale&period=all&saleStatus=reconciled',
    { cookie: ownerCookie },
  );
  assert.equal(
    (reconciledFilter.body.items as { id: string }[]).some(
      (item) => item.id === activeSaleId,
    ),
    amountCents === 400_000,
  );
  const pendingFilter = await call(
    '/api/sales?group=sale&period=all&saleStatus=pending',
    { cookie: ownerCookie },
  );
  assert.equal(
    (pendingFilter.body.items as { id: string }[]).some(
      (item) => item.id === activeSaleId,
    ),
    amountCents !== 400_000,
  );
}
const cancelledFilter = await call(
  '/api/sales?group=sale&period=all&saleStatus=cancelled',
  { cookie: ownerCookie },
);
assert.ok(
  (cancelledFilter.body.items as { id: string }[]).some(
    (item) => item.id === saleId,
  ),
);
console.log(
  'Overview refresh: receipt edits immediately update totals and one-cent differences; tenant files remain protected.',
);
// Optional real-engine proof, ONLY on synthetic integration data. No browser OCR.
if (process.env.PDV_TEST_RECEIPT_FIXTURE_PATH) {
  const { readFile } = await import('node:fs/promises');
  const upload = new FormData();
  upload.set('operationId', crypto.randomUUID());
  upload.append(
    'receipts',
    new Blob(
      [
        new Uint8Array(
          await readFile(process.env.PDV_TEST_RECEIPT_FIXTURE_PATH),
        ),
      ],
      { type: 'application/pdf' },
    ),
    'teste-sem-validade.pdf',
  );
  const uploaded = await call(`/api/sales/${activeSaleId}/attachments`, {
    method: 'POST',
    cookie: ownerCookie,
    headers: { 'x-csrf-token': String(finalSession.body.csrfToken) },
    body: upload,
  });
  const attachmentId = (uploaded.body.receipts as { id: string }[])[0].id;
  let completed = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = await call(`/api/sales/${activeSaleId}/receipt-ocr`, {
      cookie: ownerCookie,
    });
    assert.equal(status.body.enabled, true);
    const row = (
      status.body.receipts as {
        id: string;
        amountCents: number | null;
        status: string;
      }[]
    ).find((row) => row.id === attachmentId);
    if (row?.status === 'done') {
      assert.equal(row.amountCents, 284000);
      completed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(
    completed,
    true,
    'Real receipt engine must complete without a browser.',
  );
  console.log('Real receipt engine persisted R$ 2.840,00 without a browser.');
}
console.log(
  'Operation recovery lookup, authorization, tenant isolation and backup visibility passed.',
);
assert.equal(manifest.status, 200);
const privacy = await fetch(`${baseUrl}/privacidade`);
assert.equal(privacy.status, 200);
const terms = await fetch(`${baseUrl}/termos`);
assert.equal(terms.status, 200);

// Default catalog applies per store, reuses existing variants and never creates stock.
const iphone15 = SYSTEM_CATALOG_PRODUCTS.find(
  (row) => row.model === 'iPhone 15',
)!;
assert.ok(iphone15);
const catalogHeaders = {
  'x-csrf-token': String(finalSession.body.csrfToken),
  'content-type': 'application/json',
};
const existing15 = await call('/api/products', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: catalogHeaders,
  body: JSON.stringify({
    ...iphone15,
    defaultPriceCents: 345678,
    codes: [iphone15.codes[0].value],
  }),
});
await call(`/api/products/${String(existing15.body.id)}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: catalogHeaders,
  body: JSON.stringify({
    model: iphone15.model,
    color: iphone15.color,
    memory: iphone15.memory,
    defaultPriceCents: 345678,
    active: false,
    expected: {
      model: iphone15.model,
      color: iphone15.color,
      memory: iphone15.memory,
      defaultPriceCents: 345678,
    },
  }),
});
const stockBeforeCatalog = await call('/api/inventory?view=summary', {
  cookie: ownerCookie,
});
const sync = await call('/api/system-catalog/sync', {
  method: 'POST',
  cookie: ownerCookie,
  headers: catalogHeaders,
});
assert.equal(sync.body.version, SYSTEM_CATALOG_VERSION);
const afterCatalog = await call('/api/bootstrap', { cookie: ownerCookie });
type CatalogTestProduct = {
  id: string;
  model: string;
  color: string;
  memory: string;
  active: boolean;
  defaultPriceCents: number;
  codes: { code: string; market: string }[];
};
const productsAfterCatalog = afterCatalog.body.products as CatalogTestProduct[];
const existingAfter = productsAfterCatalog.find(
  (row) => row.id === existing15.body.id,
)!;
assert.equal(existingAfter.defaultPriceCents, 345678);
assert.equal(existingAfter.active, false);
assert.equal(existingAfter.codes.length, iphone15.codes.length);
assert.equal(
  productsAfterCatalog.filter((row) => row.model === 'iPhone 15').length,
  15,
);
assert.equal(
  productsAfterCatalog.some((row) => /^iPhone 15 (Plus|Pro)/.test(row.model)),
  false,
);
assert.deepEqual(
  (await call('/api/inventory?view=summary', { cookie: ownerCookie })).body,
  stockBeforeCatalog.body,
);
const repeatCatalog = await call('/api/system-catalog/sync', {
  method: 'POST',
  cookie: ownerCookie,
  headers: catalogHeaders,
});
assert.equal(repeatCatalog.body.alreadyCurrent, true);
assert.deepEqual(
  (await call('/api/bootstrap', { cookie: ownerCookie })).body.products,
  productsAfterCatalog,
);
const secondCatalogSession = await call('/api/auth/session', {
  cookie: secondShopCookie,
});
await call(`/api/products/${productId}`, {
  method: 'PATCH',
  cookie: secondShopCookie,
  expected: 404,
  headers: {
    'x-csrf-token': String(secondCatalogSession.body.csrfToken),
    'content-type': 'application/json',
  },
  body: JSON.stringify({ active: false }),
});
await call('/api/system-catalog/sync', {
  method: 'POST',
  cookie: secondShopCookie,
  headers: { 'x-csrf-token': String(secondCatalogSession.body.csrfToken) },
});
const otherProducts = (
  await call('/api/bootstrap', { cookie: secondShopCookie })
).body.products as CatalogTestProduct[];
assert.equal(otherProducts.length, SYSTEM_CATALOG_PRODUCTS.length);
assert.ok(
  otherProducts.every((row) => row.defaultPriceCents === 0 && row.active),
);
assert.ok(
  otherProducts.every(
    (row) => !productsAfterCatalog.some((first) => first.id === row.id),
  ),
);
assert.deepEqual(
  (await call('/api/inventory?view=summary', { cookie: secondShopCookie })).body
    .rows,
  [],
);
console.log(
  'Default catalog: iPhone 15 base, all variants, preserved prices/active state, no stock, idempotency and tenant isolation passed.',
);
if (!primaryStoreToken) {
  const excessiveSignup = await call('/api/auth/register-owner', {
    method: 'POST',
    expected: 429,
    ...jsonBody({
      ...ownerPayload,
      email: `rate-limit-${runId}@example.com`,
      storeCode: `rate-limit-${runId}`,
    }),
  });
  assert.equal(excessiveSignup.body.code, 'REGISTRATION_LIMIT');
}
console.log(
  'Public password registration: no activation token, recovery codes, weak password and duplicate rejection, same-origin and creation rate limits passed.',
);
// New access controls and seller attribution use only this isolated fixture shop.
const accessOwnerHeaders = {
  'content-type': 'application/json',
  'x-csrf-token': String(finalSession.body.csrfToken),
};
const staffActor = String((changedStaffSession.body.user as { id: string }).id);
const defaultStaffPermissions = defaultPermissions('operator');
const permissionRoster = await call('/api/bootstrap', { cookie: staffCookie });
assert.deepEqual(permissionRoster.body.users, []);
assert.ok(
  (permissionRoster.body.sellers as { id: string }[]).some(
    (row) => row.id === ownerActor,
  ),
);
assert.ok(
  (permissionRoster.body.sellers as object[]).every(
    (row) => Object.keys(row).sort().join(',') === 'displayName,id',
  ),
);
const foreignActor = String(
  (secondCatalogSession.body.user as { id: string }).id,
);
assert.ok(
  !(permissionRoster.body.sellers as { id: string }[]).some(
    (row) => row.id === foreignActor,
  ),
);
await call(`/api/products/${productId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: accessOwnerHeaders,
  body: JSON.stringify({ active: true }),
});
const attributionEntry = new FormData();
attributionEntry.set(
  'payload',
  JSON.stringify({
    ...entryPayload,
    operationId: crypto.randomUUID(),
    serials: ['J2SELL0001', 'J2SELL0002', 'J2SELL0003'],
  }),
);
attributionEntry.append('photos', tinyPhoto(), 'teste-vendedores.png');
await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': String(finalSession.body.csrfToken) },
  body: attributionEntry,
  expected: 201,
});
const attributionId = crypto.randomUUID();
const attributionPayload = {
  operationId: attributionId,
  customerId: staffClientId,
  sellerUserId: ownerActor,
  items: [{ serial: 'J2SELL0001', priceCents: 123400 }],
  payments: [],
};
const sellerForm = (payload: unknown, photo = true) => {
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  if (photo) form.append('itemPhotos:0', tinyPhoto(), 'teste-venda.png');
  return form;
};
for (const sellerUserId of [foreignActor, crypto.randomUUID()]) {
  const denied = await call('/api/sales', {
    method: 'POST',
    cookie: staffCookie,
    headers: { 'x-csrf-token': changedStaffCsrf },
    body: sellerForm({ ...attributionPayload, sellerUserId }),
    expected: 409,
  });
  assert.equal(denied.body.code, 'SELLER_INVALID');
}
const attribution = await call('/api/sales', {
  method: 'POST',
  cookie: staffCookie,
  headers: { 'x-csrf-token': changedStaffCsrf },
  body: sellerForm(attributionPayload),
  expected: 201,
});
assert.equal(attribution.body.id, attributionId);
assert.equal(
  (
    await call('/api/sales', {
      method: 'POST',
      cookie: staffCookie,
      headers: { 'x-csrf-token': changedStaffCsrf },
      body: sellerForm(attributionPayload, false),
    })
  ).body.replayed,
  true,
);
const changedSeller = await call('/api/sales', {
  method: 'POST',
  cookie: staffCookie,
  headers: { 'x-csrf-token': changedStaffCsrf },
  body: sellerForm({ ...attributionPayload, sellerUserId: staffActor }, false),
  expected: 409,
});
assert.equal(changedSeller.body.code, 'OPERATION_ALREADY_USED');
const creditedSale = await call(
  `/api/sales?period=all&saleId=${attributionId}`,
  { cookie: ownerCookie },
);
const sellerOptionsResult = await call('/api/sales?view=seller-options', {
  cookie: ownerCookie,
});
assert.ok(
  (sellerOptionsResult.body.sellers as { id: string }[]).some(
    (seller) => seller.id === ownerActor,
  ),
);
assert.equal(
  (sellerOptionsResult.body.sellers as { id: string }[]).some(
    (seller) => seller.id === foreignActor,
  ),
  false,
);
const ownerSalesFilter = await call(
  `/api/sales?period=all&sellerId=${ownerActor}`,
  { cookie: ownerCookie },
);
assert.ok(
  (ownerSalesFilter.body.items as { id: string }[]).some(
    (sale) => sale.id === attributionId,
  ),
);
const operatorSalesFilter = await call(
  `/api/sales?period=all&sellerId=${staffActor}`,
  { cookie: ownerCookie },
);
assert.equal(
  (operatorSalesFilter.body.items as { id: string }[]).some(
    (sale) => sale.id === attributionId,
  ),
  false,
);
const foreignSalesFilter = await call(
  `/api/sales?period=all&sellerId=${foreignActor}`,
  { cookie: ownerCookie },
);
assert.deepEqual(foreignSalesFilter.body.items, []);
assert.equal(
  (creditedSale.body.items as { sellerName: string }[])[0].sellerName,
  'Proprietário Integração',
);
assert.equal(
  (
    await call(
      `/api/operations?kind=sale&id=${attributionId}&actor=${staffActor}`,
      { cookie: staffCookie },
    )
  ).body.found,
  true,
);
assert.equal(
  (
    await call(
      `/api/operations?kind=sale&id=${attributionId}&actor=${ownerActor}`,
      { cookie: ownerCookie },
    )
  ).body.found,
  false,
);
const setStaffPermissions = async (
  permissions: Permission[],
  expectedPermissions: Permission[],
) =>
  call(`/api/users/${staffActor}`, {
    method: 'PATCH',
    cookie: ownerCookie,
    headers: accessOwnerHeaders,
    body: JSON.stringify({ permissions, expectedPermissions }),
  });
const loginAccessStaff = async () => {
  const loginOptions = {
    method: 'POST',
    ...jsonBody({
      mode: 'staff',
      storeCode: ownerPayload.storeCode,
      username: `operador-${runId}`,
      password: 'Pessoal67890',
    }),
  };
  let login = await call('/api/auth/login', {
    ...loginOptions,
    expected: [200, 429],
  });
  if (login.response.status === 429) {
    assert.equal(login.body.code, 'LOGIN_RATE_LIMIT');
    console.log(
      'Access tests: respecting the login rate-limit window before retrying.',
    );
    const retryAt = Date.now() + (60_000 - (Date.now() % 60_000)) + 1_000;
    while (Date.now() < retryAt)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(30_000, retryAt - Date.now())),
      );
    login = await call('/api/auth/login', loginOptions);
  }
  const cookie = sessionCookie(login.response);
  const state = await call('/api/auth/session', { cookie });
  return {
    cookie,
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': String(state.body.csrfToken),
    },
  };
};
await setStaffPermissions(['sales'], defaultStaffPermissions);
await call('/api/bootstrap', { cookie: staffCookie, expected: 401 });
let accessStaff = await loginAccessStaff();
let restrictedBootstrap = (await call('/api/bootstrap', accessStaff)).body;
assert.deepEqual(
  (restrictedBootstrap.user as { permissions: string[] }).permissions,
  ['sales'],
);
for (const key of ['users', 'sellers', 'products', 'clients', 'pixAccounts'])
  assert.deepEqual(restrictedBootstrap[key], []);
await call('/api/sales?period=all', accessStaff);
for (const path of [
  '/api/inventory',
  '/api/inventory/lookup?serial=J2SELL0002',
  '/api/entries',
  '/api/rankings',
  '/api/overview',
  '/api/system/backup-status',
  `/api/sales/${attributionId}/participants`,
])
  await call(path, { ...accessStaff, expected: 403 });
for (const [path, method] of [
  ['/api/sales', 'POST'],
  ['/api/entries', 'POST'],
  ['/api/clients', 'POST'],
  ['/api/products', 'POST'],
  ['/api/users', 'POST'],
  ['/api/pix-accounts', 'POST'],
  ['/api/order-statuses', 'POST'],
  [`/api/sales/${attributionId}/payments`, 'POST'],
  [`/api/sales/${attributionId}/payments`, 'PATCH'],
  [`/api/sales/${attributionId}/cancel`, 'POST'],
  [`/api/sales/${attributionId}/attachments`, 'POST'],
  [`/api/sales/${attributionId}/receipt-values`, 'PATCH'],
  [`/api/sales/${attributionId}/receipt-payment`, 'POST'],
  [`/api/sales/${attributionId}/prices`, 'PATCH'],
  [`/api/sales/${attributionId}/receipts/denied-receipt`, 'DELETE'],
  [`/api/sales/${attributionId}/order-status`, 'PATCH'],
  [`/api/sales/${attributionId}/participants`, 'PATCH'],
  [`/api/sales/${attributionId}/receipt-ocr`, 'POST'],
  [`/api/products/${productId}`, 'PATCH'],
  [`/api/clients/${staffClientId}`, 'PATCH'],
  [`/api/pix-accounts/${pixId}`, 'PATCH'],
])
  await call(path, { ...accessStaff, method, body: '{}', expected: 403 });
// Revoking sale creation must not hide a committed operation from its true actor.
assert.equal(
  (
    await call(
      `/api/operations?kind=sale&id=${attributionId}&actor=${staffActor}`,
      accessStaff,
    )
  ).body.found,
  true,
);
await call(`/api/users/${staffActor}`, {
  ...accessStaff,
  method: 'PATCH',
  body: JSON.stringify({
    permissions: defaultStaffPermissions,
    expectedPermissions: ['sales'],
  }),
  expected: 403,
});
await call(`/api/users/${ownerActor}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: accessOwnerHeaders,
  body: JSON.stringify({ permissions: [] }),
  expected: 400,
});
await call(`/api/users/${foreignActor}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: accessOwnerHeaders,
  body: JSON.stringify({ permissions: [], expectedPermissions: [] }),
  expected: 404,
});
await call(`/api/users/${staffActor}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: accessOwnerHeaders,
  body: JSON.stringify({
    permissions: ['sales.cancel'],
    expectedPermissions: ['sales'],
  }),
  expected: 400,
});
await call(`/api/users/${staffActor}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: accessOwnerHeaders,
  body: JSON.stringify({
    permissions: ['unknown'],
    expectedPermissions: ['sales'],
  }),
  expected: 400,
});
await call(`/api/users/${staffActor}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: accessOwnerHeaders,
  body: JSON.stringify({
    permissions: [],
    expectedPermissions: defaultStaffPermissions,
  }),
  expected: 409,
});
await setStaffPermissions(['sell'], ['sales']);
accessStaff = await loginAccessStaff();
restrictedBootstrap = (await call('/api/bootstrap', accessStaff)).body;
assert.deepEqual(
  (restrictedBootstrap.sellers as { id: string }[]).map((row) => row.id),
  [staffActor],
);
assert.ok(
  (restrictedBootstrap.pixAccounts as { details: string | null }[]).every(
    (row) => row.details === null,
  ),
);
await call('/api/sales', {
  ...accessStaff,
  method: 'POST',
  body: sellerForm({
    ...attributionPayload,
    operationId: crypto.randomUUID(),
    items: [{ serial: 'J2SELL0002', priceCents: 100 }],
  }),
  headers: { 'x-csrf-token': accessStaff.headers['x-csrf-token'] },
  expected: 403,
});
const selfSale = await call('/api/sales', {
  ...accessStaff,
  method: 'POST',
  body: sellerForm({
    ...attributionPayload,
    operationId: crypto.randomUUID(),
    sellerUserId: undefined,
    items: [{ serial: 'J2SELL0002', priceCents: 100 }],
  }),
  headers: { 'x-csrf-token': accessStaff.headers['x-csrf-token'] },
  expected: 201,
});
assert.equal(
  (
    await call(`/api/sales?period=all&saleId=${String(selfSale.body.id)}`, {
      cookie: ownerCookie,
    })
  ).body.items instanceof Array,
  true,
);
const savedSalePhoto = (
  creditedSale.body.items as { items: { photos: { id: string }[] }[] }[]
)[0].items[0].photos[0];
await call(`/api/files/${savedSalePhoto.id}`, {
  ...accessStaff,
  expected: 403,
});
await setStaffPermissions(['finance', 'finance.manage'], ['sell']);
accessStaff = await loginAccessStaff();
const accountBefore = (
  (await call('/api/bootstrap', { cookie: ownerCookie })).body.pixAccounts as {
    id: string;
    name: string;
    details: string | null;
  }[]
).find((row) => row.id === pixId)!;
const historicalPayments = (
  (
    await call(`/api/sales?period=all&saleId=${saleId}`, {
      cookie: ownerCookie,
    })
  ).body.items as { payments: unknown[] }[]
)[0].payments;
await call(`/api/pix-accounts/${pixId}`, {
  ...accessStaff,
  method: 'PATCH',
  body: JSON.stringify({
    name: 'Conta editada no teste',
    details: 'Titular teste',
    active: false,
  }),
});
const accountAfter = (
  (await call('/api/bootstrap', accessStaff)).body.pixAccounts as {
    id: string;
    active: boolean;
    name: string;
  }[]
).find((row) => row.id === pixId)!;
assert.equal(accountAfter.active, false);
assert.equal(accountAfter.name, 'Conta editada no teste');
assert.deepEqual(
  (
    (
      await call(`/api/sales?period=all&saleId=${saleId}`, {
        cookie: ownerCookie,
      })
    ).body.items as { payments: unknown[] }[]
  )[0].payments,
  historicalPayments,
);
await call(`/api/pix-accounts/${pixId}`, {
  ...accessStaff,
  method: 'PATCH',
  body: JSON.stringify({
    name: accountBefore.name,
    details: accountBefore.details,
    active: true,
  }),
});
await setStaffPermissions([], ['finance', 'finance.manage']);
accessStaff = await loginAccessStaff();
restrictedBootstrap = (await call('/api/bootstrap', accessStaff)).body;
for (const key of [
  'products',
  'clients',
  'pixAccounts',
  'orderStatuses',
  'users',
  'sellers',
])
  assert.deepEqual(restrictedBootstrap[key], []);
await call(`/api/files/${savedSalePhoto.id}`, {
  ...accessStaff,
  expected: 403,
});
await setStaffPermissions(['clients', 'clients.history'], []);
accessStaff = await loginAccessStaff();
await call('/api/sales?period=all', { ...accessStaff, expected: 403 });
const restrictedHistory = (
  await call(`/api/sales?period=all&customerId=${staffClientId}`, accessStaff)
).body.items as {
  id: string;
  customerId: string;
  automaticStatus: string | null;
  displayStatus: SaleDisplayStatus;
  issueKeys: SaleIssueKey[];
  items: object[];
}[];
const fullHistory = (
  await call(`/api/sales?period=all&customerId=${staffClientId}`, {
    cookie: ownerCookie,
  })
).body.items as (SaleRecord & {
  automaticStatus: string | null;
  displayStatus: SaleDisplayStatus;
  issueKeys: SaleIssueKey[];
})[];
assert.ok(restrictedHistory.length);
for (const row of restrictedHistory) {
  assert.equal(row.customerId, staffClientId);
  const full = fullHistory.find((sale) => sale.id === row.id);
  assert.ok(full);
  assert.equal(row.automaticStatus, automaticSaleStatus(full)?.key ?? null);
  assert.equal(row.automaticStatus, full.automaticStatus);
  assert.deepEqual(row.displayStatus, saleDisplayStatus(full));
  assert.deepEqual(row.displayStatus, full.displayStatus);
  assert.deepEqual(
    row.issueKeys,
    saleIssues(full).map((issue) => issue.key),
  );
  assert.deepEqual(row.issueKeys, full.issueKeys);
  for (const key of ['payments', 'receipts', 'reconciliation'])
    assert.ok(!(key in row));
  assert.ok(row.items.every((item) => !('photos' in item)));
}
await call(`/api/files/${savedSalePhoto.id}`, {
  ...accessStaff,
  expected: 403,
});
await setStaffPermissions(defaultStaffPermissions, [
  'clients',
  'clients.history',
]);
console.log(
  'Seller selection/default/replay/actor recovery, menu/action enforcement, session revocation, owner and tenant protection, file access, bank editing/inactivation and history preservation passed.',
);
// Reproduce the empty upload symptom before the first entry in a fresh shop,
// then submit both photo copies and retry the same operation without duplicates.
const uploadHeaders = {
  'x-csrf-token': String(secondCatalogSession.body.csrfToken),
};
assert.equal(
  (await call('/api/entries', { cookie: secondShopCookie })).body.total,
  0,
);
if (process.env.PDV_TEST_STANDALONE === '1') {
  const emptyUpload = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: {
      ...uploadHeaders,
      origin: baseUrl,
      cookie: secondShopCookie,
      'cf-connecting-ip': testSourceIp,
      'content-type':
        'multipart/form-data; boundary=----WebKitFormBoundaryEntryTest',
    },
    body: new Uint8Array(0),
  });
  assert.equal(emptyUpload.status, 400);
  // Vinext dev intercepts malformed multipart as a server action. Run this check
  // against the standalone candidate, where API dispatch owns parsing.
  const emptyUploadError = (await emptyUpload.json()) as {
    code?: string;
  } | null;
  assert.equal(emptyUploadError?.code, 'INVALID_MULTIPART');
  console.log(
    'Standalone API rejected an empty multipart body before the first entry.',
  );
}
assert.equal(
  (await call('/api/entries', { cookie: secondShopCookie })).body.total,
  0,
);
const firstUploadId = crypto.randomUUID();
const firstUploadPayload = {
  operationId: firstUploadId,
  productId: otherProducts[0].id,
  gtin14: otherProducts[0].codes[0].code,
  serials: ['K7UPLD0001'],
};
const firstUpload = new FormData();
firstUpload.set('payload', JSON.stringify(firstUploadPayload));
firstUpload.append('photos', tinyPhoto(), 'Caixa — frente.png');
firstUpload.append('photos', tinyPhoto(), 'Caixa — verso.png');
const firstUploaded = await call('/api/entries', {
  method: 'POST',
  cookie: secondShopCookie,
  expected: 201,
  headers: uploadHeaders,
  body: await prepareUploadForm(firstUpload),
});
assert.equal(firstUploaded.body.added, 1);
const firstUploadReplay = new FormData();
firstUploadReplay.set('payload', JSON.stringify(firstUploadPayload));
assert.equal(
  (
    await call('/api/entries', {
      method: 'POST',
      cookie: secondShopCookie,
      headers: uploadHeaders,
      body: firstUploadReplay,
    })
  ).body.replayed,
  true,
);
const firstUploadHistory = (
  await call('/api/entries', { cookie: secondShopCookie })
).body;
assert.equal(firstUploadHistory.total, 1);
assert.equal(
  (firstUploadHistory.items as { photos: unknown[] }[])[0].photos.length,
  2,
);
console.log(
  'First entry in a new shop: two materialized photos save once; retry keeps the same operation and photos.',
);
// Product editor: the same Save action persists metadata AND the typed code.
const editingHeaders = { cookie: ownerCookie, headers: accessOwnerHeaders };
type EditableProduct = {
  id: string;
  model: string;
  color: string;
  memory: string;
  defaultPriceCents: number;
  codes: { id: string; code: string; market: string | null }[];
};
const fetchProducts = async () =>
  (await call('/api/bootstrap', { cookie: ownerCookie })).body
    .products as EditableProduct[];
let editedProduct = (await fetchProducts()).find(
  (row) => row.id === productId,
)!;
const saveProductBody = productEditorPayload(
  { ...editedProduct, price: '5.012,34' },
  '5901234123457',
  'Brasil',
  editedProduct,
);
await call(`/api/products/${productId}`, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify(saveProductBody),
});
editedProduct = (await fetchProducts()).find((row) => row.id === productId)!;
assert.equal(editedProduct.defaultPriceCents, 501234);
assert.equal(
  editedProduct.codes.filter((row) => row.code === '05901234123457').length,
  1,
);
assert.equal(
  editedProduct.codes.find((row) => row.code === '05901234123457')?.market,
  'Brasil',
);
await call(`/api/products/${productId}`, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify(saveProductBody),
});
assert.equal(
  (await fetchProducts())
    .find((row) => row.id === productId)!
    .codes.filter((row) => row.code === '05901234123457').length,
  1,
);
await Promise.all(
  [0, 1].map(() =>
    call(`/api/products/${productId}`, {
      ...editingHeaders,
      method: 'PATCH',
      body: JSON.stringify({
        addCode: { code: '9780201379624', market: 'Teste concorrência' },
      }),
    }),
  ),
);
assert.equal(
  (await fetchProducts())
    .find((row) => row.id === productId)!
    .codes.filter((row) => row.code === '09780201379624').length,
  1,
);
const badCodeSave = await call(`/api/products/${productId}`, {
  ...editingHeaders,
  method: 'PATCH',
  expected: 400,
  body: JSON.stringify({
    defaultPriceCents: 999,
    addCode: { code: '1234567890123' },
    expected: { defaultPriceCents: 501234 },
  }),
});
assert.equal(badCodeSave.body.code, 'INVALID_CODE');
assert.equal(
  (await fetchProducts()).find((row) => row.id === productId)!
    .defaultPriceCents,
  501234,
);
const batchProduct = await call('/api/products', {
  ...editingHeaders,
  method: 'POST',
  expected: 201,
  body: JSON.stringify({
    model: 'Produto preços',
    color: 'Azul',
    memory: '128 GB',
    defaultPriceCents: 300000,
    codes: ['4006381333931'],
  }),
});
const batchProductId = String(batchProduct.body.id);
await call(`/api/products/${productId}`, {
  ...editingHeaders,
  method: 'PATCH',
  expected: 409,
  body: JSON.stringify({
    defaultPriceCents: 999,
    addCode: { code: '4006381333931' },
    expected: { defaultPriceCents: 501234 },
  }),
});
assert.equal(
  (await fetchProducts()).find((row) => row.id === productId)!
    .defaultPriceCents,
  501234,
);
// No price write is accepted without permission or valid CSRF.
await call('/api/products/prices', {
  method: 'PATCH',
  ...jsonBody({ prices: [] }),
  expected: 401,
});
await call('/api/products/prices', {
  cookie: ownerCookie,
  method: 'PATCH',
  ...jsonBody({ prices: [] }),
  expected: 403,
});
accessStaff = await loginAccessStaff();
await call('/api/products/prices', {
  ...accessStaff,
  method: 'PATCH',
  body: '{}',
  expected: 403,
});
for (const prices of [
  [],
  null,
  [{ productId, defaultPriceCents: -1, expectedPriceCents: 0 }],
])
  await call('/api/products/prices', {
    ...editingHeaders,
    method: 'PATCH',
    expected: 400,
    body: JSON.stringify({ prices }),
  });
const changes = [
  { productId, expectedPriceCents: 501234, defaultPriceCents: 510000 },
  {
    productId: batchProductId,
    expectedPriceCents: 300000,
    defaultPriceCents: 320000,
  },
];
await call('/api/products/prices', {
  ...editingHeaders,
  method: 'PATCH',
  expected: 400,
  body: JSON.stringify({ prices: [changes[0], changes[0]] }),
});
const saleBeforePrices = (
  await call(`/api/sales?period=all&saleId=${saleId}`, { cookie: ownerCookie })
).body.items;
await call('/api/products/prices', {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({ prices: changes }),
});
await call('/api/products/prices', {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({ prices: changes }),
});
let pricesAfter = await fetchProducts();
assert.equal(
  pricesAfter.find((row) => row.id === productId)!.defaultPriceCents,
  510000,
);
assert.equal(
  pricesAfter.find((row) => row.id === batchProductId)!.defaultPriceCents,
  320000,
);
assert.deepEqual(
  (
    await call(`/api/sales?period=all&saleId=${saleId}`, {
      cookie: ownerCookie,
    })
  ).body.items,
  saleBeforePrices,
);
// Mixed batch: one stale price or foreign product must prevent EVERY write.
await call('/api/products/prices', {
  ...editingHeaders,
  method: 'PATCH',
  expected: 409,
  body: JSON.stringify({
    prices: [
      { productId, expectedPriceCents: 510000, defaultPriceCents: 520000 },
      {
        productId: batchProductId,
        expectedPriceCents: 1,
        defaultPriceCents: 330000,
      },
    ],
  }),
});
await call('/api/products/prices', {
  ...editingHeaders,
  method: 'PATCH',
  expected: 404,
  body: JSON.stringify({
    prices: [
      { productId, expectedPriceCents: 510000, defaultPriceCents: 520000 },
      {
        productId: otherProducts[0].id,
        expectedPriceCents: 0,
        defaultPriceCents: 330000,
      },
    ],
  }),
});
pricesAfter = await fetchProducts();
assert.equal(
  pricesAfter.find((row) => row.id === productId)!.defaultPriceCents,
  510000,
);
assert.equal(
  pricesAfter.find((row) => row.id === batchProductId)!.defaultPriceCents,
  320000,
);
// Concurrent price batches: exactly one may win from the same previous price.
const competingPrices = await Promise.all(
  [530000, 540000].map((defaultPriceCents) =>
    call('/api/products/prices', {
      ...editingHeaders,
      method: 'PATCH',
      expected: [200, 409],
      body: JSON.stringify({
        prices: [{ productId, expectedPriceCents: 510000, defaultPriceCents }],
      }),
    }),
  ),
);
assert.deepEqual(
  competingPrices.map((result) => result.response.status).sort((a, b) => a - b),
  [200, 409],
);
const finalProductPrice = (await fetchProducts()).find(
  (row) => row.id === productId,
)!.defaultPriceCents;
const whatsappAfterPrices = (
  await call('/api/inventory?view=whatsapp', { cookie: ownerCookie })
).body.rows as {
  model: string;
  color: string;
  memory: string;
  defaultPriceCents: number;
}[];
const offerAfterPrices = whatsappAfterPrices.find(
  (row) =>
    row.model === editedProduct.model &&
    row.color === editedProduct.color &&
    row.memory === editedProduct.memory,
);
assert.ok(offerAfterPrices, 'The changed product still has available stock');
assert.equal(offerAfterPrices.defaultPriceCents, finalProductPrice);
// The 20-code limit must not permit a partial metadata save.
const syntheticGtin = (index: number) => {
  const body = `9527654${String(index).padStart(5, '0')}`;
  const sum = body
    .split('')
    .reverse()
    .reduce(
      (total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 3 : 1),
      0,
    );
  return `${body}${(10 - (sum % 10)) % 10}`;
};
const fullCodesProduct = await call('/api/products', {
  ...editingHeaders,
  method: 'POST',
  expected: 201,
  body: JSON.stringify({
    model: 'Teste limite códigos',
    color: 'Preto',
    memory: '128 GB',
    defaultPriceCents: 12345,
    codes: Array.from({ length: 20 }, (_, i) => syntheticGtin(i)),
  }),
});
const codeLimit = await call(
  `/api/products/${String(fullCodesProduct.body.id)}`,
  {
    ...editingHeaders,
    method: 'PATCH',
    expected: 409,
    body: JSON.stringify({
      defaultPriceCents: 98765,
      addCode: { code: syntheticGtin(20), market: 'Brasil' },
      expected: { defaultPriceCents: 12345 },
    }),
  },
);
assert.equal(codeLimit.body.code, 'PRODUCT_CODE_LIMIT');
const fullCodesAfter = (await fetchProducts()).find(
  (row) => row.id === String(fullCodesProduct.body.id),
)!;
assert.equal(fullCodesAfter.defaultPriceCents, 12345);
assert.equal(fullCodesAfter.codes.length, 20);
console.log(
  'Product codes persist with Save and retry; batch prices are atomic, tenant-scoped, permission-checked, conflict-safe and preserve sale history.',
);
// Corrections on completed sales preserve financial/stock data and change the
// customer history and seller attribution, not the actor of the original sale.
const participantPath = `/api/sales/${attributionId}/participants`;
accessStaff = await loginAccessStaff();
await call(participantPath, { ...accessStaff, expected: 403 });
await call(participantPath, { cookie: secondShopCookie, expected: 404 });
await call(participantPath, { expected: 401 });
const participantChoices = (
  await call(participantPath, { cookie: ownerCookie })
).body;
type TestedParticipants = {
  customerId: string | null;
  customerName: string;
  sellerUserId: string;
  sellerName: string;
  revision: number;
};
const originalParticipants = participantChoices.current as TestedParticipants;
for (const key of ['clients', 'sellers']) {
  assert.ok(
    (participantChoices[key] as { id: string }[]).every(
      (row) => Object.keys(row).sort().join(',') === 'id,name',
    ),
  );
}
assert.ok(
  !(participantChoices.sellers as { id: string }[]).some(
    (row) => row.id === foreignActor,
  ),
);
const correction = {
  operationId: crypto.randomUUID(),
  expected: {
    customerId: originalParticipants.customerId,
    sellerUserId: originalParticipants.sellerUserId,
    revision: originalParticipants.revision,
  },
  customerId: clientId,
  sellerUserId: staffActor,
};
const saleForCorrection = async () =>
  (
    (
      await call(`/api/sales?period=all&saleId=${attributionId}`, {
        cookie: ownerCookie,
      })
    ).body.items as JsonValue[]
  )[0];
const beforeCorrection = await saleForCorrection();
const rankAmounts = async (dimension: string) =>
  (
    await call(`/api/rankings?period=all&dimension=${dimension}`, {
      cookie: ownerCookie,
    })
  ).body.items as { key: string; totalCents: number; itemCount: number }[];
const ranksBefore = {
  customer: await rankAmounts('customer'),
  seller: await rankAmounts('seller'),
};
await call(participantPath, {
  cookie: ownerCookie,
  method: 'PATCH',
  ...jsonBody(correction),
  expected: 403,
});
await call(participantPath, {
  ...accessStaff,
  method: 'PATCH',
  body: JSON.stringify(correction),
  expected: 403,
});
await call(participantPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({ ...correction, sellerUserId: foreignActor }),
  expected: 409,
});
const changedParticipants = await call(participantPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify(correction),
});
assert.equal(
  (changedParticipants.body.current as TestedParticipants).sellerUserId,
  staffActor,
);
assert.equal(
  (changedParticipants.body.current as TestedParticipants).customerId,
  clientId,
);
assert.equal(
  (
    await call(participantPath, {
      ...editingHeaders,
      method: 'PATCH',
      body: JSON.stringify(correction),
    })
  ).body.replayed,
  true,
);
await call(participantPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({ ...correction, operationId: crypto.randomUUID() }),
  expected: 409,
});
const afterCorrection = await saleForCorrection();
assert.equal(afterCorrection.customerId, clientId);
assert.equal(
  afterCorrection.sellerName,
  (changedParticipants.body.current as TestedParticipants).sellerName,
);
for (const key of [
  'id',
  'code',
  'createdAt',
  'status',
  'items',
  'payments',
  'receipts',
  'productsTotalCents',
  'receivedTotalCents',
  'reconciliation',
])
  assert.deepEqual(
    afterCorrection[key],
    beforeCorrection[key],
    `Participant edit must preserve ${key}`,
  );
for (const [query, present] of [
  [`customerId=${clientId}`, true],
  [`customerId=${staffClientId}`, false],
  [`sellerId=${staffActor}`, true],
  [`sellerId=${ownerActor}`, false],
] as const) {
  const rows = (
    await call(`/api/sales?period=all&${query}`, { cookie: ownerCookie })
  ).body.items as { id: string }[];
  assert.equal(
    rows.some((row) => row.id === attributionId),
    present,
    query,
  );
}
for (const [dimension, oldKey, newKey] of [
  ['customer', staffClientId, clientId],
  ['seller', ownerActor, staffActor],
] as const) {
  const ranked = await rankAmounts(dimension);
  const cents = (rows: typeof ranked, key: string) =>
    rows.find((row) => row.key === key)?.totalCents ?? 0;
  assert.equal(
    cents(ranked, newKey) - cents(ranksBefore[dimension], newKey),
    123400,
  );
  assert.equal(
    cents(ranked, oldKey) - cents(ranksBefore[dimension], oldKey),
    -123400,
  );
}
const groupSeller = (
  await call('/api/sales?period=all&group=seller', { cookie: ownerCookie })
).body.groups as { key: string; totalCents: number }[];
assert.equal(
  groupSeller.find((row) => row.key === staffActor)?.totalCents,
  (await rankAmounts('seller')).find((row) => row.key === staffActor)
    ?.totalCents,
);
const originalReplay = await call('/api/sales', {
  cookie: accessStaff.cookie,
  method: 'POST',
  headers: { 'x-csrf-token': accessStaff.headers['x-csrf-token'] },
  body: sellerForm(attributionPayload, false),
});
assert.equal(originalReplay.body.replayed, true);
assert.equal(
  (await saleForCorrection()).customerId,
  clientId,
  'Retry of original sale must not undo the correction',
);
const cancelledParticipants = (
  await call(`/api/sales/${saleId}/participants`, { cookie: ownerCookie })
).body.current as TestedParticipants;
await call(`/api/sales/${saleId}/participants`, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({
    ...correction,
    operationId: crypto.randomUUID(),
    expected: {
      customerId: cancelledParticipants.customerId,
      sellerUserId: cancelledParticipants.sellerUserId,
      revision: cancelledParticipants.revision,
    },
  }),
  expected: 409,
});
await setStaffPermissions(
  ['sales', 'sales.participants'],
  defaultStaffPermissions,
);
accessStaff = await loginAccessStaff();
await call(participantPath, accessStaff);
const currentParticipants = changedParticipants.body
  .current as TestedParticipants;
await call(participantPath, {
  ...accessStaff,
  method: 'PATCH',
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    expected: {
      customerId: currentParticipants.customerId,
      sellerUserId: currentParticipants.sellerUserId,
      revision: currentParticipants.revision,
    },
    customerId: staffClientId,
    sellerUserId: ownerActor,
  }),
});
await setStaffPermissions(defaultStaffPermissions, [
  'sales',
  'sales.participants',
]);
console.log(
  'Completed sale participant edits: permissions/CSRF/tenant isolation, active choices, preserved financials, customer history, seller filters/rankings, conflicts, original create replay and cancellations passed.',
);
// Price correction and receipt deletion operate on this run's synthetic sale.
const pricePath = `/api/sales/${attributionId}/prices`;
const priceBefore = (await call(pricePath, { cookie: ownerCookie }))
  .body as unknown as SalePrices;
const saleBeforePriceCorrection =
  (await saleForCorrection()) as unknown as SaleRecord;
const priceEdit = {
  operationId: crypto.randomUUID(),
  revision: priceBefore.revision,
  items: priceBefore.items.map((item) => ({
    id: item.id,
    expectedPriceCents: item.soldPriceCents,
    priceCents: item.soldPriceCents + 5000,
  })),
};
await call(pricePath, {
  ...editingHeaders,
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(priceEdit),
  expected: 403,
});
accessStaff = await loginAccessStaff();
await call(pricePath, { ...accessStaff, expected: 403 });
await call(pricePath, {
  ...accessStaff,
  method: 'PATCH',
  body: JSON.stringify(priceEdit),
  expected: 403,
});
const pricesSaved = (
  await call(pricePath, {
    ...editingHeaders,
    method: 'PATCH',
    body: JSON.stringify(priceEdit),
  })
).body as unknown as SalePrices;
assert.equal(
  pricesSaved.productsTotalCents,
  priceBefore.productsTotalCents + 5000,
);
assert.equal(pricesSaved.receivedTotalCents, priceBefore.receivedTotalCents);
assert.equal(
  (
    await call(pricePath, {
      ...editingHeaders,
      method: 'PATCH',
      body: JSON.stringify(priceEdit),
    })
  ).body.replayed,
  true,
);
const saleAfterPrices = (await saleForCorrection()) as unknown as SaleRecord;
assert.deepEqual(saleAfterPrices.payments, saleBeforePriceCorrection.payments);
assert.equal(
  saleAfterPrices.items[0].serial,
  saleBeforePriceCorrection.items[0].serial,
);
assert.equal(
  saleAfterPrices.items[0].referencePriceCents,
  saleBeforePriceCorrection.items[0].referencePriceCents,
);
assert.equal(
  saleAfterPrices.items[0].soldPriceCents,
  saleBeforePriceCorrection.items[0].soldPriceCents + 5000,
);
const replayOriginalPrice = async () =>
  call('/api/sales', {
    cookie: accessStaff.cookie,
    method: 'POST',
    headers: { 'x-csrf-token': accessStaff.headers['x-csrf-token'] },
    body: sellerForm(attributionPayload, false),
  });
const createReplayAfterPrice = await replayOriginalPrice();
assert.equal(createReplayAfterPrice.body.replayed, true);
assert.equal(createReplayAfterPrice.body.productsTotalCents, 123400);
assert.equal(createReplayAfterPrice.body.receivedTotalCents, 0);
// Exercise the historical no-fingerprint fallback only in the isolated runner's database.
if (process.env.PDV_TEST_ISOLATED_DATA_DIR) {
  assert.ok(
    localTarget &&
      process.env.PDV_TEST_ISOLATED_DATA_DIR.includes(
        'pdv-isolated-validation-',
      ),
  );
  const { DatabaseSync } = await import('node:sqlite');
  const fixturePath = await import('node:path');
  const fixtureDb = new DatabaseSync(
    fixturePath.join(process.env.PDV_TEST_ISOLATED_DATA_DIR, 'pdv.sqlite'),
  );
  const modernOperationDetails = fixtureDb
    .prepare(
      "SELECT details_json AS details FROM audit_events WHERE entity_id=? AND action='sale.created'",
    )
    .get(attributionId)!.details as string;
  fixtureDb
    .prepare(
      "UPDATE audit_events SET details_json=json_remove(details_json,'$.operationFingerprint','$.operationPayloadFingerprint','$.operationFingerprintVersion','$.attachmentIds','$.receipts','$.productsTotalCents','$.receivedTotalCents') WHERE entity_id=? AND action='sale.created'",
    )
    .run(attributionId);
  fixtureDb.close();
  const legacyReplay = await replayOriginalPrice();
  assert.equal(legacyReplay.body.replayed, true);
  assert.equal(legacyReplay.body.productsTotalCents, 123400);
  assert.equal(legacyReplay.body.receivedTotalCents, 0);
  const restoreDb = new DatabaseSync(
    fixturePath.join(process.env.PDV_TEST_ISOLATED_DATA_DIR, 'pdv.sqlite'),
  );
  restoreDb
    .prepare(
      "UPDATE audit_events SET details_json=? WHERE entity_id=? AND action='sale.created'",
    )
    .run(modernOperationDetails, attributionId);
  restoreDb.close();
}
const receiptsForm = new FormData();
receiptsForm.set('operationId', crypto.randomUUID());
receiptsForm.append('receipts', tinyPhoto(), 'apagar-manualmente.png');
receiptsForm.append('receipts', tinyPhoto(), 'manter-comprovante.png');
const receiptUpload = await call(`/api/sales/${attributionId}/attachments`, {
  cookie: ownerCookie,
  method: 'POST',
  headers: { 'x-csrf-token': accessOwnerHeaders['x-csrf-token'] },
  body: receiptsForm,
});
const newReceipts = receiptUpload.body.receipts as {
  id: string;
  url: string;
}[];
assert.equal(newReceipts.length, 2);
await call(`/api/sales/${attributionId}/receipt-values`, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    receipts: newReceipts.map((receipt, index) => ({
      id: receipt.id,
      amountCents: index ? 5000 : 123400,
      source: 'manual',
    })),
  }),
});
const saleAfterReceiptValues =
  (await saleForCorrection()) as unknown as SaleRecord;
assert.equal(saleAfterReceiptValues.reconciliation.status, 'reconciled');
assert.equal(saleAfterReceiptValues.receivedTotalCents, 128400);
assert.equal(saleAfterReceiptValues.payments.length, 2);
assert.ok(
  saleAfterReceiptValues.payments.every((payment) => payment.method === 'pix'),
);
assert.equal(
  saleAfterReceiptValues.payments.reduce(
    (sum, payment) => sum + payment.amountCents,
    0,
  ),
  128400,
);
const deletePath = `/api/sales/${attributionId}/receipts/${newReceipts[0].id}`;
const deleteBody = JSON.stringify({ operationId: crypto.randomUUID() });
assert.equal(
  (
    await fetch(`${baseUrl}${newReceipts[0].url}`, {
      headers: { cookie: ownerCookie },
    })
  ).status,
  200,
);
await call(deletePath, {
  ...editingHeaders,
  method: 'DELETE',
  body: '{}',
  expected: 400,
});
await call(deletePath, {
  ...editingHeaders,
  method: 'DELETE',
  headers: { 'content-type': 'application/json' },
  body: deleteBody,
  expected: 403,
});
await call(deletePath, {
  ...accessStaff,
  method: 'DELETE',
  body: deleteBody,
  expected: 403,
});
assert.equal(
  (
    await call(deletePath, {
      ...editingHeaders,
      method: 'DELETE',
      body: deleteBody,
    })
  ).body.ok,
  true,
);
assert.equal(
  (
    await call(deletePath, {
      ...editingHeaders,
      method: 'DELETE',
      body: deleteBody,
    })
  ).body.replayed,
  true,
);
assert.equal(
  (
    await fetch(`${baseUrl}${newReceipts[0].url}`, {
      headers: { cookie: ownerCookie },
    })
  ).status,
  404,
);
assert.equal(
  (
    await fetch(`${baseUrl}${newReceipts[1].url}`, {
      headers: { cookie: ownerCookie },
    })
  ).status,
  200,
);
const saleAfterDelete = (await saleForCorrection()) as unknown as SaleRecord;
assert.equal(saleAfterDelete.receipts.length, 1);
assert.equal(saleAfterDelete.receipts[0].id, newReceipts[1].id);
assert.equal(saleAfterDelete.reconciliation.status, 'divergent');
assert.equal(saleAfterDelete.receivedTotalCents, 5000);
assert.equal(saleAfterDelete.payments.length, 1);
assert.equal(saleAfterDelete.payments[0].method, 'pix');
assert.equal(saleAfterDelete.payments[0].amountCents, 5000);
assert.equal(saleAfterDelete.productsTotalCents, 128400);
console.log(
  'Post-sale prices and manual receipt deletion: authenticated HTTP, CSRF/permission enforcement, original-sale replay, linked Pix cleanup, preserved unrelated payments, file 200→404 and immediate reconciliation queries passed.',
);
// Explicit use of already saved receipts, manual precedence, replay and CSRF.
const syncPath = `/api/sales/${activeSaleId}/receipt-payment`;
const syncState = async () =>
  (await call(syncPath, { cookie: ownerCookie })).body;
await call(syncPath, { cookie: secondShopCookie, expected: 404 });
let beforeSync = await syncState();
const paidFields = (value: Record<string, unknown>) =>
  (value.payments as EditablePayment[]).map(
    ({ id, method, pixAccountId, amountCents }) => ({
      id,
      method,
      pixAccountId,
      amountCents,
    }),
  );
const manualSetCash = async (amountCents: number) => {
  const current = await syncState();
  const expectedPayments = paidFields(current);
  await call(`/api/sales/${activeSaleId}/payments`, {
    ...editingHeaders,
    method: 'PATCH',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      expectedPayments,
      payments: expectedPayments.map((payment) =>
        payment.method === 'cash' ? { ...payment, amountCents } : payment,
      ),
    }),
  });
};
await manualSetCash(110000);
beforeSync = await syncState();
assert.equal(beforeSync.status, 'applied');
const syncPixPayment = (beforeSync.payments as EditablePayment[]).find(
  (payment) => payment.method === 'pix',
)!;
const syncPayload = {
  operationId: crypto.randomUUID(),
  targetPaymentId: syncPixPayment.id,
  expectedPayments: beforeSync.expectedPayments,
  expectedReceipts: beforeSync.expectedReceipts,
  expectedRequestId: beforeSync.requestId,
};
await call(syncPath, {
  ...editingHeaders,
  headers: { 'content-type': 'application/json', 'x-csrf-token': 'wrong' },
  method: 'POST',
  body: JSON.stringify(syncPayload),
  expected: 403,
});
const synced = await call(syncPath, {
  ...editingHeaders,
  method: 'POST',
  body: JSON.stringify(syncPayload),
});
assert.equal(
  synced.body.receivedTotalCents,
  Number(synced.body.receiptTotalCents) + 110000,
);
assert.equal(synced.body.status, 'applied');
await manualSetCash(120000);
const replaySync = await call(syncPath, {
  ...editingHeaders,
  method: 'POST',
  body: JSON.stringify(syncPayload),
});
assert.equal(replaySync.body.replayed, true);
assert.equal(replaySync.body.receivedTotalCents, 519999);
await call(syncPath, {
  ...editingHeaders,
  method: 'POST',
  body: JSON.stringify({ ...syncPayload, operationId: crypto.randomUUID() }),
  expected: 409,
});
const correctionPath = `/api/sales/${activeSaleId}/receipt-values`;
const receiptCorrection = {
  operationId: crypto.randomUUID(),
  preservePayments: true,
  receipts: [
    {
      id: overviewItems[0].receipts[0].id,
      amountCents: 490000,
      source: 'manual',
    },
  ],
};
await call(correctionPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify(receiptCorrection),
});
assert.equal((await syncState()).receivedTotalCents, 610000);
await call(correctionPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify(receiptCorrection),
});
assert.equal((await syncState()).receivedTotalCents, 610000);
await call(correctionPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({
    ...receiptCorrection,
    operationId: crypto.randomUUID(),
    preservePayments: false,
    receipts: [{ ...receiptCorrection.receipts[0], amountCents: 480000 }],
  }),
});
assert.equal((await syncState()).receivedTotalCents, 600000);
const syncVersion = await call('/api/receipt-ocr/status', {
  cookie: ownerCookie,
});
assert.notEqual(syncVersion.body.version, 'disabled');
console.log(
  'Receipt payment HTTP: automatic edit, explicit apply, manual precedence, same-save preservation, replay, stale snapshot, CSRF and tenant isolation passed.',
);
// Regression: R$7,100 sale = Pix R$4,100 + manually verified cash R$3,000.
const mixedPricesPath = `/api/sales/${activeSaleId}/prices`;
const mixedPrices = (await call(mixedPricesPath, { cookie: ownerCookie }))
  .body as unknown as SalePrices;
assert.equal(mixedPrices.items.length, 1);
await call(mixedPricesPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    revision: mixedPrices.revision,
    items: mixedPrices.items.map((item) => ({
      id: item.id,
      expectedPriceCents: item.soldPriceCents,
      priceCents: 710000,
    })),
  }),
});
await call(correctionPath, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    receipts: [{ ...receiptCorrection.receipts[0], amountCents: 410000 }],
  }),
});
await manualSetCash(300000);
for (const amountCents of [410000, 400000]) {
  await call(correctionPath, {
    ...editingHeaders,
    method: 'PATCH',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      receipts: [{ ...receiptCorrection.receipts[0], amountCents }],
    }),
  });
  const mixed = await syncState();
  assert.equal(mixed.receivedTotalCents, amountCents + 300000);
  assert.equal(mixed.cashCents, 300000);
  assert.equal(mixed.pixCents, amountCents);
  assert.equal(
    (mixed.payments as EditablePayment[]).find((p) => p.method === 'cash')!
      .amountCents,
    300000,
  );
  const mixedSales = (
    await call('/api/sales?period=all', { cookie: ownerCookie })
  ).body.items as SaleRecord[];
  const mixedSale = mixedSales.find((sale) => sale.id === activeSaleId)!;
  assert.equal(
    mixedSale.reconciliation.status,
    amountCents === 410000 ? 'reconciled' : 'divergent',
  );
  assert.equal(mixedSale.reconciliation.differenceCents, amountCents - 410000);
  assert.equal(mixedSale.receivedDifferenceCents, amountCents - 410000);
  assert.equal(
    automaticSaleStatus(mixedSale)?.key ?? null,
    amountCents === 410000
      ? 'reconciled'
      : amountCents < 410000
        ? 'pending_payment'
        : 'overpaid',
  );
}
console.log(
  'Mixed-payment HTTP: receipts compare only Pix; cash preserved after correction; sale balance and status recalculated.',
);
// A receipt attached after an unpaid sale registers its first Pix automatically.
const firstPixPath = `/api/sales/${attributionId}/receipt-payment`;
await call(`/api/sales/${attributionId}/receipt-values`, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    receipts: [
      { id: newReceipts[1].id, amountCents: 128400, source: 'manual' },
    ],
  }),
});
const firstPixBefore = (await call(firstPixPath, { cookie: ownerCookie })).body;
assert.equal(firstPixBefore.receiptTotalCents, 128400);
assert.equal(firstPixBefore.receivedTotalCents, 128400);
assert.equal(firstPixBefore.cashCents, 0);
assert.equal(firstPixBefore.pixCents, 128400);
await call(firstPixPath, { cookie: secondShopCookie, expected: 404 });
const firstPixPayments = firstPixBefore.payments as EditablePayment[];
assert.equal(firstPixPayments.length, 1);
const registeredPix = firstPixPayments[0];
assert.equal(registeredPix.method, 'pix');
assert.equal(registeredPix.amountCents, 128400);
const forbiddenReceiptPixEdit = await call(
  `/api/sales/${attributionId}/payments`,
  {
    ...editingHeaders,
    method: 'PATCH',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      expectedPayments: [
        {
          id: registeredPix.id,
          method: registeredPix.method,
          pixAccountId: registeredPix.pixAccountId,
          amountCents: registeredPix.amountCents,
        },
      ],
      payments: [
        {
          id: registeredPix.id,
          method: registeredPix.method,
          pixAccountId: registeredPix.pixAccountId,
          amountCents: 128000,
        },
      ],
    }),
    expected: 400,
  },
);
assert.equal(forbiddenReceiptPixEdit.body.code, 'PIX_FROM_RECEIPT');
const replayAfterFirstPix = await call('/api/sales', {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': accessOwnerHeaders['x-csrf-token'] },
  body: sellerForm(attributionPayload, false),
});
assert.equal(replayAfterFirstPix.body.replayed, true);
assert.deepEqual(
  replayAfterFirstPix.body.receipts,
  [],
  'Create replay must return the original attachment response, not receipts added later',
);
assert.equal(
  (await call(firstPixPath, { cookie: ownerCookie })).body.receivedTotalCents,
  128400,
);
await call(`/api/sales/${attributionId}/receipt-values`, {
  ...editingHeaders,
  method: 'PATCH',
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    receipts: [
      {
        id: newReceipts[1].id,
        amountCents: 128000,
        source: 'manual',
      },
    ],
  }),
});
const firstPixAfterCorrection = (
  await call(firstPixPath, { cookie: ownerCookie })
).body;
assert.equal(firstPixAfterCorrection.receivedTotalCents, 128000);
assert.equal(
  (firstPixAfterCorrection.payments as EditablePayment[])[0].amountCents,
  128000,
);
console.log(
  'First receipt Pix HTTP: automatic creation, tenant isolation, original sale replay, protected Pix editing and receipt-driven correction passed.',
);
if (process.env.PDV_TEST_ISOLATED_DATA_DIR) {
  assert.ok(
    localTarget &&
      process.env.PDV_TEST_ISOLATED_DATA_DIR.includes(
        'pdv-isolated-validation-',
      ),
  );
  const { DatabaseSync } = await import('node:sqlite');
  const fixturePaths = await import('node:path');
  const fixtureDb = new DatabaseSync(
    fixturePaths.join(process.env.PDV_TEST_ISOLATED_DATA_DIR, 'pdv.sqlite'),
  );
  fixtureDb
    .prepare(
      'UPDATE sales SET received_total_cents=999999,received_difference_cents=871599 WHERE id=?',
    )
    .run(attributionId);
  fixtureDb.close();

  const cashAfterStaleCache = await call(
    `/api/sales/${attributionId}/payments`,
    {
      ...editingHeaders,
      method: 'POST',
      expected: 201,
      body: JSON.stringify({
        operationId: crypto.randomUUID(),
        method: 'cash',
        pixAccountId: null,
        amountCents: 400,
      }),
    },
  );
  assert.equal(
    (cashAfterStaleCache.body.sale as { receivedTotalCents: number })
      .receivedTotalCents,
    128400,
  );
  const stateAfterCash = (await call(firstPixPath, { cookie: ownerCookie }))
    .body;
  const paymentsAfterCash = stateAfterCash.payments as EditablePayment[];
  const newCashPayment = paymentsAfterCash.find(
    (payment) => payment.method === 'cash',
  )!;
  const editablePaymentsAfterCash = paidFields(stateAfterCash);
  const editedCash = await call(`/api/sales/${attributionId}/payments`, {
    ...editingHeaders,
    method: 'PATCH',
    body: JSON.stringify({
      operationId: crypto.randomUUID(),
      expectedPayments: editablePaymentsAfterCash,
      payments: editablePaymentsAfterCash.map((payment) =>
        payment.id === newCashPayment.id
          ? { ...payment, amountCents: 300 }
          : payment,
      ),
    }),
  });
  assert.equal(
    (editedCash.body.sale as { receivedTotalCents: number }).receivedTotalCents,
    128300,
  );
  const normalizedDb = new DatabaseSync(
    fixturePaths.join(process.env.PDV_TEST_ISOLATED_DATA_DIR, 'pdv.sqlite'),
  );
  const normalizedTotals = normalizedDb
    .prepare(
      'SELECT received_total_cents AS total,received_difference_cents AS difference FROM sales WHERE id=?',
    )
    .get(attributionId)!;
  assert.equal(normalizedTotals.total, 128300);
  assert.equal(normalizedTotals.difference, -100);
  normalizedDb.close();

  const replayDb = new DatabaseSync(
    fixturePaths.join(process.env.PDV_TEST_ISOLATED_DATA_DIR, 'pdv.sqlite'),
  );
  replayDb
    .prepare(
      "UPDATE audit_events SET details_json=json_remove(details_json,'$.operationFingerprint','$.operationPayloadFingerprint','$.operationFingerprintVersion','$.attachmentIds','$.receipts','$.receivedTotalCents','$.receivedDifferenceCents') WHERE entity_id=? AND action='sale.created'",
    )
    .run(saleId);
  const currentTotal = replayDb
    .prepare('SELECT received_total_cents AS total FROM sales WHERE id=?')
    .get(saleId)!.total;
  replayDb.close();
  const legacyForm = new FormData();
  legacyForm.set('payload', JSON.stringify(salePayload));
  const replay = await call('/api/sales', {
    cookie: ownerCookie,
    method: 'POST',
    headers: { 'x-csrf-token': accessOwnerHeaders['x-csrf-token'] },
    body: legacyForm,
  });
  assert.equal(replay.body.replayed, true);
  const checkDb = new DatabaseSync(
    fixturePaths.join(process.env.PDV_TEST_ISOLATED_DATA_DIR, 'pdv.sqlite'),
  );
  assert.equal(
    checkDb
      .prepare('SELECT received_total_cents AS total FROM sales WHERE id=?')
      .get(saleId)!.total,
    currentTotal,
  );
  checkDb.close();
}
if (
  process.env.PDV_TEST_STANDALONE === '1' &&
  process.env.PDV_TEST_ISOLATED_DATA_DIR
) {
  const { checkPublicReportsHttp } =
    await import('./check-public-reports-http.ts');
  await checkPublicReportsHttp(
    baseUrl,
    ownerCookie,
    accessOwnerHeaders['x-csrf-token'],
    process.env.PDV_TEST_ISOLATED_DATA_DIR,
  );
}
console.log('Production integration flow passed.');
