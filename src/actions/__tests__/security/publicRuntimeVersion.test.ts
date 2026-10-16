import { describe, expect, it, vi } from 'vitest';
import footprintPackage from 'footprintjs/package.json' with { type: 'json' };
import { createActionExecutor } from '../../actionExecutor.js';
import { createActionRegistry } from '../../actionRegistry.js';

// The public engine has no application-specific version export.
vi.mock('footprintjs', async importOriginal => {
  const actual = await importOriginal<typeof import('footprintjs')>();
  return { FlowChartBuilder: actual.FlowChartBuilder, FlowChartExecutor: actual.FlowChartExecutor, MetricRecorder: actual.MetricRecorder };
});

describe('public engine runtime metadata', () => {
  it('runs actions with only public engine exports and records the installed package version', async () => {
    const actions = createActionRegistry({ actions: [{ id: 'save', name: 'Save', description: 'Save', domain: 'content', category: 'workflow', requiredModules: [], parameters: [] }] });
    const result = await createActionExecutor(actions, undefined, { authorizer: () => true }).execute('save', {}, { tenantId: 'tenant', unitId: 'store', profileType: 'brand' }, async () => 'saved');
    expect(result.status).toBe('success');
    expect(result.result).toBe('saved');
    expect(result.executionTrace?.runtime).toEqual({ library: 'footprintjs', version: footprintPackage.version });
  });
});
