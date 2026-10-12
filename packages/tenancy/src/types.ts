/**
 * Core types for @footprint/tenancy.
 *
 * Defines the multi-tenant context hierarchy and profile binding contracts.
 * All types are plain data — no classes, no IO, no side effects.
 */

// ---------------------------------------------------------------------------
// Tenant hierarchy
// ---------------------------------------------------------------------------

/**
 * A tenant context identifies who is making the request.
 *
 * The hierarchy is: Tenant > Campus > Unit (e.g., School, Store, Clinic).
 * tenantId and unitId are required; campusId is optional:
 * - Single-tenant: deployment ID as tenantId + unitId
 * - Multi-tenant flat: tenantId + unitId
 * - Multi-tenant hierarchical: tenantId + campusId + unitId
 */
export type ProfileScope = {
  readonly tenantId: string;
  readonly campusId?: string;
  readonly unitId: string;
};

export type TenantContext = ProfileScope & { readonly userId?: string };

// ---------------------------------------------------------------------------
// Profile binding
// ---------------------------------------------------------------------------

/**
 * A profile binding ties a specific unit to its resolved configuration.
 *
 * This is what gets stored (e.g., in a database) and looked up at request time.
 * It tells the system: "Unit X uses profile Y with these module overrides."
 */
export type ProfileBinding = ProfileScope & {
  /** Monotonically increasing binding revision. Changing configuration must increment it. */
  readonly revision: number;
  /** The unit this binding belongs to */
  readonly unitId: string;
  /** The profile type (e.g., "dance", "k12", "clothing-store") */
  readonly profileType: string;
  /** Optional module overrides — if set, these replace the profile defaults */
  readonly moduleOverrides?: readonly string[];
  /** When this binding was created */
  readonly createdAt: string;
  /** Additional metadata */
  readonly meta?: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Profile store (port)
// ---------------------------------------------------------------------------

/**
 * Interface for looking up profile bindings.
 *
 * This is a port — the consumer provides the adapter (database, cache, etc.).
 * The tenancy package never does IO directly.
 */
export type ProfileStore = {
  /** Strongly read the binding for the complete scope; never use unitId alone. */
  getBinding(scope: ProfileScope): Promise<ProfileBinding | undefined>;
};

// ---------------------------------------------------------------------------
// Gate decision
// ---------------------------------------------------------------------------

/**
 * The result of a feature gate check in a tenanted context.
 */
export type TenantGateResult = {
  readonly allowed: boolean;
  readonly moduleId: string;
  readonly unitId: string;
  readonly profileType: string;
  readonly reason: string;
};

// ---------------------------------------------------------------------------
// Middleware types
// ---------------------------------------------------------------------------

/**
 * A generic request-like object that middleware can inspect.
 *
 * Framework-agnostic — works with Fastify, Express, Hono, etc.
 * The consumer maps their framework's request to this shape.
 */
export type GateRequest = {
  /** Headers or context containing tenant info */
  readonly tenantContext: TenantContext;
  /** The module(s) this route requires */
  readonly requiredModules: readonly string[];
};

/**
 * The result of gate middleware evaluation.
 */
export type GateMiddlewareResult = {
  readonly allowed: boolean;
  readonly denied: readonly TenantGateResult[];
};
