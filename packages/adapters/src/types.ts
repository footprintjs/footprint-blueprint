/**
 * Core types for @footprint/adapters.
 *
 * Defines capability contracts, adapter interfaces, and service bridge.
 */

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

/**
 * A capability is a named operation that an adapter can provide.
 *
 * Example capabilities: "schedule-class", "process-payment", "send-notification".
 * Modules declare which capabilities they need; adapters declare which they provide.
 */
export type Capability = {
  /** Unique capability identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Which domain this capability belongs to */
  readonly domain: string;
  /** Description of what this capability does */
  readonly description: string;
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * An adapter provides implementations for a set of capabilities.
 *
 * Different profile types can use different adapters for the same capability.
 * For example, a K-12 school might use a "fixed-timetable" scheduling adapter
 * while a dance school uses a "time-slots" adapter.
 */
export type Adapter<TInput = unknown, TOutput = unknown> = {
  /** Unique adapter identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Which capability this adapter implements */
  readonly capabilityId: string;
  /** Execute the capability */
  execute(input: TInput, context: AdapterContext): Promise<TOutput>;
};

/**
 * Context available to adapters during execution.
 */
export type AdapterContext = {
  readonly profileType: string;
  readonly unitId: string;
  readonly tenantId?: string;
  readonly campusId?: string;
  readonly actionId?: string;
  readonly userId?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

/**
 * Maps profile types to their adapter selections.
 *
 * @example
 * ```
 * { "schedule-class": { k12: "fixed-timetable", dance: "time-slots" } }
 * ```
 */
export type AdapterMapping = {
  readonly capabilityId: string;
  readonly profileAdapters: Readonly<Record<string, string>>;
  readonly defaultAdapterId?: string;
};

// ---------------------------------------------------------------------------
// Service bridge result
// ---------------------------------------------------------------------------

export type BridgeResult<T = unknown> = {
  readonly status: "success" | "error" | "no-adapter";
  readonly capabilityId: string;
  readonly adapterId?: string;
  readonly result?: T;
  readonly error?: string;
  readonly errorCode?: string;
  readonly httpStatus?: number;
  readonly traceRunId?: string;
  readonly cause?: unknown;
  readonly duration: number;
};
