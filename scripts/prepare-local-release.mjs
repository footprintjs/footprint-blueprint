#!/usr/bin/env node
// Builds and packs local candidates. This script never publishes or uses registry credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, copyFile, writeFile, mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === '--output', 'Usage: node scripts/prepare-local-release.mjs --output /absolute/release-kit');
assert.ok(path.isAbsolute(args[1]), 'Use an absolute output directory.');
const output = args[1];
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major === 24 && minor >= 15, 'Build on Node 24.15–24.x.');
const business = path.resolve(root, '../smallbusiness-footprint');
const sources = [root, business];
const packages = await Promise.all(sources.map(async directory => ({ directory, pkg: JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) })));
const versions = new Map(packages.map(({ pkg }) => [pkg.name, pkg.version]));
await mkdir(path.join(output, 'packages'), { recursive: true });
await mkdir(path.join(output, 'verification'), { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const environment = { ...process.env, npm_config_cache: process.env.FOOTPRINT_RELEASE_NPM_CACHE ?? path.join(output, '.build-cache') };
function run(command, parameters, cwd) {
  return execFileSync(command, parameters, { cwd, env: environment, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
}
for (const cwd of [root, business]) {
  const parameters = ['pnpm', '--config.verify-deps-before-run=false', 'run', 'build'];
  await writeFile(path.join(output, 'verification', cwd === root ? 'blueprint-build.log' : 'smallbusiness-build.log'), run('corepack', parameters, cwd));
}
const artifacts = [];
for (const { directory, pkg } of packages) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'footprint-pack-'));
  try {
    const log = run('corepack', ['pnpm', '--config.verify-deps-before-run=false', 'pack', '--pack-destination', scratch], directory);
    const file = (await readdir(scratch)).find(name => name.endsWith('.tgz'));
    assert.ok(file, `No tarball created for ${pkg.name}.`);
    const tarball = path.join(scratch, file);
    const packed = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json'], root));
    assert.equal(packed.name, pkg.name); assert.equal(packed.version, pkg.version);
    assert.equal(packed.publishConfig?.access, 'public');
    assert.equal(packed.engines?.node, '>=24.15.0 <25');
    assert.equal(packed.dependencies?.footprintjs, '10.0.0');
    for (const [dependency, version] of Object.entries(packed.dependencies ?? {})) {
      assert.ok(!/^(workspace:|file:|link:)/.test(version), `Unresolved source dependency: ${dependency}.`);
      if (versions.has(dependency)) assert.equal(version, versions.get(dependency));
    }
    const entries = run('tar', ['-tzf', tarball], root).trim().split('\n');
    assert.ok(entries.every(name => name.startsWith('package/') && !name.split('/').includes('..')));
    assert.ok(!entries.some(name => /\/(node_modules|__tests__|\.git)\//.test(name)));
    for (const required of ['package/README.md', 'package/LICENSE', 'package/CHANGELOG.md']) assert.ok(entries.includes(required), `Missing ${required}.`);
    for (const conditions of Object.values(packed.exports ?? {})) {
      for (const target of typeof conditions === 'string' ? [conditions] : Object.values(conditions)) {
        assert.ok(typeof target === 'string' && target.startsWith('./'));
        assert.ok(entries.includes('package/' + target.slice(2)), `Missing export ${target}.`);
      }
    }
    const bytes = await readFile(tarball);
    const sha256 = digest(bytes);
    const destination = path.join(output, 'packages', file);
    try { assert.equal(digest(await readFile(destination)), sha256, `Existing ${file} differs; use a new candidate version/output.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await copyFile(tarball, destination);
    await writeFile(path.join(output, 'verification', file + '.pack.log'), log);
    artifacts.push({ name: pkg.name, version: pkg.version, file, sha256, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), bytes: bytes.length, dependencies: packed.dependencies });
    console.log(`Prepared ${pkg.name}@${pkg.version}`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
const quickstart = path.join(output, 'quickstart');
await mkdir(quickstart, { recursive: true });
for (const file of ['booking.mjs', 'publication.mjs', 'shared.mjs']) await copyFile(path.join(business, 'examples/shared-evidence', file), path.join(quickstart, file));
await copyFile(path.join(business, 'examples/shared-evidence/package-template.json'), path.join(quickstart, 'package.json'));
const exampleManifest = JSON.parse(await readFile(path.join(quickstart, 'package.json'), 'utf8'));
for (const artifact of artifacts) exampleManifest.dependencies[artifact.name] = '../packages/' + artifact.file;
await writeFile(path.join(quickstart, 'package.json'), JSON.stringify(exampleManifest, null, 2) + '\n');
const docs = path.join(output, 'docs');
await cp(path.join(root, 'docs'), docs, { recursive: true });
for (const file of ['LICENSE', 'README.md', 'CHANGELOG.md']) await copyFile(path.join(root, file), path.join(output, file));
await copyFile(path.join(business, 'docs/INTEGRATION.md'), path.join(docs, 'SMB-INTEGRATION.md'));
const guide = await readFile(path.join(docs, 'QUICKSTART.md'), 'utf8');
const topGuide = guide.replace(/\]\((?![a-zA-Z][a-zA-Z0-9+.-]*:|#|\/)([^)]+)\)/g, '](docs/$1)');
await writeFile(path.join(output, 'QUICKSTART.md'), topGuide);
const sourcesInfo = {};
for (const [name, cwd] of [['blueprint', root], ['smallbusiness', business]]) sourcesInfo[name] = {
  repository: name === 'blueprint' ? 'https://github.com/footprintjs/footprint-blueprint' : 'https://github.com/footprintjs/smallbusiness-footprint',
  branch: run('git', ['branch', '--show-current'], cwd).trim(), commit: run('git', ['rev-parse', 'HEAD'], cwd).trim(),
  dirty: Boolean(run('git', ['status', '--porcelain'], cwd).trim()),
};
await writeFile(path.join(output, 'RELEASE.json'), JSON.stringify({ preparedAt: new Date().toISOString(), published: false, node: process.version, footprintjs: '10.0.0', sources: sourcesInfo, artifacts }, null, 2) + '\n');
await writeFile(path.join(output, 'packages/SHA256SUMS'), artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
console.log('Local packages and quickstart prepared. Generate its npm lockfile, verify a clean consumer, and record validation before publication.');
