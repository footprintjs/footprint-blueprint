import { selectWording } from '../../matching.js';
import type { PresentationRun, PresentationScope } from '../types.js';
export function preparePresentation(run: PresentationRun) {
  return (scope: PresentationScope): void => {
    run.diagnosis = run.diagnose();
    run.selection = selectWording(run.diagnosis, run.templates);
    scope.configured = run.selection.reason === 'matched';
  };
}
