import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { SqliteDatabase } from './node/sqlite.mjs';
import { FileObjectStore } from './node/object-store.mjs';
import { startReceiptJobs } from './node/receipt-jobs.mjs';
import { startFileDeletionJobs } from './node/file-deletion-jobs.mjs';
import { startReceiptPaymentJobs } from './node/receipt-payment-jobs.mjs';
import { readBackupStatus } from './node/backup-status.mjs';

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
      READ_BACKUP_STATUS: () => readBackupStatus(directory),
    };
    startFileDeletionJobs(value.DB, value.FILES);
    startReceiptPaymentJobs(value.DB);
    if (process.env.RECEIPT_OCR_ENGINE_URL)
      startReceiptJobs(
        value.DB,
        value.FILES,
        process.env.RECEIPT_OCR_ENGINE_URL,
      );
  }
  return value;
}
