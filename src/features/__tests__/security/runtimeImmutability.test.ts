import { describe, expect, it } from 'vitest';
import { createModuleRegistry, defineModule, defineProfile, resolveProfileConfig, resolveTransitiveDependencies } from '../../index.js';

const catalog = defineModule({ id: 'catalog', name: 'Catalog', domain: 'commerce' });
const profile = defineProfile({ type: 'fashion', displayName: 'Fashion', modules: ['catalog'] });

describe('fail-closed profiles', () => {
  it('never enables a dependent or its ancestors when a prerequisite is missing', () => {
    const checkout = defineModule({ id: 'checkout', name: 'Checkout', domain: 'commerce', requires: ['payments'] });
    const receipts = defineModule({ id: 'receipts', name: 'Receipts', domain: 'commerce', requires: ['checkout'] });
    const registry = createModuleRegistry({ modules: [catalog, checkout, receipts], profileTypes: [defineProfile({ type: 'shop', displayName: 'Shop', modules: ['receipts', 'catalog'] })] });
    const graph = resolveTransitiveDependencies(['receipts', 'catalog'], registry.getAllModules());
    expect([...graph.resolved]).toEqual(['catalog']);
    expect(() => resolveProfileConfig(registry, 'shop')).toThrow('payments');
  });
  it('cannot bypass unknown profile validation using module overrides', () => {
    expect(() => resolveProfileConfig(createModuleRegistry({ modules: [catalog] }), 'unknown', ['catalog'])).toThrow('Unknown profile');
  });
  it('does not enable any node in a dependency cycle', () => {
    const a = defineModule({ id: 'a', name: 'A', domain: 'd', requires: ['b'] });
    const b = defineModule({ id: 'b', name: 'B', domain: 'd', requires: ['a'] });
    const graph = resolveTransitiveDependencies(['a', 'catalog'], new Map([[a.id, a], [b.id, b], [catalog.id, catalog]]));
    expect([...graph.resolved]).toEqual(['catalog']);
    expect(graph.errors[0]?.type).toBe('circular_dependency');
  });
});

describe('runtime immutable definition snapshots', () => {
  it('captures nested array data even when the supplied outer object was already frozen', () => {
    const nested = { title: 'Before' };
    const seed = Object.freeze({ fashion: { items: [{ nested }] } });
    const input = { ...catalog, seed };
    const registry = createModuleRegistry({ modules: [input], profileTypes: [profile] });
    nested.title = 'After';
    const captured = registry.getModule('catalog')!.seed['fashion'] as typeof seed.fashion;
    expect(captured.items[0]?.nested.title).toBe('Before');
    expect(Reflect.set(captured.items[0]!.nested, 'title', 'Mutation')).toBe(false);
    expect(Reflect.set(captured.items, '0', { nested: { title: 'Mutation' } })).toBe(false);
  });
  it('does not expose raw map mutations, including through forEach or native prototype methods', () => {
    const registry = createModuleRegistry({ modules: [catalog], profileTypes: [profile] });
    const modules = registry.getAllModules();
    expect(Reflect.get(modules, 'set')).toBeUndefined();
    expect(() => Map.prototype.set.call(modules, 'other', catalog)).toThrow();
    modules.forEach((_value, _key, receiver) => {
      expect(receiver).toBe(modules);
      expect(() => Map.prototype.clear.call(receiver)).toThrow();
    });
    const pair = modules.entries().next().value!;
    pair[0] = 'other';
    expect(modules.has('catalog')).toBe(true); expect(modules.has('other')).toBe(false);
  });
  it('keeps resolved sets, maps and nested seed data immutable after construction', () => {
    const registry = createModuleRegistry({ modules: [catalog], profileTypes: [profile] });
    const config = resolveProfileConfig(registry, 'fashion');
    expect(Reflect.get(config.enabledModules, 'add')).toBeUndefined();
    expect(() => Set.prototype.add.call(config.enabledModules, 'other')).toThrow();
    config.enabledModules.forEach((_value, _same, receiver) => expect(() => Set.prototype.clear.call(receiver)).toThrow());
    expect(() => Map.prototype.delete.call(config.modules, 'catalog')).toThrow();
    expect(() => Map.prototype.set.call(config.dependencyTree, 'catalog', ['missing'])).toThrow();
    expect(Object.isFrozen(config)).toBe(true);
    expect([...config.enabledModules]).toEqual(['catalog']);
  });
  it('does not invoke accessor properties while snapshotting definitions', () => {
    let invoked = false;
    const data = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked = true; return 'side effect'; } });
    expect(() => defineModule({ id: 'example', name: 'Example', domain: 'd', seed: data })).toThrow('accessors');
    expect(invoked).toBe(false);
  });
});
