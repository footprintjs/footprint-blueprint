// Built-in modules only: the publish job never resolves or runs package dependencies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertArchive, assertPackage, registryState } from './guards.mjs';

const expected = JSON.parse(await readFile(new URL('./reviewed.json', import.meta.url), 'utf8'));
const [mode, input] = process.argv.slice(2);
assert.ok(['archive', 'preflight', 'publish', 'verify'].includes(mode), 'Use archive, preflight, publish or verify.');
const archive = resolve(input ?? 'release/package.tgz');
const bytes = await readFile(archive);
assertArchive(bytes, expected);
const pkg = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
assertPackage(pkg, expected);

async function metadata(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(15000) });
  assert.ok([200, 404].includes(response.status), `Registry lookup failed (${response.status}); publication must stop.`);
  return { status: response.status, body: await response.json() };
}
async function dependencies() {
  for (const dependency of expected.runtime) {
    const { status, body } = await metadata(dependency.name, dependency.version);
    assert.equal(status, 200, `Publish ${dependency.name}@${dependency.version} first.`);
    assert.equal(body.name, dependency.name); assert.equal(body.version, dependency.version);
    assert.equal(body.dist?.integrity, dependency.integrity, 'A dependency differs from the reviewed registry archive.');
  }
}
async function current() {
  const { status, body } = await metadata(expected.name, expected.version);
  return { state: registryState(status, body, expected), body };
}
async function downloaded(body) {
  const response = await fetch(body.dist.tarball, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); assertArchive(Buffer.from(await response.arrayBuffer()), expected);
}
if (mode !== 'archive') {
  await dependencies();
  let result = await current();
  if (mode === 'publish' && result.state === 'absent') {
    assert.equal(process.env.GITHUB_REPOSITORY, expected.githubRepository, 'Publication is limited to the owning repository.');
    assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Publication is limited to main.');
    assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.ok(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'GitHub OIDC is required.');
    // A thrown/uncertain publication is never retried here. Inspect npm before another invocation.
    execFileSync('npm', ['publish', archive, '--registry=https://registry.npmjs.org/', '--access=public', '--provenance', '--ignore-scripts'], { stdio: 'inherit', env: process.env });
    for (let attempt = 0; attempt < 6; attempt++) {
      result = await current();
      if (result.state === 'identical') break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (mode === 'verify' || mode === 'publish' || result.state === 'identical') {
    assert.equal(result.state, 'identical', 'The target is not yet published; no completion is claimed.');
    await downloaded(result.body);
  }
  console.log(JSON.stringify({ name: expected.name, version: expected.version, state: result.state, mode, sha256: expected.sha256, integrity: expected.integrity }));
} else console.log(JSON.stringify({ name: expected.name, version: expected.version, mode, archive: 'reviewed-bytes-verified' }));
