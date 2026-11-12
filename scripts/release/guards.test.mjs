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

const commerceRelease = () => {
  const reviewed = { ...expected, name: 'smallbusiness-footprint', version: '0.9.0',
    dependencies: { 'footprint-blueprint': '^0.9.0', footprintjs: '10.1.0', foottrace: '1.4.0', zod: '4.6.5' } };
  return { reviewed, packed: { ...pkg(), name: reviewed.name, version: reviewed.version,
    dependencies: { ...reviewed.dependencies } } };
};

test('only the reviewed Smallbusiness 0.9 Blueprint compatibility declaration is portable', () => {
  const { reviewed, packed } = commerceRelease();
  assertPackage(packed, reviewed);
  assert.equal(registryState(200, { ...packed, dist: { integrity: sri,
    tarball: 'https://registry.npmjs.org/smallbusiness-footprint/-/smallbusiness-footprint-0.9.0.tgz' } }, reviewed), 'identical');
});

test('a changed range or extra dependency never bypasses exact reviewed dependency equality', () => {
  for (const edit of [
    p => { p.dependencies['footprint-blueprint'] = '^0.9.1'; },
    p => { p.dependencies['footprint-blueprint'] = '0.9.0'; },
    p => { p.dependencies.extra = '1.0.0'; },
  ]) {
    const { reviewed, packed } = commerceRelease();
    edit(packed); assert.throws(() => assertPackage(packed, reviewed));
  }
});

test('the one compatibility exception cannot admit another release, package, dependency or range', () => {
  const edits = [
    p => { p.name = 'footprint-blueprint'; },
    p => { p.version = '0.9.1'; },
    p => { p.dependencies.other = p.dependencies['footprint-blueprint']; delete p.dependencies['footprint-blueprint']; },
    p => { p.dependencies.footprintjs = '^10.1.0'; },
    ...['^0.9.1', '~0.9.0', '*', '>=0.9.0', 'file:vendor/reviewed.tgz', 'workspace:^', 'https://example.com/reviewed.tgz']
      .map(value => p => { p.dependencies['footprint-blueprint'] = value; }),
  ];
  for (const edit of edits) {
    const { reviewed, packed } = commerceRelease();
    edit(packed);
    const equallyChangedReview = { ...reviewed, name: packed.name, version: packed.version,
      dependencies: { ...packed.dependencies } };
    assert.throws(() => assertPackage(packed, equallyChangedReview));
  }
});
