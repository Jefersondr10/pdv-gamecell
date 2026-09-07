import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { SqliteDatabase } from './node/sqlite.mjs';
import { FileObjectStore } from './node/object-store.mjs';

let value: Record<string, unknown> | undefined;

export function provideRuntime() {
  if (!value) {
    const directory = process.env.PDV_DATA_DIR;
    if (!directory || !isAbsolute(directory))
      throw new Error('PDV_DATA_DIR deve ser absoluto.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    value = {
      ...process.env,
      DB: new SqliteDatabase(join(directory, 'pdv.sqlite')),
      FILES: new FileObjectStore(join(directory, 'objects')),
    };
  }
  return value;
}
