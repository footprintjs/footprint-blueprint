import type { AdapterRegistry } from './adapterRegistry.js';
import type { AdapterContext, BridgeResult } from './types.js';
export type ServiceBridge = {
  execute<TInput = unknown, TOutput = unknown>(capabilityId: string, input: TInput, context: AdapterContext): Promise<BridgeResult<TOutput>>;
  hasAdapter(capabilityId: string, profileType: string): boolean;
  availableCapabilities(profileType: string): readonly string[];
};
export function createServiceBridge(registry: AdapterRegistry): ServiceBridge {
  const errors = registry.validate();
  if (errors.length) throw new Error(`Invalid adapter registry: ${errors.join('; ')}`);
  return Object.freeze({
    async execute<TInput = unknown, TOutput = unknown>(capabilityId: string, input: TInput, context: AdapterContext): Promise<BridgeResult<TOutput>> {
      const start = Date.now();
      const adapter = registry.resolve(capabilityId, context.profileType);
      if (!adapter) return Object.freeze({ status: 'no-adapter', capabilityId, duration: Date.now() - start, error: `No adapter found for capability "${capabilityId}" with profile "${context.profileType}"`, errorCode: 'ADAPTER_UNAVAILABLE', httpStatus: 503 });
      try {
        const result = await adapter.execute(input, Object.freeze({ ...context })) as TOutput;
        return Object.freeze({ status: 'success', capabilityId, adapterId: adapter.id, result, duration: Date.now() - start });
      } catch (cause) {
        const details = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {};
        const result: BridgeResult<TOutput> = { status: 'error', capabilityId, adapterId: adapter.id, error: cause instanceof Error ? cause.message : String(cause), errorCode: typeof details.code === 'string' ? details.code : undefined, httpStatus: typeof details.status === 'number' ? details.status : undefined, traceRunId: typeof details.traceRunId === 'string' ? details.traceRunId : undefined, duration: Date.now() - start };
        Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
        return Object.freeze(result);
      }
    },
    hasAdapter: (capabilityId: string, profileType: string) => registry.resolve(capabilityId, profileType) !== undefined,
    availableCapabilities: (profileType: string) => Object.freeze(registry.capabilityIds().filter(id => registry.resolve(id, profileType) !== undefined)),
  });
}
