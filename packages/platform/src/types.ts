/**
 * Core types for @footprint/platform.
 *
 * Defines the platform configuration, the main Platform interface,
 * and the result of unit setup operations.
 */

import type { ModuleRegistry, ResolvedProfileConfig } from "@footprint/features";
import type { ProfileStore, TenantContext, GateMiddlewareResult, ProfileScope, ProfileResolverOptions } from "@footprint/tenancy";
import type { AdapterRegistry } from "@footprint/adapters";
import type { ActionRegistry, MCPToolDefinition, ActionResult, TraceRecorder, ActionAuthorizer, ActionHandlerRegistry, ActionDefinition, ActionExecutionContext, ActionExecutorOptions } from "@footprint/actions";
import type { SeedPlan } from "@footprint/seed";

// ---------------------------------------------------------------------------
// Platform configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for creating a platform instance.
 *
 * The registry and profileStore are required. Adapter and action registries
 * are optional — a platform can start with just features and tenancy,
 * and add adapters/actions later.
 */
export type PlatformConfig = {
  /** The module registry containing all module and profile definitions */
  readonly registry: ModuleRegistry;
  /** The profile store for looking up unit-to-profile bindings */
  readonly profileStore: ProfileStore;
  /** Optional adapter registry for capability-based execution */
  readonly adapterRegistry?: AdapterRegistry;
  /** Optional action registry for MCP tool export and action execution */
  readonly actionRegistry?: ActionRegistry;
  /** Optional trace recorder for persisting execution traces */
  readonly traceRecorder?: TraceRecorder;
  /** Trusted authorization policy; omitted means no action access. */
  readonly authorizer?: ActionAuthorizer;
  /** Exact action IDs mapped to trusted implementation ports. */
  readonly handlers?: ActionHandlerRegistry;
  readonly onTraceError?: (error: unknown) => void;
  /** Trusted metadata/payload projection and budgets for request-local receipts. */
  readonly evidenceOptions?: ActionExecutorOptions['evidenceOptions'];
  /** Explicit actor opt-in; never supplied by a user-controlled action payload. */
  readonly projectEvidenceActor?: ActionExecutorOptions['projectEvidenceActor'];
  /** Explicit request opt-in, evaluated after policy and schema validation. */
  readonly projectEvidenceRequest?: ActionExecutorOptions['projectEvidenceRequest'];
  readonly resolverOptions?: ProfileResolverOptions;
};

// ---------------------------------------------------------------------------
// Platform interface
// ---------------------------------------------------------------------------

/**
 * The main platform interface — a single entry point for all operations.
 *
 * Wires together features, tenancy, seed, adapters, and actions into
 * a cohesive API that the application layer consumes.
 */
export type PreparedAction = {
  readonly action: ActionDefinition;
  readonly context: ActionExecutionContext;
  /** A captured, validated immutable JSON payload. */
  readonly input: unknown;
};
export type Platform = {
  /** Resolve a unit's full profile configuration */
  resolveUnit(ctx: TenantContext): Promise<UnitSetupResult>;
  /** Resolve config + generate seed plan */
  setupUnit(ctx: TenantContext): Promise<UnitSetupResult>;
  /** Check if all required modules are enabled for a unit */
  gateCheck(ctx: TenantContext, requiredModules: readonly string[]): Promise<GateMiddlewareResult>;
  /** Get a terminology resolver function for a unit */
  getTermResolver(ctx: TenantContext): Promise<(key: string) => string>;
  /** Get MCP tools available for a unit's profile */
  getAvailableActions(ctx: TenantContext): Promise<readonly MCPToolDefinition[]>;
  /** Preflight a host-owned workflow through the same policy and schema boundary. */
  prepareAction(ctx: TenantContext, actionId: string, input: unknown): Promise<PreparedAction>;
  invalidateProfile(scope: ProfileScope): void;
  clearProfileCache(): void;
  /** Execute an action through a registered handler or adapter. */
  executeAction(ctx: TenantContext, actionId: string, input: unknown): Promise<ActionResult>;
};

// ---------------------------------------------------------------------------
// Unit setup result
// ---------------------------------------------------------------------------

/**
 * The result of resolving or setting up a unit.
 */
export type UnitSetupResult = {
  /** The unit ID that was resolved */
  readonly unitId: string;
  /** The profile type bound to this unit */
  readonly profileType: string;
  /** The fully resolved profile configuration */
  readonly config: ResolvedProfileConfig;
  /** The seed plan (only present when setupUnit is called) */
  readonly seedPlan?: SeedPlan;
};
