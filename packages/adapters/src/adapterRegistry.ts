import type { Adapter, AdapterMapping, Capability } from "./types.js";

/**
 * A registry of capabilities, adapters, and mappings.
 *
 * @example
 * ```ts
 * const registry = createAdapterRegistry({
 *   capabilities: [scheduleClass],
 *   adapters: [fixedTimetable, timeSlots],
 *   mappings: [{ capabilityId: "schedule-class", profileAdapters: { k12: "fixed-timetable", dance: "time-slots" } }],
 * });
 *
 * const adapter = registry.resolve("schedule-class", "dance");
 * // → timeSlots adapter
 * ```
 */
export type AdapterRegistry = {
  /** Get a capability definition */
  getCapability(id: string): Capability | undefined;
  /** Get an adapter by ID */
  getAdapter(id: string): Adapter | undefined;
  /** Resolve which adapter to use for a capability + profile combination */
  resolve(capabilityId: string, profileType: string): Adapter | undefined;
  /** List all registered capability IDs */
  capabilityIds(): readonly string[];
  /** List all registered adapter IDs */
  adapterIds(): readonly string[];
  /** Validate: all mappings reference existing adapters and capabilities */
  validate(): readonly string[];
};

export type AdapterRegistryInput = {
  capabilities: readonly Capability[];
  adapters: readonly Adapter[];
  mappings: readonly AdapterMapping[];
};

export function createAdapterRegistry(input: AdapterRegistryInput): AdapterRegistry {
  const capabilities = new Map<string, Capability>();
  const adapters = new Map<string, Adapter>();
  const mappings = new Map<string, AdapterMapping>();

  for (const cap of input.capabilities) {
    if (capabilities.has(cap.id)) {
      throw new Error(`Duplicate capability ID: "${cap.id}"`);
    }
    capabilities.set(cap.id, cap);
  }

  for (const adapter of input.adapters) {
    if (adapters.has(adapter.id)) {
      throw new Error(`Duplicate adapter ID: "${adapter.id}"`);
    }
    adapters.set(adapter.id, adapter);
  }

  for (const mapping of input.mappings) {
    if (mappings.has(mapping.capabilityId)) {
      throw new Error(`Duplicate mapping for capability: "${mapping.capabilityId}"`);
    }
    mappings.set(mapping.capabilityId, mapping);
  }

  const frozenCapIds = Object.freeze(Array.from(capabilities.keys()));
  const frozenAdapterIds = Object.freeze(Array.from(adapters.keys()));

  return {
    getCapability(id) {
      return capabilities.get(id);
    },

    getAdapter(id) {
      return adapters.get(id);
    },

    resolve(capabilityId, profileType) {
      const mapping = mappings.get(capabilityId);
      if (!mapping) return undefined;

      const adapterId = mapping.profileAdapters[profileType] ?? mapping.defaultAdapterId;
      if (!adapterId) return undefined;

      return adapters.get(adapterId);
    },

    capabilityIds() {
      return frozenCapIds;
    },

    adapterIds() {
      return frozenAdapterIds;
    },

    validate() {
      const errors: string[] = [];

      for (const [capId, mapping] of mappings) {
        if (!capabilities.has(capId)) {
          errors.push(`Mapping references unknown capability: "${capId}"`);
        }
        for (const [profile, adapterId] of Object.entries(mapping.profileAdapters)) {
          if (!adapters.has(adapterId)) {
            errors.push(`Mapping for "${capId}" profile "${profile}" references unknown adapter: "${adapterId}"`);
          }
        }
        if (mapping.defaultAdapterId && !adapters.has(mapping.defaultAdapterId)) {
          errors.push(`Mapping for "${capId}" has unknown default adapter: "${mapping.defaultAdapterId}"`);
        }
      }

      return Object.freeze(errors);
    },
  };
}
