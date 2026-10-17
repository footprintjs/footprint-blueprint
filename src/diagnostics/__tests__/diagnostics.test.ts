import { test } from 'vitest';
import assert from 'node:assert/strict';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { normalizeBoundaryError, diagnoseFailureRecording } from '../index.js';

const SECRET = 'sk_test_PRIVATE_CUSTOMER_EMAIL@example.invalid';
const quiet = Object.fromEntries(['info', 'log', 'debug', 'error', 'warn'].map(key => [key, () => {}]));
async function recording(errors = [Object.assign(new Error(SECRET), { status: 503 })], { write = false } = {}) {
  let index = 0;
  const chart = flowChart('Boundary', async scope => scope.$call('local-boundary', async () => {
    const error = errors[index++]; if (error) throw error; return 'local result';
  }, { attempts: errors.length, timeoutMs: 100, retryOn: () => errors.length > 1 }), 'boundary').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart);
  executor.setRedactionPolicy({ keys: ['token', 'email'], patterns: [/PRIVATE/] });
  try { await executor.run({ timeoutMs: 1000 }); } catch { /* Genuine failed SDK recording. */ }
  const nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true })));
  const node = nativeSnapshot.executionTree;
  const calls = node.attempts.filter(attempt => attempt.kind === 'call');
  return { schemaVersion: 1, storeId: 'local-store', runId: nativeSnapshot.runId, flowId: 'local-flow', nativeSnapshot,
    boundaryEvidence: calls.map((attempt, i) => ({ id: `event-${i}`, sequence: i + 1, runtimeStageId: node.runtimeStageId,
      attemptId: `${attempt.series}@${attempt.attempt}`, target: write ? 'payment' : 'database', operation: write ? 'payment.create' : 'database.read',
      outcome: attempt.outcome === 'ok' ? 'ok' : 'failed', category: attempt.category ?? 'unknown',
      effect: write ? 'unknown' : 'none', decision: { next: attempt.next, reason: attempt.reason } })),
    diagnostics: { persistence: 'stored', observer: 'ok' } };
}
const clean = report => { const text = JSON.stringify(report); assert.ok(!text.includes(SECRET)); assert.ok(!text.includes('secret-stack')); return text; };
test('generic app codes and string HTTP status cannot establish a dependency cause', () => {
  for (const error of [{ code: 'PRODUCT_STORAGE_UNAVAILABLE' }, { status: '500', message: SECRET }, { statusCode: '429' }]) {
    const result = normalizeBoundaryError(error, { system: 'database', operation: 'read', effect: 'read' });
    assert.equal(result.category, 'unknown'); assert.equal(result.httpStatus, undefined);
  }
});
test('normalization preserves only exact local guard and response-validation codes without replacing category', () => {
  for (const code of ['CIRCUIT_OPEN', 'BUDGET_PREFLIGHT_REJECTED', 'IDEMPOTENCY_KEY_REQUIRED', 'MALFORMED_RESPONSE', 'LOCAL_DEPENDENCY_BLOCKED']) {
    const result = normalizeBoundaryError({ code, status: 500, message: SECRET }, { system: 'shipping', operation: 'quote', effect: 'read' });
    assert.equal(result.code, code); assert.equal(result.category, 'server'); assert.equal(result.httpStatus, 500); clean(result);
  }
  for (const code of ['BUDGET_PREFLIGHT_REJECTED_EXTRA', 'budget_preflight_rejected', 'PROVIDER_PRIVATE_CODE']) {
    assert.equal(normalizeBoundaryError({ code, message: 'BUDGET_PREFLIGHT_REJECTED' }, { system: 'database', operation: 'read', effect: 'read' }).code,
      'DEPENDENCY_FAILURE_UNKNOWN');
  }
});
test('normalizer never invokes getters or copies raw causes, codes, messages or headers', () => {
  let read = false;
  const error = { message: SECRET, cause: { code: SECRET }, code: SECRET, headers: { authorization: SECRET } };
  Object.defineProperty(error, 'status', { enumerable: true, get() { read = true; return 403; } });
  const report = normalizeBoundaryError(error, { system: 'payment', operation: 'charge', effect: 'write' });
  assert.equal(read, false); assert.equal(report.category, 'unknown'); assert.equal(report.effect, 'unknown'); clean(report);
});
test('write500 and cancellation remain unknown unless the adapter explicitly declares no effect', () => {
  assert.equal(normalizeBoundaryError({ status: 500 }, { system: 'payment', operation: 'create', effect: 'write' }).effect, 'unknown');
  assert.equal(normalizeBoundaryError({ name: 'AbortError' }, { system: 'payment', operation: 'create', effect: 'write' }).category, 'unknown');
  assert.equal(normalizeBoundaryError({ status: 400, effect: 'none' }, { system: 'payment', operation: 'create', effect: 'write' }).effect, 'none');
});
test('stored real attempts produce factual exhaustion without model or raw provider error exposure', async () => {
  const record = await recording(); const report = diagnoseFailureRecording(record);
  assert.equal(report.status, 'failed'); assert.equal(report.causes.length, 1);
  assert.ok(report.consequences.some(item => item.code === 'RETRY_EXHAUSTED_RECORDED' || item.code === 'RETRY_DECLINED_RECORDED'));
  assert.equal(report.coverage.upstreamRootCause, 'unknown'); clean(report);
  assert.ok(report.evidenceRefs.some(ref => ref.startsWith('native#/executionTree/attempts/')));
});
test('auth adapter evidence can differ from the SDK category while retaining genuine physical attempt binding', async () => {
  const record = await recording([Object.assign(new Error(SECRET), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 400 } })]);
  record.boundaryEvidence[0].category = 'auth'; record.boundaryEvidence[0].httpStatus = 400;
  const report = diagnoseFailureRecording(record);
  assert.equal(report.causes[0].code, 'AUTH_REJECTION_RECORDED'); assert.equal(report.status, 'failed'); clean(report);
});
test('recovery requires a real successful final attempt in the same series', async () => {
  const record = await recording([Object.assign(new Error(SECRET), { status: 429 }), null]);
  const report = diagnoseFailureRecording(record);
  assert.equal(report.status, 'recovered'); assert.ok(report.consequences.some(item => item.code === 'RETRY_RECOVERED_RECORDED'));
  assert.equal(report.causes.length, 1); clean(report);
});
test('timeout or failed payment attempt cannot prove the payment was not applied', async () => {
  const record = await recording(undefined, { write: true });
  const report = diagnoseFailureRecording(record);
  assert.equal(report.status, 'unknown'); assert.equal(report.coverage.externalEffect, 'unknown');
  assert.ok(report.unknowns.some(text => /effect/i.test(text))); clean(report);
});
test('explicit cause links preserve independent first observations and separate diagnostic failures', async () => {
  const record = await recording([Object.assign(new Error(SECRET), { status: 503 }), Object.assign(new Error(SECRET), { status: 503 })]); const first = record.boundaryEvidence[0];
  first.category = 'auth';
  Object.assign(record.boundaryEvidence[1], { target: 'payment', operation: 'payment.read', category: 'unknown', causedBy: first.id });
  record.diagnostics = { persistence: 'failed', observer: 'failed', code: 'PRIVATE_FIELD_SHOULD_NOT_ESCAPE' };
  const report = diagnoseFailureRecording(record);
  assert.equal(report.causes.length, 1); assert.equal(report.causes[0].code, 'AUTH_REJECTION_RECORDED');
  assert.ok(report.consequences.some(item => item.code === 'DEPENDENT_FAILURE_RECORDED')); assert.equal(report.diagnosticFailures.length, 2);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_FIELD_SHOULD_NOT_ESCAPE'));
});
test('missing native evidence and missing attempt evidence remain unknown instead of zero', async () => {
  const record = await recording(); record.nativeSnapshot = null;
  const report = diagnoseFailureRecording(record);
  assert.equal(report.status, 'unknown'); assert.equal(report.coverage.nativeAttemptRecords, null); assert.deepEqual(report.causes, []);
  const old = await recording(); delete old.nativeSnapshot.executionTree.attempts; delete old.nativeSnapshot.executionTree.attemptSummary;
  delete old.boundaryEvidence[0].attemptId;
  delete old.boundaryEvidence[0].decision;
  const legacy = diagnoseFailureRecording(old); assert.equal(legacy.status, 'unknown'); assert.equal(legacy.coverage.nativeAttemptRecords, null);
});
test('cross-run, cross-stage and invented physical attempt references are rejected', async () => {
  for (const mutate of [r => { r.runId = 'another-run'; }, r => { r.boundaryEvidence[0].runtimeStageId = 'another#0'; }, r => { r.boundaryEvidence[0].attemptId = 'forged@1'; }]) {
    const r = await recording(); mutate(r); assert.throws(() => diagnoseFailureRecording(r), { code: 'FAILURE_RECORD_INVALID' });
  }
});
test('untrusted cause cycles, duplicate IDs, forged decisions and status strings are rejected', async () => {
  for (const mutate of [r => { r.boundaryEvidence[0].causedBy = r.boundaryEvidence[0].id; },
    r => { r.boundaryEvidence.push({ ...r.boundaryEvidence[0], sequence: 2 }); },
    r => { r.boundaryEvidence[0].decision.next = 'retry'; }, r => { r.boundaryEvidence[0].httpStatus = '500'; }]) {
    const r = await recording(); mutate(r); assert.throws(() => diagnoseFailureRecording(r), { code: 'FAILURE_RECORD_INVALID' });
  }
});
test('no scenario label is admitted to the evidence contract; identical evidence gives identical diagnosis', async () => {
  const r = await recording(), before = diagnoseFailureRecording(r);
  assert.deepEqual(diagnoseFailureRecording(JSON.parse(JSON.stringify(r))), before);
  for (const label of ['database-auth', 'provider-outage']) assert.throws(() => diagnoseFailureRecording({ ...r, label }), { code: 'FAILURE_RECORD_INVALID' });
});
test('input getters, prototypes, cycles and raw extra envelope fields are rejected before reading', async () => {
  const r = await recording(); let invoked = false;
  const getter = { ...r }; Object.defineProperty(getter, 'schemaVersion', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => diagnoseFailureRecording(getter), { code: 'FAILURE_RECORD_INVALID' }); assert.equal(invoked, false);
  assert.throws(() => diagnoseFailureRecording({ ...r, rawError: SECRET }), { code: 'FAILURE_RECORD_INVALID' });
  const cycle = { ...r }; cycle.nativeSnapshot = cycle; assert.throws(() => diagnoseFailureRecording(cycle), { code: 'FAILURE_RECORD_INVALID' });
});
test('successful category ok is accepted and diagnostic failures cannot reverse the business result', async () => {
  const r = await recording([null]); r.boundaryEvidence[0].category = 'ok';
  r.diagnostics.observer = 'failed';
  const report = diagnoseFailureRecording(r);
  assert.equal(report.status, 'ok'); assert.equal(report.diagnosticFailures.length, 1); assert.equal(report.causes.length, 0);
  r.boundaryEvidence[0].outcome = 'failed'; assert.throws(() => diagnoseFailureRecording(r), { code: 'FAILURE_RECORD_INVALID' });
});
test('truncated genuine attempts are disclosed and cannot establish a complete recovery', async () => {
  const r = await recording([Object.assign(new Error(SECRET), { status: 429 }), null]);
  r.nativeSnapshot.executionTree.attemptsDropped = 1;
  const report = diagnoseFailureRecording(r);
  assert.equal(report.status, 'unknown'); assert.equal(report.coverage.attemptsTruncated, true);
  assert.ok(report.unknowns.some(text => /truncated/.test(text)));
});
test('adapter-recorded circuit blocking is factual and does not establish a production circuit', async () => {
  const r = await recording(); Object.assign(r.boundaryEvidence[0], { outcome: 'blocked', category: 'unknown', code: 'CIRCUIT_OPEN' });
  const report = diagnoseFailureRecording(r);
  assert.equal(report.coverage.circuit, 'adapter-recorded'); assert.equal(report.causes[0].code, 'CIRCUIT_OPEN_RECORDED');
  assert.ok(report.recommendations.some(text => /does not establish a production circuit/.test(text)));
});
test('duplicate native attempt composites and duplicate physical-event references are rejected', async () => {
  const native = await recording(); native.nativeSnapshot.executionTree.attempts.push({ ...native.nativeSnapshot.executionTree.attempts[0] });
  assert.throws(() => diagnoseFailureRecording(native), { code: 'FAILURE_RECORD_INVALID' });
  const r = await recording(); r.boundaryEvidence.push({ ...r.boundaryEvidence[0], id: 'another-event', sequence: 2 });
  assert.throws(() => diagnoseFailureRecording(r), { code: 'FAILURE_RECORD_INVALID' });
});
test('genuine logical retry recovery keeps distinct physical attempts and does not become a terminal failure', async () => {
  let sends = 0;
  const chart = flowChart('Seed', () => {}, 'seed').setLogger(quiet).addRetryLoop('loop', {
    touches: 'local-payment', idempotencyKey: () => 'fake-operation-key', retry: { attempts: 2, timeoutMs: 100 },
    attempt: () => { if (++sends === 1) throw Object.assign(new Error(SECRET), { effect: 'none' }); }, reconcile: () => 'none',
  }).build();
  const executor = new FlowChartExecutor(chart); await executor.run();
  const nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true })));
  const boundaryEvidence = [];
  function walk(node) {
    for (const attempt of node.attempts ?? []) if (attempt.kind === 'call' && attempt.retryLoop?.phase === 'attempt') {
      const i = boundaryEvidence.length;
      boundaryEvidence.push({ id: `event-${i}`, sequence: i + 1, runtimeStageId: node.runtimeStageId,
        attemptId: `${attempt.series}@${attempt.attempt}`, target: 'payment', operation: 'payment.create', outcome: attempt.outcome === 'ok' ? 'ok' : 'failed',
        category: attempt.outcome === 'ok' ? 'ok' : 'unknown', effect: attempt.effect === 'applied' ? 'confirmed' : 'none' });
    }
    node.children?.forEach(walk); if (node.next) walk(node.next);
  }
  walk(nativeSnapshot.executionTree); assert.equal(boundaryEvidence.length, 2);
  const report = diagnoseFailureRecording({ schemaVersion: 1, storeId: 'local', runId: nativeSnapshot.runId, flowId: 'loop-flow', nativeSnapshot,
    boundaryEvidence, diagnostics: { persistence: 'stored', observer: 'ok' } });
  assert.equal(report.status, 'recovered'); assert.ok(report.consequences.some(e => e.code === 'LOGICAL_RETRY_RECOVERED_RECORDED'));
});
test('a genuine cancelled SDK payment attempt stays uncertain without an authoritative effect receipt', async () => {
  const chart = flowChart('Wait', async scope => scope.$call('payment', async context => new Promise((resolve, reject) => {
    context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
  }), { attempts: 1, timeoutMs: 5 }, { touches: 'local-payment', idempotencyKey: 'fake-operation' }), 'wait').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart); await assert.rejects(executor.run());
  const nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true }))), node = nativeSnapshot.executionTree;
  const attempt = node.attempts.find(a => a.kind === 'call'); assert.equal(attempt.outcome, 'timeout'); assert.equal(attempt.effect, 'unknown');
  const report = diagnoseFailureRecording({ schemaVersion: 1, storeId: 'local', runId: nativeSnapshot.runId, flowId: 'timeout-flow', nativeSnapshot,
    boundaryEvidence: [{ id: 'timeout', sequence: 1, runtimeStageId: node.runtimeStageId, attemptId: `${attempt.series}@${attempt.attempt}`,
      target: 'payment', operation: 'payment.create', outcome: 'timeout', category: 'timeout', effect: 'unknown' }], diagnostics: { persistence: 'stored', observer: 'ok' } });
  assert.equal(report.status, 'unknown'); assert.equal(report.coverage.externalEffect, 'unknown'); clean(report);
});
test('bounded inputs and deeply immutable outputs protect the report boundary', async () => {
  const record = await recording(), report = diagnoseFailureRecording(record);
  assert.ok(Object.isFrozen(report)); assert.ok(Object.isFrozen(report.causes)); assert.ok(Object.isFrozen(report.causes[0].evidenceRefs));
  assert.throws(() => report.causes.push({}), TypeError);
  record.nativeSnapshot.privatePadding = 'x'.repeat(2 * 1024 * 1024);
  assert.throws(() => diagnoseFailureRecording(record), { code: 'FAILURE_RECORD_INVALID' });
});

