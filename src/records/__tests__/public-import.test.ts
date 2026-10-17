import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../..', import.meta.url));
test('the focused records import performs no I/O or model work and retains no vendor or Node dependency', () => {
  const program = `globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN'); }; const api=await import('footprint-blueprint/records/object-store'); if(Object.keys(api).sort().join(',')!=='DEFAULT_OBJECT_RECORD_LIMITS,ObjectRecordError,createObjectRecordSink,readObjectRecord')throw Error('INVALID_EXPORTS');`;
  execFileSync(process.execPath, ['--input-type=module', '-e', program], { cwd: root, encoding: 'utf8', timeout: 5000 });
  const source = readFileSync(new URL('../object-store.ts', import.meta.url), 'utf8'); expect(source).not.toMatch(/from\s+['"](?:node:|@aws|agentfootprint|react|smallbusiness-footprint)/);
});
test('record storage public contracts compile in a browser consumer with zero Node ambient types', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)), '--project', fileURLToPath(new URL('./fixtures/tsconfig.browser.json', import.meta.url))], { cwd: root, encoding: 'utf8', timeout: 10000 });
});
