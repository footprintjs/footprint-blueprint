import type { Adapter, AdapterMapping, Capability } from './types.js';
export type AdapterRegistry = {
  getCapability(id: string): Capability | undefined;
  getAdapter(id: string): Adapter | undefined;
  resolve(capabilityId: string, profileType: string): Adapter | undefined;
  capabilityIds(): readonly string[];
  adapterIds(): readonly string[];
  validate(): readonly string[];
};
export type AdapterRegistryInput = { capabilities: readonly Capability[]; adapters: readonly Adapter[]; mappings: readonly AdapterMapping[] };
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
/** Captures port functions and metadata once; callers cannot change later routing. */
export function createAdapterRegistry(input: AdapterRegistryInput): AdapterRegistry {
  const capabilities = new Map<string, Capability>();
  const adapters = new Map<string, Adapter>();
  const mappings = new Map<string, AdapterMapping>();
  for (const cap of input.capabilities) {
    if (!text(cap.id) || !text(cap.name) || !text(cap.domain) || typeof cap.description !== 'string') throw new Error('Invalid capability definition');
    if (capabilities.has(cap.id)) throw new Error(`Duplicate capability ID: "${cap.id}"`);
    capabilities.set(cap.id, Object.freeze({ id: cap.id, name: cap.name, domain: cap.domain, description: cap.description }));
  }
  for (const adapter of input.adapters) {
    if (!text(adapter.id) || !text(adapter.name) || !text(adapter.capabilityId) || typeof adapter.execute !== 'function') throw new Error('Invalid adapter definition');
    if (adapters.has(adapter.id)) throw new Error(`Duplicate adapter ID: "${adapter.id}"`);
    const provider = adapter.execute;
    const receiver = Object.freeze({ id: adapter.id, name: adapter.name, capabilityId: adapter.capabilityId });
    const execute: Adapter['execute'] = (value, context) => provider.call(receiver as Adapter, value, context);
    adapters.set(adapter.id, Object.freeze({ ...receiver, execute }));
  }
  for (const mapping of input.mappings) {
    if (!text(mapping.capabilityId) || !mapping.profileAdapters || typeof mapping.profileAdapters !== 'object' || Array.isArray(mapping.profileAdapters) || Object.entries(mapping.profileAdapters).some(([profile, id]) => !text(profile) || !text(id)) || (mapping.defaultAdapterId !== undefined && !text(mapping.defaultAdapterId))) throw new Error('Invalid adapter mapping');
    if (mappings.has(mapping.capabilityId)) throw new Error(`Duplicate mapping for capability: "${mapping.capabilityId}"`);
    mappings.set(mapping.capabilityId, Object.freeze({ capabilityId: mapping.capabilityId, profileAdapters: Object.freeze({ ...mapping.profileAdapters }), defaultAdapterId: mapping.defaultAdapterId }));
  }
  const errors: string[] = [];
  for (const adapter of adapters.values()) if (!capabilities.has(adapter.capabilityId)) errors.push(`Adapter "${adapter.id}" references unknown capability: "${adapter.capabilityId}"`);
  for (const [capId, mapping] of mappings) {
    if (!capabilities.has(capId)) errors.push(`Mapping references unknown capability: "${capId}"`);
    for (const [profile, adapterId] of [...Object.entries(mapping.profileAdapters), ...(mapping.defaultAdapterId ? [['default', mapping.defaultAdapterId]] : [])]) {
      const adapter = adapters.get(adapterId!);
      if (!adapter) errors.push(`Mapping for "${capId}" profile "${profile}" references unknown adapter: "${adapterId}"`);
      else if (adapter.capabilityId !== capId) errors.push(`Mapping for "${capId}" profile "${profile}" selects adapter "${adapterId}" for another capability: "${adapter.capabilityId}"`);
    }
  }
  const diagnostics = Object.freeze(errors);
  const capIds = Object.freeze([...capabilities.keys()]);
  const adapterIds = Object.freeze([...adapters.keys()]);
  return Object.freeze({
    getCapability: (id: string) => capabilities.get(id), getAdapter: (id: string) => adapters.get(id),
    resolve(capabilityId: string, profileType: string) {
      if (!capabilities.has(capabilityId)) return undefined;
      const mapping = mappings.get(capabilityId);
      if (!mapping) return undefined;
      const id = Object.hasOwn(mapping.profileAdapters, profileType) ? mapping.profileAdapters[profileType] : mapping.defaultAdapterId;
      const adapter = id ? adapters.get(id) : undefined;
      return adapter?.capabilityId === capabilityId ? adapter : undefined;
    },
    capabilityIds: () => capIds, adapterIds: () => adapterIds, validate: () => diagnostics,
  });
}
