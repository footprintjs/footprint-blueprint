import { FlowChartBuilder, FlowChartExecutor, MetricRecorder } from 'footprintjs';
import { immutableValue } from '../features/index.js';
import type { ServiceBridge } from '../adapters/index.js';
import type { ActionRegistry } from './actionRegistry.js';
import { ActionAccessError, ActionInputError, validateActionInput } from './validation.js';
import { createEvidenceCollector } from './evidence.js';
import type { EvidenceCollectorOptions, ExecutionEvidence } from './evidence.js';
import type { ActionAuthorizer, ActionExecutionContext, ActionHandler, ActionHandlerRegistry, ActionResult, ActionTrace, ExecutionTrace, TraceRecorder } from './types.js';
export type ActionExecutorOptions = {
  /** Trusted server/app callback. Omitting it denies every execution. */
  authorizer?: ActionAuthorizer;
  handlers?: ActionHandlerRegistry;
  traceRecorder?: TraceRecorder;
  /** Optional observer; observer errors are always nonfatal. */
  onTraceError?: (error: unknown) => void;
  /** Trusted projection/budget settings. Defaults retain metadata only. */
  evidenceOptions?: EvidenceCollectorOptions;
  /** Opt-in actor projection, evaluated only after authorization and validation. */
  projectEvidenceActor?: (context: ActionExecutionContext) => string | undefined;
  /** Opt-in synchronous request projection; raw input is never recorded by default. */
  projectEvidenceRequest?: (input: unknown, context: ActionExecutionContext) => unknown;
};
export type ActionExecutor = { execute(actionId: string, input: unknown, context: ActionExecutionContext, handler?: ActionHandler): Promise<ActionResult> };
/** Consume genuine native promises across realms without reading ordinary thenables. */
function consumeNativePromise(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  try {
    Promise.prototype.then.call(value as Promise<unknown>, () => undefined, () => undefined);
    return true;
  } catch { return false; }
}
/** Every invocation owns a real SDK executor. Payloads remain closure-private. */
export function createActionExecutor(registry: ActionRegistry, bridge?: ServiceBridge, options: ActionExecutorOptions = {}): ActionExecutor {
  const authorizer = options.authorizer;
  const handlers = Object.freeze({ ...options.handlers });
  const recorder = options.traceRecorder;
  const onTraceError = options.onTraceError;
  const evidenceOptions = Object.freeze({ ...options.evidenceOptions });
  const projectActor = options.projectEvidenceActor;
  const projectRequest = options.projectEvidenceRequest;
  const reportObserver = (error: unknown) => {
    try {
      const result: unknown = onTraceError?.(error);
      consumeNativePromise(result);
    } catch { /* Diagnostics cannot alter a known write. */ }
  };
  const projectSafely = <T>(project: () => T): T | undefined => {
    try {
      const value = project();
      if (consumeNativePromise(value)) {
        reportObserver(new Error('Evidence projection must be synchronous'));
        return undefined;
      }
      return value;
    } catch (error) { reportObserver(error); return undefined; }
  };
  return Object.freeze({
    async execute(actionId, input, suppliedContext, fallbackHandler) {
      const action = registry.getAction(actionId);
      if (!action) return Object.freeze({ actionId, status: 'error', error: `Unknown action: "${actionId}"`, errorCode: 'ACTION_UNKNOWN', httpStatus: 404, duration: 0 });
      const startedAt = Date.now();
      let context: ActionExecutionContext;
      try { context = immutableValue(suppliedContext); }
      catch { return Object.freeze({ actionId, status: 'error', error: 'Action context must contain plain values', errorCode: 'ACTION_CONTEXT_INVALID', httpStatus: 400, duration: Date.now() - startedAt }); }
      const telemetryScope = Object.freeze({ profileType: context.profileType, unitId: context.unitId,
        ...(context.tenantId !== undefined ? { tenantId: context.tenantId } : {}),
        ...(context.campusId !== undefined ? { campusId: context.campusId } : {}),
      });
      // This fallback is a receipt identity, never represented as an SDK run identity.
      const receiptId = globalThis.crypto.randomUUID();
      const evidenceCollector = createEvidenceCollector(evidenceOptions);
      // Handlers can report facts; only the executor owns receipt identity/finalization.
      const evidenceReporter = Object.freeze({
        observe: evidenceCollector.observe, effect: evidenceCollector.effect,
        link: evidenceCollector.link, report: evidenceCollector.report,
      });
      let evidenceActor: string | undefined;
      let evidenceRequest: unknown;
      const stageState: { phase: 'authorization' | 'validation' | 'execution' } = { phase: 'authorization' };
      let capturedInput: unknown;
      let result: unknown;
      let failure: unknown;
      let adapterId: string | undefined;
      let acknowledged = false;
      const stage = async (operation: () => unknown | Promise<unknown>) => {
        try { await operation(); } catch (error) { failure = error; throw new Error('Action stage rejected'); }
      };
      // Neither request data nor provider error messages enter SDK state, args or output.
      const chart = new FlowChartBuilder()
        .start('AuthorizeAction', () => stage(async () => {
          if (typeof authorizer !== 'function' || await authorizer({ action, context, purpose: 'execute' }) !== true) throw new ActionAccessError('ACTION_FORBIDDEN', 'Action is not authorized');
        }), 'authorize-action', 'Authorize through the trusted application policy')
        .addFunction('ValidateInput', () => stage(() => {
          stageState.phase = 'validation';
          capturedInput = immutableValue(input);
          validateActionInput(action, capturedInput);
          // Both callbacks are trusted diagnostics. Neither can interrupt execution.
          evidenceActor = projectSafely(() => projectActor?.(context));
          evidenceRequest = projectSafely(() => projectRequest?.(capturedInput, context));
        }), 'validate-input', 'Validate the declared JSON Schema without coercion')
        .addFunction('ExecuteAction', () => stage(async () => {
          stageState.phase = 'execution';
          const handler = (Object.hasOwn(handlers, actionId) ? handlers[actionId] : undefined) ?? (!action.capabilityId ? fallbackHandler : undefined);
          if (handler) result = await handler(actionId, capturedInput, context, evidenceReporter);
          else if (action.capabilityId && bridge) {
            const execution = await bridge.execute(action.capabilityId, capturedInput, { ...context, actionId });
            adapterId = execution.adapterId;
            if (execution.status !== 'success') {
              if (execution.cause !== undefined) throw execution.cause;
              const error = new ActionAccessError(execution.errorCode ?? 'ACTION_PROVIDER_FAILED', execution.error ?? 'Capability failed', execution.httpStatus ?? 503);
              if (execution.traceRunId) Object.defineProperty(error, 'traceRunId', { value: execution.traceRunId });
              throw error;
            }
            result = execution.result;
          } else throw new ActionAccessError('ACTION_IMPLEMENTATION_UNAVAILABLE', 'Action implementation is unavailable', 503);
          acknowledged = true;
        }), 'execute-action', 'Invoke the registered handler or profile adapter')
        .addFunction('AcknowledgeAction', () => undefined, 'acknowledge-action', 'Acknowledge the completed operation')
        .build();
      const runtime = new FlowChartExecutor(chart, { readTracking: 'summary', writeTracking: 'summary', commitValues: 'delta' });
      runtime.setRedactionPolicy({ keys: ['input', 'args', 'result', 'output', 'error', 'message', 'cause', 'meta', 'userId'] });
      const metrics = new MetricRecorder('action-stage-metrics');
      runtime.attachScopeRecorder(metrics);
      try { await runtime.run(); } catch (error) { if (!failure && !acknowledged) failure = error; else if (acknowledged) reportObserver(error); }
      const completedAt = Date.now();
      let executionTrace: ExecutionTrace | undefined;
      let executionSnapshot: unknown;
      let engineRunId: string | undefined;
      try {
        const snapshot = runtime.getSnapshot({ redact: true });
        executionSnapshot = snapshot;
        engineRunId = snapshot.runId;
      } catch (error) { reportObserver(error); }
      const details = failure && typeof failure === 'object' ? failure as Record<string, unknown> : {};
      // Provider messages/causes and arbitrary provider strings stay outside the receipt.
      const publicCodes = new Set(['ACTION_FORBIDDEN', 'ACTION_IMPLEMENTATION_UNAVAILABLE', 'ACTION_PROVIDER_FAILED']);
      const evidenceCode = failure instanceof ActionInputError ? 'ACTION_INPUT_INVALID' : failure instanceof ActionAccessError && publicCodes.has(failure.code) ? failure.code : 'ACTION_EXECUTION_FAILED';
      let evidence: ExecutionEvidence | undefined;
      try {
        evidence = evidenceCollector.finalize({
          runId: engineRunId ?? receiptId,
          ...(engineRunId ? { engineRunId } : {}), actionId, scope: telemetryScope,
          ...(evidenceActor !== undefined ? { actorId: evidenceActor } : {}),
          ...(evidenceRequest !== undefined ? { request: evidenceRequest } : {}),
          outcome: acknowledged ? { status: 'succeeded' } : { status: stageState.phase === 'execution' ? 'failed' : 'rejected', code: evidenceCode },
          nativeRecording: executionSnapshot !== undefined,
        });
      } catch (error) { reportObserver(error); }
      try {
        executionTrace = immutableValue({
          runId: engineRunId ?? receiptId, flowId: actionId, status: acknowledged ? 'ok' : 'error',
          startedAt: new Date(startedAt).toISOString(), completedAt: new Date(completedAt).toISOString(),
          ...(acknowledged ? {} : { errorMessage: 'Action execution rejected' }),
          ...(executionSnapshot !== undefined ? { executionSnapshot } : {}),
          ...(evidence ? { evidence } : {}), runtime: { library: 'footprintjs', version: '10.0.0' },
          stageMetrics: [...metrics.getMap().values()].map(metric => ({ stageName: metric.stageName, durationMs: metric.duration })),
        }) as ExecutionTrace;
        if (recorder) try { await recorder.record(executionTrace, Object.freeze({ entityType: action.domain, entityId: action.id, ...telemetryScope })); } catch (error) { reportObserver(error); }
      } catch (error) { reportObserver(error); }
      const trace: ActionTrace = Object.freeze({ actionId, adapterId, ...telemetryScope, startedAt, completedAt });
      if (acknowledged) return Object.freeze({ actionId, status: 'success', result, duration: completedAt - startedAt, trace, executionTrace, evidence: executionTrace?.evidence ?? evidence, traceRunId: executionTrace?.runId });
      const response: ActionResult = { actionId, status: 'error', error: failure instanceof Error ? failure.message : String(failure ?? 'Action execution failed'), errorCode: typeof details.code === 'string' ? details.code : 'ACTION_EXECUTION_FAILED', httpStatus: typeof details.status === 'number' ? details.status : 500, traceRunId: typeof details.traceRunId === 'string' ? details.traceRunId : executionTrace?.runId, duration: completedAt - startedAt, trace, executionTrace, evidence: executionTrace?.evidence ?? evidence };
      Object.defineProperty(response, 'cause', { value: failure, enumerable: false });
      return Object.freeze(response);
    },
  });
}
