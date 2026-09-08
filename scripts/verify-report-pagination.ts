import assert from 'node:assert/strict';
import {
  chooseReportSliceHeight as cut,
  chunkReportItems,
} from '../lib/report-pagination.ts';
assert.equal(
  cut(0, 1000, [{ top: 940, bottom: 1060 }]),
  940,
  'Model and one SN move together',
);
assert.equal(
  cut(0, 1000, [{ top: 150, bottom: 1100 }]),
  150,
  'Do not force a cut at 25% or 92%',
);
assert.equal(
  cut(0, 1000, [
    { top: 800, bottom: 1100 },
    { top: 990, bottom: 1050 },
  ]),
  800,
  'Keep outer fitting block intact',
);
const serials = Array.from(
  { length: 137 },
  (_, i) => `SNTEST${String(i).padStart(5, '0')}`,
);
const chunks = chunkReportItems(serials, 12);
assert.deepEqual(chunks.flat(), serials);
assert.ok(chunks.every((part) => part.length <= 12));
const ranges = chunks.map((_, i) => ({ top: i * 220, bottom: i * 220 + 208 }));
let position = 0;
const total = ranges.at(-1)!.bottom;
while (position < total) {
  position += cut(position, Math.min(1000, total - position), ranges, 1000);
  assert.equal(
    ranges.some((range) => position > range.top && position < range.bottom),
    false,
    'No SN block crosses a page',
  );
}
assert.equal(position, total);
assert.deepEqual(
  chunkReportItems(
    Array.from({ length: 17 }, (_, i) => i),
    3,
  ).flat(),
  Array.from({ length: 17 }, (_, i) => i),
);
console.log(
  'PDF pagination: complete model/SN blocks, continued chunks and photos preserved.',
);
