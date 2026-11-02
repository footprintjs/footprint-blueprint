import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { assertCandidate, assertCandidateFiles } from './candidate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const clone = value => structuredClone(value);
function fixture() {
  const packed = clone(source);
  const targets = new Set(['package/package.json', 'package/README.md', 'package/LICENSE', 'package/CHANGELOG.md']);
  function collect(value) {
    if (typeof value === 'string') targets.add('package/' + value.replace(/^\.\//, ''));
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  ['main', 'types', 'module'].forEach(key => { if (packed[key]) collect(packed[key]); });
  collect(packed.exports);
  return { packed, entries: [...targets] };
}

test('changed prose and discovery metadata are valid source candidates, not historical release approval', () => {
  const { packed, entries } = fixture();
  const current = clone(source);
  current.description = packed.description = 'Updated discovery prose';
  current.keywords = packed.keywords = ['provenance', 'typescript'];
  assertCandidate(packed, current, entries);
});

test('the entire packed manifest must match the source, beyond version and dependencies', () => {
  const changes = [p => { p.description = 'stale prose'; }, p => { p.keywords = ['stale']; },
    p => { p.version = '9.9.9'; }, p => { p.dependencies.footprintjs = '9.0.0'; },
    p => { p.exports['./missing'] = './missing.js'; }, p => { p.private = true; }];
  for (const change of changes) {
    const { packed, entries } = fixture(); change(packed);
    assert.throws(() => assertCandidate(packed, source, entries), /complete current source manifest/);
  }
});

test('main, types and every export target must exist, including nested conditions and fallbacks', () => {
  const { packed, entries } = fixture();
  for (const entry of entries.filter(value => value.startsWith('package/dist/'))) {
    assert.throws(() => assertCandidate(packed, source, entries.filter(value => value !== entry)), /Missing package target/);
  }
  for (const key of ['main', 'types', 'module']) {
    const current = clone(source); current[key] = './dist/' + key + '-only.js';
    assertCandidate(clone(current), current, [...entries, 'package/dist/' + key + '-only.js']);
    assert.throws(() => assertCandidate(clone(current), current, entries), /Missing package target/);
  }
  const current = clone(source);
  current.exports['./nested'] = { node: { import: ['./dist/first.js', './dist/second.js'] }, default: null };
  const extra = [...entries, 'package/dist/first.js', 'package/dist/second.js'];
  assertCandidate(clone(current), current, extra);
  assert.throws(() => assertCandidate(clone(current), current, extra.filter(value => !value.endsWith('/second.js'))), /Missing package target/);
});

test('source candidates reject missing documentation, duplicate entries and escaping or development paths', () => {
  const { packed, entries } = fixture();
  for (const required of ['README.md', 'LICENSE', 'CHANGELOG.md']) assert.throws(() => assertCandidate(packed, source, entries.filter(value => value !== 'package/' + required)), /Missing package\//);
  for (const bad of ['../escape', '/absolute', 'package/../escape', 'package/node_modules/x', 'package/__tests__/x', 'package/.git/config', 'package/vendor/development.tgz', 'package/dir\\escape']) assert.throws(() => assertCandidate(packed, source, [...entries, bad]));
  assert.throws(() => assertCandidate(packed, source, [...entries, entries[0]]), /Duplicate/);
  for (const bad of ['../escape.js', '/absolute.js', './dist/../escape.js']) {
    const current = clone(source); current.main = bad;
    assert.throws(() => assertCandidate(clone(current), current, entries));
  }
});

test('source constraints reject private packages and nonportable or ranged dependencies', () => {
  const { entries } = fixture();
  for (const value of ['file:../local.tgz', 'workspace:*', '^10.1.0', '10.1.0-beta.1']) {
    const current = clone(source); current.dependencies.footprintjs = value;
    assert.throws(() => assertCandidate(clone(current), current, entries), /exact portable stable/);
  }
  const current = clone(source); current.private = true;
  assert.throws(() => assertCandidate(clone(current), current, entries), /cannot be private/);
});

test('the real candidate CLI checks packed bytes against this checkout and exposes no publication mode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checked-source-candidate-'));
  try {
    const { packed, entries } = fixture();
    const packageDir = join(directory, 'package');
    for (const entry of entries) {
      const target = join(directory, entry); mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry === 'package/package.json' ? JSON.stringify(packed) : 'fixture file\n');
    }
    const archive = join(directory, 'candidate.tgz');
    const pack = () => execFileSync('tar', ['-czf', archive, '-C', directory, 'package']);
    const run = () => spawnSync(process.execPath, [join(root, 'scripts/release/check-candidate.mjs'), archive], { cwd: root, encoding: 'utf8', timeout: 10000 });
    pack(); let result = run(); assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout); assert.equal(report.mode, 'source-candidate'); assert.equal(report.reviewed, false); assert.equal(report.name, source.name);
    packed.description = 'A different source archive'; writeFileSync(join(packageDir, 'package.json'), JSON.stringify(packed)); pack();
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /complete current source manifest/);
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(source));
    const missing = entries.find(entry => entry.startsWith('package/dist/')); rmSync(join(directory, missing)); pack();
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Missing package target/);
    result = spawnSync(process.execPath, [join(root, 'scripts/release/check-candidate.mjs'), archive, 'publish'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Use check-candidate/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('candidate CLI retains the reviewed package identity constraints even for a self-consistent changed checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'candidate-identity-fixture-'));
  try {
    const { packed, entries } = fixture(); packed.version = '99.0.0';
    const checkerRoot = join(directory, 'checker');
    const release = join(checkerRoot, 'scripts/release'); mkdirSync(release, { recursive: true });
    writeFileSync(join(checkerRoot, 'package.json'), JSON.stringify(packed));
    for (const name of ['check-candidate.mjs', 'candidate.mjs', 'guards.mjs', 'reviewed.json']) writeFileSync(join(release, name), readFileSync(join(root, 'scripts/release', name)));
    for (const entry of entries) {
      const target = join(directory, entry); mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry === 'package/package.json' ? JSON.stringify(packed) : 'fixture file\n');
    }
    const archive = join(directory, 'candidate.tgz');
    execFileSync('tar', ['-czf', archive, '-C', directory, 'package']);
    const result = spawnSync(process.execPath, [join(release, 'check-candidate.mjs'), archive], { cwd: checkerRoot, encoding: 'utf8', timeout: 10000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Unexpected version/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('local pnpm file validation does not relax ordinary npm full-manifest equality', () => {
  const { packed, entries } = fixture();
  delete packed.packageManager;
  delete packed.scripts.prepack;
  assertCandidateFiles(packed, entries);
  assert.throws(() => assertCandidate(packed, source, entries), /complete current source manifest/);
  const missing = entries.find(entry => entry.startsWith('package/dist/'));
  assert.throws(() => assertCandidateFiles(packed, entries.filter(entry => entry !== missing)), /Missing package target/);
});
