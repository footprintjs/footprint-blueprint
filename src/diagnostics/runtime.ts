import type { AttemptContext, CallOptions, FlowAttemptEvent, FlowRecorder, RetryPolicy } from 'footprintjs';
import { normalizeBoundaryError } from './index.js';
import type { BoundaryEvidence, BoundaryNormalizationOptions, NormalizedBoundaryError, PhysicalBoundaryEvidence, BoundaryRecorderCoverage } from './types.js';
export type { PhysicalBoundaryEvidence, BoundaryRecorderCoverage } from './types.js';

/** Logical names from trusted adapter code. Never put a URL, customer ID or credential in a name. */
export interface BoundaryOperation {
  readonly system: string;
  readonly operation: string;
  readonly target: string;
  readonly effect: 'read' | 'write';
  /** The existing durable provider operation key, not a new key invented for tracing. Never retained here. */
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
}
/** One real adapter-observed dispatch. An absent maximum remains unknown, not the observed index. */
export interface PhysicalAttemptObservation {
  readonly source: string;
  readonly outcome: 'ok' | 'failed' | 'timeout' | 'aborted';
  readonly startedAt: number;
  readonly durationMs: number;
  readonly attempt?: number;
  readonly of?: number;
  readonly httpStatus?: number;
  readonly error?: unknown;
  readonly timeoutMs?: number;
  readonly timeLeftMs?: number;
  /** Defines exactly what the adapter timed; reaching headers does not prove the response body was read. */
  readonly phase?: 'response-complete' | 'headers' | 'dispatch';
}
export interface BoundaryCallContext {
  readonly attempt: AttemptContext;
  readonly signal: AbortSignal;
  readonly deadline?: number;
  readonly timeoutMs?: number;
  timeLeftMs(): number;
  /** Reports evidence only; never starts or authorizes a retry. Malformed/late reports are diagnostic omissions. */
  observePhysical(report: PhysicalAttemptObservation): void;
  /** Explicit collection gap. Counts an omission notice, never a guessed number of dispatches. */
  markIncomplete(reason: BoundaryObservationOmission): void;
}
export type BoundaryObservationOmission = 'multiple-dispatches' | 'response-unconsumed' | 'observation-unavailable';
type NativeCall = <T>(target: string, work: (attempt: AttemptContext) => T | Promise<T>, policy?: RetryPolicy, options?: CallOptions) => Promise<T>;
/** Both the ScopeFacade and TypedScope public spellings are accepted. No engine internals are accessed. */
export type BoundaryScope = { readonly call: NativeCall } | { readonly $call: NativeCall };
export interface BoundaryRecorderSnapshot {
  readonly schemaVersion: 1;
  readonly runId?: string;
  /** Logical SDK call and physical-observation rows are distinguished by physicalEvidence. Do not sum them. */
  readonly boundaryEvidence: readonly BoundaryEvidence[];
  readonly physicalEvidence: readonly PhysicalBoundaryEvidence[];
  readonly diagnostics: { readonly observer: 'ok' | 'failed'; readonly code?: 'BOUNDARY_EVIDENCE_INCOMPLETE' };
  readonly coverage: BoundaryRecorderCoverage;
}
export interface BoundaryRecorderOptions {
  readonly normalizeError?: (error: unknown, options: BoundaryNormalizationOptions) => NormalizedBoundaryError;
  /** Shared row cap, including logical and physical rows. Default 200, the FailureRecording limit. */
  readonly maxEvents?: number;
}
export interface BoundaryRecorder {
  readonly flowRecorder: FlowRecorder;
  run<T>(scope: BoundaryScope, operation: BoundaryOperation, work: (context: BoundaryCallContext) => T | Promise<T>): Promise<T>;
  /** Detached and deeply frozen. A stored snapshot never changes when a late SDK callback arrives. */
  snapshot(): BoundaryRecorderSnapshot;
}

