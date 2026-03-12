import type {
  ModuleRegistry,
  ResolvedProfileConfig,
} from "@footprint/features";
import { resolveProfileConfig } from "@footprint/features";
import type { ProfileBinding, ProfileStore, TenantContext } from "./types.js";

/**
 * A profile resolver ties the tenant context to the feature system.
 *
 * Given a tenant context, it:
 * 1. Looks up the profile binding (via ProfileStore)
 * 2. Resolves the full config (via @footprint/features)
 * 3. Caches the result for the request lifetime
 *
 * @example
 * ```ts
 * const resolver = createProfileResolver(registry, store);
 * const config = await resolver.resolve(tenantCtx);
 * config.enabledModules; // Set of enabled module IDs
 * config.terminology;    // Resolved labels
 * ```
 */

export type ProfileResolverOptions = {
  /** Cache TTL in milliseconds. 0 = no caching. Default: 0 (no TTL, manual clearCache). */
  cacheTtlMs?: number;
};

export type ProfileResolver = {
  /** Resolve the full profile config for a tenant context */
  resolve(ctx: TenantContext): Promise<ResolvedProfileConfig>;
  /** Look up just the binding (no resolution) */
  getBinding(ctx: TenantContext): Promise<ProfileBinding | undefined>;
  /** Clear the cache */
  clearCache(): void;
};

type CacheEntry = {
  config: ResolvedProfileConfig;
  expiresAt: number;
};

/**
 * Create a profile resolver.
 *
 * The resolver caches resolved configs by unitId. Cache behavior:
 * - No options / cacheTtlMs=0: cached until clearCache() is called manually
 * - cacheTtlMs > 0: entries expire after the TTL and are re-resolved
 *
 * For per-request usage, create a new resolver per request or call clearCache().
 * For long-lived server usage, set a TTL so binding changes are picked up.
 */
export function createProfileResolver(
  registry: ModuleRegistry,
  store: ProfileStore,
  options?: ProfileResolverOptions,
): ProfileResolver {
  const cache = new Map<string, CacheEntry>();
  const ttl = options?.cacheTtlMs ?? 0;

  return {
    async resolve(ctx: TenantContext): Promise<ResolvedProfileConfig> {
      const cached = cache.get(ctx.unitId);
      if (cached) {
        if (ttl === 0 || Date.now() < cached.expiresAt) {
          return cached.config;
        }
        cache.delete(ctx.unitId);
      }

      const binding = await store.getBinding(ctx.unitId);
      if (!binding) {
        throw new Error(`No profile binding found for unit "${ctx.unitId}"`);
      }

      const config = resolveProfileConfig(
        registry,
        binding.profileType,
        binding.moduleOverrides,
      );

      cache.set(ctx.unitId, {
        config,
        expiresAt: ttl > 0 ? Date.now() + ttl : Infinity,
      });
      return config;
    },

    async getBinding(ctx: TenantContext): Promise<ProfileBinding | undefined> {
      return store.getBinding(ctx.unitId);
    },

    clearCache() {
      cache.clear();
    },
  };
}
