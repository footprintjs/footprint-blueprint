import type { ModuleRegistry, ResolvedProfileConfig } from '../features/index.js';
import { resolveProfileConfig } from '../features/index.js';
import { captureProfileBinding, normalizedProfileScope, profileScopeKey } from './profileScope.js';
import type { ProfileBinding, ProfileScope, ProfileStore, TenantContext } from './types.js';

export type ProfileResolverOptions = {
  /** Cached derivations only: every resolution still strongly reads the binding revision. Default 30s; 0 disables caching. */
  cacheTtlMs?: number;
  /** Bounded LRU capacity, default 1000. */
  maxCacheEntries?: number;
  now?: () => number;
};
export type ProfileResolver = {
  resolve(ctx: TenantContext): Promise<ResolvedProfileConfig>;
  getBinding(ctx: ProfileScope): Promise<ProfileBinding | undefined>;
  invalidate(scope: ProfileScope): void;
  clearCache(): void;
};
type CacheEntry = { config: ResolvedProfileConfig; revision: number; fingerprint: string; expiresAt: number };
type PendingScope = { generation: number; pending: number };

/** Scope isolation, strongly read revision checks, and bounded cached derivations. */
export function createProfileResolver(registry: ModuleRegistry, store: ProfileStore, options: ProfileResolverOptions = {}): ProfileResolver {
  const ttl = options.cacheTtlMs ?? 30_000;
  const maxEntries = options.maxCacheEntries ?? 1000;
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 300_000) throw new Error('cacheTtlMs must be an integer from 0 to 300000');
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) throw new Error('maxCacheEntries must be an integer from 1 to 10000');
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const pendingScopes = new Map<string, PendingScope>();
  let generation = 0;
  const readBinding = async (scope: ProfileScope) => {
    const binding = await store.getBinding(scope);
    return binding ? captureProfileBinding(binding, scope) : undefined;
  };
  return {
    async resolve(ctx) {
      const scope = normalizedProfileScope(ctx);
      const key = profileScopeKey(scope);
      const pending = pendingScopes.get(key) ?? { generation: 0, pending: 0 };
      pending.pending++;
      pendingScopes.set(key, pending);
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const globalAtStart = generation;
          const scopeAtStart = pending.generation;
          const binding = await readBinding(scope);
          if (globalAtStart !== generation || scopeAtStart !== pending.generation) continue;
          if (!binding) { cache.delete(key); throw new Error(`No profile binding found for scope ${key}`); }
          const fingerprint = JSON.stringify([binding.profileType, binding.moduleOverrides ?? null]);
          const cached = cache.get(key);
          if (cached && binding.revision < cached.revision) throw new Error('Profile binding revision regressed');
          if (cached && binding.revision === cached.revision && fingerprint !== cached.fingerprint) throw new Error('Profile binding changed without a revision increment');
          const currentTime = now();
          if (!Number.isFinite(currentTime)) throw new Error('Profile cache clock must return a finite time');
          if (globalAtStart !== generation || scopeAtStart !== pending.generation) continue;
          if (ttl > 0 && cached && binding.revision === cached.revision && currentTime < cached.expiresAt) {
            cache.delete(key); cache.set(key, cached);
            return cached.config;
          }
          const config = resolveProfileConfig(registry, binding.profileType, binding.moduleOverrides);
          if (globalAtStart !== generation || scopeAtStart !== pending.generation) continue;
          if (ttl > 0) {
            for (const [entryKey, entry] of cache) if (entry.expiresAt <= currentTime) cache.delete(entryKey);
            cache.delete(key);
            while (cache.size >= maxEntries) {
              const oldest = cache.keys().next().value;
              if (oldest === undefined) break;
              cache.delete(oldest);
            }
            cache.set(key, { config, revision: binding.revision, fingerprint, expiresAt: currentTime + ttl });
          }
          return config;
        }
        throw new Error('Profile resolution invalidated repeatedly; retry the request');
      } finally {
        pending.pending--;
        if (pending.pending === 0) pendingScopes.delete(key);
      }
    },
    getBinding(ctx) { return readBinding(normalizedProfileScope(ctx)); },
    invalidate(scope) {
      const key = profileScopeKey(scope);
      cache.delete(key);
      const pending = pendingScopes.get(key);
      if (pending) pending.generation++;
    },
    clearCache() { cache.clear(); generation++; },
  };
}