const own = (value: unknown, key: string): unknown => {
  try { if (!value || typeof value !== 'object') return undefined; const d = Object.getOwnPropertyDescriptor(value, key); return d && 'value' in d ? d.value : undefined; } catch { return undefined; }
};
const label = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9.-]{0,47}$/.test(value)
  && !/^(?:secret|password|token|authorization|cookie|api-key|sk-test|sk-live)/i.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 1_000_000;
const status = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 599;
const deepFreeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
const attemptId = (attempt: Pick<AttemptContext, 'series' | 'attempt'>) => `${attempt.series}@${attempt.attempt}`;
type PendingCall = { operation: BoundaryOperation; normalized?: NormalizedBoundaryError; finished: boolean; settled: boolean; original?: unknown; safeError?: Error; threw: boolean; ambiguousPhysicalWrite: boolean };
type PendingObservation = { parentId: string; call: PendingCall; report: PhysicalAttemptObservation; normalized?: NormalizedBoundaryError; matched: boolean };

/**
 * Request-local native observer. It creates no executor, persistence, global context, provider retry loop or model call.
 * SDK operations run once under the active scope's genuine call primitive. SDK-owned physical retries are reported
 * through the genuine AttemptContext.observed API and bound from its onAttempt callback, never fabricated IDs.
 */
