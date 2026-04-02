/**
 * @footprint/actions — Action registry, MCP tool export, and traced execution.
 *
 * Defines discoverable actions, exports them as MCP-compatible tools,
 * and executes them with tracing through the service bridge.
 */

// Types
export type {
  ActionDefinition,
  ActionParameter,
  ActionResult,
  ActionTrace,
  ExecutionTrace,
  TraceRecorder,
  TraceRecordContext,
  MCPToolDefinition,
  ActionExecutionContext,
  ActionHandler,
  SchemaExporter,
} from "./types.js";

// Registry
export { createActionRegistry } from "./actionRegistry.js";
export type { ActionRegistry, ActionRegistryInput } from "./actionRegistry.js";

// Executor
export { createActionExecutor } from "./actionExecutor.js";
export type { ActionExecutor } from "./actionExecutor.js";

// Schema exporters (adapter pattern)
export { createMCPExporter, createOpenAPIExporter } from "./exporters.js";
export type { OpenAPIPathEntry } from "./exporters.js";
