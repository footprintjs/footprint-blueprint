/**
 * @footprint/platform — Orchestration layer.
 *
 * Single entry point that wires features, tenancy, seed, adapters,
 * and actions into a cohesive platform instance.
 *
 * @example
 * ```ts
 * import {
 *   createPlatform,
 *   defineModule,
 *   defineProfile,
 *   createModuleRegistry,
 *   createMemoryProfileStore,
 *   createTenantContext,
 * } from "@footprint/platform";
 *
 * const registry = createModuleRegistry({ modules: [...], profileTypes: [...] });
 * const store = createMemoryProfileStore([{ unitId: "school-1", profileType: "dance", createdAt: "2024-01-01" }]);
 * const platform = createPlatform({ registry, profileStore: store });
 *
 * const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });
 * const setup = await platform.setupUnit(ctx);
 * ```
 */

// Platform factory and types
export { createPlatform } from "./platform.js";
export type { Platform, PlatformConfig, UnitSetupResult } from "./types.js";

// Re-export key types from all packages for convenience
// @footprint/features
export {
  defineModule,
  defineProfile,
  createModuleRegistry,
  resolveProfileConfig,
  createFeatureGate,
  createTermResolver,
  resolveTerminology,
} from "@footprint/features";
export type {
  ModuleDefinition,
  ProfileDefinition,
  ResolvedProfileConfig,
  GateResult,
  ValidationError,
  ModuleInput,
  ProfileInput,
  ModuleRegistry,
  ModuleRegistryInput,
  FeatureGate,
} from "@footprint/features";

// @footprint/tenancy
export {
  createTenantContext,
  fromHeaders,
  createProfileResolver,
  createGateMiddleware,
  createMemoryProfileStore,
} from "@footprint/tenancy";
export type {
  TenantContext,
  ProfileBinding,
  ProfileStore,
  TenantGateResult,
  GateMiddlewareResult,
  ProfileResolver,
  GateMiddleware,
} from "@footprint/tenancy";

// @footprint/seed
export { generateSeedPlan, executeSeedPlan } from "@footprint/seed";
export type {
  SeedPlan,
  SeedEntry,
  SeedGenerator,
  SeedContext,
  SeedApplier,
  SeedApplyResult,
  SeedExecutionResult,
} from "@footprint/seed";

// @footprint/adapters
export {
  createAdapterRegistry,
  createServiceBridge,
} from "@footprint/adapters";
export type {
  Capability,
  Adapter,
  AdapterContext,
  AdapterMapping,
  BridgeResult,
  AdapterRegistry,
  AdapterRegistryInput,
  ServiceBridge,
} from "@footprint/adapters";

// @footprint/actions
export { createActionRegistry, createActionExecutor } from "@footprint/actions";
export type {
  ActionDefinition,
  ActionParameter,
  MCPToolDefinition,
  ActionResult,
  ActionTrace,
  ActionExecutionContext,
  ActionHandler,
  ActionRegistry,
  ActionRegistryInput,
  ActionExecutor,
} from "@footprint/actions";
