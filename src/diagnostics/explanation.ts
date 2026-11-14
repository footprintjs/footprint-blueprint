import { FlowChartExecutor } from 'footprintjs';
import type { FailureDiagnosis } from './types.js';
import type { DiagnosisReader, FailureExplanation, FailureExplanationOptions } from './explanation/types.js';
import type { PresentationRun } from './explanation/stages/types.js';
import { readDiagnosis } from './explanation/admission.js';
import { readTemplates } from './explanation/config.js';
import { inertCopy, invalid } from './explanation/inert.js';
import { selectWording } from './explanation/matching.js';
import { renderExplanation } from './explanation/rendering.js';
import { explanationChart } from './explanation/chart.js';
export { FailureExplanationError } from './explanation/inert.js';
export type { FailureExplanation, FailureExplanationSection, FailureExplanationOptions, FailureExplanationTemplate, FailureExplanationReason } from './explanation/types.js';

/** Format a host-admitted diagnosis DTO. This checks its shape, not producer authenticity or physical cause. */
export function formatFailureExplanation(diagnosis: FailureDiagnosis, options?: FailureExplanationOptions): FailureExplanation {
  const admitted = readDiagnosis(diagnosis), templates = readTemplates(options);
  return renderExplanation(admitted, selectWording(admitted, templates));
}

/** Internal adapter: the public entry supplies the one strict recording reader, avoiding a cyclic import. */
export async function runFailureExplanation(recording: unknown, options: FailureExplanationOptions | undefined, reader: DiagnosisReader): Promise<FailureExplanation> {
  // All caller-owned data is admitted and detached before the first asynchronous boundary.
  const templates = readTemplates(options), detached = inertCopy(recording);
  const run: PresentationRun = { templates, diagnose: () => readDiagnosis(reader(detached)) };
  const executor = new FlowChartExecutor(explanationChart(run));
  executor.enableNarrative();
  await executor.run();
  if (!run.result) invalid();
  return run.result;
}
