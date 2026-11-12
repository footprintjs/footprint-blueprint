import { test, expect } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { createBoundaryRecorder, type BoundaryOperation, type BoundaryCallContext, type BoundaryRecorderOptions } from '../runtime.js';
import { diagnoseFailureRecording } from '../index.js';
import type { FailureRecording } from '../types.js';

const quiet = Object.fromEntries(['info', 'log', 'debug', 'error', 'warn'].map(key => [key, () => {}]));
const secret = 'sk_test_PRIVATE_EMAIL@example.invalid';
const read: BoundaryOperation = { system: 'database', operation: 'read-order', target: 'database.read-order', effect: 'read', timeoutMs: 200 };
const write: BoundaryOperation = { system: 'payment', operation: 'refund', target: 'payment.refund', effect: 'write', idempotencyKey: 'private-stable-refund-key', timeoutMs: 200 };
async function execute(work: (ctx: BoundaryCallContext) => unknown | Promise<unknown>, operation = read, options: BoundaryRecorderOptions = {}, timeoutMs = 1000) {
  const recorder = createBoundaryRecorder(options);
  let providerFailure: unknown;
  const chart = flowChart('Provider stage', async scope => {
    try { return await recorder.run(scope, operation, work); }
    catch (error) { providerFailure = error; throw new Error('Provider stage rejected'); }
  }, 'provider').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart);
  executor.setRedactionPolicy({ keys: ['idempotencyKey', 'secret', 'authorization'] });
  executor.attachFlowRecorder(recorder.flowRecorder);
  let result: unknown;
  try { result = await executor.run({ timeoutMs }); } catch { /* Expected provider failures are real native failed runs. */ }
  const nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true })));
  const snapshot = recorder.snapshot();
  const recording: FailureRecording = { schemaVersion: 1, storeId: 'local-store', runId: nativeSnapshot.runId, flowId: 'provider-flow', nativeSnapshot,
    boundaryEvidence: snapshot.boundaryEvidence, physicalEvidence: snapshot.physicalEvidence, coverage: snapshot.coverage,
    diagnostics: { persistence: 'stored', ...snapshot.diagnostics } };
  return { recorder, nativeSnapshot, snapshot, recording, providerFailure, result };
}
const observation = (outcome: 'ok' | 'failed', attempt = 1, of?: number) => ({ source: 'sdk-http', outcome, startedAt: Date.now(), durationMs: 0,
  attempt, ...(of === undefined ? {} : { of }), phase: 'response-complete' as const, ...(outcome === 'failed' ? { httpStatus: 503, error: new Error(secret) } : { httpStatus: 200 }) });

test('the real call and onAttempt observer bind one SDK call and its physical try without inventing IDs', async () => {
  const run = await execute(ctx => { ctx.observePhysical(observation('ok')); return 'safe-result'; });
  expect(run.snapshot.coverage.logicalCalls).toBe(1);
  expect(run.snapshot.physicalEvidence).toHaveLength(1);
  expect(run.snapshot.boundaryEvidence).toHaveLength(2);
  const p = run.snapshot.physicalEvidence[0]!;
  const rows = run.nativeSnapshot.executionTree.attempts;
  expect(rows.find((r: any) => `${r.series}@${r.attempt}` === p.attemptId).kind).toBe('observed');
  expect(rows.find((r: any) => `${r.series}@${r.attempt}` === p.parentAttemptId).kind).toBe('call');
  expect(run.snapshot.boundaryEvidence.find(row => row.attemptId === p.attemptId)?.httpStatus).toBe(200);
  const report = diagnoseFailureRecording(run.recording);
  expect(report.status).toBe('ok');
  expect(report.coverage.logicalSDKCalls).toBe(1);
  expect(report.coverage.physicalTransportAttempts).toBe(1);
  expect(report.coverage.sdkRetryDecisions).toBe('unknown');
  expect(JSON.stringify(run.recording)).not.toContain(secret);
});

test('two actual SDK tries recover while the configured maximum and SDK stop policy remain unknown', async () => {
  const run = await execute(ctx => { ctx.observePhysical(observation('failed', 1)); ctx.observePhysical(observation('ok', 2)); });
  expect(run.snapshot.physicalEvidence.map(row => row.reportedMaximum)).toEqual([undefined, undefined]);
  const report = diagnoseFailureRecording(run.recording);
  expect(report.status).toBe('recovered');
  expect(report.coverage.physicalTransportAttempts).toBe(2);
  expect(report.consequences.some(row => row.code === 'PHYSICAL_RECOVERY_RECORDED')).toBe(true);
  expect(report.consequences.some(row => row.code === 'RETRY_EXHAUSTED_RECORDED')).toBe(false);
});

