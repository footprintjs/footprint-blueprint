import type { FlowRecorder, TraversalContext } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import type { Attention } from 'foottrace';

export interface CauseCapture {
  readonly version: 1;
  readonly ruleVersion: 'recorded-facts-v1';
  readonly runId: string;
  readonly complete: boolean;
  readonly controlDeps: Readonly<Record<string, { readonly deciderId: string }>>;
  readonly attention: Readonly<Record<string, readonly Attention[]>>;
  /** Fixed event facts retained by this observer; no error messages, payloads or scores. */
  readonly facts: readonly { readonly id: string; readonly runtimeStageId: string; readonly kind: string }[];
}
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

/** Optional host rule, not engine C2: collects only actual flow/attempt events under a fixed bounded policy. */
export function createCauseCapture() {
  const control = controlDepRecorder();
  const stages = new Set<string>();
  const marks = new Map<string, Attention[]>();
  let facts: Array<{ id: string; runtimeStageId: string; kind: string }> = [];
  let runId = '', dropped = false, ended = false, failed = false;
  // The engine dispatches resume before run-start; do not erase this leg's missing history.
  let pendingResume = false, resumed = false;
  const remember = (context: TraversalContext | undefined): string | undefined => {
    if (!context || !id(context.runtimeStageId) || !id(context.runId)) { dropped = true; return; }
    if (!runId) runId = context.runId;
    if (context.runId !== runId || (!stages.has(context.runtimeStageId) && stages.size >= 512)) { dropped = true; return; }
    stages.add(context.runtimeStageId); return context.runtimeStageId;
  };
  const mark = (runtimeStageId: string, kind: Attention['kind'], reason: Attention['reason']) => {
    if (facts.length >= 1024) { dropped = true; return; }
    const evidence = `capture:${facts.length}`;
    facts.push({ id: evidence, runtimeStageId, kind });
    const existing = marks.get(runtimeStageId) ?? [];
    let item = existing.find(value => value.kind === kind && value.reason === reason);
    if (!item) {
      if (existing.length >= 32) { dropped = true; return; }
      item = { kind, reason, evidence: [] }; existing.push(item); marks.set(runtimeStageId, existing);
    }
    if (item.evidence.length >= 16) { dropped = true; return; }
    (item.evidence as string[]).push(evidence);
  };
  const recorder: FlowRecorder = {
    id: 'recorded-cause-facts-v1',
    onResume() { pendingResume = true; },
    onRunStart(event) { resumed = pendingResume; pendingResume = false; stages.clear(); marks.clear(); facts = []; runId = ''; dropped = false; ended = false; failed = false; control.clear(); remember(event.traversalContext); },
    onDecision(event) { control.onDecision(event); remember(event.traversalContext); },
    onSelected(event) { control.onSelected(event); remember(event.traversalContext); },
    onStageExecuted(event) { control.onStageExecuted(event); remember(event.traversalContext); },
    onError(event) { control.onError(event); const stage = remember(event.traversalContext); if (stage) mark(stage, 'error', 'ERROR_RECORDED'); },
    onAttempt(event) {
      control.onAttempt(event); const stage = remember(event.traversalContext); if (!stage) return;
      const record = event.record;
      if (record.outcome === 'timeout') mark(stage, 'timeout', 'TIMEOUT_RECORDED');
      if (record.effect === 'unknown') mark(stage, 'unknown-effect', 'UNKNOWN_EFFECT_RECORDED');
      // Observed next/reason are engine interpretations, not the external SDK's retry policy.
      // `next:retry` is intent before backoff/cancellation. A kept later attempt is the fact.
      if (record.attempt > 1) mark(stage, 'retried', 'RETRY_RECORDED');
      // A physical call/observation cannot establish that a logical stage exhausted its series.
      if (record.kind === 'stage' && (record.of ?? 1) > 1 && record.next === 'stop'
        && ['exhausted', 'declined', 'no-time-left'].includes(record.reason)) mark(stage, 'gave-up', 'RETRY_STOP_RECORDED');
    },
    onRunEnd() { ended = true; },
    onRunFailed() { ended = true; failed = true; },
  };
  return Object.freeze({ recorder, snapshot(nativeSnapshot: unknown): CauseCapture {
    const descriptor = nativeSnapshot && typeof nativeSnapshot === 'object' ? Object.getOwnPropertyDescriptor(nativeSnapshot, 'runId') : undefined;
    const nativeRunId = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    // Published10.1 cannot prove that every terminal commit failure emitted a stage error.
    const complete = ended && !dropped && !failed && !resumed && nativeRunId === runId;
    const controlDeps: Record<string, { deciderId: string }> = Object.create(null);
    for (const stage of stages) { const dependency = control.lookup(stage); if (dependency) controlDeps[stage] = Object.freeze({ deciderId: dependency.deciderId }); }
    const attention: Record<string, readonly Attention[]> = Object.create(null);
    for (const [stage, values] of marks) attention[stage] = Object.freeze(values.map(value => Object.freeze({ ...value, evidence: Object.freeze([...value.evidence]) })));
    return Object.freeze({ version: 1, ruleVersion: 'recorded-facts-v1', runId,
      complete, controlDeps: Object.freeze(controlDeps), attention: Object.freeze(attention), facts: Object.freeze(facts.map(value => Object.freeze({ ...value }))) });
  } });
}
