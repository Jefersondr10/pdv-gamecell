import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { clear, update } from 'idb-keyval';

globalThis.window = new EventTarget();
globalThis.BroadcastChannel = undefined;
const api = await import('../lib/client-operation-recovery.ts');
const context = {
  storeId: 'attachment-fixture',
  userId: 'owner',
  csrfToken: 'test-only',
};
const committed = new Map();
let offline = true;
let posts = 0;
let lastPayload;
let lastFiles;
globalThis.fetch = async (url, init) => {
  if (offline) throw new TypeError('offline');
  if (url.startsWith('/api/operations?')) {
    const id = new URL(url, 'https://test.invalid').searchParams.get('id');
    return Response.json({
      found: committed.has(id),
      result: committed.get(id),
    });
  }
  posts++;
  lastPayload = init.body.get('payload');
  lastFiles = await Promise.all(
    [...init.body.entries()]
      .filter(([, value]) => typeof value !== 'string')
      .map(async ([field, file]) => ({
        field,
        name: file.name,
        type: file.type,
        bytes: [...new Uint8Array(await file.arrayBuffer())],
      })),
  );
  const result = { id: JSON.parse(lastPayload).operationId, number: 123 };
  committed.set(result.id, result);
  return Response.json(result, { status: 201 });
};
const keyFor = (row) =>
  `pdv:outbox:v1:${row.storeId}:${row.userId}:${row.kind}:${row.id}`;
const rowFor = async (id) =>
  (await api.listOperations(context)).find((row) => row.id === id);
