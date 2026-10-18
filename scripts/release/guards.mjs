import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function assertArchive(bytes, expected) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, 'Archive differs from the reviewed release.');
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), expected.integrity, 'Archive integrity differs from the reviewed release.');
}

export function assertPackage(pkg, expected) {
  assert.equal(pkg.name, expected.name, 'Unexpected package.');
  assert.equal(pkg.version, expected.version, 'Unexpected version.');
  assert.deepEqual(pkg.dependencies, expected.dependencies, 'Release dependencies must match the reviewed declarations exactly.');
  assert.equal(pkg.repository?.url, expected.repository, 'Repository must match the trusted publisher.');
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/');
  assert.ok(Object.entries(pkg.dependencies).every(([name, value]) =>
    /^\d+\.\d+\.\d+$/.test(value)
    // This reviewed release intentionally exposes one Blueprint compatibility range.
    // The equality check above still binds its exact spelling to reviewed metadata.
    || (pkg.name === 'smallbusiness-footprint' && pkg.version === '0.9.0'
      && name === 'footprint-blueprint' && value === '^0.9.0')),
  'Only portable exact stable dependencies or the reviewed Smallbusiness 0.9 Blueprint range may be released.');
}

export function registryState(status, metadata, expected) {
  if (status === 404) return 'absent';
  assert.equal(status, 200, 'Registry lookup failed; publication must stop.');
  assertPackage(metadata, expected);
  assert.equal(metadata.dist?.integrity, expected.integrity, 'The target version already exists with different bytes.');
  assert.ok(metadata.dist?.tarball?.startsWith('https://registry.npmjs.org/'), 'Unexpected registry archive URL.');
  return 'identical';
}
