# @footprint/tenancy

Multi-tenant context resolution and feature gate middleware.

## Why this exists

A configurable platform serves many customers, each with their own profile (dance school, K-12, clothing store). Every request needs to know: "Which customer is this? What profile do they use? What features are enabled?"

Without a system, you end up with tenant context scattered across middleware, manual feature checks in every route, and no consistent way to gate features per customer.

`@footprint/tenancy` solves this by connecting the tenant hierarchy to the module registry from `@footprint/features`. One resolver call gives you the full resolved config — feature gates, terminology, roles — for the current tenant.

This is Layer 2 of the [footprint-blueprint](../../) framework. It depends on `@footprint/features` (Layer 1).

## What it does

```
HTTP Request
  → fromHeaders() ──→ TenantContext { tenantId, unitId }
  → ProfileResolver.resolve(ctx) ──→ ResolvedProfileConfig
  → GateMiddleware(ctx, ["attendance"]) ──→ { allowed: true/false }
```

1. **Tenant context** — extract and validate tenant info from headers (or any source)
2. **Profile resolver** — look up which profile a unit uses, resolve full config
3. **Gate middleware** — check if all required modules are enabled before processing

## Quick start

```typescript
import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import {
  createTenantContext,
  createMemoryProfileStore,
  createProfileResolver,
  createGateMiddleware,
} from "@footprint/tenancy";

// Registry from @footprint/features
const registry = createModuleRegistry({ modules: [...], profileTypes: [...] });

// Profile store (in-memory for dev, replace with DB adapter in prod)
const store = createMemoryProfileStore([
  { unitId: "school-1", profileType: "dance", createdAt: "2024-01-01" },
  { unitId: "school-2", profileType: "k12", createdAt: "2024-01-01" },
]);

// Wire up
const resolver = createProfileResolver(registry, store);
const gateCheck = createGateMiddleware(resolver);

// In a request handler:
const ctx = createTenantContext({ tenantId: "acme", unitId: "school-1" });
const result = await gateCheck(ctx, ["attendance", "scheduling"]);

if (!result.allowed) {
  // 403 — modules not enabled for this unit's profile
  return { status: 403, denied: result.denied };
}

// Proceed with full config available
const config = await resolver.resolve(ctx);
config.terminology; // resolved labels for this profile
config.roles;       // merged roles
```

## API

| Export | Purpose |
|--------|---------|
| `createTenantContext(input)` | Create a validated, frozen tenant context |
| `fromHeaders(headers, headerMap?)` | Extract tenant context from HTTP headers |
| `createProfileResolver(registry, store)` | Create a resolver that binds tenants to profiles |
| `createGateMiddleware(resolver)` | Create feature gate middleware |
| `createMemoryProfileStore(bindings)` | In-memory profile store (for testing) |

## Key types

| Type | Purpose |
|------|---------|
| `TenantContext` | `{ tenantId, campusId?, unitId, userId? }` |
| `ProfileBinding` | `{ unitId, profileType, moduleOverrides?, createdAt }` |
| `ProfileStore` | Port interface: `getBinding(unitId) → ProfileBinding` |
| `TenantGateResult` | Detailed denial reason with unitId and profileType |

## Testing

61 tests across 5 categories:

| Category | What it verifies |
|----------|-----------------|
| **Unit** (33) | Context creation, resolver caching, gate logic, store operations |
| **Scenario** (6) | Multi-tenant setup with 3 units, cross-tenant isolation, full request flow |
| **Property** (4) | Context always frozen, gate invariants via fast-check |
| **Boundary** (5) | 1000 units, 50-module gate checks, cache efficiency, unicode |
| **Security** (13) | Input validation, immutability, cross-tenant isolation, prototype keys |

```bash
pnpm test
```
