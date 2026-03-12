/**
 * Core types for footprint-features.
 *
 * All types are plain data — no classes, no IO, no side effects.
 * This file has zero runtime code; it exists only for TypeScript.
 */

// ---------------------------------------------------------------------------
// Module definitions
// ---------------------------------------------------------------------------

/** A single feature module that a platform can enable or disable. */
export type ModuleDefinition = {
  /** Unique identifier (e.g., "attendance", "fees", "scheduling") */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** What this module provides */
  readonly description: string;
  /** Which service domain owns this module */
  readonly domain: string;
  /** Module IDs that must be enabled for this module to work */
  readonly requires: readonly string[];
  /** Capabilities this module provides (for introspection / adapter contracts) */
  readonly capabilities: readonly string[];
  /**
   * Terminology overrides per profile.
   * Key = term key, Value = { profileType → label }.
   * "default" is the fallback if no school-type-specific label exists.
   */
  readonly terminology: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * Seed data hints per profile.
   * The library doesn't execute seeds — it returns the blueprint
   * for the consumer to apply however they want (Prisma, SQL, API, etc.).
   */
  readonly seed: Readonly<Record<string, unknown>>;
  /**
   * Role-based access declarations.
   * Key = permission key (e.g., "canMark", "canView"), Value = role names.
   */
  readonly roles: Readonly<Record<string, readonly string[]>>;
};

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

/** A preset configuration for a category of schools. */
export type ProfileDefinition = {
  /** Unique identifier (e.g., "k12", "dance", "music") */
  readonly type: string;
  /** Human-readable name */
  readonly displayName: string;
  /** Module IDs enabled by default for this profile */
  readonly modules: readonly string[];
  /** Default role names for this profile */
  readonly roles: readonly string[];
  /** Scheduling pattern hint */
  readonly schedulingPattern: string;
  /** Additional metadata the consumer can use */
  readonly meta: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Resolved configuration
// ---------------------------------------------------------------------------

/** The fully resolved configuration for a specific school instance. */
export type ResolvedProfileConfig = {
  /** The profile this config was resolved from */
  readonly profileType: string;
  /** Set of enabled module IDs (includes transitive dependencies) */
  readonly enabledModules: ReadonlySet<string>;
  /** Full module definitions for enabled modules */
  readonly modules: ReadonlyMap<string, ModuleDefinition>;
  /** Resolved terminology: term key → display label */
  readonly terminology: Readonly<Record<string, string>>;
  /** Merged role list from profile + enabled modules */
  readonly roles: readonly string[];
  /** Seed blueprints for enabled modules (module ID → seed data) */
  readonly seed: Readonly<Record<string, unknown>>;
  /** The dependency tree that was resolved */
  readonly dependencyTree: ReadonlyMap<string, readonly string[]>;
  /** Warnings from resolution (e.g., unknown modules that were skipped) */
  readonly warnings: readonly ValidationError[];
};

// ---------------------------------------------------------------------------
// Feature gate
// ---------------------------------------------------------------------------

/** Result of checking whether a module is enabled. */
export type GateResult = {
  readonly allowed: boolean;
  readonly moduleId: string;
  readonly reason: string;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A validation error found in module or profile definitions. */
export type ValidationError = {
  readonly type: "missing_dependency" | "circular_dependency" | "unknown_module" | "invalid_definition";
  readonly moduleId: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
};
