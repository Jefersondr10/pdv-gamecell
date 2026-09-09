import assert from 'node:assert/strict';

import {
  expandUpce,
  hasValidGtinCheckDigit,
  normalizeCandidate,
  selectCentralCandidate,
  recentScanSamples,
  openScannerCamera,
  ScanConsensus,
} from '../lib/scanner.ts';
import { displayCommercialCode } from '../lib/commercial-code.ts';
import { normalizeCommercialCode } from '../lib/gtin.ts';

const sn22 = normalizeCandidate('SFK77X4P22V', 'code_128', 'apple_serial')!;
const sn33 = normalizeCandidate('FK77X4P33V', 'code_128', 'apple_serial')!;
assert.equal(sn22.alternateValue, 'FK77X4P22V');
assert.notEqual(sn22.key, sn33.key);
const consensus = new ScanConsensus();
assert.equal(consensus.observe(sn22, 0), null);
assert.equal(consensus.observe(sn33, 100), null);
assert.equal(
  consensus.observe(sn22, 260),
  null,
  'Alternating readings do not agree',
);
consensus.reset();
for (const at of [0, 100, 200]) assert.equal(consensus.observe(sn22, at), null);
assert.equal(consensus.observe(sn22, 300), sn22);
for (const at of [400, 530, 660, 790])
  assert.equal(
    consensus.observe(sn33, at),
    null,
    'Different code cannot bypass a locked box',
  );
for (let i = 0; i < 5; i++) consensus.observe(null, 800 + i * 100);
assert.equal(
  consensus.observe(sn33, 1350),
  null,
  'Five empty frames do not rearm',
);
for (let i = 0; i < 6; i++) consensus.observe(null, 1500 + i * 100);
assert.equal(consensus.observe(sn33, 2200), null);
assert.equal(consensus.observe(sn33, 2330), null);
assert.equal(consensus.observe(sn33, 2460), sn33);
consensus.reset();
consensus.observe(sn22, 0);
consensus.observe(sn22, 130);
consensus.observe(null, 150);
assert.equal(
  consensus.observe(sn22, 260),
  null,
  'Empty frame clears consensus',
);
consensus.reset();
consensus.observe(sn22, 0);
consensus.observe(sn22, 130);
consensus.interrupt();
assert.equal(
  consensus.observe(sn22, 260),
  null,
  'Decoder failure clears consensus',
);

assert.deepEqual(recentScanSamples([{ at: 100 }, { at: 900 }], 1500), [
  { at: 100 },
  { at: 900 },
]);
assert.deepEqual(recentScanSamples([{ at: 100 }, { at: 900 }], 1501), [
  { at: 900 },
]);
const cameraConstraints: MediaStreamConstraints[] = [];
const fakeStream = {} as MediaStream;
assert.equal(
  await openScannerCamera({
    getUserMedia: async (constraints) => {
      cameraConstraints.push(constraints!);
      if (cameraConstraints.length === 1)
        throw new DOMException('Unavailable', 'OverconstrainedError');
      return fakeStream;
    },
  }),
  fakeStream,
);
assert.equal(cameraConstraints.length, 2);
assert.deepEqual(
  (cameraConstraints[0].video as MediaTrackConstraints).facingMode,
  { exact: 'environment' },
);
assert.deepEqual(
  (cameraConstraints[1].video as MediaTrackConstraints).facingMode,
  { ideal: 'environment' },
);
let permissionAttempts = 0;
await assert.rejects(
  openScannerCamera({
    getUserMedia: async () => {
      permissionAttempts += 1;
      throw new DOMException('Denied', 'NotAllowedError');
    },
  }),
);
assert.equal(permissionAttempts, 1);

