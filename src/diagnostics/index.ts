import { errorCategory, AttemptTimeoutError } from 'footprintjs';
import type { BoundaryErrorCategory, BoundaryErrorFields, BoundaryNormalizationOptions, NormalizedBoundaryError, FailureRecording, FailureDiagnosis, FailureFinding, FailureNativeSnapshot, FailureNativeNode, FailureNativeAttempt } from './types.js';
export type * from './types.js';

const CATEGORIES = ['timeout', 'rate-limited', 'server', 'network', 'auth', 'permanent', 'unknown'];
const OUTCOMES = ['ok', 'failed', 'timeout', 'aborted', 'blocked'];
const NATIVE_OUTCOMES = ['ok', 'failed', 'timeout', 'aborted', 'paused'];
const REASONS = ['succeeded', 'paused', 'aborted', 'exhausted', 'declined', 'no-time-left', 'retryable'];
const NEXT = ['retry', 'done', 'stop'];
const LOCAL_CODES = ['CIRCUIT_OPEN', 'BUDGET_PREFLIGHT_REJECTED', 'IDEMPOTENCY_KEY_REQUIRED', 'MALFORMED_RESPONSE', 'LOCAL_DEPENDENCY_BLOCKED'];
const LOCAL_FINDINGS = {
  BUDGET_PREFLIGHT_REJECTED: 'The adapter recorded a local budget preflight rejection. The code does not establish numerical budget bounds or a provider failure.',
  IDEMPOTENCY_KEY_REQUIRED: 'The adapter recorded a local idempotency-key admission rejection. The code does not establish that any write was sent.',
  MALFORMED_RESPONSE: 'The adapter recorded a response validation failure against its local response contract. This classification does not establish upstream availability.',
  LOCAL_DEPENDENCY_BLOCKED: 'The adapter recorded a local dependency admission refusal.',
};
const secret = (value: string) => /^(?:AKIA|ASIA|sk_(?:test|live)|secret|password|token|api[-_]?key|authorization|cookie)/i.test(value);
function fail(): never { throw Object.assign(new Error('Failure recording is invalid'), { code: 'FAILURE_RECORD_INVALID' }); }
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000;
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1024 && !/[\p{C}\s]/u.test(v);
const safeCode = (v: unknown): v is string => typeof v === 'string' && !secret(v) && /^[A-Z][A-Z0-9_]{1,79}$/.test(v);
const freeze = <T>(v: T): T => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const own = (v: unknown, key: string): unknown => { try { if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return undefined; const d = Object.getOwnPropertyDescriptor(v, key); return d && 'value' in d ? d.value : undefined; } catch { return undefined; } };
const statusNumber = (v: unknown): number | undefined => typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599 ? v : undefined;
const logicalLabel = (v: unknown): v is string => typeof v === 'string' && !secret(v) && /^[a-z][a-z0-9-]{0,47}$/.test(v);
const fieldLabel = (v: unknown): v is string => typeof v === 'string' && !secret(v) && /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(v);
const delayNumber = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 86_400_000 ? v : undefined;

