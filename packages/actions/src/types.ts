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