test('all-failed SDK tries do not duplicate aggregate causes or claim the SDK retry policy', async () => {
  const error = Object.assign(new Error(secret), { status: 503 });
  const run = await execute(ctx => { for (let n = 1; n <= 3; n++) ctx.observePhysical(observation('failed', n, 3)); throw error; });
  expect(run.providerFailure).toBe(error);
  expect(run.snapshot.physicalEvidence).toHaveLength(3);
  const report = diagnoseFailureRecording(run.recording);
  expect(report.status).toBe('failed');
  expect(report.causes).toHaveLength(3);
  expect(report.consequences.some(row => row.code === 'RETRY_EXHAUSTED_RECORDED')).toBe(false);
  expect(report.consequences.some(row => row.code === 'LOGICAL_CALL_STOP_RECORDED')).toBe(true);
  expect(JSON.stringify(run.recording)).not.toContain(secret);
});

test.each([false, true])('a final write acknowledgement owns its effect, including after a closed-connection retry (%s)', async retried => {
  const run = await execute(ctx => { if (retried) ctx.observePhysical(observation('failed', 1)); ctx.observePhysical(observation('ok', retried ? 2 : 1)); }, write);
  const report = diagnoseFailureRecording(run.recording);
  expect(report.status).toBe(retried ? 'recovered' : 'ok');
  expect(report.coverage.externalEffect).toBe('host-confirmed');
  expect(JSON.stringify(run.recording)).not.toContain(write.idempotencyKey);
});

test('an ambiguous write is not automatically retried', async () => {
  let sends = 0;
  const error = Object.assign(new Error(secret), { status: 503 });
  const run = await execute(ctx => { sends++; ctx.observePhysical(observation('failed')); throw error; }, write);
  expect(sends).toBe(1);
  expect(run.providerFailure).toBe(error);
  expect(run.snapshot.boundaryEvidence.find(row => row.effect === 'unknown')).toBeDefined();
  expect(diagnoseFailureRecording(run.recording).status).toBe('unknown');
  expect(diagnoseFailureRecording(run.recording).coverage.externalEffect).toBe('unknown');
});

test.each(['ConditionalCheckFailedException', 'TransactionCanceledException'])('completed %s identity survives instrumentation without rewriting unknown native effects', async name => {
  class AtomicWriteRejected extends Error { readonly status = 400; constructor() { super(secret); this.name = name; } }
  const error = new AtomicWriteRejected();
  const run = await execute(() => { throw error; }, write);
  expect(run.providerFailure).toBe(error);
  expect(run.providerFailure).toBeInstanceOf(AtomicWriteRejected);
  expect(run.nativeSnapshot.executionTree.attempts.find((r: any) => r.kind === 'call').effect).toBe('unknown');
  expect(diagnoseFailureRecording(run.recording).coverage.externalEffect).toBe('unknown');
  expect(JSON.stringify(run.recording)).not.toContain(secret);
});

test('only an adapter-explicit no-effect declaration records none for a completed write rejection', async () => {
  const error = Object.assign(new Error(secret), { status: 400, effect: 'none' });
  const run = await execute(() => { throw error; }, write);
  expect(run.providerFailure).toBe(error);
  expect(run.nativeSnapshot.executionTree.attempts.find((r: any) => r.kind === 'call').effect).toBe('none');
});

test('a final no-effect rejection cannot erase an earlier ambiguous physical write failure', async () => {
  const finalError = Object.assign(new Error('Final atomic rejection'), { status: 400, effect: 'none' });
  const run = await execute(ctx => { ctx.observePhysical(observation('failed', 1));
    ctx.observePhysical({ ...observation('failed', 2), httpStatus: 400, error: finalError }); throw finalError; }, write);
  expect(run.providerFailure).toBe(finalError);
  expect(run.nativeSnapshot.executionTree.attempts.find((r: any) => r.kind === 'call').effect).toBe('unknown');
  expect(diagnoseFailureRecording(run.recording).status).toBe('unknown');
});

test.each(['headers', 'dispatch'] as const)('a partial %s observation followed by final no-effect rejection remains unknown', async phase => {
  const finalError = Object.assign(new Error('Final rejection'), { status: 400, effect: 'none' });
  const run = await execute(ctx => { ctx.observePhysical({ ...observation('ok'), phase }); throw finalError; }, write);
  expect(run.providerFailure).toBe(finalError);
  expect(run.nativeSnapshot.executionTree.attempts.find((r: any) => r.kind === 'call').effect).toBe('unknown');
  expect(diagnoseFailureRecording(run.recording).status).toBe('unknown');
});

