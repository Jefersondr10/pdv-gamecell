import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { clear, update } from 'idb-keyval';

globalThis.window = new EventTarget();
globalThis.BroadcastChannel = undefined;
const api = await import('../lib/client-operation-recovery.ts');
const secondTab =
  await import('../lib/client-operation-recovery.ts?second-tab');
const context = {
  storeId: 'isolated-store',
  userId: 'isolated-user',
  csrfToken: 'test-only-not-a-secret',
};
const committed = new Map();
let posts = 0;
let requests = 0;
let mode = 'ok';
let release;
const form = (id, content = 'unit-A') => {
  const body = new FormData();
  body.set('payload', JSON.stringify({ operationId: id, serial: content }));
  body.append(
    'photos',
    new File(['test-photo'], 'test.jpg', { type: 'image/jpeg' }),
  );
  return body;
};
const response = (value, status = 200) => Response.json(value, { status });
globalThis.fetch = async (url, init) => {
  requests++;
  if (mode === 'offline') throw new TypeError('offline');
  if (typeof url === 'string' && url.startsWith('/api/operations?')) {
    const id = new URL(url, 'https://isolated.test').searchParams.get('id');
    return response({ found: committed.has(id), result: committed.get(id) });
  }
  posts++;
  const payload = JSON.parse(init.body.get('payload'));
  assert.equal(
    new Headers(init.headers).get('x-csrf-token'),
    context.csrfToken,
  );
  if (mode === 'reject') return response({ error: 'SN já cadastrado' }, 409);
  if (mode === 'invalid-multipart')
    return response(
      { error: 'Upload incompleto', code: 'INVALID_MULTIPART' },
      400,
    );
  if (mode === 'forbidden')
    return response(
      { error: 'Acesso revogado', code: 'PERMISSION_DENIED' },
      403,
    );
  if (mode === 'BAD_CSRF' || mode === 'PASSWORD_CHANGE_REQUIRED')
    return response(
      { error: 'Sessão precisa ser atualizada', code: mode },
      403,
    );
  if (mode === 'hold')
    await new Promise((resolve) => {
      release = resolve;
    });
  const result = { id: payload.operationId, added: 1 };
  committed.set(payload.operationId, result);
  if (mode === 'lost-response')
    throw new TypeError('connection closed after commit');
  return response(result, 201);
};

await clear();
mode = 'lost-response';
const first = crypto.randomUUID();
assert.equal(
  (
    await api.submitRecoverableOperation(
      context,
      'entry',
      first,
      'Isolated entry',
      form(first),
    )
  ).id,
  first,
);
assert.equal(posts, 1);
let rows = await api.listOperations(context);
assert.equal(rows[0].state, 'confirmed');
assert.equal(rows[0].form.length, 0);
assert.equal(rows[0].foregroundAcknowledged, true);
assert.equal(JSON.stringify(rows).includes(context.csrfToken), false);
assert.equal(
  (await api.listOperations({ ...context, userId: 'another-user' })).length,
  0,
);
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'entry',
      first,
      'changed',
      form(first, 'different-unit'),
    ),
  api.PendingOperationError,
);

mode = 'offline';
const pendingId = crypto.randomUUID();
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'sale',
      pendingId,
      'Isolated sale',
      form(pendingId),
    ),
  api.PendingOperationError,
);
rows = await api.listOperations(context);
const pending = rows.find((row) => row.id === pendingId);
assert.equal(pending.state, 'pending');
assert.ok(pending.form.length);
assert.ok(pending.nextAttemptAt > Date.now());
await assert.rejects(() => api.acknowledgeOperation(pending));
await assert.rejects(() =>
  api.recoverOperation({ ...context, userId: 'another-user' }, pending),
);
mode = 'ok';
committed.set(pendingId, { id: pendingId, number: 3 });
const before = posts;
const beforeAutomatic = requests;
assert.deepEqual(await api.recoverPendingOperations(context), []);
assert.equal(
  requests,
  beforeAutomatic,
  'automatic retries must respect backoff',
);
const manualProgress = [];
const resumed = await api.recoverPendingOperations(context, {
  manual: true,
  onProgress: (row, index, total) =>
    manualProgress.push([row.id, index, total]),
});
assert.equal(resumed[0].state, 'confirmed');
assert.deepEqual(manualProgress, [[pendingId, 1, 1]]);
assert.equal(
  (await api.listOperations(context)).find((row) => row.id === pendingId).result
    .number,
  3,
);
assert.equal(
  posts,
  before,
  'A restarted app finds the existing commit without a second POST',
);

