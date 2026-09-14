import assert from 'node:assert/strict';
import {
  ALL_PERMISSIONS,
  PERMISSION_PARENTS,
  can,
  defaultPermissions,
  resolvePermissions,
} from '../lib/permissions.ts';
import { matchesProductSearch } from '../lib/product-search.ts';
import { attachmentReadPermissions } from '../lib/server/attachment-permissions.ts';
import { routePermissions } from '../lib/server/permissions.ts';

assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length);
for (const role of ['owner', 'admin', 'operator'] as const) {
  const permissions = defaultPermissions(role);
  for (const key of permissions)
    for (const parent of PERMISSION_PARENTS[key] ?? [])
      assert.ok(permissions.includes(parent));
  assert.ok(can({ role }, 'sell'));
  assert.ok(can({ role }, 'sell.assign'));
}
assert.equal(can({ role: 'operator' }, 'sales.cancel'), false);
assert.equal(can({ role: 'operator' }, 'sales.prices'), false);
assert.equal(can({ role: 'admin' }, 'sales.prices'), true);
assert.equal(
  can(
    { role: 'operator', permissions: ['sales', 'sales.prices'] },
    'sales.prices',
  ),
  true,
);
assert.equal(
  can({ role: 'operator', permissions: ['sales.prices'] }, 'sales.prices'),
  false,
);
assert.equal(can({ role: 'operator' }, 'sales.receipts.delete'), false);
assert.equal(can({ role: 'admin' }, 'sales.receipts.delete'), true);
assert.equal(
  can({ role: 'owner', permissions: [] }, 'sales.receipts.delete'),
  true,
);
assert.equal(
  can(
    { role: 'operator', permissions: ['sales', 'sales.receipts.delete'] },
    'sales.receipts.delete',
  ),
  true,
);
assert.equal(
  can(
    { role: 'operator', permissions: ['sales.receipts.delete'] },
    'sales.receipts.delete',
  ),
  false,
);
assert.equal(
  can(
    { role: 'operator', permissions: ['sales', 'sales.cancel'] },
    'sales.cancel',
  ),
  true,
);
assert.equal(
  can({ role: 'operator', permissions: ['sales.cancel'] }, 'sales.cancel'),
  false,
);
assert.equal(
  can({ role: 'operator', permissions: ['users.manage'] }, 'users.manage'),
  false,
);
assert.equal(can({ role: 'owner', permissions: [] }, 'users.manage'), true);
assert.deepEqual(
  resolvePermissions('operator', null),
  defaultPermissions('operator'),
);
assert.deepEqual(resolvePermissions('operator', 'corrupted'), []);
assert.deepEqual(
  resolvePermissions('operator', '["invented","sales.cancel"]'),
  [],
);
assert.deepEqual(resolvePermissions('operator', '[]'), []);
assert.deepEqual(resolvePermissions('admin', '[]'), []);
const overviewOnly = {
  role: 'operator' as const,
  permissions: ['overview'] as const,
};
const mayReadAttachment = (kind: string) =>
  (attachmentReadPermissions(kind) ?? []).some((permission) =>
    can(overviewOnly, permission),
  );
assert.equal(mayReadAttachment('receipt'), true);
assert.equal(mayReadAttachment('item_photo'), false);
assert.equal(mayReadAttachment('entry_photo'), false);
assert.equal(attachmentReadPermissions('unknown'), null);
assert.deepEqual(
  routePermissions(
    new Request('https://example.test/api/inventory/history?serial=SNTEST000001'),
  ),
  ['entries', 'sales'],
  'SN history requires access to entries or sales',
);
const product = {
  model: 'iPhone 17 Pro Max',
  color: 'Azul',
  memory: '256 GB',
  codes: [{ code: '195950638011' }],
};
for (const query of [
  'iphone17',
  '17 azul 256GB',
  'AZÚL',
  '195950638011',
  '0195950638011',
  '',
])
  assert.ok(matchesProductSearch(product, query), query);
for (const query of ['rosa', '512', 'iphone 16'])
  assert.equal(matchesProductSearch(product, query), false, query);
console.log(
  'Permissions defaults, owner protection, dependencies, fail-closed decoding and product search passed.',
);
