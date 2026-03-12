import type { ServiceBridge } from "@footprint/adapters";
import type { ActionRegistry } from "./actionRegistry.js";
import type { ActionExecutionContext, ActionHandler, ActionResult, ActionTrace } from "./types.js";

/**
 * An action executor wraps action invocations with timing, tracing,
 * and error handling. It delegates capability-based actions to the
 * service bridge and calls the provided handler for everything else.
 */
export type ActionExecutor = {
  /**
   * Execute an action by ID.
   *
   * If the action has a capabilityId, the service bridge is used.
   * Otherwise, the fallback handler is called.
   */
  execute(
    actionId: string,
    input: unknown,
    context: ActionExecutionContext,
    handler?: ActionHandler,
  ): Promise<ActionResult>;
};

/**
 * Create an action executor.
 *
 * @param registry  - The action registry to look up action definitions
 * @param bridge    - Optional service bridge for capability-based actions
 *
 * @example
 * ```ts
 * const executor = createActionExecutor(registry, bridge);
 * const result = await executor.execute("create-student", { name: "Alice" }, {
 *   profileType: "k12",
 *   unitId: "school-1",
 * });
 * ```
 */
export function createActionExecutor(
  registry: ActionRegistry,
  bridge?: ServiceBridge,
): ActionExecutor {
  return {
    async execute(actionId, input, context, handler) {
      const action = registry.getAction(actionId);

      if (!action) {
        return Object.freeze({
          actionId,
          status: "error" as const,
          error: `Unknown action: "${actionId}"`,
          duration: 0,
        });
      }

      const startedAt = Date.now();

      try {
        let result: unknown;
        let adapterId: string | undefined;

        if (action.capabilityId && bridge) {
          const bridgeResult = await bridge.execute(
            action.capabilityId,
            input,
            {
              profileType: context.profileType,
              unitId: context.unitId,
              userId: context.userId,
              meta: context.meta,
            },
          );

          if (bridgeResult.status === "error" || bridgeResult.status === "no-adapter") {
            const completedAt = Date.now();
            return Object.freeze({
              actionId,
              status: "error" as const,
              error: bridgeResult.error ?? `Capability "${action.capabilityId}" failed`,
              duration: completedAt - startedAt,
              trace: Object.freeze({
                actionId,
                adapterId: bridgeResult.adapterId,
                profileType: context.profileType,
                unitId: context.unitId,
                startedAt,
                completedAt,
              } satisfies ActionTrace),
            });
          }

          result = bridgeResult.result;
          adapterId = bridgeResult.adapterId;
        } else if (handler) {
          result = await handler(actionId, input, context);
        } else {
          const completedAt = Date.now();
          return Object.freeze({
            actionId,
            status: "error" as const,
            error: action.capabilityId
              ? `Action "${actionId}" requires a service bridge (capabilityId: "${action.capabilityId}")`
              : `No handler provided for action "${actionId}"`,
            duration: completedAt - startedAt,
          });
        }

        const completedAt = Date.now();
        return Object.freeze({
          actionId,
          status: "success" as const,
          result,
          duration: completedAt - startedAt,
          trace: Object.freeze({
            actionId,
            adapterId,
            profileType: context.profileType,
            unitId: context.unitId,
            startedAt,
            completedAt,
          } satisfies ActionTrace),
        });
      } catch (err) {
        const completedAt = Date.now();
        return Object.freeze({
          actionId,
          status: "error" as const,
          error: err instanceof Error ? err.message : String(err),
          duration: completedAt - startedAt,
          trace: Object.freeze({
            actionId,
            profileType: context.profileType,
            unitId: context.unitId,
            startedAt,
            completedAt,
          } satisfies ActionTrace),
        });
      }
    },
  };
}
