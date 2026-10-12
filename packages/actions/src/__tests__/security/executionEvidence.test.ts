import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { FlowChartExecutor } from 'footprintjs';
import { createActionExecutor } from '../../actionExecutor.js';
import { createActionRegistry } from '../../actionRegistry.js';
import { validateExecutionEvidence } from '../../evidence.js';
import type { ActionDefinition, ActionExecutionContext } from '../../types.js';

const action: ActionDefinition = {
  id: 'reserve', name: 'Reserve', description: 'Request an acknowledged reservation',
  domain: 'scheduling', category: 'workflow', requiredModules: [], parameters: [],
  inputSchema: { type: 'object', additionalProperties: false, required: ['recordId'], properties: { recordId: { type: 'string', minLength: 1 }, secret: { type: 'string' } } },
};
const context: ActionExecutionContext = { profileType: 'tutoring', unitId: 'studio', tenantId: 'tenant', userId: 'private-actor', meta: { evidence: 'untrusted' } };
const registry = () => createActionRegistry({ actions: [action] });
const input = { recordId: 'resource-1', secret: 'private-request-secret' };

describe('request-local execution evidence', () => {
  it('keeps legacy handlers compatible and preserves native stage snapshots without inventing effects', async () => {
    const result = await createActionExecutor(registry(), undefined, { authorizer: () => true }).execute('reserve', input, context, async (_id, _input, _context) => 'saved');
    expect(result.status).toBe('success');
    expect(result.evidence).toMatchObject({ schemaVersion: 1, runId: result.executionTrace!.runId, engineRunId: result.executionTrace!.runId, actionId: 'reserve', outcome: { status: 'succeeded' }, observations: [], effects: [], links: [] });
    expect(result.evidence).toBe(result.executionTrace?.evidence);
    expect(validateExecutionEvidence(result.evidence).valid).toBe(true);
    const snapshot = result.executionTrace!.executionSnapshot as { runId: string; commitLog: { stageId: string }[] };
    expect(snapshot.runId).toBe(result.evidence?.engineRunId);
    expect(snapshot.commitLog.map(commit => commit.stageId)).toEqual(['authorize-action', 'validate-input', 'execute-action', 'acknowledge-action']);
    expect(JSON.stringify(result.executionTrace)).not.toMatch(/private-request-secret|private-actor|untrusted/);
    expect(Object.isFrozen(result.evidence?.observations)).toBe(true);
  });

  it('performs authorization and schema checks before any actor/request capture', async () => {
    const projectActor = vi.fn(() => 'public-actor');
    const projectRequest = vi.fn(() => ({ recordId: 'resource-1' }));
    const handler = vi.fn(async () => 'saved');
    const options = { projectEvidenceActor: projectActor, projectEvidenceRequest: projectRequest, handlers: { reserve: handler } };
    const denied = await createActionExecutor(registry(), undefined, { ...options, authorizer: () => false }).execute('reserve', input, context);
    expect(denied.evidence?.outcome).toEqual({ status: 'rejected', code: 'ACTION_FORBIDDEN' });
    const invalid = await createActionExecutor(registry(), undefined, { ...options, authorizer: () => true }).execute('reserve', { recordId: 2, secret: 'schema-private' }, context);
    expect(invalid.evidence?.outcome).toEqual({ status: 'rejected', code: 'ACTION_INPUT_INVALID' });
    expect(projectActor).not.toHaveBeenCalled(); expect(projectRequest).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify([denied.executionTrace, invalid.executionTrace])).not.toMatch(/private-request-secret|private-actor|schema-private/);
  });

  it('captures only explicit host-projected payloads and actual handler-reported phases', async () => {
    const result = await createActionExecutor(registry(), undefined, {
      authorizer: () => true,
      projectEvidenceActor: () => 'public-actor',
      projectEvidenceRequest: value => ({ recordId: (value as typeof input).recordId }),
      evidenceOptions: { project: (kind, value) => kind === 'request' ? value as { recordId: string } : { data: { safe: true } } },
    }).execute('reserve', input, context, async (_id, _input, _context, evidence) => {
      expect(evidence).not.toBe(context.meta?.evidence);
      expect(evidence).not.toHaveProperty('finalize');
      expect(evidence!.observe({ kind: 'database', operation: 'find-conflicts', recordIds: ['booking-9'], parameters: { secret: 'private-query' }, data: { secret: 'private-row' } })).toBe(true);
      expect(evidence!.effect({ kind: 'database', operation: 'insert-reservation', recordIds: ['booking-10'], phase: 'applied', count: 1, data: { secret: 'private-effect' } })).toBe(true);
      return 'saved';
    });
    expect(result.evidence).toMatchObject({ actorId: 'public-actor', request: { recordId: 'resource-1' }, observations: [{ recordIds: ['booking-9'] }], effects: [{ recordIds: ['booking-10'], phase: 'applied', count: 1 }] });
    expect(JSON.stringify(result.executionTrace)).not.toMatch(/private-query|private-row|private-effect|private-request-secret|private-actor/);
    expect(result.evidence?.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'committed' })]));
  });

  it('isolates concurrent collectors and links a real inner run only when the host reports it', async () => {
    const inner = createActionExecutor(registry(), undefined, { authorizer: () => true });
    const outer = createActionExecutor(registry(), undefined, {
      authorizer: () => true,
      handlers: { reserve: async (_id, payload, _context, evidence) => {
        const recordId = (payload as typeof input).recordId;
        const child = await inner.execute('reserve', { recordId }, context, async () => 'observed');
        evidence!.observe({ kind: 'database', operation: 'lookup', recordIds: [recordId] });
        evidence!.link({ relation: 'calls', runId: child.executionTrace!.runId });
        return child.executionTrace!.runId;
      } },
    });
    const results = await Promise.all(['resource-1', 'resource-2'].map(recordId => outer.execute('reserve', { recordId }, context)));
    expect(new Set(results.map(result => result.evidence?.runId)).size).toBe(2);
    for (let index = 0; index < results.length; index++) {
      expect(results[index].evidence?.observations).toEqual([expect.objectContaining({ recordIds: [`resource-${index + 1}`] })]);
      expect(results[index].evidence?.links).toEqual([{ relation: 'calls', runId: results[index].result }]);
    }
  });

  it('keeps provider causes private and rejects malformed reports without changing acknowledged success', async () => {
    const recorder = vi.fn(async () => { throw new Error('persistence unavailable'); });
    const observer = vi.fn(() => { throw new Error('observer unavailable'); });
    const success = await createActionExecutor(registry(), undefined, {
      authorizer: () => true,
      evidenceOptions: { project: () => { throw new Error('projection contains private-row-secret'); } },
      traceRecorder: { record: recorder }, onTraceError: observer,
    }).execute('reserve', input, context, async (_id, _input, _context, evidence) => {
      expect(evidence!.effect({ kind: 'database', operation: 'insert', phase: 'applied', count: -1 })).toBe(false);
      expect(evidence!.observe({ kind: 'database', operation: 'query', data: { secret: 'private-row-secret' } })).toBe(false);
      return 'acknowledged';
    });
    expect(success.status).toBe('success'); expect(success.result).toBe('acknowledged');
    expect(success.evidence?.effects).toEqual([]); expect(success.evidence?.observations).toEqual([]);
    expect(JSON.stringify(success.executionTrace)).not.toMatch(/private-row-secret|projection contains/);
    expect(recorder).toHaveBeenCalledOnce(); expect(observer).toHaveBeenCalledOnce();
    const cause = Object.assign(new Error('private-provider-cause'), { code: 'PRIVATE_UPSTREAM_FAILURE' });
    const failure = await createActionExecutor(registry(), undefined, { authorizer: () => true }).execute('reserve', input, context, async () => { throw cause; });
    expect(failure.evidence?.outcome).toEqual({ status: 'failed', code: 'ACTION_EXECUTION_FAILED' });
    expect(failure.cause).toBe(cause); expect(JSON.stringify(failure.executionTrace)).not.toContain('private-provider-cause');
  });

  it('preserves acknowledged outcomes when projection and native recording diagnostics throw', async () => {
    const snapshot = vi.spyOn(FlowChartExecutor.prototype, 'getSnapshot').mockImplementation(() => { throw new Error('snapshot unavailable'); });
    try {
      const result = await createActionExecutor(registry(), undefined, {
        authorizer: () => true,
        projectEvidenceActor: () => { throw new Error('actor projection unavailable'); },
        projectEvidenceRequest: () => { throw new Error('request projection unavailable'); },
        onTraceError: () => { throw new Error('observer unavailable'); },
      }).execute('reserve', input, context, async () => 'saved');
      expect(result.status).toBe('success'); expect(result.result).toBe('saved');
      expect(result.evidence?.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.evidence).not.toHaveProperty('engineRunId');
      expect(result.executionTrace).not.toHaveProperty('executionSnapshot');
      expect(validateExecutionEvidence(result.evidence).valid).toBe(true);
    } finally { snapshot.mockRestore(); }
  });

  it('does not fabricate an engine recording for unknown actions or invalid contexts', async () => {
    const executor = createActionExecutor(registry(), undefined, { authorizer: () => true });
    const unknown = await executor.execute('unknown', input, context);
    const invalid = await executor.execute('reserve', input, { ...context, meta: { invalid: () => true } });
    expect(unknown.evidence).toBeUndefined(); expect(invalid.evidence).toBeUndefined();
    expect(unknown.executionTrace).toBeUndefined(); expect(invalid.executionTrace).toBeUndefined();
  });

  it('isolates accidentally asynchronous projection and diagnostic rejection', async () => {
    const result = await createActionExecutor(registry(), undefined, {
      authorizer: () => true,
      projectEvidenceRequest: async () => { throw new Error('private-async-projection'); },
      onTraceError: async () => { throw new Error('private-async-observer'); },
    }).execute('reserve', input, context, async () => 'saved');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(result.status).toBe('success'); expect(result.result).toBe('saved');
    expect(result.evidence).not.toHaveProperty('request');
    expect(JSON.stringify(result.executionTrace)).not.toMatch(/private-async/);
  });

  it('consumes rejected native promises from another realm in selectors and diagnostics', async () => {
    const foreignProjection = vi.fn(() => runInNewContext('Promise.reject(new Error("private-foreign-projection"))'));
    const foreignObserver = vi.fn(() => runInNewContext('Promise.reject(new Error("private-foreign-observer"))'));
    const result = await createActionExecutor(registry(), undefined, {
      authorizer: () => true,
      projectEvidenceRequest: foreignProjection,
      onTraceError: foreignObserver,
    }).execute('reserve', input, context, async () => 'saved');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(result.status).toBe('success'); expect(result.result).toBe('saved');
    expect(foreignProjection).toHaveBeenCalledOnce(); expect(foreignObserver).toHaveBeenCalledOnce();
    expect(result.evidence).not.toHaveProperty('request');
    expect(JSON.stringify(result.executionTrace)).not.toMatch(/private-foreign/);
  });

  it('never invokes ordinary thenables or then getters from selectors and diagnostics', async () => {
    const then = vi.fn(() => { throw new Error('ordinary thenable invoked'); });
    const getThen = vi.fn(() => then);
    const withGetter = Object.defineProperty({}, 'then', { enumerable: true, get: getThen });
    for (const value of [{ then }, withGetter]) {
      const result = await createActionExecutor(registry(), undefined, {
        authorizer: () => true,
        projectEvidenceRequest: () => value,
        evidenceOptions: { project: (_kind, payload) => payload as never },
        traceRecorder: { record: async () => { throw new Error('diagnostics unavailable'); } },
        onTraceError: () => value,
      }).execute('reserve', input, context, async () => 'saved');
      expect(result.status).toBe('success'); expect(result.result).toBe('saved');
      expect(result.evidence).not.toHaveProperty('request');
    }
    expect(then).not.toHaveBeenCalled(); expect(getThen).not.toHaveBeenCalled();
  });
});
