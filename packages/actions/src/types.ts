/**
 * Core types for @footprint/actions.
 *
 * Defines action definitions, parameters, results, traces,
 * and MCP-compatible tool definitions.
 *
 * All types are plain data — no classes, no IO, no side effects.
 */

// ---------------------------------------------------------------------------
// Action parameter
// ---------------------------------------------------------------------------

/** A single parameter accepted by an action. */
export type ActionParameter = {
  /** Parameter name */
  readonly name: string;
  /** Parameter type */
  readonly type: "string" | "number" | "boolean" | "object";
  /** Whether this parameter is required */
  readonly required: boolean;
  /** Human-readable description */
  readonly description: string;
};

// ---------------------------------------------------------------------------
// Action definition
// ---------------------------------------------------------------------------

/** A discoverable, executable action in the system. */
export type ActionDefinition = {
  /** Unique action identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** What this action does */
  readonly description: string;
  /** Which domain this action belongs to (e.g., "scheduling", "people") */
  readonly domain: string;
  /** Category for grouping (e.g., "crud", "workflow", "report") */
  readonly category: string;
  /** Parameters this action accepts */
  readonly parameters: readonly ActionParameter[];
  /** Module IDs that must be enabled for this action to be available */
  readonly requiredModules: readonly string[];
  /** If set, this action delegates to the service bridge capability */
  readonly capabilityId?: string;
};

// ---------------------------------------------------------------------------
// Action trace
// ---------------------------------------------------------------------------

/** Trace information captured during action execution. */
export type ActionTrace = {
  /** Which action was executed */
  readonly actionId: string;
  /** Which adapter handled the execution (if capability-based) */
  readonly adapterId?: string;
  /** Profile type of the executing context */
  readonly profileType: string;
  /** Unit ID (school/campus/tenant) */
  readonly unitId: string;
  /** When execution started */
  readonly startedAt: number;
  /** When execution completed */
  readonly completedAt: number;
};

// ---------------------------------------------------------------------------
// Execution trace — full flow execution capture for observability
// ---------------------------------------------------------------------------

/**
 * Complete execution trace captured from a flow run.
 * Contains everything needed to replay, visualize, and debug the execution.
 * The shape is defined by the execution engine (footprintjs) — this type
 * is intentionally loosely typed so the blueprint doesn't depend on footprintjs.
 */
export type ExecutionTrace = {
  /** Unique run identifier */
  readonly runId: string;
  /** Which flow/action was executed */
  readonly flowId: string;
  /** Execution outcome */
  readonly status: "ok" | "error";
  /** ISO timestamp when execution started */
  readonly startedAt: string;
  /** ISO timestamp when execution completed */
  readonly completedAt: string;
  /** Error message if status is error */
  readonly errorMessage?: string;
  /** Final output of the flow */
  readonly output?: Readonly<Record<string, unknown>>;
  /** Flow specification tree (for graph visualization) */
  readonly flowSpec?: unknown;
  /** Stage descriptions keyed by stage ID */
  readonly stageDescriptions?: Readonly<Record<string, string>>;
  /** Execution tree from the flow engine (stage contexts, commit history) */
  readonly executionSnapshot?: unknown;
  /** State at each execution step (for time-travel debugging) */
  readonly historySnapshots?: readonly Readonly<Record<string, unknown>>[];
  /** Human-readable narrative of what happened */
  readonly narrative?: readonly string[];
  /** Structured narrative entries */
  readonly narrativeEntries?: readonly unknown[];
};

// ---------------------------------------------------------------------------
// Trace recorder — port for trace persistence
// ---------------------------------------------------------------------------

/** Context passed to the trace recorder identifying what was executed. */
export type TraceRecordContext = {
  /** Entity domain (e.g., "product", "order", "subscriber") */
  readonly entityType: string;
  /** Entity identifier (e.g., product ID, order ID, email) */
  readonly entityId: string;
  /** Profile type of the executing unit */
  readonly profileType: string;
  /** Unit ID that executed the action */
  readonly unitId: string;
};

/**
 * A trace recorder persists execution traces for observability.
 *
 * This is a port — the application layer provides the implementation
 * (e.g., S3 + DynamoDB, CloudWatch, a file on disk for local dev).
 * The platform calls this after every flow execution if one is configured.
 *
 * Implementations should not throw — trace persistence failures must not
 * crash the action. Log errors internally and return normally.
 */
export type TraceRecorder = {
  /** Persist an execution trace. Must not throw. */
  record(trace: ExecutionTrace, context: TraceRecordContext): Promise<void>;
};

// ---------------------------------------------------------------------------
// Action result
// ---------------------------------------------------------------------------

/** The outcome of executing an action. */
export type ActionResult = {
  /** Which action was executed */
  readonly actionId: string;
  /** Whether the action succeeded or failed */
  readonly status: "success" | "error";
  /** The return value on success */
  readonly result?: unknown;
  /** Error message on failure */
  readonly error?: string;
  /** How long execution took in milliseconds */
  readonly duration: number;
  /** Execution trace for observability */
  readonly trace?: ActionTrace;
  /** Full execution trace (when available from flow execution) */
  readonly executionTrace?: ExecutionTrace;
};

// ---------------------------------------------------------------------------
// MCP tool definition
// ---------------------------------------------------------------------------

/**
 * An MCP-compatible tool definition.
 *
 * This matches the Model Context Protocol tool schema so that actions
 * can be exposed directly to LLMs.
 */
export type MCPToolDefinition = {
  /** Tool name (derived from action ID) */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** JSON Schema for the tool's input */
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly required: readonly string[];
  };
};

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

/** Context passed to action execution. */
export type ActionExecutionContext = {
  readonly profileType: string;
  readonly unitId: string;
  readonly userId?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

/** A function that handles action execution when no capabilityId is set. */
export type ActionHandler = (
  actionId: string,
  input: unknown,
  context: ActionExecutionContext,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Schema exporter (port)
// ---------------------------------------------------------------------------

/**
 * A schema exporter transforms action definitions into an external format.
 *
 * This is a port — implement it for any format (MCP, OpenAPI, custom JSON).
 * Built-in exporters: mcpExporter, openApiExporter.
 */
export type SchemaExporter<T = unknown> = {
  /** Unique exporter identifier */
  readonly id: string;
  /** Export a list of actions into the target format */
  export(actions: readonly ActionDefinition[]): T;
};
