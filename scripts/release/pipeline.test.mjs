import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, delimiter } from 'node:path';
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

test('all existing release runner modes refuse an unreviewed candidate before registry or publication effects', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'source-release-boundary-'));
  try {
    const packageDir = join(directory, 'package');
    mkdirSync(packageDir);
    const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ ...source, description: 'Changed candidate prose' }));
    const archive = join(directory, 'candidate.tgz');
    execFileSync('tar', ['-czf', archive, '-C', directory, 'package']);
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