test('provider knowledge is an injected adapter classifier and metadata is projected explicitly', () => {
  const error = { name: 'CustomAccessDenied', $metadata: { httpStatusCode: 400 }, message: SECRET };
  assert.deepEqual(normalizeBoundaryError(error, { system: 'directory', operation: 'read', effect: 'read' }),
    { category: 'unknown', code: 'DEPENDENCY_FAILURE_UNKNOWN', effect: 'none' });
  const normalized = normalizeBoundaryError(error, { system: 'directory', operation: 'read', effect: 'read', httpStatus: 400,
    classify: fields => fields.name === 'CustomAccessDenied' && fields.httpStatus === 400 ? 'auth' : undefined });
  assert.deepEqual(normalized, { category: 'auth', code: 'DEPENDENCY_AUTH_REJECTED', httpStatus: 400, effect: 'none' }); clean(normalized);
});
test('classifier receives a frozen bounded projection without getters or raw error payloads', () => {
  let invoked = false;
  const error = { code: 'NETWORK_LOCAL', name: 'CustomFailure', status: 503, retryable: true, retryAfterMs: 30,
    retryAfterSeconds: 1, message: SECRET, headers: { authorization: SECRET }, cause: { token: SECRET } };
  Object.defineProperty(error, 'privateField', { get() { invoked = true; return SECRET; } });
  normalizeBoundaryError(error, { system: 'directory', operation: 'lookup', effect: 'read', classify: fields => {
    assert.deepEqual(fields, { code: 'NETWORK_LOCAL', name: 'CustomFailure', httpStatus: 503, retryable: true, retryAfterMs: 30, retryAfterSeconds: 1 });
    assert.ok(Object.isFrozen(fields)); clean(fields); return 'network';
  } }); assert.equal(invoked, false);
  const absent = normalizeBoundaryError({ code: SECRET, name: SECRET, status: '500', retryable: 'yes', retryAfterMs: Infinity, retryAfterSeconds: -1 },
    { system: 'directory', operation: 'lookup', effect: 'read', classify: fields => { assert.deepEqual(fields, {}); return undefined; } });
  assert.equal(absent.category, 'unknown'); clean(absent);
});
test('invalid or failing classifiers retain SDK classification and expose no raw failure', () => {
  for (const classify of [() => { throw new Error(SECRET); }, () => SECRET, () => null]) {
    const result = normalizeBoundaryError({ status: 503 }, { system: 'search', operation: 'lookup', effect: 'read', classify });
    assert.equal(result.category, 'server'); clean(result);
  }
});
test('domain-neutral labels are accepted while target and operation names never enter findings', async () => {
  const record = await recording(); record.boundaryEvidence[0].target = 'directory-service'; record.boundaryEvidence[0].operation = SECRET;
  record.boundaryEvidence[0].category = 'auth';
  const diagnosis = diagnoseFailureRecording(record); assert.equal(diagnosis.causes[0].code, 'AUTH_REJECTION_RECORDED'); clean(diagnosis);
  assert.ok(!JSON.stringify(diagnosis).includes('directory-service'));
  for (const target of ['Search', 'customer@example.invalid', 'sk_test_secret', 'a'.repeat(49)]) {
    record.boundaryEvidence[0].target = target; assert.throws(() => diagnoseFailureRecording(record), { code: 'FAILURE_RECORD_INVALID' });
  }
});
test('local response and admission codes are recorded facts with evidence links and no fixture labels', async () => {
  for (const code of ['BUDGET_PREFLIGHT_REJECTED', 'IDEMPOTENCY_KEY_REQUIRED', 'MALFORMED_RESPONSE', 'LOCAL_DEPENDENCY_BLOCKED']) {
    const record = await recording(); record.boundaryEvidence[0].code = code;
    const diagnosis = diagnoseFailureRecording(record), cause = diagnosis.causes.find(item => item.code === `${code}_RECORDED`);
    assert.ok(cause); assert.ok(cause.evidenceRefs.some(ref => ref.startsWith('native#/'))); clean(diagnosis);
  }
});
test('unrecorded unrelated stage attempts remain an explicit coverage gap without erasing bound operation facts', async () => {
  const record = await recording([null]); record.nativeSnapshot.executionTree.next = { runtimeStageId: 'unrecorded#0' };
  const diagnosis = diagnoseFailureRecording(record); assert.equal(diagnosis.status, 'ok'); assert.ok(diagnosis.unknowns.some(text => /Complete native attempt/.test(text)));
});

