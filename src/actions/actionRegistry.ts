import type { ActionDefinition, ActionDiscoveryContext, MCPToolDefinition, SchemaExporter } from './types.js';
import { createMCPExporter } from './exporters.js';
import { compileActionInput, freezeData } from './validation.js';
export type ActionRegistry = {
  getAction(id: string): ActionDefinition | undefined;
  allActions(): readonly ActionDefinition[];
  forDomain(domain: string): readonly ActionDefinition[];
  forModule(moduleId: string): readonly ActionDefinition[];
  toMCPTools(discovery: ActionDiscoveryContext): Promise<readonly MCPToolDefinition[]>;
  exportActions<T>(discovery: ActionDiscoveryContext, exporter: SchemaExporter<T>): Promise<T>;
  /** Pure schema formatting, never a tool server or authorization boundary. */
  exportMetadata<T>(enabledModules: ReadonlySet<string>, exporter: SchemaExporter<T>): T;
};
export type ActionRegistryInput = { actions: readonly ActionDefinition[] };
export function createActionRegistry(input: ActionRegistryInput): ActionRegistry {
  const map = new Map<string, ActionDefinition>();
  for (const original of input.actions) {
    if (typeof original.id !== 'string' || !original.id.trim()) throw new Error('Action id is required and must be a non-empty string');
    for (const field of ['name', 'domain', 'description', 'category'] as const) if (typeof original[field] !== 'string' || !original[field].trim()) throw new Error(`Action "${original.id}": ${field} is required`);
    if (map.has(original.id)) throw new Error(`Duplicate action ID: "${original.id}"`);
    if (!Array.isArray(original.parameters) || !Array.isArray(original.requiredModules) || original.requiredModules.some(id => typeof id !== 'string' || !id.trim())) throw new Error(`Action "${original.id}" has invalid parameters or modules`);
    const names = new Set<string>();
    for (const parameter of original.parameters) {
      if (!parameter || typeof parameter.name !== 'string' || !parameter.name.trim() || names.has(parameter.name) || !['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(parameter.type) || typeof parameter.required !== 'boolean') throw new Error(`Action "${original.id}" has an invalid or duplicate parameter`);
      names.add(parameter.name);
    }
    if (original.capabilityId !== undefined && (typeof original.capabilityId !== 'string' || !original.capabilityId.trim())) throw new Error(`Action "${original.id}" has an invalid capability`);
    if (original.requiredPermissions && (!Array.isArray(original.requiredPermissions) || original.requiredPermissions.some(permission => typeof permission !== 'string' || !permission.trim()))) throw new Error(`Action "${original.id}" has invalid permissions`);
    const action = freezeData(original); compileActionInput(action); map.set(action.id, action);
  }
  const all = Object.freeze([...map.values()]);
  const filter = (modules: ReadonlySet<string>) => all.filter(action => action.requiredModules.every(id => modules.has(id)));
  const registry: ActionRegistry = {
    getAction: id => map.get(id), allActions: () => all,
    forDomain: domain => Object.freeze(all.filter(action => action.domain === domain)),
    forModule: id => Object.freeze(all.filter(action => action.requiredModules.includes(id))),
    exportMetadata: (modules, exporter) => exporter.export(filter(modules)),
    async exportActions(discovery, exporter) {
      if (!discovery || typeof discovery.authorizer !== 'function' || typeof discovery.hasImplementation !== 'function') return exporter.export([]);
      const context = freezeData(discovery.context);
      const authorize = discovery.authorizer;
      const hasImplementation = discovery.hasImplementation;
      const available: ActionDefinition[] = [];
      for (const action of filter(discovery.enabledModules)) {
        if (!hasImplementation(action)) continue;
        try { if (await authorize({ action, context, purpose: 'discover' }) === true) available.push(action); } catch { /* Authorization failure denies discovery. */ }
      }
      return exporter.export(Object.freeze(available));
    },
    async toMCPTools(discovery) { return registry.exportActions(discovery, createMCPExporter()); },
  };
  return Object.freeze(registry);
}
