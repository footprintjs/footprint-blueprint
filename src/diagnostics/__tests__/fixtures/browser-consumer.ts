import { diagnoseFailureRecording, normalizeBoundaryError } from 'footprint-blueprint/diagnostics';
import type { BoundaryEvidence, BoundaryErrorCategory, BoundaryErrorOptions, FailureDiagnosis, FailureRecording, NormalizedBoundaryError } from 'footprint-blueprint/diagnostics';

const options: BoundaryErrorOptions = { system: 'directory', operation: 'lookup', effect: 'read',
  classify: fields => { const category: BoundaryErrorCategory = fields.name === 'NoAccess' ? 'auth' : 'unknown'; return category; } };
const normalized: NormalizedBoundaryError = normalizeBoundaryError({ status: 503 }, options);
const event: BoundaryEvidence = { id: 'event', sequence: 1, runtimeStageId: 'lookup#0', target: 'directory', operation: 'lookup',
  outcome: 'failed', category: normalized.category, effect: normalized.effect };
const record: FailureRecording = { schemaVersion: 1, storeId: 'store', runId: 'run', flowId: 'flow', nativeSnapshot: null,
  boundaryEvidence: [event], diagnostics: { persistence: 'failed', observer: 'ok' } };
const report: FailureDiagnosis = diagnoseFailureRecording(record);
const rendered = document.createElement('p'); rendered.textContent = report.summary;
// @ts-expect-error Host policy cannot invent a retry effect vocabulary.
const invalid: BoundaryErrorOptions = { system: 'directory', operation: 'lookup', effect: 'charge' };
void invalid;
