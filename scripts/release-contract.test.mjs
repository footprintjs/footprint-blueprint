import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstalledRuntime, validateReleaseRuntime } from './release-contract.mjs';

const fixture = () => [
  { pkg: { name: 'footprint-blueprint', version: '0.4.1', dependencies: { foottrace: '1.1.0', footprintjs: '10.1.0' } }, runtime: { footprintjs: '10.1.0', foottrace: '1.1.0' } },
  { pkg: { name: 'smallbusiness-footprint', version: '0.4.0', dependencies: { foottrace: '1.1.0', footprintjs: '10.1.0', 'footprint-blueprint': '0.4.1' } }, runtime: { footprintjs: '10.1.0', foottrace: '1.1.0' } },
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
    items => { items[1].pkg.dependencies.foottrace = '1.0.3'; },
    items => { items[1].pkg.dependencies['footprint-blueprint'] = '0.4.0'; },
    items => { items[0].pkg.version = '0.4.1-gamma.1'; },
    items => { items[1].pkg.name = 'wrong-package'; },
  ];
  for (const change of changes) { const items = fixture(); change(items); assert.throws(() => validateReleaseRuntime(items)); }
});

test('the package directly pins both runtimes selected by the engine', () => {
  const manifest = new URL('../package.json', import.meta.url);
  const { dependencies } = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.deepEqual(readInstalledRuntime(manifest), {
    footprintjs: dependencies.footprintjs, foottrace: dependencies.foottrace,
  });
});

test('equal Foottrace versions cannot hide a second physical owner inside the engine', t => {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function install(directory, name, version) {
    const target = join(directory, 'node_modules', name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name, version }));
    return target;
  }
  const engine = install(root, 'footprintjs', '14.3.0');
  install(root, 'foottrace', '2.3.2');
  const manifest = join(root, 'package.json');
  install(engine, 'foottrace', '2.3.2');
  assert.throws(() => readInstalledRuntime(manifest), /physical Foottrace/);
});
