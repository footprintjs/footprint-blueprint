/**
 * footprint-blueprint/platform — Orchestration layer.
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
 * } from "footprint-blueprint/platform";
 *
 * const registry = createModuleRegistry({ modules: [...], profileTypes: [...] });
 * const store = createMemoryProfileStore([{ tenantId: "t1", unitId: "school-1", revision: 0, profileType: "dance", createdAt: "2024-01-01" }]);
 * const platform = createPlatform({ registry, profileStore: store });
 *
 * const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });
 * const setup = await platform.setupUnit(ctx);
 * ```
 */

// Platform factory and types
export { createPlatform } from "./platform.js";
export type { Platform, PlatformConfig, UnitSetupResult, PreparedAction } from "./types.js";

// Re-export key types from all packages for convenience
// footprint-blueprint/features
export {
  defineModule,
  defineProfile,
  createModuleRegistry,
  resolveProfileConfig,
  createFeatureGate,
  createTermResolver,
  resolveTerminology,
} from "../features/index.js";
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
} from "../features/index.js";

// footprint-blueprint/tenancy
export {
  createTenantContext,
  fromHeaders,
  createProfileResolver,
  createGateMiddleware,
  createMemoryProfileStore,
} from "../tenancy/index.js";
export type {
  TenantContext,
  ProfileBinding,
  ProfileScope,
  ProfileResolverOptions,
  ProfileStore,
  TenantGateResult,
  GateMiddlewareResult,
  ProfileResolver,
  GateMiddleware,
} from "../tenancy/index.js";

// footprint-blueprint/seed
export { generateSeedPlan, executeSeedPlan } from "../seed/index.js";
export type {
  SeedPlan,
  SeedEntry,
  SeedGenerator,
  SeedContext,
  SeedApplier,
  SeedApplyResult,
  SeedExecutionResult,
} from "../seed/index.js";

// footprint-blueprint/adapters
export {
  createAdapterRegistry,
  createServiceBridge,
} from "../adapters/index.js";
export type {
  Capability,
  Adapter,
  AdapterContext,
  AdapterMapping,
  BridgeResult,
  AdapterRegistry,
  AdapterRegistryInput,
  ServiceBridge,
} from "../adapters/index.js";

// footprint-blueprint/actions
export { createActionRegistry, createActionExecutor, validateActionInput, ActionInputError, ActionAccessError } from "../actions/index.js";
export { createEvidenceCollector, validateExecutionEvidence, EXECUTION_EVIDENCE_LIMITATIONS } from "../actions/index.js";
export type {
  ActionDefinition,
  ActionParameter,
  MCPToolDefinition,
  ActionResult,
  ActionTrace,
  ExecutionTrace,
  TraceRecorder,
  TraceRecordContext,
  ActionExecutionContext,
  ActionHandler,
  ActionAuthorizer,
  ActionHandlerRegistry,
  ActionExecutorOptions,
  ActionRegistry,
  ActionRegistryInput,
  ActionExecutor,
  ExecutionEvidence,
  EvidenceCollector,
  EvidenceReporter,
  EvidenceCollectorOptions,
  EvidenceObservationInput,
  EvidenceEffectInput,
  EvidenceLink,
  EvidenceOutcome,
  EvidenceScope,
  EvidenceProjectionKind,
  JsonValue,
  EvidenceEffectPhase,
  EvidenceCaptureReport,
  EvidenceFinalizeInput,
  EvidenceValidationResult,
  EvidenceObservation,
  EvidenceEffect,
} from "../actions/index.js";
