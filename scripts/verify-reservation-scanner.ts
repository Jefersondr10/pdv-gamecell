import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCandidate } from '../lib/scanner.ts';
import {
  addReservationUnit,
  resolveReservationScan,
  type ReservationSerialMatch,
} from '../lib/reservation-scan.ts';
import { routePermissions } from '../lib/server/permissions.ts';

const scan = normalizeCandidate('SHC9P06R095', 'code_128', 'apple_serial')!;
const match: ReservationSerialMatch = {
  unitId: 'unit-1',
  serial: 'HC9P06R095',
  status: 'available',
  product: 'iPhone 16',
  detail: 'Preto · 128 GB',
  defaultPriceCents: 350000,
};
const item = await resolveReservationScan(scan, async (query) => {
  assert.deepEqual(query.getAll('serial'), ['SHC9P06R095', 'HC9P06R095']);
  return { matches: [match] };
});
assert.equal(item.id, match.unitId);
assert.equal(item.serial, match.serial);
assert.equal(item.productName, match.product);
assert.equal(item.productDetail, match.detail);
assert.deepEqual(addReservationUnit([], item), [item]);
assert.throws(() => addReservationUnit([item], item), /já está selecionado/);
assert.throws(
  () =>
    addReservationUnit(
      Array.from({ length: 50 }, (_, index) => ({
        ...item,
        id: `other-${index}`,
      })),
      item,
    ),
  /Limite de 50/,
);
assert.throws(
  () => addReservationUnit([], { ...item, status: 'reserved' }),
  /não está disponível/,
);
assert.deepEqual(
  await resolveReservationScan(scan, async () => ({ matches: [match, match] })),
  item,
);
await assert.rejects(
  resolveReservationScan(scan, async () => ({ matches: [] })),
  /não encontrado/,
);
await assert.rejects(
  resolveReservationScan(scan, async () => ({
    matches: [
      match,
      { ...match, unitId: 'another-unit', serial: scan.normalizedValue },
    ],
  })),
  /mais de um resultado/,
);
await assert.rejects(
  resolveReservationScan(scan, async () => ({
    matches: [{ ...match, status: 'reserved' }],
  })),
  /já está reservado/,
);
await assert.rejects(
  resolveReservationScan(scan, async () => ({
    matches: [{ ...match, status: 'sold' }],
  })),
  /já foi vendido/,
);
await assert.rejects(
  resolveReservationScan(scan, async () => {
    throw new Error('Sem conexão');
  }),
  /Sem conexão/,
);
assert.equal(
  normalizeCandidate('353915104521117', 'code_128', 'apple_serial'),
  null,
  'IMEI must not become a reservation SN',
);
assert.ok(
  routePermissions(
    new Request('http://localhost/api/inventory/lookup'),
  )?.includes('reservations'),
);
const view = readFileSync(
  new URL('../components/pdv/views/reservations-view.tsx', import.meta.url),
  'utf8',
);
assert.match(view, /<BarcodeScanner\s+autoStart\s+mode="apple_serial"/);
assert.ok(view.includes('controller.signal.aborted'));
assert.ok(view.includes('scanRequest.current?.abort()'));
assert.ok(view.includes('saving.current || scanRequest.current'));
console.log(
  'PASS: reservation scanner exact lookup, S-prefix aliases, available/sold/reserved/unknown/ambiguous SN, duplicates, 50-unit limit, errors and permissions.',
);
