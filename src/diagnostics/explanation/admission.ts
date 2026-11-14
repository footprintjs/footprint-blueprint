import type { FailureDiagnosis, FailureFinding } from '../types.js';
import { code, inertCopy, invalid, keys, object, status, text } from './inert.js';
import { upstreamRootLimit } from '../guidance.js';

const count = (v: unknown): boolean => v === null || typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000;
const oneOf = (...values: readonly unknown[]) => (value: unknown) => values.includes(value);
const coverage = {
  nativeRecording: oneOf('present', 'missing'), boundaryEvidence: oneOf('recorded', 'not-recorded'),
  nativeAttemptRecords: count, logicalSDKCalls: count, physicalTransportAttempts: count,
  physicalAttemptCounts: oneOf('reported-only', 'not-recorded'), sdkRetryDecisions: oneOf('unknown'),
  attemptBinding: oneOf('complete', 'partial'), attemptsTruncated: (v: unknown) => typeof v === 'boolean',
  logicalRetryLinks: oneOf('recorded', 'not-recorded'), upstreamRootCause: oneOf('unknown'),
  authenticity: oneOf('local-import-unverified'), externalEffect: oneOf('unknown', 'host-confirmed', 'none-recorded'),
  circuit: oneOf('adapter-recorded', 'not-recorded'),
} satisfies Record<keyof FailureDiagnosis['coverage'], (value: unknown) => boolean>;
function strings(value: unknown, maximum = 1024): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(item => text(item));
}
function findings(value: unknown): value is readonly FailureFinding[] {
  if (!Array.isArray(value) || value.length > 1024) return false;
  for (const row of value) {
    keys(row, ['code', 'summary', 'evidenceRefs']);
    if (!code(row.code) || !text(row.summary) || !strings(row.evidenceRefs)) return false;
  }
  return true;
}
/** Validate a caller-owned diagnosis DTO, not its source, authenticity or physical claims. */
export function readDiagnosis(input: FailureDiagnosis): FailureDiagnosis {
  const value: unknown = inertCopy(input);
  const fields = { status, summary: text, causes: findings, consequences: findings, diagnosticFailures: findings,
    recommendations: strings, unknowns: strings, evidenceRefs: strings, coverage: object } satisfies Record<keyof FailureDiagnosis, (value: unknown) => boolean>;
  keys(value, Object.keys(fields));
  if (Object.entries(fields).some(([key, validate]) => !validate(value[key]))) invalid();
  keys(value.coverage, Object.keys(coverage));
  if (Object.entries(coverage).some(([key, validate]) => !validate((value.coverage as Record<string, unknown>)[key]))) invalid();
  if (!(value.unknowns as string[]).includes(upstreamRootLimit)) invalid();
  const refs = new Set(value.evidenceRefs as string[]);
  for (const row of [...value.causes as FailureFinding[], ...value.consequences as FailureFinding[], ...value.diagnosticFailures as FailureFinding[]])
    if (row.evidenceRefs.some(ref => !refs.has(ref))) invalid();
  return value as unknown as FailureDiagnosis;
}
