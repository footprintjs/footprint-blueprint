import { describe, expect, it } from 'vitest';
import { FlowChartBuilder, FlowChartExecutor } from 'footprintjs';
import { readRequirementResults } from 'foottrace';
import { createCauseCapture, createRecordedCauseReader, recordedCauseScopes } from '../cause.js';
import { readRecordedCoverage, type CoverageDeclaration } from '../coverage.js';

const quiet = { log() {}, debug() {}, info() {}, warn() {}, error() {} };
async function recording(fail = false) {
  const executor = new FlowChartExecutor(new FlowChartBuilder().start('Same label', scope => { scope.a = 1; }, 'first')
    .addFunction('Same label', scope => { if (fail) throw new Error('PRIVATE'); scope.b = scope.a; }, 'second')
    .addFunction('Last', scope => { scope.c = scope.b; }, 'last').setLogger(quiet).build(),
  { readTracking: 'summary', writeTracking: 'summary', writeProvenance: 'reads-prefix' });
  const capture = createCauseCapture(); executor.attachFlowRecorder(capture.recorder);
  await executor.run().catch(() => {});
  const snapshot = executor.getSnapshot({ redact: true });
  return { snapshot, capture: capture.snapshot(snapshot), source: recordedCauseScopes(snapshot, capture.snapshot(snapshot)) };
}
function definition(runId: string): CoverageDeclaration {
  return { version: 1, runId, definitionRef: 'definition:orders-v1', label: 'Order process', description: 'Checks recorded execution coverage.', complete: true,
    scopes: [{ ref: 'scope:root', address: { logRunId: runId, drillPath: [] }, steps: [
      { ref: 'requirement:first', stageId: 'first', label: 'Same label', description: 'Prepare the order.' },
      { ref: 'requirement:second', stageId: 'second', label: 'Same label', description: 'Confirm the provider result.' },
      { ref: 'requirement:last', stageId: 'last', label: 'Last', description: 'Notify the owner.' },
    ] }] };
}
const input = (source: any, declaration?: CoverageDeclaration) => ({ source, declaration, findingRef: 'finding:investigation', windowRef: 'window:record' });

