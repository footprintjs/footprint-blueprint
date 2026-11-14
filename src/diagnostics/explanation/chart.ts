import { FlowChartBuilder } from 'footprintjs';
import type { PresentationRun } from './stages/types.js';
import { preparePresentation } from './stages/prepare/index.js';
import { choosePresentation } from './stages/choose/index.js';
import { renderPresentation } from './stages/render/index.js';

/** Presentation wiring only. Raw records, authored copy and diagnoses stay in request-local closures. */
export function explanationChart(run: PresentationRun) {
  return new FlowChartBuilder()
    .start('Find eligible wording', preparePresentation(run), 'explanation-prepare')
    .addDeciderFunction('Choose presentation', choosePresentation, 'explanation-choose')
    .addFunctionBranch('configured', 'Add supplementary configured wording', renderPresentation(run))
    .addFunctionBranch('default', 'Retain canonical default wording', renderPresentation(run))
    .end()
    .setLogger({ info() {}, log() {}, warn() {}, error() {}, debug() {} })
    .build();
}
