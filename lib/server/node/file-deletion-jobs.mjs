import { processFileDeletions } from '../file-deletion.ts';
import { expireReportFiles } from '../report-file-expiry.ts';

export function startFileDeletionJobs(db, files) {
  let stopped = false;
  let timer;
  async function run() {
    try {
      await expireReportFiles(db);
      await processFileDeletions(db, files);
    } catch {
      console.error('Private file cleanup deferred; durable jobs retained.');
    }
    if (!stopped) {
      timer = setTimeout(run, 30_000);
      timer.unref?.();
    }
  }
  timer = setTimeout(run, 1000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