test.each(['headers', 'dispatch'] as const)('a partial %s read observation cannot establish complete response success', async phase => {
  const run = await execute(ctx => { ctx.observePhysical({ ...observation('ok'), phase }); return 'unchanged SDK result'; });
  expect(run.providerFailure).toBeUndefined();
  const report = diagnoseFailureRecording(run.recording);
  expect(report.status).toBe('unknown');
  expect(report.unknowns.some(text => text.includes('complete response handling is not recorded'))).toBe(true);
});

test('a separate successful reconciliation read never erases the original unknown write', async () => {
  const recorder = createBoundaryRecorder();
  let writes = 0, reads = 0;
  const chart = flowChart('Reconcile', async scope => {
    try { await recorder.run(scope, write, ctx => { writes++; ctx.observePhysical(observation('failed')); throw new Error(secret); }); } catch { /* Reconcile, never replay. */ }
    await recorder.run(scope, { ...read, system: 'payment', operation: 'reconcile', target: 'payment.reconcile' }, ctx => { reads++; ctx.observePhysical(observation('ok')); return 'unresolved'; });
  }, 'reconcile').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart);
  executor.setRedactionPolicy({ keys: ['idempotencyKey'] }); executor.attachFlowRecorder(recorder.flowRecorder); await executor.run();
  const snapshot = recorder.snapshot(), nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true })));
  const report = diagnoseFailureRecording({ schemaVersion: 1, storeId: 'local-store', runId: nativeSnapshot.runId, flowId: 'reconcile', nativeSnapshot,
    boundaryEvidence: snapshot.boundaryEvidence, physicalEvidence: snapshot.physicalEvidence, coverage: snapshot.coverage,
    diagnostics: { persistence: 'stored', ...snapshot.diagnostics } });
  expect(writes).toBe(1); expect(reads).toBe(1); expect(report.status).toBe('unknown'); expect(report.coverage.externalEffect).toBe('unknown');
});

test('a native timeout keeps unfinished provider work visible and a stored snapshot immutable', async () => {
  let finish!: () => void;
  let context!: BoundaryCallContext;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const run = await execute(async ctx => { context = ctx; await pending; ctx.observePhysical(observation('ok')); }, { ...write, timeoutMs: 15 });
  expect(run.snapshot.coverage.inFlightCalls).toBe(1);
  const before = JSON.stringify(run.snapshot);
  expect(context.signal.aborted).toBe(true);
  expect(diagnoseFailureRecording(run.recording).status).toBe('unknown');
  finish(); await pending; await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.stringify(run.snapshot)).toBe(before);
  expect(run.recorder.snapshot().coverage.lateReports).toBe(1);
  expect(run.snapshot.physicalEvidence).toHaveLength(0);
});

test('native time budgets cap a provider call and the live attempt context remains available to adapters', async () => {
  let left = Infinity, cap = Infinity;
  const run = await execute(async ctx => { left = ctx.timeLeftMs(); cap = ctx.timeoutMs!; await new Promise(resolve => setTimeout(resolve, 30)); }, { ...read, timeoutMs: 200 }, {}, 15);
  expect(left).toBeLessThanOrEqual(15);
  expect(cap).toBeLessThanOrEqual(15);
  expect(run.snapshot.coverage.inFlightCalls).toBe(1);
});

test('forwarding the native abort reason preserves genuine cancellation classification', async () => {
  const recorder = createBoundaryRecorder(), controller = new AbortController();
  const chart = flowChart('Abort', scope => recorder.run(scope, read, ctx => new Promise<void>((_resolve, reject) => {
    ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
    controller.abort(new Error('Trusted host cancelled'));
  })), 'abort').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart); executor.attachFlowRecorder(recorder.flowRecorder);
  try { await executor.run({ signal: controller.signal }); } catch { /* Expected trusted cancellation. */ }
  expect(recorder.snapshot().boundaryEvidence.find(row => row.outcome === 'aborted')).toBeDefined();
});

test('a missing observer or malformed transport report cannot turn an acknowledged write into failure', async () => {
  const run = await execute(ctx => { ctx.observePhysical({ ...observation('ok'), durationMs: -1 }); return 'committed'; }, write);
  expect(run.providerFailure).toBeUndefined();
  expect(run.snapshot.diagnostics.observer).toBe('failed');
  expect(run.snapshot.coverage.unboundObservations).toBe(1);
  expect(diagnoseFailureRecording(run.recording).status).toBe('unknown');
});

