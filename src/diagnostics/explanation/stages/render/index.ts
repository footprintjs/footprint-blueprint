import { renderExplanation } from '../../rendering.js';
import type { PresentationRun } from '../types.js';
import { invalid } from '../../inert.js';
export function renderPresentation(run: PresentationRun) {
  return (): void => {
    if (!run.selection || !run.diagnosis) invalid();
    run.result = renderExplanation(run.diagnosis, run.selection);
  };
}
