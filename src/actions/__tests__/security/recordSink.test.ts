import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySink, type RecordSink } from 'foottrace/write';
import { readStoredRecord } from 'foottrace';
import { createActionExecutor, type ActionExecutorOptions } from '../../actionExecutor.js';
import { createActionRegistry } from '../../actionRegistry.js';
import { createModuleRegistry, defineProfile, defineModule } from '../../../features/index.js';
import { createMemoryProfileStore } from '../../../tenancy/index.js';
import { createPlatform } from '../../../platform/platform.js';

const PRIVATE = 'private-person@example.com private-provider-token';
const context = { tenantId: 'tenant', unitId: 'store', profileType: 'brand', userId: PRIVATE };
const actions = () => createActionRegistry({ actions: [{ id: 'publish', name: 'Publish', description: 'Publish', domain: 'content', category: 'workflow',
  requiredModules: [], parameters: [{ name: 'message', type: 'string', required: false, description: 'Private command' }] }] });
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('optional native action record sink', () => {
  it('stores an authentic incomplete prefix before the authoritative operation returns', async () => {
    const sink = memorySink(), factory = vi.fn<NonNullable<ActionExecutorOptions['recordSink']>>(() => sink);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const running = new Promise<void>(resolve => { entered = resolve; });
    const write = vi.fn(async () => { entered(); await gate; return { acknowledgement: 'applied', secret: PRIVATE }; });
    const executor = createActionExecutor(actions(), undefined, { authorizer: () => true, recordSink: factory,
      executionOptions: () => ({ env: { traceId: 'inbound-trace', operationId: 'operation-1' } }) });
    const pending = executor.execute('publish', { message: PRIVATE }, context, write); await running;
    const request = factory.mock.calls[0][0];
    expect(Object.isFrozen(request)).toBe(true); expect(Object.keys(request).sort()).toEqual(['actionId', 'recordId']);
    expect(request.recordId).toMatch(/^[a-f0-9-]{36}$/); expect(request.actionId).toBe('publish');
    const opened = sink.entries.find(entry => entry.kind === 'opened')!;
    expect(sink.entries.some(entry => entry.kind === 'commit')).toBe(true);
    expect(sink.entries.some(entry => entry.kind === 'closed')).toBe(false);
    expect(readStoredRecord(sink.entries).root(opened.address.logRunId)?.complete).toBe(false);
    release(); const result = await pending;
    expect(result.status).toBe('success'); expect(write).toHaveBeenCalledOnce();
    expect(result.executionTrace?.runId).toBe(opened.address.logRunId); expect(request.recordId).not.toBe(result.executionTrace?.runId);
    expect(result.executionTrace?.executionSnapshot).toMatchObject({ correlation: { traceId: 'inbound-trace', operationId: 'operation-1' }, sink: { failed: 0 } });
    expect(readStoredRecord(sink.entries).root(opened.address.logRunId)?.complete).toBe(true);
    expect(JSON.stringify(sink.entries)).not.toContain(PRIVATE); expect(JSON.stringify(result.executionTrace)).not.toContain(PRIVATE);
    expect(result.result).toEqual({ acknowledgement: 'applied', secret: PRIVATE });
    expect(result.evidence?.outcome.status).toBe('succeeded');
  });
  it('preserves an authoritative acknowledgement and masks raw errors when storage and flush fail', async () => {
    const adapter: RecordSink = { opened() { throw new Error(PRIVATE); }, commit() { throw new Error(PRIVATE); },
      note() { throw new Error(PRIVATE); }, closed() { throw new Error(PRIVATE); }, async flush() { throw new Error(PRIVATE); } };
    const write = vi.fn(async () => 'applied'), observer = vi.fn();
    const result = await createActionExecutor(actions(), undefined, { authorizer: () => true, recordSink: () => adapter, onTraceError: observer })
      .execute('publish', {}, context, write);
    expect(result.status).toBe('success'); expect(result.result).toBe('applied'); expect(write).toHaveBeenCalledOnce();
    expect(result.evidence?.outcome.status).toBe('succeeded');
    expect(result.executionTrace?.executionSnapshot).toMatchObject({ sink: { failed: expect.any(Number), lastError: '[REDACTED]' } });
    expect((result.executionTrace!.executionSnapshot as { sink: { failed: number } }).sink.failed).toBeGreaterThan(0);
    expect(JSON.stringify(result.executionTrace)).not.toContain(PRIVATE);
    expect(observer).toHaveBeenCalledOnce();
  });
  it('returns an acknowledged result after a bounded incomplete drain and reports the limitation', async () => {
    const sink = memorySink(), observer = vi.fn(), write = vi.fn(async () => 'applied');
    const result = await createActionExecutor(actions(), undefined, { authorizer: () => true, recordSinkFlushTimeoutMs: 10,
      recordSink: () => ({ ...sink, flush: () => new Promise<void>(() => {}) }), onTraceError: observer }).execute('publish', {}, context, write);
    expect(result.status).toBe('success'); expect(write).toHaveBeenCalledOnce(); expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0][0]).toMatchObject({ message: 'Native record flush is pending' });
  });
  it.each(['throw', 'malformed', 'async'] as const)('isolates a %s factory and retains genuine native evidence', async mode => {
    const write = vi.fn(async () => 'applied'), observer = vi.fn();
    const factory = (() => { if (mode === 'throw') throw new Error(PRIVATE); if (mode === 'async') return Promise.reject(new Error(PRIVATE)); return {}; }) as NonNullable<ActionExecutorOptions['recordSink']>;
    const result = await createActionExecutor(actions(), undefined, { authorizer: () => true, recordSink: factory, onTraceError: observer }).execute('publish', {}, context, write);
    await Promise.resolve();
    expect(result.status).toBe('success'); expect(write).toHaveBeenCalledOnce(); expect(observer).toHaveBeenCalledOnce();
    expect(result.executionTrace?.runId).toBeTruthy(); expect(result.executionTrace?.executionSnapshot).not.toHaveProperty('sink');
    expect(JSON.stringify(result.executionTrace)).not.toContain(PRIVATE);
    expect(observer.mock.calls[0][0]).toMatchObject({ message: 'Native record sink is unavailable' });
  });
  it('leaves recording absent when disabled and allocates distinct host locators for concurrent native runs', async () => {
    const factory = vi.fn<NonNullable<ActionExecutorOptions['recordSink']>>(() => undefined);
    const disabled = await createActionExecutor(actions(), undefined, { authorizer: () => true, recordSink: factory }).execute('publish', {}, context, async () => 'applied');
    expect(disabled.executionTrace?.executionSnapshot).not.toHaveProperty('sink');
    const sinks = new Map<string, ReturnType<typeof memorySink>>();
    const executor = createActionExecutor(actions(), undefined, { authorizer: () => true, recordSink: ({ recordId }) => {
      const sink = memorySink(); sinks.set(recordId, sink); return sink;
    } });
    const results = await Promise.all([executor.execute('publish', {}, context, async () => 'applied'), executor.execute('publish', {}, context, async () => 'applied')]);
    expect(sinks.size).toBe(2); expect(new Set(results.map(result => result.executionTrace?.runId)).size).toBe(2);
    const nativeIds = [...sinks.values()].map(sink => sink.entries.find(entry => entry.kind === 'opened')!.address.logRunId);
    expect(new Set(nativeIds)).toEqual(new Set(results.map(result => result.executionTrace?.runId)));
  });
  it('forwards the host factory and bounded drain through the real Platform action boundary', async () => {
    const sink = memorySink(), factory = vi.fn<NonNullable<ActionExecutorOptions['recordSink']>>(() => sink), observer = vi.fn();
    const platform = createPlatform({ registry: createModuleRegistry({ modules: [defineModule({ id: 'content', name: 'Content', domain: 'content', description: 'Published content' })], profileTypes: [defineProfile({ type: 'brand', displayName: 'Brand', modules: ['content'], roles: ['Owner'], schedulingPattern: 'time-slots' })] }),
      profileStore: createMemoryProfileStore([{ tenantId: 'tenant', unitId: 'store', profileType: 'brand', revision: 0, createdAt: '2026-10-17' }]), actionRegistry: actions(),
      authorizer: () => true, handlers: { publish: async () => 'applied' }, recordSink: request => { factory(request); return { ...sink, flush: () => new Promise<void>(() => {}) }; },
      recordSinkFlushTimeoutMs: 10, onTraceError: observer, executionOptions: () => ({ env: { traceId: 'platform-trace', operationId: 'platform-operation' } }) });
    const result = await platform.executeAction({ tenantId: 'tenant', unitId: 'store' }, 'publish', {});
    expect(result.status).toBe('success'); expect(factory).toHaveBeenCalledOnce(); expect(observer).toHaveBeenCalledOnce();
    expect(result.executionTrace?.executionSnapshot).toMatchObject({ correlation: { traceId: 'platform-trace', operationId: 'platform-operation' } });
    expect(sink.entries.some(entry => entry.kind === 'closed')).toBe(true);
  });
  it.each([-1, 2001, 1.5, Infinity])('rejects invalid final diagnostic drain %s at configuration time', timeout => {
    expect(() => createActionExecutor(actions(), undefined, { recordSinkFlushTimeoutMs: timeout })).toThrow(TypeError);
  });
});
