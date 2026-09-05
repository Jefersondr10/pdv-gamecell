import assert from 'node:assert/strict';

const baseUrl = process.env.PDV_TEST_ORIGIN ?? 'http://127.0.0.1:3004';
const maintenanceBypass = process.env.PDV_TEST_BYPASS;
const primaryStoreToken = process.env.PDV_TEST_PRIMARY_TOKEN;
const passwordSignupToken =
  process.env.PDV_TEST_SIGNUP_TOKEN ?? primaryStoreToken;
assert.ok(passwordSignupToken, 'Informe PDV_TEST_SIGNUP_TOKEN para o teste.');
const runId = Date.now().toString(36);
let ownerCookie = '';
let ownerCsrf = '';

type JsonValue = Record<string, unknown>;

async function call(
  path: string,
  options: RequestInit & { cookie?: string; expected?: number } = {},
) {
  const headers = new Headers(options.headers);
  headers.set('origin', baseUrl);
  if (maintenanceBypass) {
    headers.set('x-production-maintenance-bypass', maintenanceBypass);
  }
  if (options.cookie) headers.set('cookie', options.cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as JsonValue) : {};
  const expected = options.expected ?? 200;
  assert.equal(
    response.status,
    expected,
    `${path}: esperado ${expected}, recebido ${response.status}: ${text}`,
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
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
    type: 'image/png',
  });
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
assert.equal('inventory' in emptyBootstrap.body, false);

const emptyStock = await call('/api/inventory?view=summary', {
  cookie: ownerCookie,
});
assert.deepEqual(emptyStock.body.rows, []);

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

const client = await call('/api/clients', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Cliente Integração' }),
});
const clientId = String(client.body.id);

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

const entryForm = new FormData();
entryForm.set(
  'payload',
  JSON.stringify({ productId, serials: ['HC9P06R095', 'SHC9P06R096'] }),
);
entryForm.append('photos', tinyPhoto(), 'entrada.png');
await call('/api/entries', {
  method: 'POST',
  cookie: ownerCookie,
  expected: 201,
  headers: { 'x-csrf-token': ownerCsrf },
  body: entryForm,
});

const duplicateForm = new FormData();
duplicateForm.set(
  'payload',
  JSON.stringify({ productId, serials: ['HC9P06R095'] }),
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

const saleForm = new FormData();
saleForm.set(
  'payload',
  JSON.stringify({
    customerId: clientId,
    items: [
      { serial: 'HC9P06R095', priceCents: 450_000 },
      { serial: 'SHC9P06R096', priceCents: 450_000 },
    ],
    payments: [{ method: 'pix', pixAccountId: pixId, amountCents: 850_000 }],
  }),
);
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
const longSearch = encodeURIComponent('ação'.repeat(40));
await call(`/api/sales?group=sale&q=${longSearch}`, { cookie: ownerCookie });
await call(`/api/entries?q=${longSearch}`, { cookie: ownerCookie });
await call(`/api/inventory?q=${longSearch}`, { cookie: ownerCookie });

const grouped = await call('/api/sales?group=model', { cookie: ownerCookie });
assert.equal(
  (grouped.body.groups as Array<{ itemCount: number }>)[0].itemCount,
  2,
);

await call(`/api/sales/${saleId}/cancel`, {
  method: 'POST',
  cookie: ownerCookie,
  headers: { 'x-csrf-token': ownerCsrf, 'content-type': 'application/json' },
  body: JSON.stringify({ reason: 'Cancelamento do ensaio local' }),
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
await call('/api/bootstrap', { cookie: staffCookie });

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
