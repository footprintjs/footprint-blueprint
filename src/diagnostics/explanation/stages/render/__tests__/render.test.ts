import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagnoseFailureRecording } from '../../../../index.js';
import { renderPresentation } from '../index.js';
import type { PresentationRun } from '../../types.js';
import { recording } from '../../../__tests__/fixtures.js';

test('render refuses missing selection and otherwise retains the actual unknowns', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const run: PresentationRun = { diagnose: () => diagnosis, diagnosis, templates: [] };
  assert.throws(renderPresentation(run), error => (error as { code: string }).code === 'EXPLANATION_INVALID');
  run.selection = { reason: 'no-templates' };
  renderPresentation(run)();
  assert.deepEqual(run.result?.unknowns, diagnosis.unknowns);
});