assert.equal(hasValidGtinCheckDigit('4006381333931'), true);
assert.equal(hasValidGtinCheckDigit('4006381333932'), false);
assert.equal(displayCommercialCode('00036000291452', 'UPC'), '036000291452');
assert.equal(displayCommercialCode('00036000291452', 'EAN'), '036000291452');
assert.equal(displayCommercialCode('04006381333931', 'EAN'), '4006381333931');
assert.equal(expandUpce('04252614'), '042100005264');
assert.equal(normalizeCommercialCode('04252614'), '00042100005264');

assert.equal(
  normalizeCandidate('4006381333931', 'ean_13', 'product')?.normalizedValue,
  '04006381333931',
);
assert.equal(
  normalizeCandidate('96385074', 'ean_8', 'product')?.normalizedValue,
  '00000096385074',
);
assert.equal(
  normalizeCandidate('036000291452', 'upc_a', 'product')?.key,
  'PRODUCT:00036000291452',
);
assert.equal(
  normalizeCandidate('0036000291452', 'ean_13', 'product')?.key,
  'PRODUCT:00036000291452',
);
assert.equal(
  normalizeCandidate('195950638011', 'upc_a', 'product')?.key,
  normalizeCandidate('0195950638011', 'ean_13', 'product')?.key,
);
assert.equal(
  normalizeCandidate('04252614', 'upc_e', 'product')?.normalizedValue,
  '00042100005264',
);
assert.equal(
  normalizeCandidate('04252614', 'upc_e', 'product')?.alternateValue,
  '00000004252614',
);
assert.equal(normalizeCandidate('4006381333932', 'ean_13', 'product'), null);

const serial = normalizeCandidate('SHC9P06R095', 'code_128', 'apple_serial');
assert.equal(serial?.rawValue, 'SHC9P06R095');
assert.equal(serial?.normalizedValue, 'SHC9P06R095');
assert.equal(serial?.alternateValue, 'HC9P06R095');
assert.equal(serial?.prefixStripped, undefined);
assert.equal(serial?.key, 'SERIAL:HC9P06R095');
const manualSerial = normalizeCandidate(
  'SHC9P06R095',
  'manual_code_128',
  'apple_serial',
);
assert.equal(manualSerial?.normalizedValue, 'SHC9P06R095');
assert.equal(manualSerial?.prefixStripped, undefined);
assert.equal(manualSerial?.alternateValue, 'HC9P06R095');
assert.equal(
  normalizeCandidate('HC9P06R095', 'code_128', 'apple_serial')?.normalizedValue,
  'HC9P06R095',
);
assert.equal(
  normalizeCandidate('HC9P06R095', 'manual_code_128', 'apple_serial')?.key,
  manualSerial?.key,
);
assert.equal(
  normalizeCandidate('HC9P06R095', 'manual_code_128', 'apple_serial')
    ?.alternateValue,
  'SHC9P06R095',
);
assert.equal(
  normalizeCandidate('SN inválido!', 'code_128', 'apple_serial'),
  null,
);
assert.equal(
  normalizeCandidate('353915104521117', 'code_128', 'apple_serial'),
  null,
);
assert.equal(
  normalizeCandidate('S353915104521117', 'code_128', 'apple_serial'),
  null,
);
assert.equal(
  normalizeCandidate(
    '89049032004008882600000000000123',
    'code_128',
    'apple_serial',
  ),
  null,
);

const centeredSerial = normalizeCandidate(
  'HC9P06R095',
  'code_128',
  'apple_serial',
);
const upperSerial = normalizeCandidate(
  'FC3Y91KL20',
  'code_128',
  'apple_serial',
);
assert.ok(centeredSerial);
assert.ok(upperSerial);
assert.equal(
  selectCentralCandidate(
    [
      {
        candidate: upperSerial,
        boundingBox: { x: 250, y: 8, width: 500, height: 34 },
      },
      {
        candidate: centeredSerial,
        boundingBox: { x: 220, y: 84, width: 560, height: 32 },
      },
    ],
    1000,
    200,
  )?.normalizedValue,
  'HC9P06R095',
);

console.log('Scanner normalization checks passed.');