/** Normalize at the adapter boundary, before a generic application error hides its provider classification. */
export function normalizeBoundaryError(error: unknown, options: BoundaryNormalizationOptions): NormalizedBoundaryError {
  const { system, operation, effect, classify } = options;
  if (!logicalLabel(system) || !identifier(operation) || !['read', 'write'].includes(effect)
    || (classify !== undefined && typeof classify !== 'function')
    || (options.httpStatus !== undefined && statusNumber(options.httpStatus) === undefined)) fail();
  // Provider adapters project their own metadata explicitly. The reusable core has no vendor-name map.
  const status = options.httpStatus ?? statusNumber(own(error, 'status')) ?? statusNumber(own(error, 'statusCode'));
  const name = own(error, 'name'), code = own(error, 'code'), retryable = own(error, 'retryable');
  const retryAfterMs = delayNumber(own(error, 'retryAfterMs')), retryAfterSeconds = delayNumber(own(error, 'retryAfterSeconds'));
  const fields: BoundaryErrorFields = freeze({
    ...(fieldLabel(name) ? { name } : {}), ...(fieldLabel(code) ? { code } : {}),
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(typeof retryable === 'boolean' ? { retryable } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
  let timedOut = false;
  try { timedOut = error instanceof AttemptTimeoutError; } catch { /* Hostile error objects disclose no details. */ }
  let category: BoundaryErrorCategory = timedOut ? 'timeout' : fields.name === 'AbortError' ? 'unknown'
    : errorCategory({ ...fields, ...(status === undefined ? {} : { status }) });
  if (classify !== undefined) {
    // Classifiers are trusted adapter code, but their failures and invalid outputs disclose no raw errors.
    let classified: unknown;
    try { classified = classify(fields); } catch { classified = undefined; }
    if (typeof classified === 'string' && CATEGORIES.includes(classified)) category = classified as BoundaryErrorCategory;
  }
  const codes: Record<BoundaryErrorCategory, string> = { timeout: 'DEPENDENCY_TIMEOUT', 'rate-limited': 'DEPENDENCY_RATE_LIMITED', server: 'DEPENDENCY_SERVER_ERROR',
    network: 'DEPENDENCY_NETWORK_ERROR', auth: 'DEPENDENCY_AUTH_REJECTED', permanent: 'DEPENDENCY_REQUEST_REJECTED', unknown: 'DEPENDENCY_FAILURE_UNKNOWN' };
  const localCode = own(error, 'code');
  return freeze({ category, code: typeof localCode === 'string' && LOCAL_CODES.includes(localCode) ? localCode : codes[category],
    ...(status === undefined ? {} : { httpStatus: status }), effect: effect === 'read' || own(error, 'effect') === 'none' ? 'none' : 'unknown' });
}

function boundedJson(value: unknown): void {
  const seen = new Set<object>(); let nodes = 0;
  const walk = (v: unknown, depth: number): void => {
    if (++nodes > 50_000 || depth > 48) fail();
    if (v === null || ['boolean', 'string'].includes(typeof v)) return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail(); return; }
    if (!v || typeof v !== 'object' || seen.has(v)) fail();
    const array = Array.isArray(v);
    if ((!array && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) || (array && v.length > 5000)) fail();
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key.length > 4096 || ['__proto__', 'prototype', 'constructor'].includes(key)) fail();
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !d.enumerable || !('value' in d)) fail();
      walk(d.value, depth + 1);
    }
    if (array && Object.keys(v).length !== v.length) fail();
    seen.delete(v);
  };
  walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 2 * 1024 * 1024) fail();
}
function exact(v: unknown, required: readonly string[], optional: readonly string[] = []): void {
  if (!object(v) || required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) fail();
}
function nativeIndex(snapshot: FailureNativeSnapshot | null, runId: string) {
  const stages = new Map<string, { node: FailureNativeNode; path: string }>(), attempts = new Map<string, { record: FailureNativeAttempt; stageId: string; ref: string }>(); let dropped = false, missing = false;
  if (snapshot === null) return { stages, attempts, dropped, missing: true, present: false };
  if (!object(snapshot) || snapshot.runId !== runId || !object(snapshot.executionTree) || !Array.isArray(snapshot.commitLog)) fail();
  function walk(node: FailureNativeNode, path: string): void {
    if (!object(node) || stages.size >= 500 || !identifier(node.runtimeStageId) || stages.has(node.runtimeStageId)) fail();
    const stage = { node, path }; stages.set(node.runtimeStageId, stage);
    if (node.attempts === undefined) missing = true;
    else {
      if (!Array.isArray(node.attempts)) fail();
      for (const [i, record] of (node.attempts as readonly FailureNativeAttempt[]).entries()) {
        if (!object(record) || !identifier(record.series) || !integer(record.attempt) || record.attempt < 1
          || !['stage', 'call', 'observed'].includes(record.kind) || !NATIVE_OUTCOMES.includes(record.outcome)
          || !NEXT.includes(record.next) || !REASONS.includes(record.reason)
          || (record.category !== undefined && !CATEGORIES.includes(record.category))
          || !Number.isFinite(record.durationMs) || record.durationMs < 0 || !Number.isFinite(record.startedAt)
          || (record.of !== undefined && (!integer(record.of) || record.of < record.attempt))
          || (record.effect !== undefined && !['applied', 'none', 'unknown'].includes(record.effect))) fail();
        const id = `${record.series}@${record.attempt}`;
        if (attempts.has(id)) fail();
        if (record.retryLoop !== undefined) {
          const loop = record.retryLoop;
          if (!object(loop) || !identifier(loop.id) || !identifier(loop.series) || !integer(loop.attempt) || loop.attempt < 1
            || !integer(loop.of) || loop.of < loop.attempt || !['attempt', 'reconcile'].includes(loop.phase)) fail();
        }
        attempts.set(id, { record, stageId: node.runtimeStageId, ref: `${path}/attempts/${i}` });
      }
    }
    if (node.attemptsDropped !== undefined && !integer(node.attemptsDropped)) fail();
    if ((node.attemptsDropped ?? 0) > 0) dropped = true;
    if (node.attemptSummary !== undefined) {
      const summary = node.attemptSummary;
      if (!object(summary) || !integer(summary.count)) fail();
      if (summary.count > (node.attempts?.length ?? 0)) dropped = true;
    }
    if (node.children !== undefined) { if (!Array.isArray(node.children)) fail(); node.children.forEach((child, i) => walk(child, `${path}/children/${i}`)); }
    if (node.next !== undefined && node.next !== null) walk(node.next, `${path}/next`);
  }
  walk(snapshot.executionTree, 'native#/executionTree');
  // Nested scopes require an explicit mount-qualified identity. Do not guess which identically named stage was intended.
  if (snapshot.subflowResults && Object.keys(snapshot.subflowResults).length) missing = true;
  return { stages, attempts, dropped, missing, present: true };
}

