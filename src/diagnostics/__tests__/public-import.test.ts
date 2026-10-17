import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
test('the published diagnostics subpath loads only its two pure runtime functions without network access', () => {
  const program = `globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };\nconst api = await import('footprint-blueprint/diagnostics');\nif (Object.keys(api).sort().join(',') !== 'diagnoseFailureRecording,normalizeBoundaryError') throw new Error('INVALID_EXPORTS');\nif (api.normalizeBoundaryError({status:503},{system:'directory',operation:'lookup',effect:'read'}).category !== 'server') throw new Error('INVALID_NORMALIZATION');\n`;
  execFileSync(process.execPath, ['--input-type=module', '--eval', program], { cwd: root, timeout: 5000, encoding: 'utf8' });
  const implementation = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(implementation, /from\s+['"](?:node:|@aws|agentfootprint|react|smallbusiness-footprint)/);
  assert.doesNotMatch(implementation, /AccessDeniedException|Dynamo|Stripe|EasyPost|charming/i);
});
test('public contracts compile in a DOM consumer with no Node ambient types', () => {
  const compiler = new URL('../../../node_modules/typescript/bin/tsc', import.meta.url);
  const config = new URL('./fixtures/tsconfig.browser.json', import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(compiler), '--project', fileURLToPath(config)], { cwd: root, timeout: 10000, encoding: 'utf8' });
});
