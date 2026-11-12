import { describe, expect, it } from 'vitest';
import { FlowChartBuilder, FlowChartExecutor } from 'footprintjs';
import { createCauseCapture, createRecordedCauseReader, recordedCauseScopes } from '../cause.js';

describe('recorded cause queries', () => {
  it('uses per-write prefixes and preserves the native bounded query result', async () => {
    const chart = new FlowChartBuilder().start('seed', s => { s.a = 1; s.b = 2; }, 'seed')
      .addFunction('consume', s => { s.x = s.a; s.y = s.b; }, 'consume').build();
    const capture = createCauseCapture();
    const executor = new FlowChartExecutor(chart, { readTracking: 'summary', writeTracking: 'summary', writeProvenance: 'reads-prefix' });
    executor.attachFlowRecorder(capture.recorder);
    await executor.run();
    const snapshot = executor.getSnapshot({ redact: true });
    const source = recordedCauseScopes(snapshot, capture.snapshot(snapshot));
    expect(source.incomplete).toBe(false);
    const reader = createRecordedCauseReader(source);
    const catalog = await reader.catalog();
    const x = catalog.nodes.find(n => n.selection.key === 'x')!;
    expect(x).toBeDefined();
    const result = await reader.explain(x.id);
    expect(result.nodeId).toBe(x.id);
    expect(JSON.stringify(result)).not.toContain('getValue');
    expect(catalog.nodes.some(n => n.selection.key === 'b')).toBe(true);
    expect(result.impact.nodes).not.toContain(catalog.nodes.find(n => n.selection.key === 'b')!.id);
  });

  it('does not turn interpreted physical stop fields into logical exhaustion', () => {
    const capture = createCauseCapture(), context = { runId: 'run-1', runtimeStageId: 'work#0' } as any;
    capture.recorder.onRunStart!({ traversalContext: context } as any);
    const record = { kind: 'observed', series: 'work#0@1.1', attempt: 1, of: 1, next: 'stop', reason: 'exhausted', outcome: 'failed' };
    capture.recorder.onAttempt!({ record, traversalContext: context } as any);
    capture.recorder.onRunEnd!({} as any);
    let snapshot = capture.snapshot({ runId: 'run-1' });
    expect(Object.values(snapshot.attention).flat()).toEqual([]);
    capture.recorder.onAttempt!({ record: { ...record, attempt: 2 }, traversalContext: context } as any);
    snapshot = capture.snapshot({ runId: 'run-1' });
    expect(snapshot.attention['work#0']!.map(mark => mark.kind)).toEqual(['retried']);
  });

  it('does not report a planned retry when cancellation prevents the next actual attempt', async () => {
    const capture = createCauseCapture(), controller = new AbortController(); let calls = 0;
    const quiet = { log() {}, debug() {}, info() {}, warn() {}, error() {} };
    const executor = new FlowChartExecutor(new FlowChartBuilder().start('work', () => { calls++; throw new Error('synthetic'); }, 'work')
      .retry({ attempts: 2, backoffMs: 20 }).setLogger(quiet).build());
    executor.attachFlowRecorder(capture.recorder);
    executor.attachFlowRecorder({ id: 'cancel-after-first-attempt', onAttempt() { controller.abort(); } });
    await executor.run({ signal: controller.signal }).catch(() => {});
    const result = capture.snapshot(executor.getSnapshot({ redact: true }));
    expect(calls).toBe(1);
    expect(Object.values(result.attention).flat().some(mark => mark.kind === 'retried')).toBe(false);
  });

  it.each([false, true])('does not certify earlier history after resume (fresh executor: %s)', async fresh => {
    let a = 0, b = 0; const quiet = { log() {}, debug() {}, info() {}, warn() {}, error() {} };
    const chart = new FlowChartBuilder().start('A', scope => { if (++a === 1) throw new Error('synthetic'); scope.a = 1; }, 'A')
      .retry({ attempts: 2 }).addPausableFunction('Wait', {
        execute: scope => { scope.pending = true; return { question: 'synthetic' }; }, resume: scope => { scope.approved = true; },
      }, 'wait').addFunction('B', scope => { if (++b === 1) throw new Error('synthetic'); scope.b = scope.a; }, 'B')
      .retry({ attempts: 2 }).addFunction('C', scope => { scope.x = scope.b; }, 'C').setLogger(quiet).build();
    const options = { readTracking: 'summary', writeTracking: 'summary', writeProvenance: 'reads-prefix' } as const;
    let capture = createCauseCapture(), executor = new FlowChartExecutor(chart, options);
    executor.attachFlowRecorder(capture.recorder); await executor.run(); const checkpoint = executor.getCheckpoint();
    if (fresh) { capture = createCauseCapture(); executor = new FlowChartExecutor(chart, options); executor.attachFlowRecorder(capture.recorder); }
    await executor.resume(checkpoint!, {});
    const snapshot = executor.getSnapshot({ redact: true }), evidence = capture.snapshot(snapshot);
    expect(evidence.complete).toBe(false);
    const source = recordedCauseScopes(snapshot, evidence); expect(source.incomplete).toBe(true);
    const reader = createRecordedCauseReader(source), x = reader.nodes.find(node => node.selection.key === 'x')!;
    const result = await reader.explain(x.id);
    expect(result.confidence).toBe('incomplete'); expect(result.rootCause).toBeUndefined();
  });

  it('retains only fixed factual marks, with bounded omission and no raw error body', () => {
    const capture = createCauseCapture(), context = { runId: 'run-1', runtimeStageId: 'work#0' } as any;
    capture.recorder.onRunStart!({ traversalContext: context } as any);
    for (let index = 0; index < 40; index++) capture.recorder.onError!({ traversalContext: context, errorMessage: 'PRIVATE@example.invalid' } as any);
    capture.recorder.onRunFailed!({} as any);
    const snapshot = capture.snapshot({ runId: 'run-1' });
    expect(snapshot.complete).toBe(false);
    expect(snapshot.attention['work#0']![0]!.evidence).toHaveLength(16);
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
  });

  it('does not certify an unstamped terminal failure and resets across real runs', async () => {
    const capture = createCauseCapture();
    capture.recorder.onRunStart!({ traversalContext: { runId: 'failure', runtimeStageId: 'work#0' } } as any);
    capture.recorder.onRunFailed!({} as any);
    expect(capture.snapshot({ runId: 'failure' }).complete).toBe(false);
    const executor = new FlowChartExecutor(new FlowChartBuilder().start('healthy', s => { s.x = 1; }, 'healthy').build());
    executor.attachFlowRecorder(capture.recorder); await executor.run();
    const snapshot = capture.snapshot(executor.getSnapshot({ redact: true }));
    expect(snapshot.complete).toBe(true);
    expect(Object.keys(snapshot.attention)).toEqual([]);
  });

  it('rejects excessive catalogs and malformed scope data before public queries', () => {
    expect(() => createRecordedCauseReader({ scopes: [null as any], incomplete: false })).toThrow('Cause recording is unavailable');
    expect(() => createRecordedCauseReader({ scopes: [], incomplete: false }, { maxCatalogNodes: 0 })).toThrow('Cause recording is unavailable');
    expect(() => createRecordedCauseReader({ scopes: Array.from({ length: 17 }, () => ({ address: { logRunId: 'run', drillPath: [] }, commitLog: [] })), incomplete: false })).toThrow('Cause recording is unavailable');
  });

  it('never turns a legacy missing capture into complete evidence', async () => {
    const executor = new FlowChartExecutor(new FlowChartBuilder().start('work', s => { s.x = 1; }, 'work').build());
    await executor.run();
    const source = recordedCauseScopes(executor.getSnapshot({ redact: true }));
    const reader = createRecordedCauseReader(source);
    const catalog = await reader.catalog();
    const result = await reader.explain(catalog.nodes[0]!.id);
    expect(result.confidence).toBe('incomplete');
    expect(result.rootCause).toBeUndefined();
    expect(result.gaps.some(g => g.code === 'not-collected')).toBe(true);
  });

  it('refuses foreign selections and getters without reading their value', async () => {
    let touched = false;
    const hostile = Object.defineProperty({}, 'commitLog', { enumerable: true, get() { touched = true; throw new Error('PRIVATE'); } });
    expect(() => recordedCauseScopes(hostile)).toThrow('Cause recording is unavailable');
    expect(touched).toBe(false);
    const reader = createRecordedCauseReader({ scopes: [], incomplete: true });
    await expect(reader.explain('foreign-private-id')).rejects.toMatchObject({ code: 'CAUSE_SELECTION_INVALID' });
  });

  it('does not disclose raw exceptions and honors a pre-aborted query', async () => {
    const reader = createRecordedCauseReader({ scopes: [], incomplete: true });
    const controller = new AbortController(); controller.abort();
    const result = await reader.catalog({ signal: controller.signal });
    expect(result.confidence).toBe('incomplete');
    expect(result.gaps.map(g => g.code)).toContain('cancelled');
  });
});
