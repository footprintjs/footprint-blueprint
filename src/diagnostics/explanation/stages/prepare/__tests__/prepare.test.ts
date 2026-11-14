import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagnoseFailureRecording } from '../../../../index.js';
import { preparePresentation } from '../index.js';
import type { PresentationRun } from '../../types.js';
import { recording } from '../../../__tests__/fixtures.js';

test('prepare keeps diagnosis and configured copy outside the recorded scope', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  let calls = 0;
  const run: PresentationRun = { diagnose: () => { calls++; return diagnosis; }, templates: [
    { id: 'auth', when: { findingCode: 'AUTH_REJECTION_RECORDED' }, problem: 'Private authored wording' },
  ] };
  const scope = { configured: false };
  preparePresentation(run)(scope);
  assert.equal(calls, 1); assert.deepEqual(scope, { configured: true });
  assert.equal(run.selection?.templateId, 'auth');
  assert(!JSON.stringify(scope).includes('Private authored wording'));
});
