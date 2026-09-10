// Builds must already exist. Never opens or mutates the developer/live database.
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'pdv-isolated-validation-'));
const database = new DatabaseSync(join(directory, 'pdv.sqlite'));
for (const file of (await readdir('drizzle'))
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort())
  database.exec(await readFile(join('drizzle', file), 'utf8'));
// This brand-new fixture has no old object store to clean up.
database.exec(
  "DELETE FROM login_attempts WHERE key_hash='system:production-r2-reset-pending'",
);
database
  .prepare(
    'INSERT INTO login_attempts(key_hash,attempts,blocked_until,updated_at) VALUES(?,0,NULL,?)',
  )
  .run('system:production-ready-v1', Date.now());
database.close();
const port = 32421;
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(port),
  HOST: '127.0.0.1',
  APP_ORIGIN: origin,
  PDV_DATA_DIR: directory,
  RECEIPT_OCR_ENGINE_URL: '',
  MIGRATION_TARGET_ORIGIN: '',
  MIGRATION_READ_ONLY: '',
  PRODUCTION_MAINTENANCE: '',
  PASSWORD_SIGNUP_TOKEN_V1: '',
  PRIMARY_STORE_SETUP_TOKEN_V1: randomBytes(24).toString('hex'),
  GOOGLE_CLIENT_ID: 'isolated-test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'isolated-test-not-a-real-secret',
  VINEXT_TRUST_PROXY: '1',
  VINEXT_TRUSTED_HOSTS: '127.0.0.1',
};
for (const name of [
  'SESSION_TOKEN_PEPPER_V1',
  'PASSWORD_PEPPER_V1',
  'OAUTH_STATE_SECRET_V1',
  'RATE_LIMIT_SECRET_V1',
  'RECOVERY_CODE_PEPPER_V1',
])
  env[name] = randomBytes(32).toString('hex');
