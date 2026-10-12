/**
 * @footprint/tenancy — Multi-tenant context resolution and feature gating.
 *
 * Connects the tenant hierarchy (Tenant > Campus > Unit) to the module
 * registry from @footprint/features. Given a request context, resolves
 * which profile a unit uses and gates features accordingly.
 *
 * @example
 * ```ts
 * import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
 * import {
 *   createTenantContext,
 *   createMemoryProfileStore,
 *   createProfileResolver,
 *   createGateMiddleware,
 * } from "@footprint/tenancy";
 *
 * // Set up registry (from @footprint/features)
 * const registry = createModuleRegistry({ modules: [...], profileTypes: [...] });
 *
 * // Set up profile store
 * const store = createMemoryProfileStore([
 *   { tenantId: "t1", unitId: "school-1", revision: 0, profileType: "dance", createdAt: "2024-01-01" },
 * ]);
 *
 * // Create resolver + middleware
 * const resolver = createProfileResolver(registry, store);
 * const gateCheck = createGateMiddleware(resolver);
 *
 * // In a request handler:
 * const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });
 * const result = await gateCheck(ctx, ["attendance"]);
 * result.allowed; // true if attendance is enabled for this dance school
 * ```
 */

// Types
export type {
  TenantContext,
  ProfileScope,
  ProfileBinding,
  ProfileStore,
  TenantGateResult,
  GateRequest,
  GateMiddlewareResult,
} from "./types.js";

// Tenant context
export { createTenantContext, fromHeaders } from "./tenantContext.js";
export type { TenantContextInput, HeaderMap } from "./tenantContext.js";

// Profile resolver
export { createProfileResolver } from "./profileResolver.js";
export type { ProfileResolver, ProfileResolverOptions } from "./profileResolver.js";

// Gate middleware
export { createGateMiddleware } from "./gateMiddleware.js";
export type { GateMiddleware } from "./gateMiddleware.js";

// In-memory store (for testing / simple use)
export { createMemoryProfileStore } from "./memoryProfileStore.js";

export { profileScopeKey } from "./profileScope.js";
export type { MemoryProfileStore } from "./memoryProfileStore.js";
