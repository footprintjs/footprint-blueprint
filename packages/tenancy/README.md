# @footprint/tenancy

Scoped profile binding, revision-aware resolution, and feature gating. The consumer supplies a `ProfileStore`; the library does not authenticate request headers or provide a database.

## 0.2 contracts

A `ProfileScope` contains `{ tenantId, campusId?, unitId }`. Tenant and unit IDs are required, trimmed, and bounded to 160 characters. The same unit ID can exist in different tenants or campuses without sharing a binding or a cache entry. `TenantContext` adds an optional user ID. Build it from trusted authentication context; `fromHeaders()` only validates shape.

A `ProfileBinding` contains the complete scope plus `revision`, `profileType`, `createdAt`, optional `moduleOverrides`, and optional plain `meta`. The revision is a nonnegative safe integer and must increase when configuration changes. `ProfileStore.getBinding(scope)` must strongly read that complete scope. Responses with another scope, malformed revisions, unknown profiles, or invalid module graphs are rejected.

```ts
const scope = { tenantId: "acme", campusId: "north", unitId: "store-1" };
const store = createMemoryProfileStore([
  { ...scope, revision: 0, profileType: "fashion", createdAt: "2026-01-01" },
]);
const resolver = createProfileResolver(registry, store, {
  cacheTtlMs: 30_000,
  maxCacheEntries: 1000,
});
const config = await resolver.resolve(scope);
store.updateBinding({ ...scope, revision: 1, profileType: "fashion", moduleOverrides: ["catalog"], createdAt: "2026-01-01" }, 0);
resolver.invalidate(scope);
```

The memory adapter captures immutable binding data. `addBinding(binding)` rejects duplicate full scopes. `updateBinding(binding, expectedRevision)` requires the current revision to match and the new revision to equal `expectedRevision + 1`. `removeBinding(scope, expectedRevision)` also checks the version. `allBindings({tenantId, campusId?})` enumerates one exact namespace. It is a local/test adapter, not persistent storage or an authorization service.

## Cache behavior

Every resolution strongly reads the binding. Only the derived immutable configuration is cached. A different revision is resolved immediately; changing the profile or module overrides under an unchanged cached revision is rejected. Persistent adapters must enforce monotonic revisions when writing bindings.

The default derivation TTL is 30 seconds. `cacheTtlMs: 0` disables derivation caching. TTLs must be integers from 0 to 300,000 milliseconds; LRU capacity defaults to 1000 and is bounded to 10,000 entries. An optional `now` function supports deterministic testing.

`invalidate(scope)` affects one tenant/campus/unit scope. `clearCache()` affects all scopes. Both prevent earlier in-flight reads from repopulating or returning obsolete data: invalidated reads retry at most three times, then reject if the scope keeps changing.

If a composed binding also incorporates a separately versioned override record, its revision must represent every contributing configuration change. A sum of nondecreasing base and override revisions is one suitable scalar version; retain monotonic tombstones when removing overrides.

## Feature middleware

`createGateMiddleware(resolver)` resolves and validates the binding even for an empty module list. It checks module availability, not user permissions. The action boundary still needs authenticated scope, an authorizer, input validation, and domain preconditions.

## Breaking changes from 0.1

- Binding reads and deletes take a full scope, not a unit ID string.
- Every binding needs `tenantId` and `revision`.
- Binding updates/deletes require revision preconditions.
- Default caching is finite; zero means no caching.
- Invalid bindings and definitions fail closed instead of producing a partially enabled configuration.