/** Read facts from the stored/reloaded record only. A scenario name or fault plan is never an input. */
export function diagnoseFailureRecording(input: unknown): FailureDiagnosis {
  try { boundedJson(input); } catch { fail(); }
  const record = input as FailureRecording;
  exact(record, ['schemaVersion', 'storeId', 'runId', 'flowId', 'nativeSnapshot', 'boundaryEvidence', 'diagnostics']);
  if (record.schemaVersion !== 1 || ![record.storeId, record.runId, record.flowId].every(identifier)
    || !Array.isArray(record.boundaryEvidence) || record.boundaryEvidence.length > 200) fail();
  exact(record.diagnostics, ['persistence', 'observer'], ['code']);
  if (!['stored', 'failed'].includes(record.diagnostics.persistence) || !['ok', 'failed'].includes(record.diagnostics.observer)
    || (record.diagnostics.code !== undefined && !safeCode(record.diagnostics.code))) fail();
  const native = nativeIndex(record.nativeSnapshot, record.runId);
  type IndexedBoundary = { event: FailureRecording['boundaryEvidence'][number]; linked: ReturnType<typeof native.attempts.get>; ref: string };
  const ids = new Map<string, IndexedBoundary>(), sequences = new Set<number>(), physicalRefs = new Set<string>();
  const events = record.boundaryEvidence.map((event, i) => {
    exact(event, ['id', 'sequence', 'runtimeStageId', 'target', 'operation', 'outcome', 'category', 'effect'], ['code', 'httpStatus', 'causedBy', 'attemptId', 'decision']);
    if (![event.id, event.runtimeStageId, event.operation].every(identifier) || ids.has(event.id) || !integer(event.sequence)
      || sequences.has(event.sequence) || !logicalLabel(event.target) || !OUTCOMES.includes(event.outcome)
      || !(CATEGORIES.includes(event.category) || event.category === 'ok' && event.outcome === 'ok') || !['none', 'confirmed', 'unknown'].includes(event.effect)
      || (event.code !== undefined && !safeCode(event.code)) || (event.httpStatus !== undefined && statusNumber(event.httpStatus) === undefined)
      || (event.causedBy !== undefined && !identifier(event.causedBy)) || (event.attemptId !== undefined && !identifier(event.attemptId))) fail();
    if (event.decision !== undefined) { exact(event.decision, ['next', 'reason']); if (!NEXT.includes(event.decision.next) || !REASONS.includes(event.decision.reason)) fail(); }
    const linked = event.attemptId === undefined ? undefined : native.attempts.get(event.attemptId);
    if (event.attemptId !== undefined && physicalRefs.has(event.attemptId)) fail();
    if (event.attemptId !== undefined) physicalRefs.add(event.attemptId);
    if (native.present && (!native.stages.has(event.runtimeStageId) || (event.attemptId !== undefined && (!linked || linked.stageId !== event.runtimeStageId)))) fail();
    if (native.present && event.decision && (!linked || linked.record.next !== event.decision.next || linked.record.reason !== event.decision.reason)) fail();
    if (linked) {
      if (event.outcome === 'blocked') {
        if (linked.record.outcome !== 'failed' || event.effect !== 'none'
          || event.code === undefined || !LOCAL_CODES.includes(event.code)) fail();
      } else if (event.outcome !== linked.record.outcome) fail();
      // A sidecar cannot rewrite the outcome of this physical write. A later reconciliation is a distinct observation.
      if (linked.record.effect === 'unknown' && event.effect !== 'unknown') fail();
      if (linked.record.effect === 'applied' && event.effect === 'none') fail();
    }
    const result = { event, linked, ref: `boundaryEvidence#/${i}` }; ids.set(event.id, result); sequences.add(event.sequence); return result;
  });
  for (const { event } of events) if (event.causedBy !== undefined && (!ids.has(event.causedBy) || ids.get(event.causedBy)!.event.sequence >= event.sequence)) fail();
  const causes: FailureFinding[] = [], consequences: FailureFinding[] = [], diagnosticFailures: FailureFinding[] = [], recommendations: string[] = [], unknowns: string[] = [];
  const entry = (code: string, summary: string, refs: string[]): FailureFinding => ({ code, summary, evidenceRefs: [...new Set(refs)] });
  const refsFor = (e: IndexedBoundary): string[] => [e.ref, ...(e.linked ? [e.linked.ref] : [])];
  const failure = (e: IndexedBoundary): boolean => e.event.outcome !== 'ok';
  if (!native.present) unknowns.push('Native recording is unavailable; boundary stage and attempt identities cannot be verified.');
  if (native.missing) unknowns.push('Complete native attempt or mounted subflow evidence is not recorded.');
  if (native.dropped) unknowns.push('Native attempt evidence is truncated; omitted attempts cannot be reconstructed.');
  if (!events.length) unknowns.push('No adapter boundary evidence was recorded; no absence of external effects is established.');
  if (events.some(e => !e.linked)) unknowns.push('Some boundary events lack a verifiable physical attempt reference.');
  if (native.present) for (const e of [...events].sort((a, b) => a.event.sequence - b.event.sequence)) {
    if (!failure(e)) continue;
    let ancestor = e.event.causedBy ? ids.get(e.event.causedBy) : undefined, parent: IndexedBoundary | undefined;
    while (ancestor) { if (failure(ancestor)) parent = ancestor; ancestor = ancestor.event.causedBy ? ids.get(ancestor.event.causedBy) : undefined; }
    const localSummary = e.event.code !== undefined && Object.hasOwn(LOCAL_FINDINGS, e.event.code) ? LOCAL_FINDINGS[e.event.code as keyof typeof LOCAL_FINDINGS] : undefined;
    if (parent) consequences.push(entry(localSummary ? `${e.event.code}_RECORDED` : 'DEPENDENT_FAILURE_RECORDED',
      localSummary ? `${localSummary} It explicitly names an earlier failed boundary as its cause.` : 'A subsequent adapter failure explicitly names an earlier failed boundary as its cause.', [...refsFor(parent), ...refsFor(e)]));
    else if (localSummary) causes.push(entry(`${e.event.code}_RECORDED`, localSummary, refsFor(e)));
    else {
      const names = { auth: 'authentication or authorization rejection', 'rate-limited': 'rate limit or throttling', server: 'server failure',
        network: 'network failure', permanent: 'request rejection', timeout: 'timeout', unknown: 'unclassified failure' };
      const code = e.event.outcome === 'blocked' ? e.event.code === 'CIRCUIT_OPEN' ? 'CIRCUIT_OPEN_RECORDED' : 'BOUNDARY_BLOCKED_RECORDED'
        : e.event.category === 'auth' ? 'AUTH_REJECTION_RECORDED' : 'BOUNDARY_FAILURE_RECORDED';
      causes.push(entry(code, `The adapter recorded ${e.event.outcome === 'blocked' ? 'a blocked operation' : names[e.event.category as keyof typeof names]} at an adapter boundary. This is an observed classification, not proof of the upstream root cause.`, refsFor(e)));
    }
  }
  type IndexedAttempt = NonNullable<ReturnType<typeof native.attempts.get>>;
  const groups = new Map<string, IndexedAttempt[]>(), logical = new Map<string, IndexedAttempt[]>(), logicalRecovered = new Set<string>();
  for (const item of native.attempts.values()) { const key = `${item.stageId}|${item.record.series}`; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(item); }
  let recovered = false, terminal = false, incomplete = false;
  for (const item of native.attempts.values()) if (item.record.retryLoop?.phase === 'attempt') {
    const key = item.record.retryLoop.series;
    if (!logical.has(key)) logical.set(key, []);
    logical.get(key)!.push(item);
  }
  for (const [series, group] of logical) {
    group.sort((a, b) => a.record.retryLoop!.attempt - b.record.retryLoop!.attempt);
    if (new Set(group.map(item => item.record.retryLoop!.attempt)).size !== group.length) {
      incomplete = true; unknowns.push('Multiple physical records share a logical retry position; its final result cannot be uniquely selected.'); continue;
    }
    const last = group.at(-1)!, firstFailure = group.find(item => ['failed', 'timeout', 'aborted'].includes(item.record.outcome));
    if (firstFailure && last.record.outcome === 'ok' && last.record.next === 'done') {
      recovered = true; logicalRecovered.add(series);
      consequences.push(entry('LOGICAL_RETRY_RECOVERED_RECORDED', 'Engine-authored logical retry links join distinct physical calls; a failed logical attempt is followed by a successful one.', [firstFailure.ref, last.ref]));
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.record.attempt - b.record.attempt); const last = group.at(-1)!, failed = group.filter(a => ['failed', 'timeout', 'aborted'].includes(a.record.outcome));
    if (last.record.next === 'retry') incomplete = true;
    if (failed.length && last.record.outcome === 'ok' && last.record.next === 'done') {
      recovered = true; consequences.push(entry('RETRY_RECOVERED_RECORDED', 'The same native attempt series records a failure followed by a successful final attempt.', [failed[0]!.ref, last.ref]));
    }
    if (failed.length && last.record.next === 'stop') {
      if (last.record.retryLoop === undefined || !logicalRecovered.has(last.record.retryLoop.series)) terminal = true;
      const codes = { exhausted: 'RETRY_EXHAUSTED_RECORDED', declined: 'RETRY_DECLINED_RECORDED', 'no-time-left': 'RETRY_DEADLINE_STOP_RECORDED', aborted: 'RUN_ABORT_RECORDED' };
      if (Object.hasOwn(codes, last.record.reason)) consequences.push(entry(codes[last.record.reason as keyof typeof codes], `The native attempt series stopped with recorded reason ${last.record.reason}.`, [last.ref]));
    }
  }
  if (incomplete) unknowns.push('A recorded retry series has no terminal outcome.');
  const nativeUnknownEffects = [...native.attempts.values()].filter(item => item.record.effect === 'unknown');
  const unknownEffect = nativeUnknownEffects.length > 0 || events.some(e => e.event.effect === 'unknown');
  if (nativeUnknownEffects.length) consequences.push(entry('UNKNOWN_EXTERNAL_EFFECT_RECORDED',
    'The native recording retains an unknown external write effect. Omitting or changing a boundary sidecar cannot establish that the write was not applied.',
    nativeUnknownEffects.map(item => item.ref)));
  if (unknownEffect) { unknowns.push('An external effect is unknown. Neither an error, a timeout, nor a later successful call proves that the earlier write was not applied.'); recommendations.push('Reconcile the original operation with the authoritative adapter and original idempotency key before another write.'); }
  if (causes.some(c => c.code === 'AUTH_REJECTION_RECORDED')) recommendations.push('Check the adapter credential and authorization configuration; a recorded rejection does not establish an upstream outage.');
  if (events.some(e => e.event.category === 'rate-limited')) recommendations.push('Review the recorded retry policy and bounded backoff against the remaining deadline; do not infer retry policy from an HTTP category.');
  if (events.some(e => e.event.outcome === 'blocked' && e.event.code === 'CIRCUIT_OPEN')) recommendations.push('Inspect the adapter-recorded circuit state before another attempt. This does not establish a production circuit breaker or an upstream outage.');
  if (record.diagnostics.persistence === 'failed') diagnosticFailures.push(entry('TRACE_PERSISTENCE_FAILED', 'Trace persistence was reported failed; this is separate from the business boundary outcome.', ['diagnostics#/persistence']));
  if (record.diagnostics.observer === 'failed') diagnosticFailures.push(entry('TRACE_OBSERVER_FAILED', 'The diagnostic observer was reported failed; it is not substituted for the original boundary failure.', ['diagnostics#/observer']));
  unknowns.push('The physical upstream root cause and imported recording authenticity are not independently verified.');
  const fullyBound = native.present && events.length > 0 && events.every(e => e.linked);
  const status = !fullyBound || native.dropped || incomplete || unknownEffect ? 'unknown'
    : events.every(e => e.event.outcome === 'ok') ? 'ok' : recovered && !terminal ? 'recovered' : terminal ? 'failed' : 'unknown';
  if (!recommendations.length) recommendations.push('Review the cited stored evidence and reproduce through injected local adapters before changing business behavior.');
  const evidenceRefs = [...new Set([...causes, ...consequences, ...diagnosticFailures].flatMap(e => e.evidenceRefs))];
  return freeze({ status, summary: { ok: 'Recorded adapter operations completed.', recovered: 'A recorded operation recovered after retry.', failed: 'A recorded operation ended in failure.', unknown: 'Available evidence leaves the operation or external effect uncertain.' }[status],
    causes, consequences, diagnosticFailures, recommendations, unknowns, evidenceRefs,
    coverage: { nativeRecording: native.present ? 'present' : 'missing', boundaryEvidence: events.length ? 'recorded' : 'not-recorded',
      nativeAttemptRecords: native.attempts.size || null, attemptBinding: fullyBound ? 'complete' : 'partial', attemptsTruncated: native.dropped,
      logicalRetryLinks: logical.size ? 'recorded' : 'not-recorded',
      upstreamRootCause: 'unknown', authenticity: 'local-import-unverified', externalEffect: unknownEffect ? 'unknown' : events.some(e => e.event.effect === 'confirmed') ? 'host-confirmed' : events.length ? 'none-recorded' : 'unknown',
      circuit: events.some(e => e.event.outcome === 'blocked' && e.event.code === 'CIRCUIT_OPEN') ? 'adapter-recorded' : 'not-recorded' } });
}