// The optional entrypoint lets the same isolated suite validate the final image.
const serverEntry = resolve(process.argv[2] ?? 'dist/standalone/server.js');
const server = spawn(process.execPath, [serverEntry], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', (chunk) => {
  serverLog = (serverLog + chunk).slice(-4000);
});
server.stderr.on('data', (chunk) => {
  serverLog = (serverLog + chunk).slice(-4000);
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Isolated server stopped: ${serverLog}`);
    try {
      if ((await fetch(`${origin}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`Isolated server not ready: ${serverLog}`);

  let cookie = '',
    csrf = '';
  async function call(path, { method = 'GET', json, form, status = 200 } = {}) {
    const headers = { origin, cookie, 'x-csrf-token': csrf };
    if (json) headers['content-type'] = 'application/json';
    const response = await fetch(origin + path, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: form ?? (json ? JSON.stringify(json) : undefined) }),
    });
    const body = await response.json();
    if (!response.ok && response.status !== status)
      throw Error(path + ' ' + response.status + ' ' + JSON.stringify(body));
    if (status >= 400) assert.equal(response.status, status, path);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    return body;
  }
  await call('/api/auth/register-owner', {
    method: 'POST',
    json: {
      email: 'receipt-flow@example.invalid',
      password: 'LocalReceipt2026!',
      displayName: 'Teste',
      storeName: 'Teste isolado',
      storeCode: 'receiptflow',
    },
  });
  csrf = (await call('/api/auth/session')).csrfToken;
  const product = await call('/api/products', {
    method: 'POST',
    json: {
      model: 'iPhone Teste',
      color: 'Preto',
      memory: '256 GB',
      defaultPriceCents: 710000,
      codes: ['036000291452'],
    },
  });
  const client = await call('/api/clients', {
    method: 'POST',
    json: { name: 'Cliente fictício' },
  });
  const account = await call('/api/pix-accounts', {
    method: 'POST',
    json: { name: 'Banco Teste' },
  });
  const photo = () =>
    new Blob(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      { type: 'image/png' },
    );
  const entry = new FormData();
  entry.set(
    'payload',
    JSON.stringify({
      operationId: crypto.randomUUID(),
      productId: product.id,
      gtin14: '00036000291452',
      serials: ['TESTX00001', 'TESTX00002', 'TESTX00003'],
    }),
  );
  entry.append('photos', photo(), 'test.png');
  await call('/api/entries', { method: 'POST', form: entry });
  async function sale(serial, payments, status = 200) {
    const form = new FormData();
    form.set(
      'payload',
      JSON.stringify({
        operationId: crypto.randomUUID(),
        customerId: client.id,
        items: [{ serial, priceCents: 710000 }],
        payments,
      }),
    );
    form.append('itemPhotos:0', photo(), 'test.png');
    return call('/api/sales', { method: 'POST', form, status });
  }
  const zero = await sale('TESTX00001', []);
  const mixed = await sale('TESTX00002', [
    { method: 'cash', amountCents: 300000 },
  ]);
  await sale(
    'TESTX00003',
    [{ method: 'pix', pixAccountId: account.id, amountCents: 710000 }],
    400,
  );
  const list = async (id) =>
    (await call('/api/sales?period=all')).items.find((s) => s.id === id);
  assert.equal((await list(zero.id)).receivedTotalCents, 0);
  assert.ok((await list(zero.id)).issueKeys.includes('pending_payment'));
  assert.equal((await list(mixed.id)).receivedTotalCents, 300000);
  const form = new FormData();
  form.set('operationId', crypto.randomUUID());
  form.set(
    'receiptValues',
    JSON.stringify([{ amountCents: 410000, source: 'manual' }]),
  );
  form.append('receipts', photo(), 'receipt-test.png');
  await call('/api/sales/' + mixed.id + '/attachments', {
    method: 'POST',
    form,
  });
  let received = await list(mixed.id);
  assert.equal(received.receivedTotalCents, 710000, 'receipt + cash');
  assert.equal(received.displayStatus.key, 'reconciled');
  assert.equal(received.receipts.length, 1);
  const fixture = new DatabaseSync(join(directory, 'pdv.sqlite'));
  const rawBefore = fixture
    .prepare('SELECT received_total_cents AS amount FROM sales WHERE id=?')
    .get(mixed.id).amount;
  // Simulate a legacy manually-entered Pix total. It must never override evidence.
  fixture
    .prepare(
      "INSERT INTO payments(id,store_id,sale_id,method,amount_cents,created_at) SELECT ?,store_id,id,'pix',710000,? FROM sales WHERE id=?",
    )
    .run(crypto.randomUUID(), Date.now(), mixed.id);
  fixture
    .prepare(
      'UPDATE sales SET received_total_cents=?,received_difference_cents=?-products_total_cents WHERE id=?',
    )
    .run(rawBefore + 710000, rawBefore + 710000, mixed.id);
  fixture
    .prepare(
      "UPDATE attachments SET receipt_amount_cents=402000 WHERE sale_id=? AND kind='receipt'",
    )
    .run(mixed.id);
  received = await list(mixed.id);
  assert.equal(received.receivedTotalCents, 702000);
  assert.equal(received.receivedDifferenceCents, -8000);
  assert.ok(received.issueKeys.includes('pending_payment'));
  const cash = await call('/api/sales/' + mixed.id + '/payments', {
    method: 'POST',
    json: {
      operationId: crypto.randomUUID(),
      method: 'cash',
      amountCents: 8000,
    },
  });
  assert.equal(
    cash.sale.receivedTotalCents,
    710000,
    'cash addition ignores stale legacy Pix',
  );
  assert.equal((await list(mixed.id)).receivedTotalCents, 710000);
  await call('/api/sales/' + mixed.id + '/payments', {
    method: 'POST',
    json: {
      operationId: crypto.randomUUID(),
      method: 'pix',
      pixAccountId: account.id,
      amountCents: 100,
    },
    status: 400,
  });
  const before = (await list(mixed.id)).payments.map(
    ({ id, method, pixAccountId, amountCents }) => ({
      id,
      method,
      pixAccountId,
      amountCents,
    }),
  );
  const changed = before.map((p) =>
    p.method === 'pix' ? { ...p, amountCents: p.amountCents + 100 } : p,
  );
  await call('/api/sales/' + mixed.id + '/payments', {
    method: 'PATCH',
    json: {
      operationId: crypto.randomUUID(),
      expectedPayments: before,
      payments: changed,
    },
    status: 400,
  });
  fixture
    .prepare(
      "UPDATE attachments SET receipt_amount_cents=NULL WHERE sale_id=? AND kind='receipt'",
    )
    .run(mixed.id);
  assert.equal(
    (await list(mixed.id)).receivedTotalCents,
    308000,
    'reread excludes old Pix',
  );
  fixture.close();
  console.log(
    'PASS HTTP: sale without receipt, cash + receipt automatic reconciliation, legacy Pix ignored, cash addition with correct balance, new/manual Pix rejected and reread resets income. Test database isolated.',
  );
} finally {
  server.kill();
}
