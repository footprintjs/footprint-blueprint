# @footprint/actions

Action registry, MCP tool export, and traced execution.

## Why this exists

Actions are the verbs of the platform — "enroll a student", "schedule a class", "process a fee". Every action is discoverable, filterable by module, and exportable as an **MCP tool definition** so LLMs can invoke them directly.

This makes the platform AI-compatible: an LLM can discover what actions are available for a given school, understand their parameters via JSON Schema, and execute them through a standard protocol.

## Concepts

| Concept | Description |
|---------|-------------|
| **ActionDefinition** | A discoverable action with parameters, domain, category, and required modules |
| **ActionRegistry** | Index of all actions with filtering (by domain, module) and MCP export |
| **ActionExecutor** | Executes actions with timing, tracing, and error containment |
| **MCPToolDefinition** | An MCP-compatible tool schema (name, description, JSON Schema input) |

## Usage

```ts
import { createActionRegistry, createActionExecutor } from "@footprint/actions";

// Define actions
const actions = [
  {
    id: "enroll-student",
    name: "Enroll Student",
    description: "Enroll a new student",
    domain: "people",
    category: "crud",
    parameters: [
      { name: "studentName", type: "string", required: true, description: "Full name" },
    ],
    requiredModules: ["students"],
    capabilityId: "enroll",
  },
];

// Create registry
const registry = createActionRegistry({ actions });

// Export as MCP tools (filtered by enabled modules)
const enabledModules = new Set(["students", "attendance"]);
const tools = registry.toMCPTools(enabledModules);
// → [{ name: "enroll-student", description: "...", inputSchema: { type: "object", ... } }]

// Execute with tracing
const executor = createActionExecutor(registry, bridge);
const result = await executor.execute("enroll-student", { studentName: "Alice" }, {
  profileType: "k12",
  unitId: "school-1",
});
// → { actionId, status: "success", result, duration, trace }
```

## API

### `createActionRegistry({ actions })`

- `getAction(id)` — Look up an action definition
- `allActions()` — Get all registered actions
- `forDomain(domain)` — Filter actions by domain
- `forModule(moduleId)` — Find actions requiring a module
- `toMCPTools(enabledModules)` — Export as MCP tool definitions (built-in)
- `exportActions(enabledModules, exporter)` — Export using any SchemaExporter (adapter pattern)

### `createActionExecutor(registry, bridge?)`

- `execute(actionId, input, context, handler?)` — Execute with tracing
  - Capability-based actions delegate to the service bridge
  - Other actions use the provided handler
  - Returns `ActionResult` with timing and trace info

## Schema exporter pattern

Export formats use the adapter pattern via `SchemaExporter<T>`. Built-in exporters: MCP and OpenAPI. Add your own by implementing the interface.

```ts
import { createActionRegistry, createMCPExporter, createOpenAPIExporter } from "@footprint/actions";

const registry = createActionRegistry({ actions: [...] });
const enabled = new Set(["students", "scheduling"]);

// Built-in MCP (same as toMCPTools)
const mcpTools = registry.exportActions(enabled, createMCPExporter());

// Built-in OpenAPI
const openApiOps = registry.exportActions(enabled, createOpenAPIExporter());

// Custom exporter
const csvExporter = {
  id: "csv",
  export(actions) {
    return actions.map(a => `${a.id},${a.name},${a.domain}`).join("\n");
  },
};
const csv = registry.exportActions(enabled, csvExporter);
```

### `SchemaExporter<T>` interface

```ts
type SchemaExporter<T> = {
  readonly id: string;
  export(actions: readonly ActionDefinition[]): T;
};
```

## Tests

49 tests across 6 files:
- **Unit**: actionRegistry, actionExecutor
- **Scenario**: action discovery per school profile
- **Property**: MCP schema invariants with fast-check
- **Boundary**: large action sets
- **Security**: validation, prototype pollution, error containment
