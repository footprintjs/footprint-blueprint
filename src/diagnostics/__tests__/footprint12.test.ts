import { describe, expect, it } from 'vitest';
import { FlowChartBuilder, FlowChartExecutor } from 'footprintjs';
import { createRecordGraph, explain } from 'foottrace/cause';
import { createBoundaryRecorder } from '../runtime.js';
import { diagnoseFailureRecording } from '../index.js';
import { createCauseCapture, recordedCauseScopes } from '../cause.js';
import type { FailureRecording } from '../types.js';

const quiet = { info() {}, log() {}, warn() {}, error() {}, debug() {} };

async function returnedCall() {
  const boundary = createBoundaryRecorder();
  const chart = new FlowChartBuilder().start('Read a fixture', async scope => {
    await boundary.run(scope, { system: 'inventory', operation: 'read', target: 'inventory.read', effect: 'read' }, () => 7);
  }, 'read').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart);
  executor.attachFlowRecorder(boundary.flowRecorder);
  await executor.run();
  const snapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true })));
  const observed = boundary.snapshot();
  const recording: FailureRecording = {
    schemaVersion: 1, storeId: 'fixture-store', runId: snapshot.runId, flowId: 'fixture-flow',
    nativeSnapshot: snapshot, boundaryEvidence: observed.boundaryEvidence,
    physicalEvidence: observed.physicalEvidence, coverage: observed.coverage,
    diagnostics: { persistence: 'stored', ...observed.diagnostics },
  };
  return { recording, snapshot };
}

describe('published FootPrint 12 and Foottrace 1.15 admission', () => {
  it('keeps the native answered label without upgrading transport or provider coverage', async () => {
    const { recording, snapshot } = await returnedCall();
    expect(snapshot.executionTree.attempts.some((row: { reason: string }) => row.reason === 'answered')).toBe(true);
    expect(recording.boundaryEvidence[0]?.decision?.reason).toBe('answered');
    const diagnosis = diagnoseFailureRecording(recording);
    expect(diagnosis.status).toBe('ok');
    expect(diagnosis.coverage.upstreamRootCause).toBe('unknown');
    expect(diagnosis.coverage.physicalTransportAttempts).toBeNull();
    expect(diagnosis.coverage.sdkRetryDecisions).toBe('unknown');
  });

  it('still reads stored succeeded labels without rewriting the imported record', async () => {
    const { recording, snapshot } = await returnedCall();
    for (const row of snapshot.executionTree.attempts) if (row.reason === 'answered') row.reason = 'succeeded';
    const stored = { ...recording, boundaryEvidence: recording.boundaryEvidence.map(row => ({ ...row,
      ...(row.decision ? { decision: { ...row.decision, reason: 'succeeded' as const } } : {}) })) };
    const bytes = JSON.stringify(stored);
    expect(diagnoseFailureRecording(stored).status).toBe('ok');
    expect(JSON.stringify(stored)).toBe(bytes);
    snapshot.executionTree.attempts[0].reason = 'provider-confirmed';
    expect(() => diagnoseFailureRecording(stored)).toThrow('Failure recording is invalid');
  });

  it.each([false, true])('keeps writes underneath partial writes in the shared graph (seeded: %s)', async seeded => {
    const chart = new FlowChartBuilder().start('Seed', scope => {
      if (seeded) scope.bag = { base: 1 };
    }, 'seed').addFunction('Add a field', scope => {
      scope.$update('bag', { extra: 2 });
    }, 'add').addFunction('Read the assembled value', scope => { scope.result = scope.bag; }, 'read')
      .setLogger(quiet).build();
    const capture = createCauseCapture();
    const executor = new FlowChartExecutor(chart, { initialContext: seeded ? {} : { bag: { base: 1 } },
      readTracking: 'summary', writeTracking: 'summary', writeProvenance: 'reads-prefix', commitValues: 'delta' });
    executor.attachFlowRecorder(capture.recorder);
    await executor.run();
    const snapshot = executor.getSnapshot({ redact: true });
    const source = recordedCauseScopes(snapshot, capture.snapshot(snapshot));
    const scope = source.scopes[0]!;
    const graph = createRecordGraph(source.scopes);
    const index = snapshot.commitLog.findIndex(row => row.stageId === 'add');
    const bundle = snapshot.commitLog[index]!;
    expect(bundle.trace).toContainEqual(expect.objectContaining({ path: 'bag', verb: 'merge', readKeys: [] }));
    const nodeId = graph.nodeId(scope.address, { runtimeStageId: bundle.runtimeStageId, commitIdx: index, key: 'bag' });
    const parents = await graph.parents(nodeId, { signal: new AbortController().signal });
    if (seeded) {
      expect(parents.edges.some(edge => edge.attribution === 'recorded-write')).toBe(true);
    } else {
      const result = await explain(graph, nodeId, { includeBackward: true });
      expect(result.confidence).toBe('incomplete');
      expect(result.rootCause).toBeUndefined();
      expect(parents.edges).toEqual([]);
      expect(result.gaps.some(gap => gap.code === 'not-collected')).toBe(true);
    }
  });
});
