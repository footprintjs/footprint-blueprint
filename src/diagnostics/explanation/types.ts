import type { FailureDiagnosis } from '../types.js';

/** Trusted authored copy. It is presentation configuration, never evidence or action authority. */
export interface FailureExplanationTemplate {
  readonly id: string;
  readonly when: { readonly status?: FailureDiagnosis['status']; readonly findingCode?: string };
  readonly problem?: string;
  readonly recordedCause?: string;
  readonly suggestedNextStep?: string;
}
export interface FailureExplanationOptions { readonly templates?: readonly FailureExplanationTemplate[]; }
export interface FailureExplanationSection {
  readonly title: 'Problem' | 'Recorded cause' | 'Suggested next step';
  /** Canonical admitted observation or recommendation. Render this even when configured copy exists. */
  readonly text: string;
  /** Supplementary authored explanation, not a verified causal finding or a repair. */
  readonly configuredText?: string;
  readonly wordingSource: 'default' | 'configured';
  readonly evidenceRefs: readonly string[];
}
export type FailureExplanationReason = 'matched' | 'no-templates' | 'no-match' | 'unavailable-facts' | 'ambiguous-templates' | 'ambiguous-findings';
/** A presentation of a host-admitted diagnosis. Shape admission does not authenticate its producer. */
export interface FailureExplanation {
  readonly version: 1;
  readonly status: FailureDiagnosis['status'];
  readonly problem: FailureExplanationSection;
  readonly recordedCause: FailureExplanationSection;
  readonly suggestedNextStep: FailureExplanationSection;
  /** Mandatory uncertainty retained verbatim, independently of any configured copy. */
  readonly unknowns: readonly string[];
  readonly coverage: FailureDiagnosis['coverage'];
  readonly evidenceRefs: readonly string[];
  readonly template: { readonly outcome: 'default' | 'configured'; readonly id?: string; readonly reason: FailureExplanationReason };
}
export interface SelectedWording {
  readonly problem?: string;
  readonly recordedCause?: string;
  readonly suggestedNextStep?: string;
}
export interface ExplanationSelection {
  readonly reason: FailureExplanationReason;
  readonly templateId?: string;
  readonly wording?: SelectedWording;
}
export type DiagnosisReader = (recording: unknown) => FailureDiagnosis;
