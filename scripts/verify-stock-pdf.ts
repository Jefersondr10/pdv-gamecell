import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import {
  buildStockReportPdf,
  type StockPdfRow,
} from '../lib/stock-report-pdf.ts';

const entries: [string, string, string, number][] = [
  ['iPhone 15', 'Preto', '128 GB', 8],
  ['iPhone 16', 'Branco', '128 GB', 4],
  ['iPhone 16', 'Preto', '128 GB', 3],
  ['iPhone 16', 'Rosa', '128 GB', 6],
  ['iPhone 16', 'Ultramarino', '128 GB', 6],
  ['iPhone 16', 'Verde-azulado', '128 GB', 3],
  ['iPhone 17', 'Azul-névoa', '256 GB', 3],
  ['iPhone 17', 'Lavanda', '256 GB', 5],
  ['iPhone 17', 'Preto', '256 GB', 3],
  ['iPhone 17', 'Sálvia', '256 GB', 3],
  ['iPhone 17 Pro', 'Azul-intenso', '256 GB', 10],
  ['iPhone 17 Pro', 'Prateado', '256 GB', 6],
  ['iPhone 17 Pro Max', 'Azul-intenso', '256 GB', 5],
  ['iPhone 17 Pro Max', 'Prateado', '256 GB', 26],
];
const rows: StockPdfRow[] = entries.map(
  ([model, color, memory, available]) => ({
    model,
    color,
    memory,
    available,
    serials: [],
    photos: [],
  }),
);
const options = {
  rows,
  storeName: 'GAMECELL ATACADO',
  generatedAt: Date.parse('2026-09-09T19:25:00-03:00'),
  level: 'summary' as const,
};
const noAsset = async () => {
  throw new Error('Summary must not fetch photos');
};
const output = new URL('../tmp/pdfs/', import.meta.url);
await mkdir(output, { recursive: true });
const summary = await buildStockReportPdf(options, noAsset);
const summaryDoc = await PDFDocument.load(summary);
assert.equal(
  summaryDoc.getPageCount(),
  1,
  '14 variations should fit legibly on one A4',
);
assert.ok(summary.byteLength < 40_000, 'Vector report stays small');
await writeFile(new URL('estoque-novo.pdf', output), summary);

const detailRows = rows.map((row, index) => ({
  ...row,
  serials: Array.from(
    { length: row.available },
    (_, n) =>
      `TEST${String(index).padStart(2, '0')}${String(n).padStart(4, '0')}`,
  ),
}));
detailRows.push({
  model: 'Produto com nome bastante longo para conferir a quebra de linha',
  color: 'Azul com descrição longa de acabamento',
  memory: '1 TB',
  available: 160,
  serials: Array.from(
    { length: 160 },
    (_, n) => `LONGSERIAL${String(n).padStart(14, '0')}`,
  ),
  photos: [],
});
await writeFile(
  new URL('estoque-detalhado-teste.pdf', output),
  await buildStockReportPdf(
    { ...options, rows: detailRows, level: 'serials' },
    noAsset,
  ),
);
await assert.rejects(
  buildStockReportPdf({ ...options, level: 'serials' }),
  /estoque mudou/,
);
await writeFile(
  new URL('estoque-vazio-teste.pdf', output),
  await buildStockReportPdf({ ...options, rows: [] }, noAsset),
);
const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const photo = {
  id: 'photo-1',
  name: 'Entrada.png',
  url: '/api/files/test',
  sizeBytes: png.byteLength,
  mimeType: 'image/png',
};
let loads = 0;
const photoOptions = {
  ...options,
  rows: [{ ...rows[0], photos: [photo, photo] }],
  includePhotos: true,
};
await writeFile(
  new URL('estoque-foto-teste.pdf', output),
  await buildStockReportPdf(photoOptions, async () => {
    loads++;
    return png;
  }),
);
assert.equal(loads, 1, 'Duplicate entry photo appears once');
await assert.rejects(
  buildStockReportPdf(photoOptions, async () => {
    throw new Error('Photo failed');
  }),
  /Photo failed/,
);
console.log(
  'Stock PDF: one-page summary, vector size, serial pagination, mismatch guard, empty report and photos passed.',
);
