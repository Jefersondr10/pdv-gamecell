import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCandidate } from '../lib/scanner.ts';
import { isStockSerialQuery, resolveStockScan } from '../lib/stock-scan.ts';
import { defaultScannerInput } from '../lib/scanner-input.ts';

for (const userAgent of [
  'Mozilla Windows NT 10.0',
  'Mozilla Macintosh',
  'Mozilla Linux x86_64',
]) {
  assert.equal(
    defaultScannerInput({ userAgent, coarsePointer: false, canHover: true }),
    'keyboard',
  );
}
for (const userAgent of [
  'Mozilla iPhone Mobile',
  'Mozilla Android Mobile',
  'Mozilla iPad',
]) {
  assert.equal(
    defaultScannerInput({ userAgent, coarsePointer: true, canHover: false }),
    'camera',
  );
}
assert.equal(
  defaultScannerInput({
    userAgent: 'Mozilla Macintosh',
    coarsePointer: true,
    canHover: false,
  }),
  'camera',
  'iPad desktop mode uses camera',
);
assert.equal(
  defaultScannerInput({
    userAgent: 'Mozilla Windows NT 10.0',
    coarsePointer: false,
    canHover: true,
  }),
  'keyboard',
  'Touch-capable desktop with primary mouse keeps keyboard default',
);
assert.equal(
  defaultScannerInput({
    userAgent: 'Mozilla Android Mobile',
    coarsePointer: false,
    canHover: true,
  }),
  'camera',
  'Phone with a mouse still defaults to camera',
);

const products = [
  { id: 'upc', codes: [{ code: '195950638011' }] },
  { id: 'ean', codes: [{ code: '04006381333931' }] },
  { id: 'upce', codes: [{ code: '00042100005264' }] },
];
const noSerialLookup = async () => {
  throw new Error('Commercial codes must not query serials');
};
for (const [raw, format, expected] of [
  ['0195950638011', 'ean_13', 'upc'],
  ['4006381333931', 'ean_13', 'ean'],
  ['04252614', 'upc_e', 'upce'],
  ['04252614', 'manual_gtin', 'upce'],
] as const) {
  const scan = normalizeCandidate(raw, format, 'product');
  assert.ok(scan);
  assert.deepEqual(
    (await resolveStockScan(scan, 'product', products, noSerialLookup))
      .productIds,
    [expected],
  );
}
const unknown = normalizeCandidate('036000291452', 'upc_a', 'product')!;
assert.deepEqual(
  (await resolveStockScan(unknown, 'product', products, noSerialLookup))
    .productIds,
  [],
);
const serial = normalizeCandidate('SHC9P06R095', 'code_128', 'apple_serial')!;
let requested = '';
assert.deepEqual(
  await resolveStockScan(serial, 'apple_serial', products, async (query) => {
    requested = query;
    return { productIds: ['sold-product', 'sold-product'] };
  }),
  { query: 'SHC9P06R095', productIds: ['sold-product'] },
);
assert.equal(requested, 'SHC9P06R095');
assert.deepEqual(
  (
    await resolveStockScan(serial, 'apple_serial', products, async () => ({
      productIds: [],
    }))
  ).productIds,
  [],
);
await assert.rejects(
  resolveStockScan(serial, 'apple_serial', products, async () => {
    throw new Error('Offline');
  }),
  /Offline/,
);
assert.equal(
  isStockSerialQuery('HCABCDEFGH'),
  true,
  'Letter-only serials must be searchable',
);
assert.equal(isStockSerialQuery('SHC9P06R095'), true);
assert.equal(isStockSerialQuery('iPhone 16'), false);
assert.equal(isStockSerialQuery('abc'), false);
assert.equal(
  normalizeCandidate('353915104521117', 'code_128', 'apple_serial'),
  null,
);
assert.equal(
  normalizeCandidate('modelo195950638011', 'manual_gtin', 'product'),
  null,
);
assert.equal(
  normalizeCandidate('4006381333932', 'manual_gtin', 'product'),
  null,
);
const stock = readFileSync(
  new URL('../components/pdv/views/stock-production-view.tsx', import.meta.url),
  'utf8',
);
const scanner = readFileSync(
  new URL('../components/pdv/barcode-scanner.tsx', import.meta.url),
  'utf8',
);
assert.ok(stock.includes('Bipar código ou SN para pesquisar no estoque'));
assert.ok(stock.includes('right-1 top-1/2'));
assert.ok(scanner.includes('event.preventDefault()'));
assert.ok(scanner.includes('scannerInputPreference'));
assert.ok(
  scanner.includes("input !== 'camera'"),
  'Never auto-start camera before choosing device default or in keyboard mode',
);
assert.ok(
  scanner.includes('void service.stop(false)'),
  'Closing the reader stops camera tracks',
);
console.log(
  'PASS: stock camera/keyboard lookups, UPC/EAN/UPC-E aliases, unknown codes, sold serials, letter-only SNs, lookup errors and input safeguards.',
);
