/**
 * @footprint/adapters — Adapter registry and service bridge.
 *
 * Routes capability calls to the correct adapter based on profile type.
 * Different profiles can use different implementations for the same operation.
 *
 * @example
 * ```ts
 * import { createAdapterRegistry, createServiceBridge } from "@footprint/adapters";
 *
 * const registry = createAdapterRegistry({
 *   capabilities: [{ id: "schedule", name: "Schedule", domain: "scheduling", description: "Schedule classes" }],
 *   adapters: [fixedTimetable, timeSlots],
 *   mappings: [{ capabilityId: "schedule", profileAdapters: { k12: "fixed-timetable", dance: "time-slots" } }],
 * });
 *
 * const bridge = createServiceBridge(registry);
 * const result = await bridge.execute("schedule", input, { profileType: "dance", unitId: "studio-1" });
 * ```
 */

// Types
export type {
  Capability,
  Adapter,
  AdapterContext,
  AdapterMapping,
  BridgeResult,
} from "./types.js";

// Registry
export { createAdapterRegistry } from "./adapterRegistry.js";
export type { AdapterRegistry, AdapterRegistryInput } from "./adapterRegistry.js";

// Service bridge
export { createServiceBridge } from "./serviceBridge.js";
export type { ServiceBridge } from "./serviceBridge.js";