export function createBoundaryRecorder(options: BoundaryRecorderOptions = {}): BoundaryRecorder {
  const maxEvents = options.maxEvents ?? 200;
  if (!count(maxEvents) || maxEvents > 200 || options.normalizeError !== undefined && typeof options.normalizeError !== 'function') throw new TypeError('Boundary recorder options are invalid');
  const normalize = options.normalizeError ?? normalizeBoundaryError;
  const calls = new Map<string, PendingCall>();
  const live = new Set<PendingCall>();
  const rows: BoundaryEvidence[] = [], physical: PhysicalBoundaryEvidence[] = [];
  let active: PendingObservation | undefined, runId: string | undefined, sequence = 0;
  let observerFailed = false, droppedEvents = 0, unboundObservations = 0, lateReports = 0, logicalCalls = 0, physicalObservations = 0, omittedObservations = 0;
  const incomplete = () => { observerFailed = true; };
  const normalized = (error: unknown, operation: BoundaryOperation, httpStatus?: number): NormalizedBoundaryError => {
    // A host classifier is trusted policy, not a source of arbitrary fields for the retained record.
    const raw = normalize(error, { system: operation.system, operation: operation.operation, effect: operation.effect, ...(httpStatus === undefined ? {} : { httpStatus }) });
    const category = own(raw, 'category'), code = own(raw, 'code'), actualStatus = own(raw, 'httpStatus'), effect = own(raw, 'effect');
    if (!['timeout', 'rate-limited', 'server', 'network', 'auth', 'permanent', 'unknown'].includes(category as string)
      || typeof code !== 'string' || !['DEPENDENCY_TIMEOUT', 'DEPENDENCY_RATE_LIMITED', 'DEPENDENCY_SERVER_ERROR', 'DEPENDENCY_NETWORK_ERROR', 'DEPENDENCY_AUTH_REJECTED',
        'DEPENDENCY_REQUEST_REJECTED', 'DEPENDENCY_FAILURE_UNKNOWN', 'CIRCUIT_OPEN', 'BUDGET_PREFLIGHT_REJECTED', 'IDEMPOTENCY_KEY_REQUIRED', 'MALFORMED_RESPONSE', 'LOCAL_DEPENDENCY_BLOCKED'].includes(code)
      || actualStatus !== undefined && !status(actualStatus) || !['none', 'unknown'].includes(effect as string)) throw new TypeError('Boundary normalization is invalid');
    return Object.freeze({ category, code, ...(actualStatus === undefined ? {} : { httpStatus: actualStatus }), effect }) as NormalizedBoundaryError;
  };
  const safeFailure = (failure: NormalizedBoundaryError) => Object.assign(new Error(failure.code), { name: 'BoundaryDependencyError', code: failure.code,
    ...(failure.httpStatus === undefined ? {} : { status: failure.httpStatus }), ...(failure.effect === 'none' ? { effect: 'none' } : {}) });
  const fallback = (operation: BoundaryOperation): NormalizedBoundaryError => ({ category: 'unknown', code: 'DEPENDENCY_FAILURE_UNKNOWN', effect: operation.effect === 'read' ? 'none' : 'unknown' });

  const onAttempt = (event: FlowAttemptEvent) => {
    try {
      const record = event.record, id = attemptId(record), stageId = event.traversalContext?.runtimeStageId, eventRun = event.traversalContext?.runId;
      const call = calls.get(id);
      const observation = record.kind === 'observed' ? active : undefined;
      if (!call && !observation) return;
      if (!stageId || !eventRun || runId !== undefined && runId !== eventRun) { incomplete(); unboundObservations++; return; }
      runId ??= eventRun;
      if (observation && (observation.matched || record.target !== observation.call.operation.target || record.source !== observation.report.source
        || record.attempt !== (observation.report.attempt ?? 1) || record.startedAt !== observation.report.startedAt || record.durationMs !== observation.report.durationMs
        || record.outcome !== observation.report.outcome)) { incomplete(); unboundObservations++; return; }
      const pending = call ?? observation!.call, op = pending.operation;
      if (call) { call.finished = true; calls.delete(id); }
      if (observation) observation.matched = true;
      const failure = observation?.normalized ?? pending.normalized;
      const category = record.outcome === 'ok' ? 'ok' : failure?.category ?? (record.outcome === 'timeout' ? 'timeout' : record.category ?? 'unknown');
      const effect = op.effect === 'read' ? 'none' : observation ? 'unknown' : record.effect === 'applied' ? 'confirmed' : record.effect === 'none' ? 'none' : 'unknown';
      if (record.outcome === 'paused') { incomplete(); unboundObservations++; return; }
      if (rows.length >= maxEvents) { droppedEvents++; incomplete(); return; }
      const row: BoundaryEvidence = { id: `boundary-${++sequence}`, sequence, runtimeStageId: stageId, attemptId: id, target: op.system, operation: op.operation,
        outcome: record.outcome, category, effect,
        ...(failure ? { code: failure.code } : {}),
        ...((failure?.httpStatus ?? observation?.report.httpStatus) === undefined ? {} : { httpStatus: failure?.httpStatus ?? observation?.report.httpStatus }),
        ...(!observation ? { decision: { next: record.next, reason: record.reason } } : {}) };
      rows.push(deepFreeze(row));
      if (observation) {
        const report = observation.report;
        physical.push(deepFreeze({ attemptId: id, parentAttemptId: observation.parentId, source: report.source, phase: report.phase ?? 'dispatch',
          startedAt: record.startedAt, durationMs: record.durationMs,
          ...(report.attempt === undefined ? {} : { reportedAttempt: report.attempt }), ...(report.of === undefined ? {} : { reportedMaximum: report.of }),
          ...(report.timeoutMs === undefined ? {} : { timeoutMs: report.timeoutMs }), ...(report.timeLeftMs === undefined ? {} : { timeLeftMs: report.timeLeftMs }),
          nativeDecisionMeaning: 'engine-interpretation', sdkRetryDecision: 'unknown' }));
      }
    } catch { incomplete(); unboundObservations++; }
  };
  const flowRecorder: FlowRecorder = Object.freeze({ id: 'blueprint-boundary-recorder', onAttempt });

  return Object.freeze({ flowRecorder,
    async run<T>(scope: BoundaryScope, operation: BoundaryOperation, work: (context: BoundaryCallContext) => T | Promise<T>): Promise<T> {
      if (!label(operation.system) || !label(operation.target) || !label(operation.operation) || !['read', 'write'].includes(operation.effect)
        || operation.timeoutMs !== undefined && (!finite(operation.timeoutMs) || operation.timeoutMs <= 0)
        || operation.idempotencyKey !== undefined && (operation.effect !== 'write' || typeof operation.idempotencyKey !== 'string') || typeof work !== 'function') throw new TypeError('Boundary operation is invalid');
      const invoke = 'call' in scope ? scope.call.bind(scope) : scope.$call.bind(scope);
      // Capture immutable configuration, but never retain a provider key in diagnostic state.
      const safeOperation: BoundaryOperation = Object.freeze({ system: operation.system, operation: operation.operation, target: operation.target, effect: operation.effect,
        ...(operation.timeoutMs === undefined ? {} : { timeoutMs: operation.timeoutMs }) });
      const pending: PendingCall = { operation: safeOperation, finished: false, settled: false, threw: false, ambiguousPhysicalWrite: false };
      logicalCalls++;
      try {
        return await invoke<T>(operation.target, async (attempt: AttemptContext) => {
          const parentId = attemptId(attempt); calls.set(parentId, pending); live.add(pending);
          const context: BoundaryCallContext = Object.freeze({ attempt, signal: attempt.signal,
            ...(attempt.deadline === undefined ? {} : { deadline: attempt.deadline }), ...(attempt.timeoutMs === undefined ? {} : { timeoutMs: attempt.timeoutMs }),
            timeLeftMs: () => attempt.timeLeftMs(),
            markIncomplete(reason: BoundaryObservationOmission) {
              incomplete();
              if (pending.finished || pending.settled || attempt.signal.aborted) { lateReports++; return; }
              if (!['multiple-dispatches', 'response-unconsumed', 'observation-unavailable'].includes(reason)) return;
              omittedObservations++;
              if (safeOperation.effect === 'write') pending.ambiguousPhysicalWrite = true;
            },
            observePhysical(input: PhysicalAttemptObservation) {
              physicalObservations++;
              if (pending.finished || pending.settled || attempt.signal.aborted) { lateReports++; incomplete(); return; }
              try {
                const source = own(input, 'source'), outcome = own(input, 'outcome'), startedAt = own(input, 'startedAt'), durationMs = own(input, 'durationMs');
                const n = own(input, 'attempt'), of = own(input, 'of'), httpStatus = own(input, 'httpStatus'), timeoutMs = own(input, 'timeoutMs'), timeLeftMs = own(input, 'timeLeftMs'), phase = own(input, 'phase');
                if (!label(source) || !['ok', 'failed', 'timeout', 'aborted'].includes(outcome as string) || !finite(startedAt) || !finite(durationMs) || durationMs < 0
                  || n !== undefined && !count(n) || of !== undefined && (!count(of) || of < (n as number ?? 1)) || httpStatus !== undefined && !status(httpStatus)
                  || timeoutMs !== undefined && (!finite(timeoutMs) || timeoutMs <= 0) || timeLeftMs !== undefined && !finite(timeLeftMs)
                  || phase !== undefined && !['response-complete', 'headers', 'dispatch'].includes(phase as string)) throw new TypeError('Boundary observation is invalid');
                const failure = outcome === 'ok' ? undefined : normalized(own(input, 'error'), safeOperation, httpStatus as number | undefined);
                if (safeOperation.effect === 'write' && (phase !== 'response-complete' || outcome !== 'ok' && failure?.effect !== 'none')) pending.ambiguousPhysicalWrite = true;
                const report = { source, outcome, startedAt, durationMs, ...(n === undefined ? {} : { attempt: n }), ...(of === undefined ? {} : { of }),
                  ...(httpStatus === undefined ? {} : { httpStatus }), ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(timeLeftMs === undefined ? {} : { timeLeftMs }), ...(phase === undefined ? {} : { phase }) } as PhysicalAttemptObservation;
                const observation: PendingObservation = { parentId, call: pending, report, normalized: failure, matched: false };
                const previous = active; active = observation;
                try { attempt.observed({ target: safeOperation.target, source: report.source, outcome: report.outcome, startedAt: report.startedAt, durationMs: report.durationMs,
                  ...(report.attempt === undefined ? {} : { attempt: report.attempt }), ...(report.of === undefined ? {} : { of: report.of }),
                  ...(failure === undefined ? {} : { error: safeFailure(failure) }) }); }
                finally { active = previous; }
                if (!observation.matched) { unboundObservations++; incomplete(); }
              } catch { if (safeOperation.effect === 'write') pending.ambiguousPhysicalWrite = true; unboundObservations++; incomplete(); }
            },
          });
          try { return await work(context); }
          catch (error) {
            pending.threw = true; pending.original = error;
            try { pending.normalized = normalized(error, safeOperation); } catch { incomplete(); pending.normalized = fallback(safeOperation); }
            // A final rejection of one SDK try cannot prove that an earlier ambiguous write try did nothing.
            if (pending.ambiguousPhysicalWrite && pending.normalized.effect === 'none') pending.normalized = Object.freeze({ ...pending.normalized, effect: 'unknown' });
            // Cancellation classification depends on the real signal reason's identity. It is a trusted host
            // control already owned by the native executor, not an arbitrary provider error to project.
            if (attempt.signal.aborted && error === attempt.signal.reason) throw error;
            // Native traces receive only a safe neutral error. The private thrown value is not copied into a record.
            pending.safeError = safeFailure(pending.normalized);
            throw pending.safeError;
          } finally { pending.settled = true; live.delete(pending); }
        }, { attempts: 1, ...(operation.timeoutMs === undefined ? {} : { timeoutMs: operation.timeoutMs }) },
        operation.effect === 'write' ? { touches: operation.system, ...(operation.idempotencyKey === undefined ? {} : { idempotencyKey: operation.idempotencyKey }) } : undefined);
      } catch (error) {
        // This observer adds no retry. Preserve the existing adapter's completed error identity (including
        // conditional/atomic conflict handling). A native touching call may wrap that exact safe projection;
        // restoring the private error does NOT change its immutable unknown-effect record. A native own timer
        // or cancellation has a different cause and remains authoritative while provider work is unresolved.
        if (pending.threw && pending.safeError && (error === pending.safeError || own(error, 'cause') === pending.safeError)) throw pending.original;
        throw error;
      } finally {
        if (!pending.finished && pending.settled) { unboundObservations++; incomplete(); for (const [id, entry] of calls) if (entry === pending) calls.delete(id); }
        if (!pending.finished && !pending.settled && !live.has(pending)) { unboundObservations++; incomplete(); }
        pending.original = undefined;
      }
    },
    snapshot(): BoundaryRecorderSnapshot {
      // A row cap may admit a physical observation and then omit its final logical-call record. Do not export
      // dangling links as if they were bound evidence. Omission is visible, and never reconstructed from counters.
      const parents = new Set(rows.map(row => row.attemptId));
      const retainedPhysical = physical.filter(row => parents.has(row.parentAttemptId));
      const orphaned = new Set(physical.filter(row => !parents.has(row.parentAttemptId)).map(row => row.attemptId));
      const retainedRows = rows.filter(row => !row.attemptId || !orphaned.has(row.attemptId));
      const failed = observerFailed || orphaned.size > 0 || live.size > 0;
      const diagnostics = { observer: failed ? 'failed' : 'ok', ...(failed ? { code: 'BOUNDARY_EVIDENCE_INCOMPLETE' } : {}) };
      // All retained values are bounded projections, so a JSON round trip also detaches every nested object.
      return deepFreeze(JSON.parse(JSON.stringify({ schemaVersion: 1, ...(runId === undefined ? {} : { runId }), boundaryEvidence: retainedRows, physicalEvidence: retainedPhysical, diagnostics,
        coverage: { logicalCalls, physicalObservations, inFlightCalls: live.size, droppedEvents: droppedEvents + orphaned.size, unboundObservations, lateReports, omittedObservations,
          physicalAttemptCounts: 'reported-only', sdkRetryDecisions: 'unknown', externalDelivery: 'unknown' } })) as BoundaryRecorderSnapshot);
    },
  });
}
