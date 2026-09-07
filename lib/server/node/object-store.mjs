import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class FileObjectStore {
  constructor(directory) {
    if (!isAbsolute(directory)) throw new Error('Object directory must be absolute');
    this.directory = directory;
  }
  objectPath(key) {
    if (typeof key !== 'string' || !key || key.length > 1024) throw new Error('Invalid object key');
    // Keys never become filesystem paths, so traversal and absolute paths cannot escape.
    return join(this.directory, createHash('sha256').update(key).digest('hex'));
  }
  async put(key, body, options = {}) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const destination = this.objectPath(key);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const hash = createHash('sha256');
    let size = 0;
    const transform = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    } });
    const stream = body?.getReader ? Readable.fromWeb(body) : Readable.from([typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)]);
    try {
      await pipeline(stream, transform, createWriteStream(temporary, { mode: 0o600, flags: 'wx', flush: true }));
      const metadata = { key, size, etag: hash.digest('hex'), uploaded: new Date().toISOString(), ...options };
      await pipeline(Readable.from([JSON.stringify(metadata)]), createWriteStream(`${temporary}.json`, { mode: 0o600, flags: 'wx', flush: true }));
      await rename(temporary, `${destination}.blob`);
      await rename(`${temporary}.json`, `${destination}.json`);
      return metadata;
    } catch (error) {
      await Promise.allSettled([unlink(temporary), unlink(`${temporary}.json`)]);
      throw error;
    }
  }
  async get(key) {
    const destination = this.objectPath(key);
    let metadata;
    try { metadata = JSON.parse(await readFile(`${destination}.json`, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (metadata.key !== key) throw new Error('Object metadata mismatch');
    return { ...metadata, httpEtag: `"${metadata.etag}"`, body: Readable.toWeb(createReadStream(`${destination}.blob`)) };
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const destination = this.objectPath(key);
      for (const suffix of ['.json', '.blob']) {
        try { await unlink(`${destination}${suffix}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  async list({ prefix = '', cursor = '', limit = 1000 } = {}) {
    let names;
    try { names = await readdir(this.directory); }
    catch (error) { if (error.code === 'ENOENT') return { objects: [], truncated: false }; throw error; }
    const objects = [];
    for (const name of names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const metadata = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
      if (metadata.key.startsWith(prefix) && metadata.key > cursor) objects.push(metadata);
    }
    objects.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    return { objects: objects.slice(0, limit), truncated: objects.length > limit, cursor: objects.length > limit ? objects[limit - 1].key : undefined };
  }
}
