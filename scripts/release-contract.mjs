import assert from 'node:assert/strict';

/** A release pins what both source packages actually resolve, never a guessed SDK version. */
export function validateReleaseRuntime(packages) {
  const stable = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
  assert.equal(packages.length, 2, 'Both shared packages are required.');
  const byName = new Map(packages.map(item => [item.pkg.name, item]));
  assert.equal(byName.size, 2, 'Shared packages must be unique.');
  const blueprint = byName.get('footprint-blueprint'), business = byName.get('smallbusiness-footprint');
  assert.ok(blueprint && business, 'Expected Blueprint and Smallbusiness sources.');
  const runtime = blueprint.runtime;
  assert.ok(stable(runtime?.footprintjs) && stable(runtime?.foottrace), 'Resolve a stable installed engine and record runtime first.');
  for (const { pkg, runtime: installed } of packages) {
    assert.ok(stable(pkg.version), 'Only stable shared versions belong in this release kit.');
    assert.equal(pkg.dependencies?.footprintjs, runtime.footprintjs, 'Source must pin its actual installed engine exactly.');
    assert.deepEqual(installed, runtime, 'Shared packages must resolve the same engine and record runtime versions.');
    for (const version of Object.values(pkg.dependencies ?? {})) assert.ok(!/^(workspace:|file:|link:)/.test(version), 'Release dependencies must be portable.');
  }
  assert.equal(business.pkg.dependencies?.['footprint-blueprint'], blueprint.pkg.version, 'Smallbusiness must pin this Blueprint release.');
  return Object.freeze({ footprintjs: runtime.footprintjs, foottrace: runtime.foottrace });
}
