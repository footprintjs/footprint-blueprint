import assert from 'node:assert/strict';

const stableVersion = value => typeof value === 'string'
  && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  && value.split('.').every(part => Number.isSafeInteger(Number(part)));

/** Source identity is fixed; a source version/dependency change is not release approval. */
export function assertCandidateIdentity(source, trusted) {
  assert.equal(source.name, trusted.name, 'Unexpected package.');
  assert.equal(source.repository?.url, trusted.repository, 'Repository must match the trusted publisher.');
  assert.equal(source.publishConfig?.access, 'public');
  assert.equal(source.publishConfig?.registry, 'https://registry.npmjs.org/');
}

// Shared by source CI and local candidate preparation. This validates packaging,
// never the immutable approval record consumed by the separate release runner.
export function assertCandidate(packed, source, entries) {
  assert.deepEqual(packed, source, 'Packed manifest must match the complete current source manifest.');
  assert.notEqual(packed.private, true, 'A public source candidate cannot be private.');
  assert.ok(stableVersion(packed.version), 'Candidate must declare a stable source version.');
  assert.ok(Object.values(packed.dependencies ?? {}).every(stableVersion), 'Candidate dependencies must remain exact portable stable versions.');
  assertCandidateFiles(packed, entries);
}

// Local pnpm packing intentionally normalizes development manifest fields. Its
// existing identity/runtime checks stay in the preparer; reuse file validation
// without relaxing the strict full-manifest source CI check above.
export function assertCandidateFiles(packed, entries) {
  assert.ok(Array.isArray(entries) && entries.length > 0, 'Candidate archive must contain files.');
  assert.equal(new Set(entries).size, entries.length, 'Duplicate archive entries are not allowed.');
  for (const entry of entries) {
    assert.ok(typeof entry === 'string' && entry.startsWith('package/') && !entry.includes('\\') && !entry.includes('\0') && !entry.split('/').includes('..'), 'Archive entries must remain inside package/.');
    assert.ok(!entry.split('/').some(part => ['node_modules', '__tests__', '.git', 'vendor'].includes(part)), 'Development trees must not be packed.');
  }
  for (const required of ['README.md', 'LICENSE', 'CHANGELOG.md']) assert.ok(entries.includes('package/' + required), `Missing package/${required}.`);
  function target(value, exported = false) {
    assert.ok(typeof value === 'string' && value.length > 0, 'Package targets must be paths.');
    if (exported) assert.ok(value.startsWith('./'), 'Export targets must be package-relative paths.');
    const relative = value.startsWith('./') ? value.slice(2) : value;
    assert.ok(relative && !relative.startsWith('/') && !relative.includes('\\') && !relative.includes('\0') && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'Package targets must remain inside package/.');
    assert.ok(entries.includes('package/' + relative), `Missing package target ${value}.`);
  }
  for (const key of ['main', 'types', 'module']) if (packed[key] !== undefined) target(packed[key]);
  function exports(value) {
    if (value === null) return; // Explicitly blocked exports declare no target.
    if (typeof value === 'string') target(value, true);
    else {
      assert.ok(value && typeof value === 'object', 'Invalid export declaration.');
      for (const child of Object.values(value)) exports(child);
    }
  }
  if (packed.exports !== undefined) exports(packed.exports);
}
