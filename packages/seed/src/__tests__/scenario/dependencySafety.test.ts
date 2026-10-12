import { describe, expect, it, vi } from 'vitest';
import { createModuleRegistry, defineModule, defineProfile, resolveProfileConfig } from '@footprint/features';
import { generateSeedPlan, executeSeedPlan } from '../../index.js';
import type { SeedApplier } from '../../index.js';

const base = defineModule({ id: 'base', name: 'Base', domain: 'd', seed: { default: { label: 'Base' } } });
const middle = defineModule({ id: 'middle', name: 'Middle', domain: 'd', requires: ['base'] });
const child = defineModule({ id: 'child', name: 'Child', domain: 'd', requires: ['middle'], seed: { default: { label: 'Child' } } });
const independent = defineModule({ id: 'independent', name: 'Independent', domain: 'd', seed: { default: { label: 'Independent' } } });
const config = resolveProfileConfig(createModuleRegistry({ modules: [child, middle, base, independent], profileTypes: [defineProfile({ type: 'demo', displayName: 'Demo', modules: ['child', 'independent'] })] }), 'demo');

describe('dependency-safe seed generation and application', () => {
  it('orders generators before transforming even when blueprint insertion order puts the dependent first', () => {
    const order: string[] = [];
    const reversed = { ...config, seed: { child: config.seed['child'], base: config.seed['base'] } };
    const plan = generateSeedPlan(reversed, 'unit', [
      { moduleId: 'base', generate() { order.push('base'); return { id: 'base-record' }; } },
      { moduleId: 'child', generate(_blueprint, context) { order.push('child'); return { parentId: (context.generated['base'] as { id: string }).id }; } },
    ]);
    expect(order).toEqual(['base', 'child']);
    expect(plan.entries.find((entry) => entry.moduleId === 'child')).toMatchObject({ requires: ['base'], transformed: { parentId: 'base-record' } });
  });
  it('stops every subsequent write by default after a failed prerequisite', async () => {
    const apply = vi.fn<SeedApplier['apply']>(async (entry) => {
      if (entry.moduleId === 'base') throw new Error('Base creation failed');
      return { moduleId: entry.moduleId, status: 'success' };
    });
    const result = await executeSeedPlan(generateSeedPlan(config, 'unit'), { apply });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.results.map((entry) => entry.status)).toEqual(['error', 'skipped', 'skipped']);
    expect(result.status).toBe('error');
  });
  it('continues only independent branches in explicit partial mode, including dependencies through an unseeded module', async () => {
    const called: string[] = [];
    const apply: SeedApplier['apply'] = async (entry) => {
      called.push(entry.moduleId);
      if (entry.moduleId === 'base') return { moduleId: entry.moduleId, status: 'error', error: 'Base failed' };
      return { moduleId: entry.moduleId, status: 'success' };
    };
    const result = await executeSeedPlan(generateSeedPlan(config, 'unit'), { apply }, { failureMode: 'partial' });
    expect(called).toEqual(['base', 'independent']);
    expect(result.results.find((entry) => entry.moduleId === 'child')).toMatchObject({ status: 'skipped', reason: 'Prerequisites did not succeed: base' });
    expect(result.status).toBe('partial');
  });
  it('reports earlier acknowledged writes as partial rather than claiming rollback when a later write fails', async () => {
    const captured: string[] = [];
    const result = await executeSeedPlan(generateSeedPlan(config, 'unit'), {
      async apply(entry) { if (entry.moduleId === 'child') throw new Error('Child failed'); captured.push(entry.moduleId); return { moduleId: entry.moduleId, status: 'success' }; },
    });
    expect(captured).toEqual(['base', 'independent']); expect(result.status).toBe('partial');
  });
  it('freezes nested generation output and does not retain caller-owned mutable values', () => {
    const output = { items: [{ nested: { label: 'Before' } }] };
    const plan = generateSeedPlan(config, 'unit', [{ moduleId: 'base', generate: () => output }]);
    output.items[0]!.nested.label = 'After';
    const stored = plan.entries.find((entry) => entry.moduleId === 'base')!.transformed as typeof output;
    expect(stored.items[0]!.nested.label).toBe('Before'); expect(Reflect.set(stored.items[0]!.nested, 'label', 'Mutation')).toBe(false);
  });
  it('rejects reordered prerequisite entries before any seed adapter writes', async () => {
    const plan = generateSeedPlan(config, 'unit');
    const apply = vi.fn<SeedApplier['apply']>();
    await expect(executeSeedPlan({ ...plan, entries: [...plan.entries].reverse() }, { apply })).rejects.toThrow('must precede');
    expect(apply).not.toHaveBeenCalled();
  });
});
