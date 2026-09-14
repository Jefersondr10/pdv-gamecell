import assert from 'node:assert/strict';

import {
  serialMatchingQuery,
  restrictSerialHistoryDetails,
  serialMovements,
  type SerialHistoryResponse,
} from '../lib/serial-history.ts';

const history: SerialHistoryResponse = {
  canViewEntryDetails: true,
  canViewSaleDetails: true,
  unit: {
    id: 'unit-1',
    serial: 'SNTESTE123',
    productName: 'iPhone Teste',
    productDetail: 'Preto · 256 GB',
    status: 'sold',
  },
  entry: {
    id: 'entry-1',
    createdAt: 100,
    operatorName: 'Operador',
    note: null,
    photos: [],
  },
  sales: [
    {
      id: 'sale-cancelled',
      number: 12,
      createdAt: 200,
      status: 'cancelled',
      cancelledAt: 300,
      cancelledByName: 'Administrador',
      cancellationReason: 'Troca de aparelho',
      customerName: 'Cliente antigo',
      sellerName: 'Vendedor',
      soldPriceCents: 400_000,
      referencePriceCents: 390_000,
      photos: [],
    },
    {
      id: 'sale-current',
      number: 18,
      createdAt: 400,
      status: 'completed',
      cancelledAt: null,
      cancelledByName: null,
      cancellationReason: null,
      customerName: 'Cliente atual',
      sellerName: 'Vendedor',
      soldPriceCents: 410_000,
      referencePriceCents: 400_000,
      photos: [],
    },
  ],
};

const movements = serialMovements(history);
assert.deepEqual(
  movements.map(({ key, kind, at }) => ({ key, kind, at })),
  [
    { key: 'entry:entry-1', kind: 'entry', at: 100 },
    { key: 'sale:sale-cancelled', kind: 'sale', at: 200 },
    {
      key: 'cancellation:sale-cancelled',
      kind: 'cancellation',
      at: 300,
    },
    { key: 'sale:sale-current', kind: 'sale', at: 400 },
  ],
);
assert.equal(movements.filter((item) => item.kind === 'entry').length, 1);
assert.equal(movements.filter((item) => item.kind === 'sale').length, 2);
assert.equal(
  movements.filter((item) => item.kind === 'cancellation').length,
  1,
);
assert.equal(serialMatchingQuery(['SNTEST000001'], '#00001'), null);
assert.equal(
  serialMatchingQuery(['SNTEST000001'], 'sntest000001'),
  'SNTEST000001',
);

const entriesOnly = restrictSerialHistoryDetails(history, {
  entries: true,
  sales: false,
});
assert.equal(entriesOnly.entry.operatorName, 'Operador');
assert.equal(entriesOnly.sales[0].customerName, null);
assert.equal(entriesOnly.sales[0].sellerName, null);
assert.equal(entriesOnly.sales[0].soldPriceCents, null);
assert.equal(entriesOnly.sales[0].referencePriceCents, null);
assert.equal(entriesOnly.sales[0].cancellationReason, null);
assert.deepEqual(entriesOnly.sales[0].photos, []);

const salesOnly = restrictSerialHistoryDetails(history, {
  entries: false,
  sales: true,
});
assert.equal(salesOnly.entry.operatorName, null);
assert.equal(salesOnly.entry.note, null);
assert.deepEqual(salesOnly.entry.photos, []);
assert.equal(salesOnly.sales[0].customerName, 'Cliente antigo');

console.log('serial history verification passed');
