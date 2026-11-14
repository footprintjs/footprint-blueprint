import { test } from 'vitest';
import assert from 'node:assert/strict';
import { diagnoseFailureRecording, formatFailureExplanation, createFailureExplanation } from '../../index.js';
import { privateError, recording } from './fixtures.js';
const refuses = (work: () => unknown) => assert.throws(work, error => ['EXPLANATION_INVALID', 'EXPLANATION_LIMIT'].includes((error as { code?: string }).code ?? ''));

test('defaults retain the original diagnosis, evidence and unknown physical root', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const view = formatFailureExplanation(diagnosis);
  assert.equal(view.problem.text, diagnosis.summary);
  assert.equal(view.recordedCause.text, diagnosis.causes.map(item => item.summary).join(' '));
  assert.deepEqual(view.unknowns, diagnosis.unknowns);
  assert.deepEqual(view.coverage, diagnosis.coverage);
  assert.deepEqual(view.evidenceRefs, diagnosis.evidenceRefs);
  assert.equal(view.coverage.upstreamRootCause, 'unknown');
  assert.equal(view.template.reason, 'no-templates');
  assert(!JSON.stringify(view).includes(privateError));
});

test('exact code and status select supplementary wording without replacing a canonical observation', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const view = formatFailureExplanation(diagnosis, { templates: [{ id: 'auth-help', when: { status: diagnosis.status, findingCode: 'AUTH_REJECTION_RECORDED' },
    problem: 'The operation needs attention.', recordedCause: 'Configured wording for {{findingCode}}.',
    suggestedNextStep: 'Ask an administrator to check access.' }] });
  assert.equal(view.template.id, 'auth-help');
  assert.equal(view.problem.configuredText, 'The operation needs attention.');
  assert.equal(view.recordedCause.configuredText, 'Configured wording for AUTH_REJECTION_RECORDED.');
  assert.equal(view.recordedCause.wordingSource, 'configured');
  assert.equal(view.recordedCause.text, diagnosis.causes[0]!.summary);
  assert.equal(view.coverage.upstreamRootCause, 'unknown');
});

test('wrong status, wrong code and unavailable placeholders select safe defaults', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  for (const template of [
    { id: 'wrong-status', when: { status: 'ok' as const }, problem: 'Wrong result' },
    { id: 'wrong-code', when: { findingCode: 'UNKNOWN_CODE' }, problem: 'Wrong problem' },
    { id: 'missing-value', when: { status: diagnosis.status }, problem: 'Calls: {{transportAttemptCount}}' },
  ]) {
    const view = formatFailureExplanation(diagnosis, { templates: [template] });
    assert.equal(view.template.outcome, 'default');
    assert.equal(view.problem.configuredText, undefined);
  }
});

test('ambiguous templates and competing causes never depend on array order', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const templates = [{ id: 'first', when: { status: diagnosis.status }, problem: 'One' }, { id: 'second', when: { status: diagnosis.status }, problem: 'Two' }];
  for (const values of [templates, [...templates].reverse()]) {
    const view = formatFailureExplanation(diagnosis, { templates: values });
    assert.equal(view.template.reason, 'ambiguous-templates');
    assert.equal(view.problem.configuredText, undefined);
  }
  const competing = diagnoseFailureRecording(await recording({ calls: 2 }));
  assert.equal(competing.causes.length, 2);
  const view = formatFailureExplanation(competing, { templates: [{ id: 'single', when: { findingCode: 'AUTH_REJECTION_RECORDED' }, recordedCause: 'Only one cause' }] });
  assert.equal(view.template.reason, 'ambiguous-findings');
  assert.equal(view.recordedCause.configuredText, undefined);
});

test('consequence templates can offer advice without claiming they are the recorded cause', async () => {
  const diagnosis = diagnoseFailureRecording(await recording({ status: 503, write: true }));
  assert(diagnosis.consequences.some(item => item.code === 'UNKNOWN_EXTERNAL_EFFECT_RECORDED'));
  const view = formatFailureExplanation(diagnosis, { templates: [{ id: 'reconcile', when: { status: 'unknown', findingCode: 'UNKNOWN_EXTERNAL_EFFECT_RECORDED' },
    problem: 'A write needs checking.', recordedCause: 'A claimed root', suggestedNextStep: 'Consult the original operation record.' }] });
  assert.equal(view.template.outcome, 'configured');
  assert.equal(view.recordedCause.configuredText, undefined);
  assert.equal(view.suggestedNextStep.text, diagnosis.recommendations[0]);
  assert.match(view.suggestedNextStep.text, /Reconcile/);
  assert.equal(view.coverage.externalEffect, 'unknown');
  assert.deepEqual(view.unknowns, diagnosis.unknowns);
});

test('missing evidence cannot acquire a configured cause and supplementary copy has no authority fields', async () => {
  const diagnosis = diagnoseFailureRecording(await recording({ missing: true }));
  const view = formatFailureExplanation(diagnosis, { templates: [{ id: 'unknown', when: { status: 'unknown' },
    problem: 'Please inspect this operation.', recordedCause: 'A made-up outage', suggestedNextStep: 'Collect the missing recording.' }] });
  assert.equal(view.recordedCause.configuredText, undefined);
  assert.equal(view.coverage.upstreamRootCause, 'unknown');
  assert.equal(view.status, 'unknown');
  assert.match(view.recordedCause.text, /unknown|not recorded/i);
  refuses(() => formatFailureExplanation(diagnosis, { templates: [{ id: 'bad', when: { status: 'unknown' }, confidence: 'complete' } as never] }));
});

