import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagnoseFailureRecording, formatFailureExplanation } from '../../index.js';
import type { FailureDiagnosis, FailureFinding, FailureExplanationOptions } from '../../index.js';
import { recording } from './fixtures.js';

const buckets = ['causes', 'consequences', 'diagnosticFailures'] as const;
async function failedDiagnosis() {
  // Native/boundary facts are genuine local observations; these two diagnostic
  // states are explicit host reports, not a claim that a storage service failed.
  const value = await recording({ status: 503, write: true });
  const reported = { ...value, diagnostics: { persistence: 'failed', observer: 'failed' } };
  return diagnoseFailureRecording(JSON.parse(JSON.stringify(reported)));
}
function assertFindings(view: ReturnType<typeof formatFailureExplanation>, diagnosis: FailureDiagnosis) {
  assert.deepEqual(view.canonicalFindings, Object.fromEntries(buckets.map(bucket => [bucket, diagnosis[bucket]])));
  for (const bucket of buckets) {
    assert(diagnosis[bucket].length > 0, `The genuine ${bucket} witness must not be empty`);
    for (const finding of diagnosis[bucket]) {
      const retained: FailureFinding | undefined = view.canonicalFindings[bucket].find(row => row.code === finding.code && row.summary === finding.summary);
      assert(retained);
      assert.deepEqual(retained.evidenceRefs, finding.evidenceRefs);
    }
  }
}

for (const mode of ['no-templates', 'ambiguous-templates'] as const) {
  test(`retains every canonical finding when ${mode} prevents configured wording`, async () => {
    const diagnosis = await failedDiagnosis();
    const options: FailureExplanationOptions | undefined = mode === 'no-templates' ? undefined : { templates: [
      { id: 'one', when: { status: diagnosis.status }, problem: 'First optional wording' },
      { id: 'two', when: { status: diagnosis.status }, problem: 'Second optional wording' },
    ] };
    const view = formatFailureExplanation(diagnosis, options);
    assert.equal(view.template.reason, mode);
    assertFindings(view, diagnosis);
    assert.equal(view.recordedCause.text, diagnosis.causes.map(row => row.summary).join(' '));
    assert.deepEqual(view.unknowns, diagnosis.unknowns);
    assert.equal(view.coverage.externalEffect, 'unknown');
    assert.equal(view.coverage.upstreamRootCause, 'unknown');
    assert.match(view.suggestedNextStep.text, /^Reconcile/);
    assert.equal(view.suggestedNextStep.configuredText, undefined);
  });
}

test('canonical findings detach caller arrays, rows and references and freeze the entire retained result', async () => {
  const diagnosis = await failedDiagnosis();
  const mutableRows = (bucket: typeof buckets[number]) => diagnosis[bucket].map(row => ({ ...row, evidenceRefs: [...row.evidenceRefs] }));
  const input = { ...diagnosis, causes: mutableRows('causes'), consequences: mutableRows('consequences'), diagnosticFailures: mutableRows('diagnosticFailures') };
  const view = formatFailureExplanation(input);
  assertFindings(view, diagnosis);
  assert(Object.isFrozen(view.canonicalFindings));
  for (const bucket of buckets) {
    assert.notEqual(view.canonicalFindings[bucket], input[bucket]);
    assert(Object.isFrozen(view.canonicalFindings[bucket]));
    for (let index = 0; index < input[bucket].length; index++) {
      const original = input[bucket][index]!, retained = view.canonicalFindings[bucket][index]!;
      assert.notEqual(retained, original); assert.notEqual(retained.evidenceRefs, original.evidenceRefs);
      assert(Object.isFrozen(retained)); assert(Object.isFrozen(retained.evidenceRefs));
      original.summary = 'Later caller edit'; original.evidenceRefs.push('later-reference');
    }
  }
  assertFindings(view, diagnosis);
});

test('the whole-output budget includes canonical findings rather than silently omitting them', async () => {
  const diagnosis = await failedDiagnosis();
  // Synthetic admitted DTO text isolates the output limit; it is not evidence
  // of seventy observed service failures. Its references remain admitted ones.
  const consequences = Array.from({ length: 70 }, () => ({ ...diagnosis.consequences[0]!, summary: 'x'.repeat(4096) }));
  assert.throws(() => formatFailureExplanation({ ...diagnosis, consequences }),
    error => (error as { code?: string }).code === 'EXPLANATION_LIMIT');
});