const rejectedId = crypto.randomUUID();
mode = 'reject';
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'entry',
      rejectedId,
      'Rejected fixture',
      form(rejectedId),
    ),
  api.RejectedOperationError,
);
const rejected = (await api.listOperations(context)).find(
  (row) => row.id === rejectedId,
);
assert.equal(rejected.state, 'rejected');
assert.equal(rejected.form.length, 0);

mode = 'forbidden';
const forbiddenId = crypto.randomUUID();
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'sale',
      forbiddenId,
      'Revoked access',
      form(forbiddenId),
    ),
  api.RejectedOperationError,
);
assert.equal(
  (await api.listOperations(context)).find((row) => row.id === forbiddenId)
    .state,
  'rejected',
);

for (const recoverableCode of ['BAD_CSRF', 'PASSWORD_CHANGE_REQUIRED']) {
  mode = recoverableCode;
  const sessionId = crypto.randomUUID();
  await assert.rejects(
    () =>
      api.submitRecoverableOperation(
        context,
        'sale',
        sessionId,
        'Refresh session',
        form(sessionId),
      ),
    api.PendingOperationError,
  );
  const saved = (await api.listOperations(context)).find(
    (row) => row.id === sessionId,
  );
  assert.equal(saved.state, 'pending');
  assert.ok(
    saved.form.length,
    'Session errors must preserve the unsent payload',
  );
  assert.match(
    saved.error,
    recoverableCode === 'BAD_CSRF' ? /mesma conta e loja/ : /senha/,
  );
  mode = 'ok';
  assert.equal((await api.recoverOperation(context, saved)).id, sessionId);
}

mode = 'invalid-multipart';
const multipartId = crypto.randomUUID();
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'entry',
      multipartId,
      'Incomplete upload',
      form(multipartId),
    ),
  api.PendingOperationError,
);
const multipartPending = (await api.listOperations(context)).find(
  (row) => row.id === multipartId,
);
assert.equal(multipartPending.state, 'pending');
assert.ok(
  multipartPending.form.length,
  'A failed transport must not discard the photos',
);
assert.equal(
  (await api.listOperations(context)).filter((row) => row.id === multipartId)
    .length,
  1,
);
mode = 'ok';
assert.equal(
  (await secondTab.recoverOperation(context, multipartPending)).id,
  multipartId,
);
assert.equal(committed.has(multipartId), true);

// The exact manual-button path retries immediately, exposes failures, and
// retains payloads. A later successful click uses the same operation ID.
await clear();
mode = 'offline';
const manualId = crypto.randomUUID();
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'sale',
      manualId,
      'Manual recovery',
      form(manualId),
    ),
  api.PendingOperationError,
);
const savedManual = (await api.listOperations(context))[0];
assert.match(savedManual.error, /internet/);
const attemptsBeforeClick = requests;
const failedManual = await api.recoverPendingOperations(context, {
  manual: true,
});
assert.equal(failedManual[0].state, 'pending');
assert.match(failedManual[0].error, /internet/);
assert.ok(
  requests > attemptsBeforeClick,
  'manual click must attempt a request despite backoff',
);
assert.ok(
  (await api.listOperations(context))[0].form.length,
  'retry failure retains attachments',
);
mode = 'ok';
const postsBeforeManual = posts;
const [clickOne, clickTwo] = await Promise.all([
  api.recoverPendingOperations(context, { manual: true }),
  api.recoverPendingOperations(context, { manual: true }),
]);
assert.equal(clickOne[0].state, 'confirmed');
assert.equal(clickTwo[0].state, 'confirmed');
assert.equal(posts, postsBeforeManual + 1, 'double-clicks reuse one upload');
assert.equal((await api.listOperations(context))[0].error, undefined);

