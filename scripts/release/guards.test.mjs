import assert from 'node:assert/strict';
import test from 'node:test';
import { assertArchive, assertPackage, registryState } from './guards.mjs';
import { createHash } from 'node:crypto';
const bytes = Buffer.from('reviewed bytes');
const sha = createHash('sha256').update(bytes).digest('hex');
const sri = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const expected = { name: 'fixture-package', version: '1.2.3', sha256: sha, integrity: sri,
  repository: 'git+https://github.com/fixture/package.git', dependencies: { footprintjs: '10.1.0' } };
const pkg = () => ({ name: expected.name, version: expected.version, type: 'module',
  repository: { type: 'git', url: expected.repository }, dependencies: { ...expected.dependencies },
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' } });
const metadata = () => ({ ...pkg(), dist: { integrity: sri, tarball: 'https://registry.npmjs.org/fixture-package/-/fixture-package-1.2.3.tgz' } });
test('only the reviewed immutable archive passes both independent digest checks', () => {
  assertArchive(bytes, expected);
  assert.throws(() => assertArchive(Buffer.from('different bytes'), expected));
  assert.throws(() => assertArchive(bytes, { ...expected, integrity: 'sha512-wrong' }));
});
test('packed identity, portability, repository and exact dependencies are release boundaries', () => {
  assertPackage(pkg(), expected);
  const edits = [ p => { p.name = 'another-package'; }, p => { p.version = '1.2.4'; },
    p => { p.dependencies.footprintjs = '^10.1.0'; }, p => { p.dependencies.footprintjs = 'file:local.tgz'; },
    p => { p.repository.url = 'git+https://github.com/fixture/other.git'; },
    p => { p.publishConfig.registry = 'https://example.com/'; } ];
  for (const edit of edits) { const p = pkg(); edit(p); assert.throws(() => assertPackage(p, expected)); }
});
test('an existing version is accepted only as an identical already-published release', () => {
  assert.equal(registryState(404, {}, expected), 'absent');
  assert.equal(registryState(200, metadata(), expected), 'identical');
  const wrong = metadata(); wrong.dist.integrity = 'sha512-other';
  assert.throws(() => registryState(200, wrong, expected));
  assert.throws(() => registryState(500, {}, expected));
  assert.throws(() => registryState(401, {}, expected));
  assert.throws(() => registryState(200, { ...metadata(), dist: {} }, expected));
  assert.throws(() => registryState(200, { ...metadata(), version: '1.2.4' }, expected));
});