test('static templates reject executable or unsupported syntax without invoking getters', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  let getters = 0;
  const template = { id: 'hostile', when: { status: diagnosis.status } };
  Object.defineProperty(template, 'problem', { enumerable: true, get() { getters++; return 'secret'; } });
  refuses(() => formatFailureExplanation(diagnosis, { templates: [template] }));
  assert.equal(getters, 0);
  for (const problem of ['{{constructor}}', '{{coverage.externalEffect}}', '{{status()}}'])
    refuses(() => formatFailureExplanation(diagnosis, { templates: [{ id: 'syntax', when: { status: diagnosis.status }, problem }] }));
});

test('template counts, text bytes and placeholder counts are bounded', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const value = { id: 'bound', when: { status: diagnosis.status }, problem: 'A short explanation.' };
  refuses(() => formatFailureExplanation(diagnosis, { templates: Array.from({ length: 33 }, (_, index) => ({ ...value, id: 'bound-' + index })) }));
  refuses(() => formatFailureExplanation(diagnosis, { templates: [{ ...value, problem: '🙂'.repeat(251) }] }));
  refuses(() => formatFailureExplanation(diagnosis, { templates: [{ ...value, problem: '{{status}}'.repeat(9) }] }));
});

test('mutable caller data is copied and the complete returned view is frozen', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const options = { templates: [{ id: 'copy', when: { status: diagnosis.status }, problem: 'Original words' }] };
  const pending = createFailureExplanation(await recording(), options);
  options.templates[0]!.problem = 'Later words';
  const view = await pending;
  assert.equal(view.problem.configuredText, 'Original words');
  assert(Object.isFrozen(view)); assert(Object.isFrozen(view.problem)); assert(Object.isFrozen(view.coverage)); assert(Object.isFrozen(view.unknowns));
});

test('the async chart facade and synchronous formatter return the same explanation', async () => {
  const value = await recording(), options = { templates: [{ id: 'auth', when: { findingCode: 'AUTH_REJECTION_RECORDED' }, problem: 'Access needs checking.' }] };
  const expected = formatFailureExplanation(diagnoseFailureRecording(value), options);
  assert.deepEqual(await createFailureExplanation(value, options), expected);
});

test('a recording with no boundary calls keeps unknown defaults instead of refusing the legitimate diagnosis', async () => {
  const diagnosis = diagnoseFailureRecording(await recording({ calls: 0 }));
  assert.equal(diagnosis.coverage.externalEffect, 'unknown');
  const view = formatFailureExplanation(diagnosis);
  assert.equal(view.status, 'unknown');
  assert.deepEqual(view.unknowns, diagnosis.unknowns);
  assert.equal(view.recordedCause.configuredText, undefined);
});

test('a cause-only template without an evidenced cause is not reported as applied', async () => {
  const diagnosis = diagnoseFailureRecording(await recording({ missing: true }));
  const view = formatFailureExplanation(diagnosis, { templates: [{ id: 'cause-only', when: { status: 'unknown' }, recordedCause: 'No evidence supports these words.' }] });
  assert.equal(view.template.outcome, 'default');
  assert.equal(view.template.reason, 'unavailable-facts');
});

test('canonical uncertainty cannot be removed by a formatter caller', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  refuses(() => formatFailureExplanation({ ...diagnosis, unknowns: [] }));
  refuses(() => formatFailureExplanation({ ...diagnosis, coverage: { ...diagnosis.coverage, upstreamRootCause: 'known' } } as never));
});

test('unknown effects suppress configured retry advice and do not count withheld-only wording as applied', async () => {
  const diagnosis = diagnoseFailureRecording(await recording({ status: 503, write: true }));
  for (const template of [
    { id: 'unsafe-only', when: { status: 'unknown' as const }, suggestedNextStep: 'Retry now' },
    { id: 'unsafe-with-problem', when: { status: 'unknown' as const }, problem: 'A write needs checking.', suggestedNextStep: 'Retry now' },
  ]) {
    const view = formatFailureExplanation(diagnosis, { templates: [template] });
    assert(!JSON.stringify(view).includes('Retry now'));
    assert.match(view.suggestedNextStep.text, /^Reconcile/);
    assert.equal(view.suggestedNextStep.configuredText, undefined);
    if (template.id === 'unsafe-only') assert.equal(view.template.reason, 'unavailable-facts');
  }
  const unsafeRecommendations = { ...diagnosis, recommendations: ['Retry now'] };
  assert.match(formatFailureExplanation(unsafeRecommendations).suggestedNextStep.text, /^Reconcile/);
});

test('cyclic, prototype-bearing, sparse and duplicate configuration is refused without runtime field interpolation', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const value = { id: 'same', when: { status: diagnosis.status }, problem: 'Plain words' };
  refuses(() => formatFailureExplanation(diagnosis, { templates: [value, value] }));
  refuses(() => formatFailureExplanation(diagnosis, { templates: new Array(1) }));
  refuses(() => formatFailureExplanation(diagnosis, Object.create({ templates: [value] })));
  const cycle: Record<string, unknown> = {}; cycle.templates = cycle;
  refuses(() => formatFailureExplanation(diagnosis, cycle));
  const getterDiagnosis = { ...diagnosis };
  let reads = 0;
  Object.defineProperty(getterDiagnosis, 'summary', { enumerable: true, get() { reads++; return privateError; } });
  refuses(() => formatFailureExplanation(getterDiagnosis));
  assert.equal(reads, 0);
});

test('an output limit refuses the whole canonical presentation instead of trimming evidence', async () => {
  const diagnosis = diagnoseFailureRecording(await recording());
  const causes = Array.from({ length: 70 }, () => ({ ...diagnosis.causes[0]!, summary: 'x'.repeat(4096) }));
  refuses(() => formatFailureExplanation({ ...diagnosis, causes }));
});
