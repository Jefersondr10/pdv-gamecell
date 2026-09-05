import assert from 'node:assert/strict';

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
const passwordSignupToken =
  process.env.PDV_TEST_SIGNUP_TOKEN ?? primaryStoreToken;
assert.ok(passwordSignupToken, 'Informe PDV_TEST_SIGNUP_TOKEN para o teste.');
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
await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 403,
  ...jsonBody(ownerPayload),
});
const registration = await call('/api/auth/register-owner', {
  method: 'POST',
  expected: 201,
  ...jsonBody({ ...ownerPayload, setupToken: passwordSignupToken }),
});
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
  body: JSON.stringify({ active: true, defaultPriceCents: 500_000 }),
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
await call(`/api/clients/${clientId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ phone: '(11) 99999-0000', active: false }),
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

const pendingStatus = await call('/api/order-statuses', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Pagamento pendente', color: 'amber' }),
});
const pendingStatusId = String((pendingStatus.body.item as { id: string }).id);
const duplicateStatus = await call('/api/order-statuses', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'pagamento PENDENTE', color: 'red' }),
});
assert.equal(duplicateStatus.body.code, 'ORDER_STATUS_EXISTS');
await call(`/api/order-statuses/${pendingStatusId}`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Pagamento pendente', color: 'orange' }),
});
const orderStatuses = await call('/api/order-statuses', {
  cookie: ownerCookie,
});
assert.equal((orderStatuses.body.items as unknown[]).length, 1);

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
  (prefixedLookup.body.matches as Array<{ status: string }>)[0].status,
  'available',
);
const availableStock = await call('/api/inventory?view=summary', {
  cookie: ownerCookie,
});
assert.equal(
  (availableStock.body.rows as Array<{ available: number }>)[0].available,
  2,
);
const inventoryPage = await call('/api/inventory?limit=50&includePhotos=1', {
  cookie: ownerCookie,
});
assert.equal(inventoryPage.body.total, 2);
assert.equal((inventoryPage.body.items as unknown[]).length, 2);

const saleOperationId = crypto.randomUUID();
const salePayload = {
  operationId: saleOperationId,
  customerId: clientId,
  items: [
    { serial: 'HC9P06R095', priceCents: 450_000 },
    { serial: 'HC9P06R096', priceCents: 450_000 },
  ],
  payments: [{ method: 'pix', pixAccountId: pixId, amountCents: 850_000 }],
};
const saleForm = new FormData();
saleForm.set('payload', JSON.stringify(salePayload));
saleForm.append('itemPhotos:0', tinyPhoto(), 'aparelho-1.png');
saleForm.append('itemPhotos:1', tinyPhoto(), 'aparelho-2.png');
const sale = await call('/api/sales', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf },
  body: saleForm,
});
assert.equal(sale.body.number, 1);
const saleId = String(sale.body.id);
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
const conflictingSaleForm = new FormData();
conflictingSaleForm.set(
  'payload',
  JSON.stringify({
    ...salePayload,
    items: [
      { serial: 'HC9P06R095', priceCents: 449_999 },
      { serial: 'HC9P06R096', priceCents: 450_001 },
    ],
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
  expected: 409,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({
    operationId: crypto.randomUUID(),
    method: 'pix',
    pixAccountId: crypto.randomUUID(),
    amountCents: 1,
  }),
});
assert.equal(invalidPixPayment.body.code, 'PIX_ACCOUNT_INVALID');

const concurrentPaymentOperationId = crypto.randomUUID();
const [concurrentCash, concurrentPix] = await Promise.all([
  call(`/api/sales/${saleId}/payments`, {
    method: 'POST',
    cookie: ownerCookie,
    expected: [201, 409],
    headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
    body: JSON.stringify({
      operationId: concurrentPaymentOperationId,
      method: 'cash',
      pixAccountId: null,
      amountCents: 25_000,
    }),
  }),
  call(`/api/sales/${saleId}/payments`, {
    method: 'POST',
    cookie: ownerCookie,
    expected: [201, 409],
    headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
    body: JSON.stringify({
      operationId: concurrentPaymentOperationId,
      method: 'pix',
      pixAccountId: pixId,
      amountCents: 25_000,
    }),
  }),
]);
assert.deepEqual(
  [concurrentCash.response.status, concurrentPix.response.status].sort(
    (left, right) => left - right,
  ),
  [201, 409],
);
const concurrentConflict =
  concurrentCash.response.status === 409 ? concurrentCash : concurrentPix;
assert.equal(concurrentConflict.body.code, 'OPERATION_ALREADY_USED');
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
  1,
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

await call(`/api/sales/${saleId}/order-status`, {
  method: 'PATCH',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ orderStatusId: pendingStatusId }),
});
const appendedAttachments = new FormData();
appendedAttachments.append('receipts', tinyPdf(), 'comprovante-depois.pdf');
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
assert.equal(appended.body.receiptsAdded, 1);
assert.equal(appended.body.itemPhotosAdded, 1);

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
    receipts: unknown[];
  }>
)[0];
assert.equal(editedSale.orderStatus?.id, pendingStatusId);
assert.equal(editedSale.orderStatus?.name, 'Pagamento pendente');
assert.equal(editedSale.orderStatus?.color, 'orange');
assert.equal(editedSale.receipts.length, 1);
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
    'HC9P06R096',
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

await call(`/api/sales/${saleId}/cancel`, {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ reason: 'Cancelamento do ensaio local' }),
});
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
const cancelledAttachment = new FormData();
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
  body: JSON.stringify({ reason: 'Segunda tentativa de cancelamento' }),
});

const afterCancel = await call('/api/inventory/lookup?serial=HC9P06R095', {
  cookie: ownerCookie,
});
assert.equal(
  (afterCancel.body.matches as Array<{ status: string }>)[0].status,
  'available',
);

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
await call('/api/bootstrap', { cookie: staffCookie });

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
assert.ok(
  (missingReceiptAlerts.body.items as Array<{ id: string }>).some(
    (item) => item.id === activeSaleId,
  ),
);
const activeReceipt = new FormData();
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
  !(completedSaleAlerts.body.items as Array<{ id: string }>).some(
    (item) => item.id === activeSaleId,
  ),
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
assert.equal(manifest.status, 200);
const privacy = await fetch(`${baseUrl}/privacidade`);
assert.equal(privacy.status, 200);
const terms = await fetch(`${baseUrl}/termos`);
assert.equal(terms.status, 200);

console.log('Production integration flow passed.');
