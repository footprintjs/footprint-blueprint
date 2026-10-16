import { describe, it, expect, vi } from 'vitest';
import { FlowChartExecutor } from 'footprintjs';
import footprintPackage from 'footprintjs/package.json' with { type: 'json' };
import { createActionRegistry } from '../../actionRegistry.js';
import { createActionExecutor } from '../../actionExecutor.js';
import { validateActionInput, ActionInputError } from '../../validation.js';
import type { ActionDefinition } from '../../types.js';
const context = { tenantId: 'tenant', profileType: 'brand', unitId: 'store', userId: 'admin' };
const action: ActionDefinition = {
  id: 'publish', name: 'Publish', description: 'Publish acknowledged content', domain: 'content', category: 'workflow', requiredModules: ['editor'], parameters: [], requiredPermissions: ['content:publish'],
  inputSchema: { type: 'object', additionalProperties: false, required: ['expectedRevision', 'tags'], properties: { expectedRevision: { type: 'integer', minimum: 0 }, tags: { type: 'array', maxItems: 2, items: { type: 'string', minLength: 1 } }, email: { type: 'string', format: 'email' } } },
};
const registry = () => createActionRegistry({ actions: [action] });
describe('trusted runtime boundary', () => {
  it('denies missing/false/throwing authorizers and cannot grant access through input', async () => {
    for (const authorizer of [undefined, () => false, () => { throw new Error('denied'); }]) {
      const write = vi.fn(async () => 'written');
      const executor = createActionExecutor(registry(), undefined, { authorizer, handlers: { publish: write } });
      const result = await executor.execute('publish', { expectedRevision: 0, tags: [], admin: true }, context);
      expect(result.status).toBe('error'); expect(write).not.toHaveBeenCalled();
    }
  });
  it('AJV rejects invalid nested values, additional fields, numeric strings and formats before any write', async () => {
    const write = vi.fn(async () => 'written');
    const executor = createActionExecutor(registry(), undefined, { authorizer: () => true, handlers: { publish: write } });
    for (const input of [{ expectedRevision: '0', tags: [] }, { expectedRevision: -1, tags: [] }, { expectedRevision: 0, tags: [42] }, { expectedRevision: 0, tags: ['a', 'b', 'c'] }, { expectedRevision: 0, tags: [], admin: true }, { expectedRevision: 0, tags: [], email: 'secret-invalid-email' }]) {
      const result = await executor.execute('publish', input, context);
      expect(result.errorCode).toBe('ACTION_INPUT_INVALID'); expect(result.httpStatus).toBe(400);
    }
    expect(write).not.toHaveBeenCalled();
    try { validateActionInput(registry().getAction('publish')!, { email: 'secret' }); } catch (error) { expect(error).toBeInstanceOf(ActionInputError); expect(JSON.stringify(error)).not.toContain('secret'); }
  });
  it('runs real Footprint 10 stages with private payloads, unique concurrent runs and honored recorder', async () => {
    const record = vi.fn(async () => {});
    const executor = createActionExecutor(registry(), undefined, { authorizer: () => true, handlers: { publish: async () => ({ privateToken: 'provider-secret' }) }, traceRecorder: { record } });
    const results = await Promise.all([0, 1].map(expectedRevision => executor.execute('publish', { expectedRevision, tags: ['customer-secret'], email: 'private@example.com' }, context)));
    expect(record).toHaveBeenCalledTimes(2);
    expect(new Set(results.map(result => result.executionTrace?.runId)).size).toBe(2);
    for (const result of results) {
      expect(result.status).toBe('success'); expect(result.result).toEqual({ privateToken: 'provider-secret' });
      expect(result.executionTrace?.runtime).toEqual({ library: 'footprintjs', version: footprintPackage.version });
      expect(result.executionTrace?.stageMetrics?.map(metric => metric.stageName)).toEqual(['AuthorizeAction', 'ValidateInput', 'ExecuteAction', 'AcknowledgeAction']);
      const snapshot = result.executionTrace?.executionSnapshot as { commitLog: { stageId: string }[]; sharedState: unknown };
      expect(snapshot.commitLog.map(commit => commit.stageId)).toEqual(['authorize-action', 'validate-input', 'execute-action', 'acknowledge-action']);
      expect(snapshot.sharedState).toEqual({});
      const recorded = JSON.stringify(result.executionTrace);
      for (const privateValue of ['customer-secret', 'provider-secret', 'private@example.com']) expect(recorded).not.toContain(privateValue);
    }
  });
  it('preserves an acknowledged write when the trace recorder and error callback throw', async () => {
    const write = vi.fn(async () => 'saved');
    const callback = vi.fn(() => { throw new Error('observer failed'); });
    const result = await createActionExecutor(registry(), undefined, { authorizer: () => true, handlers: { publish: write }, traceRecorder: { record: async () => { throw new Error('record failed'); } }, onTraceError: callback }).execute('publish', { expectedRevision: 0, tags: [] }, context);
    expect(result.status).toBe('success'); expect(result.result).toBe('saved'); expect(write).toHaveBeenCalledOnce(); expect(callback).toHaveBeenCalledOnce();
  });
  it('preserves known success when SDK run/snapshot diagnostics fail after the handler commits', async () => {
    const nativeRun = FlowChartExecutor.prototype.run;
    const write = vi.fn(async () => 'saved');
    const observer = vi.fn();
    const run = vi.spyOn(FlowChartExecutor.prototype, 'run').mockImplementation(async function (options) {
      await nativeRun.call(this, options);
      throw new Error('post-commit SDK observer failed');
    });
    const snapshot = vi.spyOn(FlowChartExecutor.prototype, 'getSnapshot').mockImplementation(() => { throw new Error('snapshot failed'); });
    try {
      const result = await createActionExecutor(registry(), undefined, { authorizer: () => true, handlers: { publish: write }, onTraceError: observer }).execute('publish', { expectedRevision: 0, tags: [] }, context);
      expect(result.status).toBe('success'); expect(result.result).toBe('saved'); expect(write).toHaveBeenCalledOnce(); expect(observer).toHaveBeenCalledTimes(2);
    } finally { run.mockRestore(); snapshot.mockRestore(); }
  });
  it('cannot use a fallback handler to bypass a missing capability adapter', async () => {
    const definitions = createActionRegistry({ actions: [{ ...action, capabilityId: 'publication' }] });
    const fallback = vi.fn(async () => 'bypassed');
    const result = await createActionExecutor(definitions, undefined, { authorizer: () => true }).execute('publish', { expectedRevision: 0, tags: [] }, context, fallback);
    expect(result.errorCode).toBe('ACTION_IMPLEMENTATION_UNAVAILABLE'); expect(fallback).not.toHaveBeenCalled();
  });
  it('preserves provider code/status/run and private original cause while redacting provider error text from traces', async () => {
    const cause = Object.assign(new Error('private@example.com bearer-token-secret'), { code: 'REVISION_CONFLICT', status: 409, traceRunId: 'provider-run' });
    const result = await createActionExecutor(registry(), undefined, { authorizer: () => true, handlers: { publish: async () => { throw cause; } } }).execute('publish', { expectedRevision: 0, tags: [] }, context);
    expect(result.errorCode).toBe('REVISION_CONFLICT'); expect(result.httpStatus).toBe(409); expect(result.traceRunId).toBe('provider-run'); expect(result.cause).toBe(cause);
    expect(Object.keys(result)).not.toContain('cause'); expect(JSON.stringify(result.executionTrace)).not.toMatch(/private@example|bearer-token-secret/);
  });
  it('discovery filters modules, implementations and trusted authorization, fail closed on no policy', async () => {
    const actions = createActionRegistry({ actions: [action, { ...action, id: 'no-handler' }, { ...action, id: 'denied' }, { ...action, id: 'disabled', requiredModules: ['disabled'] }] });
    const discovery = { enabledModules: new Set(['editor']), context, authorizer: ({ action: candidate }: { action: ActionDefinition }) => candidate.id !== 'denied', hasImplementation: (candidate: ActionDefinition) => candidate.id !== 'no-handler' };
    expect((await actions.toMCPTools(discovery)).map(tool => tool.name)).toEqual(['publish']);
    expect(await actions.toMCPTools({ ...discovery, authorizer: undefined! })).toEqual([]);
    expect(await actions.toMCPTools({ ...discovery, authorizer: () => { throw new Error('no'); } })).toEqual([]);
  });
  it('captures immutable definitions and rejects invalid schemas at registration', () => {
    const supplied = structuredClone(action) as ActionDefinition;
    const actions = createActionRegistry({ actions: [supplied] });
    (supplied.requiredModules as string[]).push('untrusted');
    expect(actions.getAction('publish')?.requiredModules).toEqual(['editor']);
    expect(() => ((actions.getAction('publish')?.inputSchema?.properties as Record<string, unknown>).email = {})).toThrow();
    expect(() => createActionRegistry({ actions: [{ ...action, inputSchema: { type: 'object', unknownKeyword: true } }] })).toThrow();
  });
});
it('captures context synchronously and records the same immutable tenant scope after asynchronous authorization', async () => {
  let release!: (allowed: boolean) => void;
  const authorized = new Promise<boolean>(resolve => { release = resolve; });
  let authorizeStarted!: () => void;
  const started = new Promise<void>(resolve => { authorizeStarted = resolve; });
  const supplied = { tenantId: 'tenant-old', campusId: 'campus-old', unitId: 'unit-old', userId: 'user-private', profileType: 'brand-old', meta: { permission: 'original' } };
  const seen: unknown[] = [];
  const record = vi.fn(async () => {});
  const executor = createActionExecutor(registry(), undefined, {
    authorizer: async ({ context }) => { seen.push(context); authorizeStarted(); return authorized; },
    handlers: { publish: async (_id, _input, context) => { seen.push(context); return 'saved'; } },
    traceRecorder: { record },
  });
  const pending = executor.execute('publish', { expectedRevision: 0, tags: [] }, supplied);
  // Even mutations before the SDK's first async authorization callback cannot change capture.
  supplied.tenantId = 'tenant-new'; supplied.campusId = 'campus-new'; supplied.unitId = 'unit-new'; supplied.profileType = 'brand-new'; supplied.userId = 'changed-private'; supplied.meta.permission = 'changed';
  await started; release(true);
  const result = await pending;
  expect(result.status).toBe('success');
  for (const context of seen) {
    expect(context).toMatchObject({ tenantId: 'tenant-old', campusId: 'campus-old', unitId: 'unit-old', userId: 'user-private', profileType: 'brand-old', meta: { permission: 'original' } });
    expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen((context as any).meta)).toBe(true);
  }
  expect(result.trace).toMatchObject({ tenantId: 'tenant-old', campusId: 'campus-old', unitId: 'unit-old', profileType: 'brand-old' });
  const scope = record.mock.calls[0]?.[1];
  expect(scope).toMatchObject({ tenantId: 'tenant-old', campusId: 'campus-old', unitId: 'unit-old', profileType: 'brand-old' });
  expect(Object.isFrozen(scope)).toBe(true); expect(scope).not.toHaveProperty('userId'); expect(scope).not.toHaveProperty('meta');
  expect(JSON.stringify(record.mock.calls)).not.toMatch(/user-private|changed-private|tenant-new|campus-new|unit-new/);
});
