import assert from 'node:assert/strict';
import { prepareUploadForm } from '../lib/client-upload.ts';
import { requestJson } from '../lib/client-api.ts';

const bytes = Uint8Array.from([0, 255, 128, 13, 10, 34, 137, 80, 78, 71]);
const form = new FormData();
form.append('payload', '{"modelo":"Azul-névoa","operationId":"same-id"}');
form.append(
  'photos',
  new File([bytes], 'Caixa — frente.jpg', { type: 'image/jpeg' }),
);
form.append(
  'photos',
  new File([bytes], 'IMG_0002.HEIC', { type: 'image/heic' }),
);
form.append(
  'receipts',
  new File(['%PDF-1.7\nfixture'], 'Comprovante.pdf', {
    type: 'application/pdf',
  }),
);
const sources = form.getAll('photos');
let reads = 0;
for (const source of sources) {
  const read = source.arrayBuffer.bind(source);
  source.arrayBuffer = () => {
    reads++;
    return read();
  };
}
const prepared = await prepareUploadForm(form);
assert.equal(reads, 2);
assert.equal(prepared.get('payload'), form.get('payload'));
for (const [index, photo] of prepared.getAll('photos').entries()) {
  assert.notEqual(
    photo,
    sources[index],
    'Never pass the restored/disk-backed File to fetch',
  );
  assert.equal(photo.name, sources[index].name);
  assert.equal(photo.type, sources[index].type);
  assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), bytes);
}
// Exercise the real multipart encoder/parser with repeated names and binary data.
const wire = new Request('https://isolated.test/upload', {
  method: 'POST',
  body: prepared,
});
const decoded = await new Response(await wire.arrayBuffer(), {
  headers: { 'content-type': wire.headers.get('content-type') },
}).formData();
assert.equal(decoded.getAll('photos').length, 2);
assert.equal(decoded.getAll('photos')[0].name, 'Caixa — frente.jpg');
assert.equal(await decoded.get('receipts').text(), '%PDF-1.7\nfixture');
let calls = 0;
globalThis.fetch = async (_url, init) => {
  calls++;
  assert.equal(new Headers(init.headers).get('x-csrf-token'), 'fixture');
  assert.equal(
    new Headers(init.headers).get('content-type'),
    null,
    'Browser must generate the matching boundary',
  );
  for (const [index, file] of init.body.getAll('photos').entries()) {
    assert.notEqual(file, sources[index]);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  }
  return Response.json({ ok: true });
};
assert.deepEqual(
  await requestJson('/api/entries', {
    method: 'POST',
    headers: {
      'x-csrf-token': 'fixture',
      'Content-Type': 'multipart/form-data; boundary=stale',
    },
    body: form,
  }),
  { ok: true },
);
assert.equal(calls, 1);
sources[0].arrayBuffer = () => Promise.resolve(new ArrayBuffer(0));
await assert.rejects(
  () => requestJson('/api/entries', { method: 'POST', body: form }),
  /abrir um dos anexos/,
);
assert.equal(
  calls,
  1,
  'No request may be sent with an unreadable or truncated file',
);
sources[0].arrayBuffer = () => Promise.reject(new Error('Disk unavailable'));
await assert.rejects(() => prepareUploadForm(form), /abrir um dos anexos/);
const controller = new AbortController();
controller.abort();
await assert.rejects(() => prepareUploadForm(form, controller.signal), {
  name: 'AbortError',
});
assert.equal(calls, 1);
console.log(
  'Upload preparation passed: in-memory copies, original names/types/bytes, multiple photos/PDF, generated boundary, unreadable files and abort.',
);
