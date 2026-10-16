import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseRuntime } from './release-contract.mjs';

const fixture = () => [
  { pkg: { name: 'footprint-blueprint', version: '0.4.1', dependencies: { footprintjs: '10.1.0' } }, runtime: { footprintjs: '10.1.0', foottrace: '1.1.0' } },
  { pkg: { name: 'smallbusiness-footprint', version: '0.4.0', dependencies: { footprintjs: '10.1.0', 'footprint-blueprint': '0.4.1' } }, runtime: { footprintjs: '10.1.0', foottrace: '1.1.0' } },
];

test('a release records exact installed versions and matching portable shared dependencies', () => {
  assert.deepEqual(validateReleaseRuntime(fixture()), { footprintjs: '10.1.0', foottrace: '1.1.0' });
  const later = fixture();
  for (const item of later) { item.pkg.dependencies.footprintjs = '10.2.0'; item.runtime.footprintjs = '10.2.0'; }
  assert.deepEqual(validateReleaseRuntime(later), { footprintjs: '10.2.0', foottrace: '1.1.0' });
});

test('stale installs, ranges, local paths, mixed record runtimes and mismatched Blueprint versions cannot be packed', () => {
  const changes = [
    items => { items[0].runtime.footprintjs = '10.0.0'; },
    items => { items[0].pkg.dependencies.footprintjs = '^10.1.0'; },
    items => { items[0].pkg.dependencies.footprintjs = 'file:../engine.tgz'; },
    items => { items[1].runtime.foottrace = '1.0.3'; },
    items => { items[1].pkg.dependencies['footprint-blueprint'] = '0.4.0'; },
    items => { items[0].pkg.version = '0.4.1-gamma.1'; },
    items => { items[1].pkg.name = 'wrong-package'; },
  ];
  for (const change of changes) { const items = fixture(); change(items); assert.throws(() => validateReleaseRuntime(items)); }
});
