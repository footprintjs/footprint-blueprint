/**
 * Core types for footprint-blueprint/seed.
 *
 * Defines seed plan generation, application contracts, and results.
 */

// ---------------------------------------------------------------------------
// Seed plan
// ---------------------------------------------------------------------------

/**
 * A seed plan describes what data to create for a unit.
 *
 * The plan is generated from the resolved config — it contains one entry
 * per enabled module that has seed data. The consumer applies the plan
 * however they want (Prisma, SQL, API, etc.).
 */
export type SeedPlan = {
  /** The profile type this plan was generated for */
  readonly profileType: string;
  /** The unit this plan targets */
  readonly unitId: string;
  /** Individual seed entries, one per module */
  readonly entries: readonly SeedEntry[];
  /** When this plan was generated */
  readonly generatedAt: string;
};

/**
 * A single seed entry for one module.
 */
export type SeedEntry = {
  /** The module this seed data belongs to */
  readonly moduleId: string;
  /** The raw seed blueprint from the module definition */
  readonly blueprint: unknown;
  /** Optional transform applied by a seed generator */
  readonly transformed?: unknown;
  /** Execution order (lower = first) */
  readonly order: number;
  /** Transitive prerequisite modules that have entries in this plan. */
  readonly requires: readonly string[];
};

// ---------------------------------------------------------------------------
// Seed generator (extension point)
// ---------------------------------------------------------------------------

/**
 * A seed generator transforms raw blueprints into concrete data.
 *
 * Generators are optional — if none is registered for a module, the raw
 * blueprint is used as-is. Generators enable:
 * - Adding IDs, timestamps, or computed fields
 * - Expanding shorthand (e.g., grade names → full grade objects)
 * - Cross-referencing between modules
 */
export type SeedGenerator = {
  /** Which module this generator handles */
  readonly moduleId: string;
  /** Transform the raw blueprint into concrete seed data */
  generate(blueprint: unknown, context: SeedContext): unknown;
};

/**
 * Context available to seed generators during transformation.
 */
export type SeedContext = {
  /** The profile type being seeded */
  readonly profileType: string;
  /** The unit being seeded */
  readonly unitId: string;
  /** Access to other modules' blueprints (for cross-referencing) */
  readonly blueprints: Readonly<Record<string, unknown>>;
  /** Access to other modules' transformed data (if already generated) */
  readonly generated: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Seed applier (port)
// ---------------------------------------------------------------------------

/**
 * Interface for applying seed data to a data store.
 *
 * This is a port — the consumer provides the adapter.
 */
export type SeedApplier = {
  /** Apply a single seed entry */
  apply(entry: SeedEntry, context: SeedContext): Promise<SeedApplyResult>;
};

export type SeedApplyResult = {
  readonly moduleId: string;
  readonly status: "success" | "skipped" | "error";
  readonly recordsCreated?: number;
  readonly error?: string;
  readonly reason?: string;
};

export type SeedExecutionOptions = {
  /** Default stop: no subsequent write after a failure. Partial continues independent branches only. */
  readonly failureMode?: "stop" | "partial";
};

// ---------------------------------------------------------------------------
// Seed execution result
// ---------------------------------------------------------------------------

export type SeedExecutionResult = {
  readonly plan: SeedPlan;
  readonly results: readonly SeedApplyResult[];
  readonly status: "success" | "partial" | "error";
  readonly duration: number;
};
