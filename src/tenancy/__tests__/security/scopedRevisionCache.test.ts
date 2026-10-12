import { describe, expect, it, vi } from 'vitest';
import { createModuleRegistry, defineModule, defineProfile } from '../../../features/index.js';
import { createMemoryProfileStore, createProfileResolver } from '../../index.js';
import type { ProfileBinding, ProfileScope, ProfileStore } from '../../index.js';

const registry = createModuleRegistry({
  modules: [defineModule({ id: 'base', name: 'Base', domain: 'd' }), defineModule({ id: 'extra', name: 'Extra', domain: 'd' })],
  profileTypes: [defineProfile({ type: 'basic', displayName: 'Basic', modules: ['base'] }), defineProfile({ type: 'extended', displayName: 'Extended', modules: ['base', 'extra'] })],
});
const scope = (tenantId = 'a', campusId?: string): ProfileScope => ({ tenantId, ...(campusId ? { campusId } : {}), unitId: 'same-unit' });
const binding = (target = scope(), profileType = 'basic', revision = 0): ProfileBinding => ({ ...target, profileType, revision, createdAt: '2026-01-01' });

describe('scoped profile storage and revisions', () => {
  it('separates the same unit ID across tenants and campuses', async () => {
    const a = scope('a', 'one'); const b = scope('b', 'one'); const c = scope('a', 'two');
    const store = createMemoryProfileStore([binding(a), binding(b, 'extended'), binding(c, 'extended')]);
    const resolver = createProfileResolver(registry, store);
    expect((await resolver.resolve(a)).enabledModules.has('extra')).toBe(false);
    expect((await resolver.resolve(b)).enabledModules.has('extra')).toBe(true);
    expect((await resolver.resolve(c)).enabledModules.has('extra')).toBe(true);
    expect(store.allBindings({ tenantId: 'a', campusId: 'one' })).toEqual([binding(a)]);
    expect(await store.getBinding(scope('unknown', 'one'))).toBeUndefined();
  });
  it('requires matching revisions for updates and deletes and snapshots caller metadata', async () => {
    const original = { ...binding(), meta: { nested: { label: 'Before' } }, moduleOverrides: ['base'] };
    const store = createMemoryProfileStore([original]); original.meta.nested.label = 'After'; original.moduleOverrides.push('extra');
    expect((await store.getBinding(scope()))?.moduleOverrides).toEqual(['base']);
    expect((await store.getBinding(scope()))?.meta).toEqual({ nested: { label: 'Before' } });
    expect(() => store.updateBinding(binding(scope(), 'extended', 1), 9)).toThrow('revision conflict');
    store.updateBinding(binding(scope(), 'extended', 1), 0);
    expect(() => store.removeBinding(scope(), 0)).toThrow('revision conflict');
    expect(store.removeBinding(scope(), 1)).toBe(true);
  });
  it('rejects a provider response from a different scope and a malformed revision', async () => {
    const wrongScope: ProfileStore = { getBinding: async () => binding(scope('b')) };
    await expect(createProfileResolver(registry, wrongScope).resolve(scope('a'))).rejects.toThrow('scope does not match');
    const malformed: ProfileStore = { getBinding: async () => binding(scope(), 'basic', -1) };
    await expect(createProfileResolver(registry, malformed).resolve(scope())).rejects.toThrow('nonnegative safe integer');
  });
});

describe('bounded cached derivations with strong binding reads', () => {
  it('reads the revision each time, reuses unchanged derivations, and detects a new binding before TTL expiry', async () => {
    const store = createMemoryProfileStore([binding()]); const read = vi.spyOn(store, 'getBinding');
    const resolver = createProfileResolver(registry, store);
    const first = await resolver.resolve(scope()); expect(await resolver.resolve(scope())).toBe(first); expect(read).toHaveBeenCalledTimes(2);
    store.updateBinding(binding(scope(), 'extended', 1), 0);
    expect((await resolver.resolve(scope())).enabledModules.has('extra')).toBe(true);
  });
  it('disables derivation caching at zero TTL and expires the finite default', async () => {
    const store = createMemoryProfileStore([binding()]); const uncached = createProfileResolver(registry, store, { cacheTtlMs: 0 });
    expect(await uncached.resolve(scope())).not.toBe(await uncached.resolve(scope()));
    let now = 0; const cached = createProfileResolver(registry, store, { now: () => now });
    const first = await cached.resolve(scope()); now = 29_999; expect(await cached.resolve(scope())).toBe(first);
    now = 30_000; expect(await cached.resolve(scope())).not.toBe(first);
  });
  it('evicts beyond its configured capacity and invalidates only the selected scope', async () => {
    const a = scope('a'); const b = scope('b'); const c = scope('c');
    const resolver = createProfileResolver(registry, createMemoryProfileStore([binding(a), binding(b), binding(c)]), { maxCacheEntries: 2 });
    const first = await resolver.resolve(a); const second = await resolver.resolve(b); await resolver.resolve(c);
    expect(await resolver.resolve(a)).not.toBe(first);
    const currentB = await resolver.resolve(b); resolver.invalidate(a);
    expect(await resolver.resolve(b)).toBe(currentB); expect(currentB).not.toBe(second);
  });
  it('rejects a changed profile under an unchanged revision', async () => {
    let current = binding(); const store: ProfileStore = { getBinding: async () => current };
    const resolver = createProfileResolver(registry, store); await resolver.resolve(scope()); current = binding(scope(), 'extended');
    await expect(resolver.resolve(scope())).rejects.toThrow('without a revision increment');
  });
  it.each(['scope', 'all'] as const)('retries an obsolete in-flight binding read after %s invalidation without refilling stale data', async (mode) => {
    let finish!: (value: ProfileBinding) => void; let current = binding();
    const read = vi.fn<ProfileStore['getBinding']>().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementation(async () => current);
    const resolver = createProfileResolver(registry, { getBinding: read }); const pending = resolver.resolve(scope());
    if (mode === 'scope') resolver.invalidate(scope()); else resolver.clearCache();
    current = binding(scope(), 'extended', 1); finish(binding());
    expect((await pending).enabledModules.has('extra')).toBe(true);
    expect((await resolver.resolve(scope())).enabledModules.has('extra')).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('captures the request scope before an asynchronous provider read', async () => {
    const requested = { ...scope() }; let finish!: (value: ProfileBinding) => void;
    const read = vi.fn<ProfileStore['getBinding']>(() => new Promise((resolve) => { finish = resolve; }));
    const pending = createProfileResolver(registry, { getBinding: read }).resolve(requested); requested.tenantId = 'changed';
    finish(binding(scope('a'))); expect((await pending).profileType).toBe('basic');
    expect(read).toHaveBeenCalledWith(scope('a'));
  });
});