async function timedOutWriteRecording() {
  const chart = flowChart('Wait for write', async scope => {
    await scope.$call('read-before-write', async () => 'ready', { attempts: 1 });
    return scope.$call('external-write', async context => new Promise((resolve, reject) => {
    context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
  }), { attempts: 1, timeoutMs: 5 }, { touches: 'local-directory', idempotencyKey: 'private-operation' });
  }, 'wait').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart); await assert.rejects(executor.run());
  const nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true }))), node = nativeSnapshot.executionTree;
  const attempt = node.attempts.find(a => a.kind === 'call' && a.target === 'external-write'); assert.equal(attempt.outcome, 'timeout'); assert.equal(attempt.effect, 'unknown');
  return { schemaVersion: 1, storeId: 'local', runId: nativeSnapshot.runId, flowId: 'write-timeout', nativeSnapshot,
    boundaryEvidence: [{ id: 'timeout', sequence: 1, runtimeStageId: node.runtimeStageId, attemptId: `${attempt.series}@${attempt.attempt}`,
      target: 'directory', operation: 'create', outcome: 'timeout', category: 'timeout', effect: 'unknown' }], diagnostics: { persistence: 'stored', observer: 'ok' } };
}
test('a sidecar cannot overwrite a genuine unknown native write effect with none or confirmed', async () => {
  for (const effect of ['none', 'confirmed']) {
    const record = await timedOutWriteRecording(); record.boundaryEvidence[0].effect = effect;
    assert.throws(() => diagnoseFailureRecording(record), { code: 'FAILURE_RECORD_INVALID' });
  }
});
test('an omitted boundary event cannot hide a native unknown write effect behind other successful boundaries', async () => {
  const record = await timedOutWriteRecording();
  const node = record.nativeSnapshot.executionTree;
  const readAttempt = node.attempts.find(a => a.kind === 'call' && a.target === 'read-before-write');
  // Keep only a genuine successful read; the unknown-effect write remains in the native recording.
  assert.ok(readAttempt); record.boundaryEvidence = [{ id: 'read', sequence: 1, runtimeStageId: node.runtimeStageId,
    attemptId: `${readAttempt.series}@${readAttempt.attempt}`, target: 'directory', operation: 'read',
    outcome: readAttempt.outcome, category: 'ok', effect: 'none' }];
  const report = diagnoseFailureRecording(record); assert.equal(report.status, 'unknown'); assert.equal(report.coverage.externalEffect, 'unknown');
  const finding = report.consequences.find(item => item.code === 'UNKNOWN_EXTERNAL_EFFECT_RECORDED'); assert.ok(finding);
  const callIndex = node.attempts.findIndex(a => a.kind === 'call' && a.target === 'external-write'); assert.ok(finding.evidenceRefs.includes(`native#/executionTree/attempts/${callIndex}`));
});
test('a sidecar cannot claim no effect when a real successful touching call records applied', async () => {
  const chart = flowChart('Write', scope => scope.$call('external-write', async () => 'acknowledged', { attempts: 1 },
    { touches: 'local-directory', idempotencyKey: 'private-operation' }), 'write').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart); await executor.run();
  const nativeSnapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true }))), node = nativeSnapshot.executionTree;
  const attempt = node.attempts.find(a => a.kind === 'call'); assert.equal(attempt.effect, 'applied');
  const record = { schemaVersion: 1, storeId: 'local', runId: nativeSnapshot.runId, flowId: 'write', nativeSnapshot,
    boundaryEvidence: [{ id: 'write', sequence: 1, runtimeStageId: node.runtimeStageId, attemptId: `${attempt.series}@${attempt.attempt}`,
      target: 'directory', operation: 'create', outcome: 'ok', category: 'ok', effect: 'none' }], diagnostics: { persistence: 'stored', observer: 'ok' } };
  assert.throws(() => diagnoseFailureRecording(record), { code: 'FAILURE_RECORD_INVALID' });
});
test('nonblocked boundary outcomes must exactly match the genuine native outcome', async () => {
  const failed = await recording(); failed.boundaryEvidence[0].outcome = 'aborted';
  assert.throws(() => diagnoseFailureRecording(failed), { code: 'FAILURE_RECORD_INVALID' });
  const timeout = await timedOutWriteRecording(); timeout.boundaryEvidence[0].outcome = 'failed';
  assert.throws(() => diagnoseFailureRecording(timeout), { code: 'FAILURE_RECORD_INVALID' });
});
test('blocked is only an effect-free local admission observation bound to a failed native attempt', async () => {
  const timeout = await timedOutWriteRecording(); Object.assign(timeout.boundaryEvidence[0], { outcome: 'blocked', code: 'CIRCUIT_OPEN', effect: 'none' });
  assert.throws(() => diagnoseFailureRecording(timeout), { code: 'FAILURE_RECORD_INVALID' });
  const failed = await recording(); Object.assign(failed.boundaryEvidence[0], { outcome: 'blocked', effect: 'unknown', code: 'CIRCUIT_OPEN' });
  assert.throws(() => diagnoseFailureRecording(failed), { code: 'FAILURE_RECORD_INVALID' });
  const unclassified = await recording(); unclassified.boundaryEvidence[0].outcome = 'blocked';
  assert.throws(() => diagnoseFailureRecording(unclassified), { code: 'FAILURE_RECORD_INVALID' });
});
