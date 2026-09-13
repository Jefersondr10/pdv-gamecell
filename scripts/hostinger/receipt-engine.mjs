import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractReceiptDocument,
  needsReceiptOcrEnrichment,
  preferReceiptReading,
} from '../../lib/receipt-document.ts';

let busy = false;
await Promise.all(
  [
    '/usr/bin/pdftotext',
    '/usr/bin/pdftoppm',
    '/usr/bin/tesseract',
    '/usr/bin/heif-convert',
    '/usr/share/tesseract-ocr/5/tessdata/por.traineddata',
  ].map((path) => access(path)),
);
function command(binary, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('READ_FAILED'));
      return;
    }
    const child = spawn(binary, args, {
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: '/usr/bin:/bin', OMP_THREAD_LIMIT: '1', LANG: 'C.UTF-8' },
    });
    const chunks = [];
    let size = 0;
    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    signal.addEventListener('abort', kill, { once: true });
    const deadline = setTimeout(kill, 50_000);
    child.stdout.on('data', (bytes) => {
      size += bytes.length;
      if (size > 512_000) kill();
      else chunks.push(bytes);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', kill);
      if (code === 0 && !signal.aborted)
        resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error('READ_FAILED'));
    });
  });
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.end('ok');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/read') {
    response.writeHead(404).end();
    return;
  }
  if (busy) {
    response.writeHead(503).end();
    return;
  }
  const mime = request.headers['content-type'];
  if (
    ![
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ].includes(mime)
  ) {
    response.writeHead(422).end();
    return;
  }
  busy = true;
  const abort = new AbortController();
  const timeout = setTimeout(() => {
    abort.abort();
    if (!request.complete) request.destroy();
  }, 115_000);
  response.on('close', () => {
    if (!response.writableFinished) abort.abort();
  });
  let directory;
  try {
    let total = 0;
    const chunks = [];
    for await (const bytes of request) {
      total += bytes.length;
      if (total > 12 * 1024 * 1024) throw new Error('LIMIT');
      chunks.push(bytes);
    }
    if (!total || abort.signal.aborted) throw new Error('INVALID');
    directory = await mkdtemp(join(tmpdir(), 'receipt-'));
    const input = join(directory, 'input');
    await writeFile(input, Buffer.concat(chunks), { mode: 0o600 });
    let suggestion = null;
    const readings = [];
    const needsDetails = () => needsReceiptOcrEnrichment(suggestion);
    const remember = (text) => {
      readings.push(extractReceiptDocument(text));
      suggestion = preferReceiptReading(readings);
    };
    let imagePath = input;
    if (mime === 'image/heic' || mime === 'image/heif') {
      await command(
        '/usr/bin/heif-convert',
        ['-q', '95', input, join(directory, 'converted.jpg')],
        abort.signal,
      );
      const converted = (await readdir(directory)).filter(
        (name) => name.startsWith('converted') && name.endsWith('.jpg'),
      );
      if (converted.length !== 1) {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ amountCents: null, confidence: null }));
        return;
      }
      imagePath = join(directory, converted[0]);
    }
    if (mime === 'application/pdf') {
      const text = await command(
        '/usr/bin/pdftotext',
        ['-f', '1', '-l', '3', '-layout', input, '-'],
        abort.signal,
      );
      remember(text);
      if (needsDetails()) {
        await command(
          '/usr/bin/pdftoppm',
          [
            '-f',
            '1',
            '-l',
            '1',
            '-singlefile',
            '-scale-to',
            '2000',
            '-png',
            input,
            join(directory, 'page'),
          ],
          abort.signal,
        );
        imagePath = join(directory, 'page.png');
      }
    }
    if (needsDetails())
      remember(
        await command(
          '/usr/bin/tesseract',
          [imagePath, 'stdout', '-l', 'por', '--oem', '1', '--psm', '6'],
          abort.signal,
        ),
      );
    if (needsDetails() && !abort.signal.aborted)
      remember(
        await command(
          '/usr/bin/tesseract',
          [imagePath, 'stdout', '-l', 'por', '--oem', '1', '--psm', '11'],
          abort.signal,
        ),
      );
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    response.end(
      JSON.stringify({
        amountCents: suggestion?.amountCents ?? null,
        confidence: suggestion?.confidence ?? null,
        details: suggestion?.details ?? null,
      }),
    );
  } catch {
    if (!response.headersSent) response.writeHead(503);
    response.end();
  } finally {
    clearTimeout(timeout);
    abort.abort();
    if (directory) await rm(directory, { recursive: true, force: true });
    busy = false;
  }
}).listen(3001, '0.0.0.0');