// An app restart may keep a seven-minute lease although the sale was saved.
// Manual confirmation may look it up, but cannot steal an active upload lease.
await clear();
mode = 'offline';
const leasedId = crypto.randomUUID();
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'sale',
      leasedId,
      'Mobile restarted',
      form(leasedId),
    ),
  api.PendingOperationError,
);
const leasedKey = `pdv:outbox:v1:${context.storeId}:${context.userId}:sale:${leasedId}`;
await update(leasedKey, (row) => ({
  ...row,
  leaseOwner: 'other-tab',
  leaseUntil: Date.now() + 420_000,
}));
mode = 'ok';
const beforeLeaseCheck = posts;
const unconfirmedLease = await secondTab.recoverPendingOperations(context, {
  manual: true,
});
assert.equal(unconfirmedLease[0].state, 'pending');
assert.match(unconfirmedLease[0].error, /envio anterior.*andamento/);
assert.equal(
  posts,
  beforeLeaseCheck,
  'a manual check must not resend an active lease',
);
assert.equal((await api.listOperations(context))[0].leaseOwner, 'other-tab');
committed.set(leasedId, { id: leasedId, number: 7 });
const confirmedLease = await secondTab.recoverPendingOperations(context, {
  manual: true,
});
assert.equal(confirmedLease[0].state, 'confirmed');
assert.equal(
  posts,
  beforeLeaseCheck,
  'recover committed sale without reposting',
);
assert.equal((await api.listOperations(context))[0].result.number, 7);

mode = 'hold';
const simultaneousId = crypto.randomUUID();
const submitting = api.submitRecoverableOperation(
  context,
  'entry',
  simultaneousId,
  'Two tabs fixture',
  form(simultaneousId),
);
while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
const active = (await api.listOperations(context)).find(
  (row) => row.id === simultaneousId,
);
const count = posts;
await assert.rejects(
  () => secondTab.recoverOperation(context, active),
  secondTab.PendingOperationError,
);
assert.equal(
  posts,
  count,
  'Persistent lease prevents concurrent uploads from another tab',
);
release();
await submitting;

// oxlint-disable-next-line typescript/unbound-method -- The test always invokes this original method with its IDBObjectStore receiver via call().
const originalPut = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function () {
  throw new DOMException('test full disk', 'QuotaExceededError');
};
const requestsBeforeFull = requests;
await assert.rejects(
  () =>
    api.submitRecoverableOperation(
      context,
      'sale',
      crypto.randomUUID(),
      'Quota fixture',
      form('quota'),
    ),
  /nenhum envio foi iniciado/,
);
assert.equal(requests, requestsBeforeFull);
IDBObjectStore.prototype.put = function (value, key) {
  if (value?.state === 'confirmed')
    throw new DOMException(
      'test disk failed after commit',
      'QuotaExceededError',
    );
  return originalPut.call(this, value, key);
};
mode = 'ok';
const confirmedDespiteStorage = crypto.randomUUID();
assert.equal(
  (
    await api.submitRecoverableOperation(
      context,
      'entry',
      confirmedDespiteStorage,
      'Confirmed fixture',
      form(confirmedDespiteStorage),
    )
  ).id,
  confirmedDespiteStorage,
);
IDBObjectStore.prototype.put = originalPut;
await clear();
console.log(
  'PASS: manual retry ignores backoff with visible errors; automatic backoff, lost response/restart, active-lease lookup without reupload, double-clicks, immutable payload, tenant/actor isolation, rejection, cross-tab lease and quota safety.',
);
