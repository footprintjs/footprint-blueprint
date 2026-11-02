// Built-in modules only; this source-candidate check has no publication mode.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { assertPackage } from './guards.mjs';
import { assertCandidate } from './candidate.mjs';

assert.equal(process.argv.length, 3, 'Use check-candidate.mjs /path/to/candidate.tgz.');
const archive = resolve(process.argv[2]);
const source = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const reviewed = JSON.parse(await readFile(new URL('./reviewed.json', import.meta.url), 'utf8'));
// Keep the existing name/version/exact-dependency/repository constraints. This
// does not compare or replace the immutable archive hashes used for publication.
assertPackage(source, reviewed);
const packed = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
assertCandidate(packed, source, entries);
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
console.log(JSON.stringify({ name: packed.name, version: packed.version, mode: 'source-candidate', reviewed: false, sha256 }));
