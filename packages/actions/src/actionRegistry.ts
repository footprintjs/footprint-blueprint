import type { ActionDefinition, MCPToolDefinition, SchemaExporter } from "./types.js";
import { createMCPExporter } from "./exporters.js";

/**
 * An action registry holds action definitions and can export them
 * as MCP tools, filtered by enabled modules.
 */
export type ActionRegistry = {
  /** Get an action by ID */
  getAction(id: string): ActionDefinition | undefined;
  /** List all registered actions */
  allActions(): readonly ActionDefinition[];
  /** Filter actions by domain */
  forDomain(domain: string): readonly ActionDefinition[];
  /** Filter actions that require a given module */
  forModule(moduleId: string): readonly ActionDefinition[];
  /** Export available actions as MCP tool definitions (filtered by enabled modules) */
  toMCPTools(enabledModules: ReadonlySet<string>): readonly MCPToolDefinition[];
  /** Export available actions using a custom schema exporter (adapter pattern) */
  exportActions<T>(enabledModules: ReadonlySet<string>, exporter: SchemaExporter<T>): T;
};

export type ActionRegistryInput = {
  actions: readonly ActionDefinition[];
};

/**
 * Create an action registry.
 */
export function createActionRegistry(input: ActionRegistryInput): ActionRegistry {
  const mcpExporter = createMCPExporter();
  const actionMap = new Map<string, ActionDefinition>();

  for (const action of input.actions) {
    if (!action.id || typeof action.id !== "string" || action.id.trim().length === 0) {
      throw new Error("Action id is required and must be a non-empty string");
    }
    if (!action.name || typeof action.name !== "string") {
      throw new Error(`Action "${action.id}": name is required`);
    }
    if (!action.domain || typeof action.domain !== "string") {
      throw new Error(`Action "${action.id}": domain is required`);
    }
    if (actionMap.has(action.id)) {
      throw new Error(`Duplicate action ID: "${action.id}"`);
    }
    actionMap.set(action.id, action);
  }

  const frozenAll = Object.freeze(Array.from(actionMap.values()));

  return {
    getAction(id) {
      return actionMap.get(id);
    },

    allActions() {
      return frozenAll;
    },

    forDomain(domain) {
      return frozenAll.filter((a) => a.domain === domain);
    },

    forModule(moduleId) {
      return frozenAll.filter((a) => a.requiredModules.includes(moduleId));
    },

    toMCPTools(enabledModules) {
      return this.exportActions(enabledModules, mcpExporter);
    },

    exportActions<T>(enabledModules: ReadonlySet<string>, exporter: SchemaExporter<T>): T {
      // Actions with empty requiredModules are global — available to all profiles
      const available = frozenAll.filter((a) =>
        a.requiredModules.every((m) => enabledModules.has(m)),
      );
      return exporter.export(available);
    },
  };
}
