import { diagnoseFailureRecording, normalizeBoundaryError, formatFailureExplanation, createFailureExplanation } from 'footprint-blueprint/diagnostics';
import type { BoundaryEvidence, BoundaryErrorCategory, BoundaryErrorOptions, FailureDiagnosis, FailureRecording, NormalizedBoundaryError, FailureExplanation, FailureExplanationTemplate } from 'footprint-blueprint/diagnostics';
import { createBoundaryRecorder } from 'footprint-blueprint/diagnostics/runtime';
import type { BoundaryOperation, BoundaryCallContext, PhysicalAttemptObservation, BoundaryScope } from 'footprint-blueprint/diagnostics/runtime';

const options: BoundaryErrorOptions = { system: 'directory', operation: 'lookup', effect: 'read',
  classify: fields => { const category: BoundaryErrorCategory = fields.name === 'NoAccess' ? 'auth' : 'unknown'; return category; } };
const normalized: NormalizedBoundaryError = normalizeBoundaryError({ status: 503 }, options);
const event: BoundaryEvidence = { id: 'event', sequence: 1, runtimeStageId: 'lookup#0', target: 'directory', operation: 'lookup',
  outcome: 'failed', category: normalized.category, effect: normalized.effect };
const record: FailureRecording = { schemaVersion: 1, storeId: 'store', runId: 'run', flowId: 'flow', nativeSnapshot: null,
  boundaryEvidence: [event], diagnostics: { persistence: 'failed', observer: 'ok' } };
const report: FailureDiagnosis = diagnoseFailureRecording(record);
const rendered = document.createElement('p'); rendered.textContent = report.summary;
const templates: readonly FailureExplanationTemplate[] = [{ id: 'access', when: { findingCode: 'AUTH_REJECTION_RECORDED' }, problem: 'Access needs checking.' }];
const explanation: FailureExplanation = formatFailureExplanation(report, { templates });
rendered.textContent = explanation.recordedCause.text;
void createFailureExplanation(record, { templates });
// @ts-expect-error Presentation configuration cannot supply replacement causal certainty.
const invalidTemplate: FailureExplanationTemplate = { id: 'invalid', when: { status: 'unknown' }, confidence: 'complete' };
void invalidTemplate;
// @ts-expect-error Host policy cannot invent a retry effect vocabulary.
const invalid: BoundaryErrorOptions = { system: 'directory', operation: 'lookup', effect: 'charge' };
void invalid;
const runtime = createBoundaryRecorder();
const operation: BoundaryOperation = { system: 'directory', operation: 'lookup', target: 'directory.lookup', effect: 'read', timeoutMs: 500 };
const transport: PhysicalAttemptObservation = { source: 'browser-fetch', outcome: 'ok', startedAt: Date.now(), durationMs: 0, phase: 'response-complete' };
async function browserAdapter(scope: BoundaryScope) {
  return runtime.run(scope, operation, (context: BoundaryCallContext) => { context.observePhysical(transport); return context.timeLeftMs(); });
}
void browserAdapter;
