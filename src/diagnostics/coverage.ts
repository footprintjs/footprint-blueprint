import { readRequirementResults, type RequirementCheck, type RequirementResult } from 'foottrace';
import type { Gap } from 'foottrace/cause';
import type { CoverageRow, RecordedCoverage, RecordedCoverageInput } from './coverageTypes.js';
import { addressKey, coverageInput, CoverageRecordingError, freezeCoverage } from './coverageValidation.js';
export { CoverageRecordingError } from './coverageValidation.js';
export type { CoverageDeclaration, CoverageScopeDeclaration, CoverageStepDeclaration, CoverageRow, RecordedCoverage, RecordedCoverageInput } from './coverageTypes.js';

/**
 * Compare declared execution inventory with retained commits, never with imagined execution.
 * This is reference-only evidence admission, not a claim gate or a dependency walker.
 */
export function readRecordedCoverage(input: RecordedCoverageInput): RecordedCoverage {
  const { source, declaration, findingRef, windowRef } = coverageInput(input);
  const rows: Array<Omit<CoverageRow, 'result'>> = [], results: RequirementResult[] = [], gaps: Gap[] = [];
  const addGap = (evidence: readonly string[] = []) => { gaps.push({ code: 'not-collected', evidence }); };
  const add = (row: Omit<CoverageRow, 'ref' | 'result'>, observed: boolean, detail: string, evidenceRefs: readonly string[], unavailable = false) => {
    const index = rows.length, resultRef = `coverage:result:${index}`, check: RequirementCheck = {
      checkRef: `coverage:check:${index}`, disposition: observed ? 'checked-pass' : 'unreachable',
      ...(!observed ? { reason: 'not-collected' as const } : {}), detail,
      evidenceRefs, attemptRefs: [],
    };
    const binding = { id: resultRef, requirementRef: row.requirementRef, findingRef, windowRef,
      affects: [findingRef], evidenceRefs, detail, checks: observed || unavailable ? [check] : [], actionRefs: [] };
    results.push(observed ? { ...binding, state: 'satisfied' } : { ...binding, state: 'unresolved', reason: 'not-collected' });
    rows.push({ ...row, ref: resultRef });
  };
  const inventoryKnown = Boolean(declaration?.complete && source.scopes.length);
  add({ requirementRef: 'coverage:inventory', label: 'Expected flow inventory',
    description: declaration?.description ?? 'The expected execution inventory has not been supplied for this record.',
    state: inventoryKnown ? 'observed' : 'unknown' }, inventoryKnown,
  inventoryKnown ? 'coverage:inventory-declared' : 'coverage:inventory-not-collected',
  declaration ? [declaration.definitionRef] : [], !declaration || !source.scopes.length);
  if (!inventoryKnown) addGap(declaration ? [declaration.definitionRef] : []);
  if (source.incomplete) addGap(['source#/incomplete']);
  if (declaration) {
    const sourceScopes = new Map(source.scopes.map((scope, index) => [addressKey(scope.address), { scope, index }]));
    for (const expectedScope of declaration.scopes) {
      const actual = sourceScopes.get(addressKey(expectedScope.address));
      for (const expected of expectedScope.steps) {
        const commits = actual?.scope.commitLog.flatMap((commit, index) => (commit as { stageId: string }).stageId === expected.stageId ? [`source#/scopes/${actual.index}/commitLog/${index}`] : []) ?? [];
        // A retained commit is enough to prove observed execution; it does not prove success or this resume leg.
        const observed = commits.length > 0;
        const evidence = observed ? commits.slice(0, 16) : [declaration.definitionRef, 'source#/scopes'];
        add({ requirementRef: expected.ref, ...(actual ? { scopeIndex: actual.index } : {}), label: expected.label,
          ...(expected.description === undefined ? {} : { description: expected.description }),
          state: observed ? 'observed' : actual ? 'not-observed' : 'unknown' }, observed,
        observed ? 'coverage:execution-observed' : actual ? 'coverage:execution-not-collected' : 'coverage:scope-not-collected', evidence, !actual);
        if (!observed) addGap(evidence);
      }
    }
  }
  try {
    const admitted = readRequirementResults(results);
    return freezeCoverage({ version: 1, ...(declaration ? { declaration } : {}),
      rows: rows.map((row, index) => ({ ...row, result: admitted[index]! })), results: admitted, gaps });
  } catch { throw new CoverageRecordingError(); }
}
