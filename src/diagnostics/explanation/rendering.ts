import type { FailureDiagnosis } from '../types.js';
import type { ExplanationSelection, FailureExplanation, FailureExplanationSection } from './types.js';
import { freeze, limit } from './inert.js';
import { unknownWriteGuidance } from '../guidance.js';

export function renderExplanation(diagnosis: FailureDiagnosis, selection: ExplanationSelection): FailureExplanation {
  const section = (title: FailureExplanationSection['title'], text: string, refs: readonly string[], configuredText?: string): FailureExplanationSection => ({
    title, text, ...(configuredText === undefined ? {} : { configuredText }), wordingSource: configuredText === undefined ? 'default' : 'configured', evidenceRefs: refs,
  });
  const causeRefs = [...new Set(diagnosis.causes.flatMap(item => item.evidenceRefs))];
  const cause = diagnosis.causes.map(item => item.summary).join(' ') || 'No cause was recorded; the upstream root cause remains unknown.';
  const next = diagnosis.coverage.externalEffect === 'unknown' ? unknownWriteGuidance
    : diagnosis.recommendations[0] ?? 'Review the cited evidence before changing business behavior.';
  const result: FailureExplanation = {
    version: 1, status: diagnosis.status,
    problem: section('Problem', diagnosis.summary, diagnosis.evidenceRefs, selection.wording?.problem),
    recordedCause: section('Recorded cause', cause, causeRefs, selection.wording?.recordedCause),
    suggestedNextStep: section('Suggested next step', next, diagnosis.evidenceRefs, selection.wording?.suggestedNextStep),
    unknowns: diagnosis.unknowns, coverage: diagnosis.coverage, evidenceRefs: diagnosis.evidenceRefs,
    template: { outcome: selection.reason === 'matched' ? 'configured' : 'default', reason: selection.reason,
      ...(selection.templateId === undefined ? {} : { id: selection.templateId }) },
  };
  // Bound retained presentation bytes without trimming a finding, guard, uncertainty or reference.
  let bytes = 0;
  const count = (value: unknown): void => {
    if (typeof value === 'string') bytes += new TextEncoder().encode(value).byteLength;
    else if (value && typeof value === 'object') for (const item of Object.values(value)) count(item);
    if (bytes > 256 * 1024) limit();
  };
  count(result);
  return freeze(result);
}
