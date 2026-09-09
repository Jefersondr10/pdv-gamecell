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
const port = 32419;
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
const server = spawn(process.execPath, [resolve('dist/standalone/server.js')], {
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
  // Exercise the real signed-cookie return flow without visiting/calling Google.
  const reportPath =
    '/?report=sales&storeId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa&level=complete&period=day&day=2026-09-08';
  for (const [requested, expected] of [
    [reportPath, reportPath],
    ['https://outside.invalid/', '/'],
  ]) {
    const login = await fetch(
      `${origin}/api/auth/google?returnTo=${encodeURIComponent(requested)}`,
      { redirect: 'manual' },
    );
    assert.equal(login.status, 302);
    assert.equal(
      new URL(login.headers.get('location')).origin,
      'https://accounts.google.com',
    );
    const oauthCookie = login.headers.get('set-cookie').split(';')[0];
    const cancelled = await fetch(
      `${origin}/api/auth/google/callback?error=access_denied`,
      { redirect: 'manual', headers: { cookie: oauthCookie } },
    );
    const destination = new URL(cancelled.headers.get('location'));
    destination.searchParams.delete('auth_error');
    assert.equal(destination.origin, origin);
    assert.equal(destination.pathname + destination.search, expected);
  }
  console.log(
    'PASS: report login return retained; external redirects rejected; no Google network request made.',
  );
  const integration = spawn(
    process.execPath,
    [
      '--experimental-transform-types',
      resolve('scripts/integration-production.ts'),
    ],
    {
      env: {
        ...env,
        PDV_TEST_ISOLATED_DATA_DIR: directory,
        PDV_TEST_ORIGIN: origin,
        PDV_TEST_STANDALONE: '1',
        PDV_TEST_ALLOW_REMOTE: '',
        PDV_TEST_PRIMARY_TOKEN: '',
        PDV_TEST_BYPASS: '',
        PDV_TEST_RECEIPT_FIXTURE_PATH: '',
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  const code = await new Promise((resolve, reject) => {
    integration.once('error', reject);
    integration.once('exit', resolve);
  });
  if (code !== 0)
    throw new Error(
      `Isolated integration failed (${code}). Server tail: ${serverLog}`,
    );
  console.log(
    'PASS: standalone integration used a fresh synthetic database; existing stores were not touched.',
  );
} finally {
  server.kill();
}
