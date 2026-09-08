import assert from 'node:assert/strict';
import { summarizeStockByMemory } from '../lib/stock-report-summary.ts';

const rows = [
  { model: 'iPhone 15', memory: '128 GB', color: 'Preto', available: 4 },
  { model: 'iPhone 15', memory: '128GB', color: 'Azul', available: 3 },
  { model: 'iPhone 15', memory: '256 gb', color: 'Rosa', available: 2 },
  { model: 'iPhone 16', memory: '128 GB', color: 'Branco', available: 11 },
  { model: 'iPhone 17', memory: '256 GB', color: 'Lavanda', available: 7 },
  { model: 'iPhone 17 Pro', memory: '1TB', color: 'Laranja', available: 2 },
  { model: 'iPhone 17 Pro', memory: '512GB', color: 'Silver', available: 1 },
  { model: 'iPhone 17 Pro Max', memory: '256 GB', color: 'Azul', available: 0 },
];
const before = structuredClone(rows);
const summary = summarizeStockByMemory(rows);
assert.equal(
  summary.modelCount,
  4,
  'Model count must not become a count of storage variants',
);
assert.deepEqual(
  summary.groups.map(({ model, memory, quantity }) => ({
    model,
    memory,
    quantity,
  })),
  [
    { model: 'iPhone 15', memory: '128 GB', quantity: 7 },
    { model: 'iPhone 15', memory: '256 GB', quantity: 2 },
    { model: 'iPhone 16', memory: '128 GB', quantity: 11 },
    { model: 'iPhone 17', memory: '256 GB', quantity: 7 },
    { model: 'iPhone 17 Pro', memory: '512 GB', quantity: 1 },
    { model: 'iPhone 17 Pro', memory: '1 TB', quantity: 2 },
  ],
);
assert.equal(
  summary.groups.reduce((n, g) => n + g.quantity, 0),
  rows.reduce((n, r) => n + r.available, 0),
);
assert.deepEqual(
  rows,
  before,
  'Summary must not alter stock or detailed color rows',
);
assert.equal(
  new Set(summary.groups.map((g) => g.key)).size,
  summary.groups.length,
);
assert.deepEqual(summarizeStockByMemory([]), { modelCount: 0, groups: [] });
assert.equal(
  summarizeStockByMemory([
    { model: 'iPhone 15', memory: '', available: 1 },
    { model: 'iPhone 15', memory: '128 GB', available: 1 },
  ]).groups.length,
  2,
  'Missing memory must not be guessed',
);
assert.equal(
  summarizeStockByMemory([
    { model: ' iPhone 15 ', memory: '128\u00a0GB', available: 1 },
    { model: 'iPhone 15', memory: '128gb', available: 1 },
  ]).groups[0].quantity,
  2,
);
assert.equal(
  summarizeStockByMemory([
    { model: 'iPhone 17 Pro', memory: '1 TB', available: 1 },
    { model: 'iPhone 17 Pro', memory: '1024 GB', available: 1 },
  ]).groups.length,
  2,
  'Retain capacities as named in the catalog',
);
console.log(
  'PASS: stock report groups model + storage across colors, sorts capacity, normalizes labels, preserves totals/model count and excludes unavailable stock.',
);
