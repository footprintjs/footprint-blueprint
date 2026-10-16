import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { FlowChartExecutor } from 'footprintjs';
import footprintPackage from 'footprintjs/package.json' with { type: 'json' };
import { createActionRegistry } from '../../actionRegistry.js';
import { createActionExecutor } from '../../actionExecutor.js';
import { captureExecutionRunOptions } from '../../executionOptions.js';

const context = { tenantId: 'tenant', unitId: 'store', profileType: 'brand' };
const registry = () => createActionRegistry({ actions: [{ id: 'publish', name: 'Publish', description: 'Publish', domain: 'content', category: 'workflow', requiredModules: [], parameters: [] }] });

describe('host-owned engine execution controls', () => {
  it('records the installed engine version instead of an application version guess', async () => {
    const installed = createRequire(import.meta.url)('footprintjs/package.json') as { version: string };
    const result = await createActionExecutor(registry(), undefined, { authorizer: () => true }).execute('publish', {}, context, async () => 'saved');
    expect(footprintPackage.version).toBe(installed.version);
    expect(result.executionTrace?.runtime).toEqual({ library: 'footprintjs', version: installed.version });
  });

  it('delegates an expired deadline and an already aborted signal to the engine before any business stage', async () => {
    for (const controls of [{ deadline: Date.now() - 1 }, { signal: AbortSignal.abort() }]) {
      const authorizer = vi.fn(() => true), write = vi.fn(async () => 'saved');
      const result = await createActionExecutor(registry(), undefined, { authorizer, executionOptions: () => controls }).execute('publish', {}, context, write);
      expect(result.status).toBe('error'); expect(authorizer).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    }
  });

  it('captures only the declared engine controls per invocation and preserves native correlation', async () => {
    const native = FlowChartExecutor.prototype.run, seen: unknown[] = [];
    const run = vi.spyOn(FlowChartExecutor.prototype, 'run').mockImplementation(function (options) { seen.push(options); return native.call(this, options); });
    const callback = vi.fn(({ actionId, context: supplied }) => {
      expect(actionId).toBe('publish'); expect(Object.isFrozen(supplied)).toBe(true);
      return { timeoutMs: 10000, env: { traceId: 'caller-trace', operationId: 'caller-operation' } };
    });
    try {
      const result = await createActionExecutor(registry(), undefined, { authorizer: () => true, executionOptions: callback }).execute('publish', {}, context, async () => 'saved');
      expect(result.status).toBe('success'); expect(callback).toHaveBeenCalledOnce();
      expect(seen[0]).toEqual({ timeoutMs: 10000, env: { traceId: 'caller-trace', operationId: 'caller-operation' } });
      expect(result.executionTrace?.executionSnapshot).toMatchObject({ correlation: { traceId: 'caller-trace', operationId: 'caller-operation' } });
    } finally { run.mockRestore(); }
  });

  it('cannot smuggle private data, recorder hooks or retries through execution options', async () => {
    for (const controls of [{ input: { private: 'SECRET_INPUT' } }, { env: { private: 'SECRET_ENV' } }, { retry: { attempts: 5 } }, { record: () => {} }]) {
      const write = vi.fn(async () => 'saved');
      const result = await createActionExecutor(registry(), undefined, { authorizer: () => true, executionOptions: () => controls as never }).execute('publish', {}, context, write);
      expect(result.status).toBe('error'); expect(write).not.toHaveBeenCalled();
      expect(JSON.stringify(result.executionTrace)).not.toMatch(/SECRET_INPUT|SECRET_ENV/);
    }
  });

  it('does not read getters and detaches a mutable host options envelope', () => {
    const getter = vi.fn(() => 'SECRET_GETTER');
    expect(() => captureExecutionRunOptions(Object.defineProperty({}, 'deadline', { enumerable: true, get: getter }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const source = { deadline: 123, env: { traceId: 'original' } }, captured = captureExecutionRunOptions(source);
    source.deadline = 999; source.env.traceId = 'changed';
    expect(captured).toEqual({ deadline: 123, env: { traceId: 'original' } });
  });
  it('rejects asynchronous controls without an unhandled rejection or a business action', async () => {
    const write = vi.fn(async () => 'saved');
    const result = await createActionExecutor(registry(), undefined, { authorizer: () => true,
      executionOptions: (() => Promise.reject(new Error('PRIVATE_HOST_CONTROL'))) as never }).execute('publish', {}, context, write);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(result.status).toBe('error'); expect(write).not.toHaveBeenCalled();
    expect(JSON.stringify(result.executionTrace)).not.toContain('PRIVATE_HOST_CONTROL');
  });
});
