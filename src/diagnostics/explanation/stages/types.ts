import type { FailureDiagnosis } from '../../types.js';
import type { ExplanationSelection, FailureExplanation, FailureExplanationTemplate } from '../types.js';
export interface PresentationRun {
  readonly diagnose: () => FailureDiagnosis;
  diagnosis?: FailureDiagnosis;
  readonly templates: readonly FailureExplanationTemplate[];
  selection?: ExplanationSelection;
  result?: FailureExplanation;
}
/** Only fixed status/count decisions enter the presentation chart's native recording. */
export interface PresentationScope { configured: boolean; }
