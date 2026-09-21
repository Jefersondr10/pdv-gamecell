import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
export async function checkPublicReportsHttp(
  origin: string,
  cookie: string,
  csrf: string,
  directory: string,
) {
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  assert.ok(directory.includes('pdv-isolated-validation-'));
  const doc = await PDFDocument.create();
  doc.addPage().drawText('RELATORIO SINTETICO - SEM DADOS REAIS');
  const bytes = await doc.save();
  const op = crypto.randomUUID();
  const payload = (hours = '24') => {
    const data = new FormData();
    data.set(
      'file',
      new File([bytes as BlobPart], 'teste.pdf', { type: 'application/pdf' }),
    );
    data.set('title', 'Teste isolado');
    data.set('hours', hours);
    data.set('consent', 'public');
    data.set('operationId', op);
    return data;
  };
  const headers = { origin, cookie, 'x-csrf-token': csrf };
  assert.equal((await fetch(`${origin}/api/report-shares`)).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/report-shares`, {
        method: 'POST',
        headers: { origin, cookie },
        body: payload(),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/report-shares`, {
        method: 'POST',
        headers: { ...headers, origin: 'https://outside.invalid' },
        body: payload(),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/report-shares`, {
        method: 'POST',
        headers,
        body: payload('0'),
      })
    ).status,
    400,
  );
  const created = await fetch(`${origin}/api/report-shares`, {
    method: 'POST',
    headers,
    body: payload(),
  });
  const share = (await created.json()) as {
    id: string;
    url: string;
    expiresAt: number;
    createdAt: number;
    error?: string;
  };
  assert.equal(created.status, 201, JSON.stringify(share));
  assert.equal(share.expiresAt - share.createdAt, 86400_000);
  const replay = await fetch(`${origin}/api/report-shares`, {
    method: 'POST',
    headers,
    body: payload(),
  });
  assert.equal(((await replay.json()) as { id: string }).id, share.id);
  const publicPdf = await fetch(share.url);
  assert.equal(publicPdf.status, 200);
  assert.equal(publicPdf.headers.get('content-type'), 'application/pdf');
  assert.match(publicPdf.headers.get('cache-control')!, /no-store/);
  assert.match(publicPdf.headers.get('x-robots-tag')!, /noindex/);
  assert.equal(
    (await PDFDocument.load(await publicPdf.arrayBuffer())).getPageCount(),
    1,
  );
  assert.equal(
    (await fetch(`${origin}/api/public-reports/${'a'.repeat(43)}`)).status,
    404,
  );
  const db = new DatabaseSync(join(directory, 'pdv.sqlite'));
  const attachment = String(
    db
      .prepare('SELECT attachment_id AS id FROM report_shares WHERE id=?')
      .get(share.id)!.id,
  );
  assert.equal((await fetch(`${origin}/api/files/${attachment}`)).status, 401);
  db.prepare('UPDATE report_shares SET expires_at=? WHERE id=?').run(
    Date.now() - 1,
    share.id,
  );
  assert.equal((await fetch(share.url)).status, 404);
  db.prepare('UPDATE report_shares SET expires_at=? WHERE id=?').run(
    Date.now() + 3600_000,
    share.id,
  );
  const revoked = await fetch(`${origin}/api/report-shares`, {
    method: 'DELETE',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ id: share.id }),
  });
  assert.equal(revoked.status, 200);
  assert.equal((await fetch(share.url)).status, 404);
  db.close();
  console.log(
    'PASS: public report HTTP upload, CSRF, origin, anonymous read, private file guard, replay, expiry and revocation.',
  );
}
