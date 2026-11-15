import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertArchive } from './guards.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/publish.yml'), 'utf8');
const steps = workflow.split(/(?=^      - )/m).slice(1);
const explicitPublish = "github.event_name == 'workflow_dispatch' && inputs.publish";
const stepWith = command => {
  const found = steps.filter(step => step.includes(command));
  assert.equal(found.length, 1, `Expected one workflow step for ${command}`);
  return found[0];
};

// Exercise only the explicit temporary executable, never a real npm binary.
// Reset the marker before testing whether the release runner reaches this fence.
function assertNpmFence(bin, marker) {
  const probe = spawnSync(join(bin, 'npm'), [], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + delimiter + process.env.PATH } });
  assert.equal(probe.status, 77, `Temporary npm fence was not executable: ${probe.stderr}`);
  assert.equal(readFileSync(marker, 'utf8'), 'refused');
  rmSync(marker);
}

test('ordinary source packing does not mistake changed candidate bytes for release approval', () => {
  const pack = stepWith('npm pack --ignore-scripts');
  assert.doesNotMatch(pack, /node scripts\/release\/run\.mjs archive/, 'Ordinary source packing must not demand the historical release digest.');
  assert.match(pack, /node scripts\/release\/check-candidate\.mjs release\/package\.tgz/);
  assert.match(pack, /git diff --exit-code/);
  assert.doesNotMatch(pack, /^        if:/m, 'Source candidates must be checked on every event.');
});