describe('expected and observed recording coverage', () => {
  it('keeps descriptions separate and admits all results through the shared contract', async () => {
    const run = await recording(), result = readRecordedCoverage(input(run.source, definition(run.snapshot.runId)));
    expect(result.rows.map(row => row.state)).toEqual(['observed', 'observed', 'observed', 'observed']);
    expect(result.rows[1]!.description).toBe('Prepare the order.');
    expect(JSON.stringify(result.results)).not.toContain('Prepare the order.');
    expect(readRequirementResults(result.results)).toEqual(result.results);
    expect(result.rows[1]!.result.checks[0]!.attemptRefs).toEqual([]);
    expect(result.rows[1]!.result.checks[0]!.evidenceRefs).toContain('source#/scopes/0/commitLog/0');
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.rows[1]!.result)).toBe(true);
  });

  it('does not turn absence after real early failure into skipped, success or proved blocking', async () => {
    const run = await recording(true), result = readRecordedCoverage(input(run.source, definition(run.snapshot.runId)));
    const last = result.rows.find(row => row.requirementRef === 'requirement:last')!;
    expect(last.state).toBe('not-observed');
    expect(last.result).toMatchObject({ state: 'unresolved', reason: 'not-collected' });
    expect(last.result.checks).toEqual([]);
    expect(last.result.detail).toBe('coverage:execution-not-collected');
    expect(result.gaps.some(gap => gap.code === 'not-collected')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('keeps a real unselected branch visible without inferring not-applicable from its name', async () => {
    const chart = new FlowChartBuilder().start('Start', scope => { scope.ready = true; }, 'first')
      .addDeciderFunction('Route', () => 'chosen', 'route')
      .addFunctionBranch('chosen', 'Same label', scope => { scope.chosen = true; })
      .addFunctionBranch('other', 'Same label', scope => { scope.other = true; }).end().setLogger(quiet).build();
    const capture = createCauseCapture(), executor = new FlowChartExecutor(chart, { readTracking: 'summary', writeTracking: 'summary', writeProvenance: 'reads-prefix' });
    executor.attachFlowRecorder(capture.recorder); await executor.run();
    const snapshot = executor.getSnapshot({ redact: true }), source = recordedCauseScopes(snapshot, capture.snapshot(snapshot));
    const declaration = definition(snapshot.runId); (declaration.scopes[0] as any).steps = [
      { ref: 'requirement:chosen', stageId: 'chosen', label: 'Same label', description: 'Selected delivery path.' },
      { ref: 'requirement:other', stageId: 'other', label: 'Same label', description: 'Alternative delivery path.' },
    ];
    const result = readRecordedCoverage(input(source, declaration));
    expect(result.rows[1]!.state).toBe('observed');
    expect(result.rows[2]).toMatchObject({ state: 'not-observed', description: 'Alternative delivery path.', result: { state: 'unresolved', reason: 'not-collected' } });
    expect(result.results.flatMap(row => row.checks).every(check => check.disposition !== 'not-applicable')).toBe(true);
  });

  it('reports missing or partial declarations and unavailable declared scopes explicitly', async () => {
    const run = await recording();
    const missing = readRecordedCoverage(input(run.source));
    expect(missing.rows).toHaveLength(1); expect(missing.rows[0]!.state).toBe('unknown');
    expect(missing.results[0]).toMatchObject({ state: 'unresolved', reason: 'not-collected' });
    const partial = definition(run.snapshot.runId); (partial as any).complete = false;
    expect(readRecordedCoverage(input(run.source, partial)).results[0]).toMatchObject({ state: 'unresolved', reason: 'not-collected', checks: [] });
    const unavailable = definition(run.snapshot.runId); (unavailable.scopes[0]!.address as any).drillPath = ['unretained#1'];
    const rows = readRecordedCoverage(input(run.source, unavailable)).rows;
    expect(rows[1]).toMatchObject({ state: 'unknown', result: { state: 'unresolved', reason: 'not-collected' } });
    expect(rows[1]!.result.checks[0]).toMatchObject({ disposition: 'unreachable', reason: 'not-collected', detail: 'coverage:scope-not-collected' });
  });

  it('matches exact scope and stable stage ID instead of equal display names', async () => {
    const run = await recording(), declaration = definition(run.snapshot.runId);
    (declaration.scopes[0]!.steps[1] as any).stageId = 'missing';
    const result = readRecordedCoverage(input(run.source, declaration));
    expect(result.rows[1]!.state).toBe('observed'); expect(result.rows[2]!.state).toBe('not-observed');
    (declaration.scopes[0]!.address as any).logRunId = 'other-run';
    expect(() => readRecordedCoverage(input(run.source, declaration))).toThrow('Coverage recording is unavailable');
  });

  it('does not borrow evidence from another mount with the same stage ID', async () => {
    const run = await recording(), source = structuredClone(run.source), declaration = definition(run.snapshot.runId);
    source.scopes.push({ address: { logRunId: run.snapshot.runId, drillPath: ['mount#9'] }, commitLog: [] });
    (declaration.scopes as any).push({ ref: 'scope:mount', address: { logRunId: run.snapshot.runId, drillPath: ['mount#9'] },
      steps: [{ ref: 'requirement:mounted-first', stageId: 'first', label: 'Same label' }] });
    const result = readRecordedCoverage(input(source, declaration));
    expect(result.rows.find(row => row.requirementRef === 'requirement:first')!.state).toBe('observed');
    expect(result.rows.find(row => row.requirementRef === 'requirement:mounted-first')!.state).toBe('not-observed');
  });

  it('retains explicit unknown coverage on a real resumed execution', async () => {
    const chart = new FlowChartBuilder().start('Start', scope => { scope.started = true; }, 'first')
      .addPausableFunction('Approve', { execute: () => ({ question: 'synthetic' }), resume: scope => { scope.approved = true; } }, 'wait')
      .addFunction('Last', scope => { scope.done = true; }, 'last').setLogger(quiet).build();
    const capture = createCauseCapture(), executor = new FlowChartExecutor(chart, { readTracking: 'summary', writeTracking: 'summary', writeProvenance: 'reads-prefix' });
    executor.attachFlowRecorder(capture.recorder); await executor.run(); await executor.resume(executor.getCheckpoint()!, {});
    const snapshot = executor.getSnapshot({ redact: true }), source = recordedCauseScopes(snapshot, capture.snapshot(snapshot));
    expect(source.incomplete).toBe(true);
    const result = readRecordedCoverage(input(source, definition(snapshot.runId)));
    expect(result.gaps).toContainEqual({ code: 'not-collected', evidence: ['source#/incomplete'] });
    expect(result.rows.find(row => row.requirementRef === 'requirement:last')!.state).toBe('observed');
  });

  it('rejects duplicate declarations, excessive descriptions and inert-data attacks without invoking getters', async () => {
    const run = await recording(); let touched = false;
    const hostile = Object.defineProperty({}, 'source', { enumerable: true, get() { touched = true; throw new Error('PRIVATE'); } });
    expect(() => readRecordedCoverage(hostile as any)).toThrow('Coverage recording is unavailable'); expect(touched).toBe(false);
    const duplicate = definition(run.snapshot.runId); (duplicate.scopes[0]!.steps as any).push(duplicate.scopes[0]!.steps[0]);
    expect(() => readRecordedCoverage(input(run.source, duplicate))).toThrow();
    const long = definition(run.snapshot.runId); (long.scopes[0]!.steps[0] as any).description = 'x'.repeat(1025);
    expect(() => readRecordedCoverage(input(run.source, long))).toThrow();
    expect(() => readRecordedCoverage(input(run.source, { ...definition(run.snapshot.runId), extra: 'PRIVATE' } as any))).toThrow();
  });

  it('rejects cyclic, sparse, proxy and oversized inputs with value-free refusals', async () => {
    const run = await recording(), cyclic: any = input(run.source); cyclic.extra = cyclic;
    const sparse = definition(run.snapshot.runId); (sparse.scopes as any) = new Array(1);
    const proxy = new Proxy({}, { ownKeys() { throw new Error('PRIVATE'); } });
    for (const value of [cyclic, input(run.source, sparse), proxy]) {
      expect(() => readRecordedCoverage(value as any)).toThrow('Coverage recording is unavailable');
    }
    const excessive = definition(run.snapshot.runId); (excessive.scopes[0] as any).steps = Array.from({ length: 257 }, (_, n) => ({ ref: `r:${n}`, stageId: `stage-${n}`, label: 'Step' }));
    expect(() => readRecordedCoverage(input(run.source, excessive))).toThrow('Coverage recording is unavailable');
  });

  it('rejects custom array prototypes before inherited iterator or array methods can execute', async () => {
    const run = await recording(), declaration = definition(run.snapshot.runId);
    let inheritedReads = 0;
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, Symbol.iterator, { get() { inheritedReads++; return Array.prototype[Symbol.iterator]; } });
    Object.defineProperty(prototype, 'forEach', { get() { inheritedReads++; return Array.prototype.forEach; } });
    Object.setPrototypeOf(declaration.scopes, prototype);
    expect(() => readRecordedCoverage(input(run.source, declaration))).toThrow('Coverage recording is unavailable');
    expect(inheritedReads).toBe(0);
  });

  it('returns detached data and never copies native display labels or payloads into the coverage report', async () => {
    const run = await recording(), source = structuredClone(run.source), declaration = definition(run.snapshot.runId);
    (source.scopes[0]!.commitLog[0] as any).stage = 'PRIVATE@example.invalid';
    const result = readRecordedCoverage(input(source, declaration));
    (declaration.scopes[0]!.steps[0] as any).description = 'Changed after reading';
    expect(result.rows[1]!.description).toBe('Prepare the order.');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(Object.isFrozen(declaration)).toBe(false);
  });

  it('does not mutate captures or change existing healthy cause queries', async () => {
    const run = await recording(), before = JSON.stringify({ snapshot: run.snapshot, capture: run.capture, source: run.source });
    const reader = createRecordedCauseReader(run.source), node = reader.nodes[0]!;
    const causeBefore = JSON.stringify(await reader.explain(node.id));
    readRecordedCoverage(input(run.source, definition(run.snapshot.runId)));
    expect(JSON.stringify({ snapshot: run.snapshot, capture: run.capture, source: run.source })).toBe(before);
    expect(JSON.stringify(await reader.explain(node.id))).toBe(causeBefore);
  });
});
