import type { FailureDiagnosis } from '../types.js';
import type { ExplanationSelection, FailureExplanationTemplate, SelectedWording } from './types.js';
import type { ExplanationSlot } from './config.js';
import { placeholders } from './config.js';

function render(value: string | undefined, slots: Partial<Record<ExplanationSlot, string>>): string | undefined {
  if (value === undefined) return undefined;
  if (placeholders(value).some(slot => slots[slot] === undefined)) return undefined;
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, key: ExplanationSlot) => slots[key]!);
}
/** All matching is explicit. More than one eligible template/finding never means take the first. */
export function selectWording(diagnosis: FailureDiagnosis, templates: readonly FailureExplanationTemplate[]): ExplanationSelection {
  if (!templates.length) return { reason: 'no-templates' };
  const findings = [...diagnosis.causes, ...diagnosis.consequences, ...diagnosis.diagnosticFailures];
  const eligible: Array<{ templateId: string; wording: SelectedWording }> = [];
  let unavailable = false, ambiguous = false;
  for (const template of templates) {
    if (template.when.status !== undefined && template.when.status !== diagnosis.status) continue;
    const matches = template.when.findingCode === undefined ? [] : findings.filter(row => row.code === template.when.findingCode && row.evidenceRefs.length);
    if (template.when.findingCode !== undefined && !matches.length) continue;
    // A uniquely cited consequence may explain recovery without selecting one of several earlier causes.
    // Status-only wording has no such binding, so competing causes still require the default view.
    if (matches.length > 1 || template.when.findingCode === undefined && diagnosis.causes.length > 1) { ambiguous = true; continue; }
    const cause = diagnosis.causes.length === 1 && diagnosis.causes[0]!.code === template.when.findingCode
      && diagnosis.causes[0]!.evidenceRefs.length ? diagnosis.causes[0] : undefined;
    const slots: Partial<Record<ExplanationSlot, string>> = { status: diagnosis.status,
      ...(matches[0] ? { findingCode: matches[0].code } : {}), ...(cause ? { recordedCause: cause.summary } : {}),
      ...(diagnosis.coverage.nativeAttemptRecords === null ? {} : { nativeAttemptCount: String(diagnosis.coverage.nativeAttemptRecords) }),
      ...(diagnosis.coverage.logicalSDKCalls === null ? {} : { logicalCallCount: String(diagnosis.coverage.logicalSDKCalls) }),
      ...(diagnosis.coverage.physicalTransportAttempts === null ? {} : { transportAttemptCount: String(diagnosis.coverage.physicalTransportAttempts) }),
    };
    const problem = render(template.problem, slots);
    // Author copy cannot visually contradict the pinned reconciliation guard for an uncertain write.
    const adviceAllowed = diagnosis.coverage.externalEffect !== 'unknown';
    const next = adviceAllowed ? render(template.suggestedNextStep, slots) : undefined;
    const configuredCause = cause ? render(template.recordedCause, slots) : undefined;
    if (template.problem !== undefined && problem === undefined || adviceAllowed && template.suggestedNextStep !== undefined && next === undefined
      || cause && template.recordedCause !== undefined && configuredCause === undefined) { unavailable = true; continue; }
    if (problem === undefined && configuredCause === undefined && next === undefined) { unavailable = true; continue; }
    eligible.push({ templateId: template.id, wording: {
      ...(problem === undefined ? {} : { problem }), ...(configuredCause === undefined ? {} : { recordedCause: configuredCause }),
      ...(next === undefined ? {} : { suggestedNextStep: next }),
    } });
  }
  if (ambiguous) return { reason: 'ambiguous-findings' };
  if (eligible.length > 1) return { reason: 'ambiguous-templates' };
  if (eligible.length === 1) return { reason: 'matched', ...eligible[0]! };
  return { reason: unavailable ? 'unavailable-facts' : 'no-match' };
}