test('source-candidate staging uses the current version and leaves a stale archive untouched', async t => {
  const pack = stepWith('npm pack --ignore-scripts');
  const staging = pack.match(/^          (mv .+)$/m)?.[1];
  assert.ok(staging, 'The actual workflow archive-staging command is required.');
  const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const version of ['1.1.0', '2.7.3']) {
    await t.test(version, () => {
      const directory = mkdtempSync(join(tmpdir(), 'source-candidate-staging-'));
      try {
        mkdirSync(join(directory, 'release'));
        writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }));
        const fresh = join(directory, 'release', `${name}-${version}.tgz`);
        const stale = join(directory, 'release', `${name}-1.0.0.tgz`);
        const bytes = Buffer.from(`fresh source candidate ${version}`);
        writeFileSync(fresh, bytes);
        writeFileSync(stale, 'stale source candidate 1.0.0');
        const result = spawnSync('/bin/sh', ['-eu', '-c', staging], {
          cwd: directory, encoding: 'utf8', timeout: 10000,
          env: { ...process.env, PATH: dirname(process.execPath) + delimiter + process.env.PATH },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(readFileSync(join(directory, 'release/package.tgz')), bytes);
        assert.equal(readFileSync(stale, 'utf8'), 'stale source candidate 1.0.0');
        assert.equal(existsSync(fresh), false);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  }
});

test('every explicit publication retains archive approval, registry preflight and main-only downstream publication', () => {
  const archive = stepWith('node scripts/release/run.mjs archive release/package.tgz');
  const preflight = stepWith('node scripts/release/run.mjs preflight release/package.tgz');
  for (const step of [archive, preflight]) {
    assert.equal(step.match(/^        if: (.+)$/m)?.[1], explicitPublish);
  }
  assert.ok(workflow.indexOf(archive) < workflow.indexOf(preflight));
  const publisher = workflow.split(/^  publish:\n/m)[1];
  assert.ok(publisher, 'The original independently gated publisher must remain.');
  assert.match(publisher, /^    if: github\.event_name == 'workflow_dispatch' && inputs\.publish && github\.ref == 'refs\/heads\/main'$/m);
  assert.match(publisher, /^    needs: verify$/m);
  assert.match(publisher, /^      id-token: write$/m);
  assert.match(publisher, /node scripts\/release\/run\.mjs publish release\/package\.tgz/);
  assert.equal((workflow.match(/npm publish/g) ?? []).length, 0, 'Only the guarded runner may invoke npm publication.');
});

test('candidate and release suites execute in CI with pinned tools and one same-run artifact', () => {
  const guard = stepWith('node --test scripts/release/guards.test.mjs');
  assert.match(guard, /scripts\/release\/candidate\.test\.mjs/);
  assert.match(guard, /scripts\/release\/pipeline\.test\.mjs/);
  assert.match(workflow, /node-version: 24\.21\.0/);
  assert.match(guard, /npm --version.*11\.19\.0/);
  assert.match(workflow, /pnpm@12\.11\.2 --ignore-scripts/);
  assert.match(workflow, /install --frozen-lockfile --ignore-scripts/);
  const upload = stepWith('actions/upload-artifact@');
  const download = stepWith('actions/download-artifact@');
  for (const step of [upload, download]) assert.match(step, /^          name: checked-source-package$/m);
  assert.match(upload, /^          if-no-files-found: error$/m);
  assert.match(upload, /^          path: release\/package\.tgz$/m);
  assert.match(download, /^          path: release$/m);
});

test('both immutable digest checks independently reject changed bytes', () => {
  const bytes = Buffer.from('candidate bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  assertArchive(bytes, { sha256, integrity });
  assert.throws(() => assertArchive(bytes, { sha256: '0'.repeat(64), integrity }), /Archive differs/);
  assert.throws(() => assertArchive(bytes, { sha256, integrity: 'sha512-other' }), /Archive integrity differs/);
});

test('all release modes refuse a checked current-source archive before registry or publication effects', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'source-release-boundary-'));
  try {
    const packageDir = join(directory, 'package');
    mkdirSync(packageDir);
    const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(source));
    const targets = new Set(['README.md', 'LICENSE', 'CHANGELOG.md']);
    function collect(value) {
      if (typeof value === 'string') targets.add(value.replace(/^\.\//, ''));
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    }
    for (const field of ['main', 'types', 'module', 'exports']) collect(source[field]);
    for (const target of targets) {
      const filename = join(packageDir, target);
      mkdirSync(resolve(filename, '..'), { recursive: true });
      writeFileSync(filename, 'inert source-candidate packaging fixture\n');
    }
    const archive = join(directory, 'candidate.tgz');
    execFileSync('tar', ['-czf', archive, '-C', directory, 'package']);
    const checked = spawnSync(process.execPath, [resolve(root, 'scripts/release/check-candidate.mjs'), archive], {
      cwd: root, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(JSON.parse(checked.stdout).reviewed, false);
    const fence = join(directory, 'fence.mjs');
    const network = join(directory, 'network-attempted');
    const npmAttempt = join(directory, 'npm-attempted');
    const bin = join(directory, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'npm'), `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(npmAttempt)}, 'refused'); process.exit(77);
`, { mode: 0o755 });
    assertNpmFence(bin, npmAttempt);
    writeFileSync(fence, `import { writeFileSync } from 'node:fs'; globalThis.fetch = () => { writeFileSync(${JSON.stringify(network)}, 'refused'); throw new Error('NO_NETWORK_IN_RELEASE_TEST'); };`);
    for (const mode of ['archive', 'preflight', 'publish', 'verify']) {
      await t.test(mode, () => {
        const result = spawnSync(process.execPath, ['--import', fence, resolve(root, 'scripts/release/run.mjs'), mode, archive], { cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + delimiter + process.env.PATH } });
        assert.notEqual(result.status, 0, `${mode} accepted an unreviewed candidate`);
        assert.match(result.stderr, /Archive differs from the reviewed release/);
        assert.equal(existsSync(network), false, `${mode} reached a registry operation before immutable approval`);
        assert.equal(existsSync(npmAttempt), false, `${mode} reached npm before immutable approval`);
      });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('the runner checks packed package identity after valid fixture digests and before external effects', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fixture-release-package-'));
  try {
    const packageDir = join(directory, 'package'); mkdirSync(packageDir);
    const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ ...source, version: '99.0.0' }));
    const archive = join(directory, 'candidate.tgz');
    execFileSync('tar', ['-czf', archive, '-C', directory, 'package']);
    const bytes = readFileSync(archive);
    // Only this temporary test fixture has synthetic review hashes. The actual
    // repository review record is never modified or treated as approval.
    const expected = { ...JSON.parse(readFileSync(join(root, 'scripts/release/reviewed.json'), 'utf8')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
    writeFileSync(join(directory, 'reviewed.json'), JSON.stringify(expected));
    for (const name of ['run.mjs', 'guards.mjs']) writeFileSync(join(directory, name), readFileSync(join(root, 'scripts/release', name)));
    const network = join(directory, 'network-attempted');
    const npmAttempt = join(directory, 'npm-attempted');
    const bin = join(directory, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'npm'), `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(npmAttempt)}, 'refused'); process.exit(77);
`, { mode: 0o755 });
    assertNpmFence(bin, npmAttempt);
    const fence = join(directory, 'fence.mjs');
    writeFileSync(fence, `import { writeFileSync } from 'node:fs'; globalThis.fetch = () => { writeFileSync(${JSON.stringify(network)}, 'refused'); throw new Error('NO_NETWORK_IN_RELEASE_TEST'); };`);
    for (const mode of ['archive', 'preflight', 'publish', 'verify']) {
      await t.test(mode, () => {
        const result = spawnSync(process.execPath, ['--import', fence, join(directory, 'run.mjs'), mode, archive], { cwd: directory, encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + delimiter + process.env.PATH } });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /Unexpected version/);
        assert.equal(existsSync(network), false); assert.equal(existsSync(npmAttempt), false);
      });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
