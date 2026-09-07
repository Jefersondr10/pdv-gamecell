import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from '../lib/server/node/sqlite.mjs';
import { FileObjectStore } from '../lib/server/node/object-store.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'pdv-storage-test-'));
const db = new SqliteDatabase(join(temporary, 'test.sqlite'));
try {
  await db.prepare('CREATE TABLE example (id TEXT PRIMARY KEY, amount INTEGER NOT NULL)').run();
  const saved = await db.batch([db.prepare('INSERT INTO example VALUES (?, ?) RETURNING id').bind('p1', 100), db.prepare('SELECT * FROM example')]);
  assert.equal(saved[0].meta.changes, 1);
  assert.equal(saved[0].results[0].id, 'p1');
  assert.equal(saved[1].meta.changes, 0);
  await assert.rejects(db.batch([db.prepare('UPDATE example SET amount=200'), db.prepare('INSERT INTO example VALUES (?, NULL)').bind('p2')]));
  assert.equal((await db.prepare('SELECT amount FROM example').first()).amount, 100);
  const store = new FileObjectStore(join(temporary, 'objects'));
  const bytes = Buffer.from('Receipt test');
  await store.put('../../outside', bytes);
  const file = await store.get('../../outside');
  assert.deepEqual(Buffer.from(await new Response(file.body).arrayBuffer()), bytes);
  assert.equal((await store.list()).objects.length, 1);
  assert.equal(await store.get('missing'), null);
  await store.delete('../../outside');
  assert.equal(await store.get('../../outside'), null);
  console.log('Node database transactions and file storage passed.');
} finally {
  db.close();
  // This is the unique mkdtemp directory created above, never application data.
  await rm(temporary, { recursive: true, force: true });
}