test('an SDK call without transport reports does not establish zero physical sends', async () => {
  const run = await execute(() => 'SDK result');
  const report = diagnoseFailureRecording(run.recording);
  expect(report.coverage.logicalSDKCalls).toBe(1);
  expect(report.coverage.physicalTransportAttempts).toBeNull();
  expect(report.unknowns.some(text => text.includes('zero provider sends'))).toBe(true);
});

test('a real observation plus an explicit omission stays incomplete without inventing attempts', async () => {
  const run = await execute(ctx => { ctx.observePhysical(observation('ok')); ctx.markIncomplete('multiple-dispatches'); return 'acknowledged'; });
  expect(run.providerFailure).toBeUndefined();
  expect(run.snapshot.physicalEvidence).toHaveLength(1);
  expect(run.snapshot.coverage.physicalObservations).toBe(1);
  expect(run.snapshot.coverage.omittedObservations).toBe(1);
  expect(run.snapshot.coverage.unboundObservations).toBe(0);
  const report = diagnoseFailureRecording(run.recording);
  expect(report.status).toBe('unknown');
  expect(report.coverage.physicalTransportAttempts).toBe(1);
  expect(report.coverage.physicalAttemptCounts).toBe('reported-only');
  const previous = JSON.parse(JSON.stringify(run.recording)); delete previous.coverage.omittedObservations;
  expect(() => diagnoseFailureRecording(previous)).not.toThrow();
});

test('unattached observer and pre-call admission failure remain explicit evidence gaps', async () => {
  const recorder = createBoundaryRecorder();
  const executor = new FlowChartExecutor(flowChart('Unattached', scope => recorder.run(scope, read, () => 'done'), 'unattached').setLogger(quiet).build());
  await executor.run();
  expect(recorder.snapshot().boundaryEvidence).toHaveLength(0);
  expect(recorder.snapshot().coverage.unboundObservations).toBe(1);
  const invalid = await execute(() => { throw new Error('must not run'); }, { ...write, idempotencyKey: 'bad key with spaces' });
  expect(invalid.snapshot.coverage.inFlightCalls).toBe(0);
  expect(invalid.snapshot.coverage.unboundObservations).toBe(1);
});

test('a broken normalizer is an observer failure and does not replace the original read failure', async () => {
  const error = new Error(secret);
  const run = await execute(() => { throw error; }, read, { normalizeError() { throw new Error('observer failed'); } });
  expect(run.providerFailure).toBe(error);
  expect(run.snapshot.diagnostics.observer).toBe('failed');
  expect(JSON.stringify(run.recording)).not.toContain(secret);
});

test('row limits retain honest omissions rather than dangling fabricated bindings', async () => {
  const run = await execute(ctx => { ctx.observePhysical(observation('failed')); ctx.observePhysical(observation('ok', 2)); }, read, { maxEvents: 1 });
  expect(run.snapshot.boundaryEvidence.length).toBeLessThanOrEqual(1);
  expect(run.snapshot.coverage.droppedEvents).toBeGreaterThan(0);
  expect(() => diagnoseFailureRecording(run.recording)).not.toThrow();
  expect(diagnoseFailureRecording(run.recording).status).toBe('unknown');
});

test('snapshots are deeply frozen detached JSON and hostile reports never invoke getters', async () => {
  let getterReads = 0;
  const run = await execute(ctx => { const report = { ...observation('failed'), error: { message: secret, headers: { authorization: secret } } };
    Object.defineProperty(report, 'httpStatus', { get() { getterReads++; return 401; } }); ctx.observePhysical(report); });
  expect(getterReads).toBe(0);
  expect(Object.isFrozen(run.snapshot)).toBe(true);
  expect(Object.isFrozen(run.snapshot.boundaryEvidence)).toBe(true);
  expect(JSON.stringify(run.snapshot)).not.toContain(secret);
});

test('forged physical bindings, clocks, sources and SDK-policy claims are rejected', async () => {
  const run = await execute(ctx => { ctx.observePhysical(observation('ok')); });
  for (const change of [
    (r: any) => { r.physicalEvidence[0].attemptId = 'invented@1'; },
    (r: any) => { r.physicalEvidence[0].parentAttemptId = r.physicalEvidence[0].attemptId; },
    (r: any) => { r.physicalEvidence[0].source = 'another-sdk'; },
    (r: any) => { r.physicalEvidence[0].startedAt += 1000; },
    (r: any) => { r.physicalEvidence[0].durationMs += 1000; },
    (r: any) => { r.physicalEvidence[0].reportedMaximum = 10; },
    (r: any) => { r.physicalEvidence[0].sdkRetryDecision = 'exhausted'; },
    (r: any) => { r.coverage.physicalObservations = 0; },
  ]) { const edited = JSON.parse(JSON.stringify(run.recording)); change(edited); expect(() => diagnoseFailureRecording(edited)).toThrow(); }
});

