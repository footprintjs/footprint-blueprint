import { test } from 'vitest';
import assert from 'node:assert/strict';
import { FlowChartExecutor } from 'footprintjs';
import { diagnoseFailureRecording } from '../../../../index.js';
import { explanationChart } from '../../../chart.js';
import type { PresentationRun } from '../../types.js';
import { privateError, recording } from '../../../__tests__/fixtures.js';

test('actual chart records configured and default decide branches without raw input or wording', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  for (const configured of [false, true]) {
    const run: PresentationRun = { diagnose: () => diagnosis, templates: configured
      ? [{ id: 'auth', when: { findingCode: 'AUTH_REJECTION_RECORDED' }, problem: 'PRIVATE_CONFIGURED_WORDING' }] : [] };
    const executor = new FlowChartExecutor(explanationChart(run));
    executor.enableNarrative();
    await executor.run();
    const snapshot = executor.getSnapshot({ redact: true }), text = JSON.stringify([snapshot, executor.getNarrativeEntries()]);
    assert.equal(run.result?.template.outcome, configured ? 'configured' : 'default');
    assert(text.includes('explanation-choose'));
    assert(text.includes(configured ? 'One eligible static wording template' : 'No unique eligible template; preserve canonical defaults'));
    assert(!text.includes(privateError)); assert(!text.includes('PRIVATE_CONFIGURED_WORDING'));
  }
});
