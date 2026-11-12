import { createRecordedCauseReader } from './cause.js';
import { admitInertData } from './coverageAdmission.js';
import type { CoverageDeclaration, RecordedCoverageInput } from './coverageTypes.js';

export class CoverageRecordingError extends Error {
  constructor(readonly code: 'COVERAGE_INPUT_INVALID' | 'COVERAGE_INPUT_LIMIT' = 'COVERAGE_INPUT_INVALID') {
    super('Coverage recording is unavailable'); this.name = 'CoverageRecordingError';
  }
}
function fail(limit = false): never { throw new CoverageRecordingError(limit ? 'COVERAGE_INPUT_LIMIT' : 'COVERAGE_INPUT_INVALID'); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) fail();
}
function text(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail();
}
function ref(value: unknown): asserts value is string { text(value, 512); if (/\s/u.test(value)) fail(); }
function list(value: unknown, maximum: number): asserts value is unknown[] { if (!Array.isArray(value)) fail(); if (value.length > maximum) fail(true); }
export const addressKey = (value: { readonly logRunId: string; readonly drillPath: readonly string[] }): string => JSON.stringify([value.logRunId, value.drillPath]);

function declaration(value: unknown): asserts value is CoverageDeclaration {
  fields(value, ['version', 'runId', 'definitionRef', 'label', 'complete', 'scopes'], ['description']);
  if (value.version !== 1 || typeof value.complete !== 'boolean') fail();
  ref(value.runId); ref(value.definitionRef); text(value.label, 120);
  if (value.description !== undefined) text(value.description, 1024);
  list(value.scopes, 16);
  const refs = new Set<string>([value.definitionRef]), addresses = new Set<string>(); let count = 0;
  const unique = (value: unknown) => { ref(value); if (refs.has(value)) fail(); refs.add(value); };
  for (const scope of value.scopes) {
    fields(scope, ['ref', 'address', 'steps']); unique(scope.ref);
    fields(scope.address, ['logRunId', 'drillPath']); ref(scope.address.logRunId);
    if (scope.address.logRunId !== value.runId) fail();
    list(scope.address.drillPath, 16); scope.address.drillPath.forEach(ref);
    const key = addressKey(scope.address as any); if (addresses.has(key)) fail(); addresses.add(key);
    list(scope.steps, 256); const stageIds = new Set<string>();
    for (const step of scope.steps) {
      if (++count > 256) fail(true);
      fields(step, ['ref', 'stageId', 'label'], ['description']); unique(step.ref); ref(step.stageId); text(step.label, 120);
      if (step.description !== undefined) text(step.description, 1024);
      if (stageIds.has(step.stageId)) fail(); stageIds.add(step.stageId);
    }
  }
}

/** Admission proves bounded inert shape, not producer authority or the truth of descriptions. */
export function coverageInput(value: unknown): RecordedCoverageInput {
  try {
    admitInertData(value, () => fail(), () => fail(true));
    fields(value, ['source', 'findingRef', 'windowRef'], ['declaration']); ref(value.findingRef); ref(value.windowRef);
    fields(value.source, ['scopes', 'incomplete']);
    // The existing public record adapter admits actual logs and their scope identities; no second graph reader.
    createRecordedCauseReader(value.source as any);
    for (const scope of (value.source as any).scopes) for (const commit of scope.commitLog) {
      if (!object(commit)) fail(); ref(commit.stageId);
    }
    if (value.declaration !== undefined) {
      declaration(value.declaration);
      for (const scope of (value.source as any).scopes) if (scope.address.logRunId !== value.declaration.runId) fail();
    }
    return structuredClone(value) as unknown as RecordedCoverageInput;
  } catch (error) {
    if (error instanceof CoverageRecordingError) throw error;
    fail();
  }
}

export function freezeCoverage<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeCoverage); Object.freeze(value); }
  return value;
}