test('concurrent recorders never attach another run or its private provider data', async () => {
  const [a, b] = await Promise.all([execute(async ctx => { await new Promise(resolve => setTimeout(resolve, 2)); ctx.observePhysical(observation('ok')); }),
    execute(ctx => { ctx.observePhysical(observation('ok')); })]);
  expect(a.snapshot.runId).not.toBe(b.snapshot.runId);
  expect(a.snapshot.runId).toBe(a.nativeSnapshot.runId);
  expect(b.snapshot.runId).toBe(b.nativeSnapshot.runId);
  expect(diagnoseFailureRecording(a.recording).status).toBe('ok');
  expect(diagnoseFailureRecording(b.recording).status).toBe('ok');
});

test('parallel logical calls on the same stage keep distinct adapter-reported parent associations', async () => {
  const recorder = createBoundaryRecorder();
  const chart = flowChart('Parallel', scope => Promise.all([recorder.run(scope, read, async ctx => {
    ctx.observePhysical(observation('failed', 1)); await new Promise(resolve => setTimeout(resolve, 3)); ctx.observePhysical(observation('ok', 2));
  }), recorder.run(scope, read, ctx => { ctx.observePhysical(observation('ok', 1)); })]), 'parallel').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart); executor.attachFlowRecorder(recorder.flowRecorder); await executor.run();
  const snapshot = recorder.snapshot(), nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true })));
  expect(new Set(snapshot.physicalEvidence.map(row => row.parentAttemptId)).size).toBe(2);
  const report = diagnoseFailureRecording({ schemaVersion: 1, storeId: 'local-store', runId: nativeSnapshot.runId, flowId: 'parallel', nativeSnapshot,
    boundaryEvidence: snapshot.boundaryEvidence, physicalEvidence: snapshot.physicalEvidence, coverage: snapshot.coverage,
    diagnostics: { persistence: 'stored', ...snapshot.diagnostics } });
  expect(report.status).toBe('recovered'); expect(report.coverage.logicalSDKCalls).toBe(2); expect(report.coverage.physicalTransportAttempts).toBe(3);
});

test('a host-selected provider request reference stays tied to the genuine physical attempt without authenticating delivery', async () => {
  const reference = { namespace: 'stripe', id: 'req_fixture123' };
  const run = await execute(ctx => { ctx.observePhysical({ ...observation('ok'), requestReference: reference }); reference.id = 'req_changed'; return 'acknowledged'; });
  expect(run.result).toBe('acknowledged');
  expect(run.snapshot.physicalEvidence[0]?.requestReference).toEqual({ namespace: 'stripe', id: 'req_fixture123' });
  expect(Object.isFrozen(run.snapshot.physicalEvidence[0]?.requestReference)).toBe(true);
  const diagnosis = diagnoseFailureRecording(run.recording);
  expect(diagnosis.unknowns.some(text => text.includes('adapter-reported lookup aids'))).toBe(true);
  expect(JSON.stringify(diagnosis)).not.toContain('req_fixture123');
  expect(run.nativeSnapshot.executionTree.attempts.some((row: any) => row.kind === 'observed')).toBe(true);
});

test.each(['sk_live_PRIVATE', 'owner@example.invalid', 'https://provider.invalid/secret', 'x'.repeat(129)])('a malformed request reference cannot alter acknowledged business behavior', async id => {
  const run = await execute(ctx => { ctx.observePhysical({ ...observation('ok'), requestReference: { namespace: 'provider', id } }); return 'acknowledged'; });
  expect(run.result).toBe('acknowledged');
  expect(run.snapshot.physicalEvidence).toEqual([]);
  expect(run.snapshot.coverage.unboundObservations).toBeGreaterThan(0);
  expect(JSON.stringify(run.recording)).not.toContain(id);
  expect(diagnoseFailureRecording(run.recording).status).toBe('unknown');
});

test('an imported provider reference cannot bypass the strict stored-record seam', async () => {
  const run = await execute(ctx => ctx.observePhysical(observation('ok')));
  const changed = JSON.parse(JSON.stringify(run.recording));
  changed.physicalEvidence[0].requestReference = { namespace: 'provider', id: 'sk_live_PRIVATE' };
  expect(() => diagnoseFailureRecording(changed)).toThrow('Failure recording is invalid');
});
