import { test } from 'vitest';
import assert from 'node:assert/strict';
import { FlowChartBuilder, FlowChartExecutor } from 'footprintjs';
import { createBoundaryRecorder } from '../../runtime.js';
import { diagnoseFailureRecording, formatFailureExplanation } from '../../index.js';
import type { FailureRecording } from '../../types.js';

async function recoveredDiagnosis() {
  const recorder = createBoundaryRecorder();
  const chart = new FlowChartBuilder().start('Read through observed transport', scope => recorder.run(scope,
    { system: 'database', operation: 'read', target: 'database.read', effect: 'read' }, context => {
      for (let attempt = 1; attempt <= 3; attempt++) context.observePhysical({ source: 'local-sdk',
        outcome: attempt === 3 ? 'ok' : 'failed', startedAt: Date.now(), durationMs: 0, attempt,
        phase: 'response-complete', httpStatus: attempt === 3 ? 200 : 503,
        ...(attempt === 3 ? {} : { error: new Error('PRIVATE_TRANSPORT_DETAIL') }) });
      return 'local read result';
    }), 'read').setLogger({ info() {}, log() {}, warn() {}, error() {}, debug() {} }).build();
  const executor = new FlowChartExecutor(chart);
  executor.attachFlowRecorder(recorder.flowRecorder);
  await executor.run();
  const nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true }))), observation = recorder.snapshot();
  const recording: FailureRecording = { schemaVersion: 1, storeId: 'local-store', runId: nativeSnapshot.runId,
    flowId: 'local-read', nativeSnapshot, boundaryEvidence: observation.boundaryEvidence,
    physicalEvidence: observation.physicalEvidence, coverage: observation.coverage,
    diagnostics: { persistence: 'stored', ...observation.diagnostics } };
  return diagnoseFailureRecording(recording);
}

test('a unique recorded recovery consequence can customize problem and advice without choosing between earlier causes', async () => {
  const diagnosis = await recoveredDiagnosis();
  assert.equal(diagnosis.status, 'recovered');
  assert.equal(diagnosis.causes.length, 2);
  assert.equal(diagnosis.consequences.filter(row => row.code === 'PHYSICAL_RECOVERY_RECORDED').length, 1);
  const before = JSON.stringify(diagnosis);
  const view = formatFailureExplanation(diagnosis, { templates: [{ id: 'recovered',
    when: { status: 'recovered', findingCode: 'PHYSICAL_RECOVERY_RECORDED' },
    problem: 'The recorded operation recovered.', suggestedNextStep: 'Review the earlier transport observations.',
    recordedCause: 'Do not claim this consequence is the root.' }] });
  assert.equal(view.template.id, 'recovered');
  assert.equal(view.problem.configuredText, 'The recorded operation recovered.');
  assert.equal(view.suggestedNextStep.configuredText, 'Review the earlier transport observations.');
  assert.equal(view.recordedCause.configuredText, undefined);
  assert.equal(view.recordedCause.text, diagnosis.causes.map(row => row.summary).join(' '));
  assert.deepEqual(view.unknowns, diagnosis.unknowns);
  assert.deepEqual(view.evidenceRefs, diagnosis.evidenceRefs);
  assert.equal(view.coverage.upstreamRootCause, 'unknown');
  assert.equal(JSON.stringify(diagnosis), before);
});

test('status-only templates and repeated finding-code matches keep the conservative ambiguity fallback', async () => {
  const diagnosis = await recoveredDiagnosis();
  for (const when of [{ status: 'recovered' as const }, { status: 'recovered' as const, findingCode: 'BOUNDARY_FAILURE_RECORDED' }]) {
    const view = formatFailureExplanation(diagnosis, { templates: [{ id: 'ambiguous', when, problem: 'Do not pick a first cause.' }] });
    assert.equal(view.template.reason, 'ambiguous-findings');
    assert.equal(view.problem.configuredText, undefined);
    assert.equal(view.recordedCause.configuredText, undefined);
  }
});