async function pending() {
  offline = true;
  const id = crypto.randomUUID();
  const form = new FormData();
  form.set(
    'payload',
    JSON.stringify({
      operationId: id,
      customerId: 'same-customer',
      sellerUserId: 'same-seller',
      items: [{ serial: 'TEST123456', priceCents: 515000 }],
      payments: [],
    }),
  );
  form.append(
    'itemPhotos:0',
    new File([new Uint8Array([255, 216, 255, 1])], 'original.jpg', {
      type: 'image/jpeg',
    }),
  );
  form.append(
    'receipts',
    new File(['%PDF-1.7 fixture'], 'receipt.pdf', { type: 'application/pdf' }),
  );
  await assert.rejects(
    () =>
      api.submitRecoverableOperation(
        context,
        'sale',
        id,
        'Attachment fixture',
        form,
      ),
    api.PendingOperationError,
  );
  offline = false;
  return rowFor(id);
}
await clear();
// oxlint-disable-next-line typescript/unbound-method -- The original is invoked with its Blob receiver via call().
const originalRead = Blob.prototype.arrayBuffer;
// oxlint-disable-next-line typescript/unbound-method -- The original is invoked with its IDBObjectStore receiver via call().
const originalGet = IDBObjectStore.prototype.get;
const unavailable = new WeakSet();
try {
  // Simulate unreadable temporary handles only on restored IndexedDB Files.
  // Fresh File instances reconstructed from stored byte copies remain readable.
  IDBObjectStore.prototype.get = function (key) {
    const request = originalGet.call(this, key);
    request.addEventListener('success', () => {
      for (const [, value] of request.result?.form ?? [])
        if (typeof value !== 'string' && value.type === 'image/jpeg')
          unavailable.add(value);
    });
    return request;
  };
  Blob.prototype.arrayBuffer = function () {
    if (unavailable.has(this))
      return Promise.reject(new Error('Temporary file unavailable'));
    return originalRead.call(this);
  };
  const durable = await pending();
  assert.equal(durable.fileCopies.length, 2);
  const copies = durable.fileCopies.map((file) => ({
    name: file.name,
    bytes: [...new Uint8Array(file.bytes)],
  }));
  await api.recoverOperation(context, durable);
  assert.deepEqual(
    lastFiles.map((file) => ({ name: file.name, bytes: file.bytes })),
    copies,
  );
  assert.deepEqual(
    (await rowFor(durable.id)).fileCopies,
    [],
    'confirmed uploads release stored file bytes',
  );

  const legacy = await pending();
  await update(keyFor(legacy), (row) => ({ ...row, fileCopies: undefined }));
  const postsBeforeFailure = posts;
  await assert.rejects(
    () => api.recoverOperation(context, legacy),
    api.PendingOperationError,
  );
  const broken = await rowFor(legacy.id);
  assert.equal(
    posts,
    postsBeforeFailure,
    'unreadable legacy files never reach POST',
  );
  assert.equal(broken.attachmentIssue.index, 1);
  assert.equal(broken.attachmentIssue.field, 'itemPhotos:0');
  assert.match(broken.error, /Corrigir anexo/);
  const replacement = new File(
    [new Uint8Array([255, 216, 255, 2])],
    'replacement.jpg',
    { type: 'image/jpeg' },
  );
  await assert.rejects(
    () =>
      api.replaceOperationAttachment(
        { ...context, userId: 'other' },
        broken,
        1,
        replacement,
      ),
    /mesma conta/,
  );
  await assert.rejects(
    () => api.replaceOperationAttachment(context, broken, 0, replacement),
    /Anexo não encontrado/,
  );
  await assert.rejects(
    () =>
      api.replaceOperationAttachment(
        context,
        broken,
        1,
        new File(['bad'], 'wrong.pdf', { type: 'application/pdf' }),
      ),
    /foto/,
  );
  offline = true;
  await assert.rejects(
    () => api.replaceOperationAttachment(context, broken, 1, replacement),
    api.PendingOperationError,
  );
  offline = false;
  assert.equal(
    (await rowFor(broken.id)).fingerprint,
    broken.fingerprint,
    'server lookup failure must preserve originals',
  );
  await update(keyFor(broken), (row) => ({
    ...row,
    leaseOwner: 'other-tab',
    leaseUntil: Date.now() + 420000,
  }));
  await assert.rejects(
    () => api.replaceOperationAttachment(context, broken, 1, replacement),
    /envio em andamento/,
  );
  assert.equal((await rowFor(broken.id)).leaseOwner, 'other-tab');
  await update(keyFor(broken), (row) => ({
    ...row,
    leaseOwner: undefined,
    leaseUntil: undefined,
  }));
  // Failed storage writes must not remove the original or mark it repaired.
  // oxlint-disable-next-line typescript/unbound-method -- The original is invoked with its IDBObjectStore receiver via call().
  const originalPut = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function (value, key) {
      if (value?.fileCopies?.some((file) => file.name === 'replacement.jpg'))
        throw new DOMException('Full storage', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    };
    await assert.rejects(
      () => api.replaceOperationAttachment(context, broken, 1, replacement),
      /envio original foi preservado/,
    );
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.equal((await rowFor(broken.id)).fingerprint, broken.fingerprint);
  assert.deepEqual(
    await api.replaceOperationAttachment(context, broken, 1, replacement),
    { confirmed: false },
  );
  const repaired = await rowFor(broken.id);
  assert.equal(repaired.id, broken.id);
  assert.equal(
    repaired.form[0][1],
    broken.form[0][1],
    'customer, seller, SN, amounts and operation ID stay byte-for-byte unchanged',
  );
  assert.equal(repaired.attachmentIssue, undefined);
  const oldParts = JSON.parse(broken.fingerprint);
  const newParts = JSON.parse(repaired.fingerprint);
  assert.deepEqual(
    newParts.filter((_, index) => index !== 1),
    oldParts.filter((_, index) => index !== 1),
    'other attachments keep their fingerprints',
  );
  await assert.rejects(
    () => api.replaceOperationAttachment(context, broken, 1, replacement),
    /mudaram em outra aba/,
  );
  const beforeResume = posts;
  await api.recoverOperation(context, repaired);
  assert.equal(posts, beforeResume + 1);
  assert.equal(lastPayload, broken.form[0][1]);
  assert.equal(lastFiles[0].name, 'replacement.jpg');
  assert.deepEqual(lastFiles[0].bytes, [255, 216, 255, 2]);
  assert.equal(lastFiles[1].type, 'application/pdf');
  assert.equal((await rowFor(repaired.id)).state, 'confirmed');

  const alreadySaved = await pending();
  committed.set(alreadySaved.id, { id: alreadySaved.id, number: 124 });
  const beforeConfirmedRepair = posts;
  assert.deepEqual(
    await api.replaceOperationAttachment(context, alreadySaved, 1, replacement),
    { confirmed: true },
  );
  assert.equal(
    posts,
    beforeConfirmedRepair,
    'already committed sale must never be resubmitted or have attachments replaced',
  );
  assert.equal((await rowFor(alreadySaved.id)).result.number, 124);
} finally {
  Blob.prototype.arrayBuffer = originalRead;
  IDBObjectStore.prototype.get = originalGet;
  await clear();
}
console.log(
  'PASS: durable attachment bytes, legacy unreadable-file detection, scoped one-file repair, unchanged sale/other attachments, offline/lease/quota/stale guards, same-ID resume and already-committed protection.',
);
