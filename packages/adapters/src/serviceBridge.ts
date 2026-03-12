import type { AdapterRegistry } from "./adapterRegistry.js";
import type { AdapterContext, BridgeResult } from "./types.js";

/**
 * A service bridge routes capability calls to the correct adapter
 * based on the profile type.
 *
 * @example
 * ```ts
 * const bridge = createServiceBridge(adapterRegistry);
 *
 * const result = await bridge.execute("schedule-class", input, {
 *   profileType: "dance",
 *   unitId: "studio-1",
 * });
 * ```
 */
export type ServiceBridge = {
  /** Execute a capability through the correct adapter */
  execute<TInput = unknown, TOutput = unknown>(
    capabilityId: string,
    input: TInput,
    context: AdapterContext,
  ): Promise<BridgeResult<TOutput>>;

  /** Check if a capability has an adapter for the given profile */
  hasAdapter(capabilityId: string, profileType: string): boolean;

  /** List capabilities available for a profile type */
  availableCapabilities(profileType: string): readonly string[];
};

export function createServiceBridge(registry: AdapterRegistry): ServiceBridge {
  return {
    async execute<TInput = unknown, TOutput = unknown>(
      capabilityId: string,
      input: TInput,
      context: AdapterContext,
    ): Promise<BridgeResult<TOutput>> {
      const start = Date.now();
      const adapter = registry.resolve(capabilityId, context.profileType);

      if (!adapter) {
        return {
          status: "no-adapter",
          capabilityId,
          duration: Date.now() - start,
          error: `No adapter found for capability "${capabilityId}" with profile "${context.profileType}"`,
        };
      }

      try {
        const result = await adapter.execute(input, context) as TOutput;
        return {
          status: "success",
          capabilityId,
          adapterId: adapter.id,
          result,
          duration: Date.now() - start,
        };
      } catch (err) {
        return {
          status: "error",
          capabilityId,
          adapterId: adapter.id,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - start,
        };
      }
    },

    hasAdapter(capabilityId, profileType) {
      return registry.resolve(capabilityId, profileType) !== undefined;
    },

    availableCapabilities(profileType) {
      return registry.capabilityIds().filter(
        (capId) => registry.resolve(capId, profileType) !== undefined,
      );
    },
  };
}
