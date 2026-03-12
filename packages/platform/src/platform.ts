/**
 * Platform factory — creates a fully wired platform instance.
 *
 * This is the main orchestration function that ties together all
 * packages: features, tenancy, seed, adapters, and actions.
 */

import { createTermResolver } from "@footprint/features";
import {
  createProfileResolver,
  createGateMiddleware,
} from "@footprint/tenancy";
import type { TenantContext, GateMiddlewareResult } from "@footprint/tenancy";
import { generateSeedPlan } from "@footprint/seed";
import { createServiceBridge } from "@footprint/adapters";
import type { ServiceBridge } from "@footprint/adapters";
import { createActionExecutor } from "@footprint/actions";
import type { ActionResult, MCPToolDefinition } from "@footprint/actions";
import type { Platform, PlatformConfig, UnitSetupResult } from "./types.js";

/**
 * Create a fully configured platform instance.
 *
 * @example
 * ```ts
 * const platform = createPlatform({
 *   registry,
 *   profileStore,
 *   adapterRegistry,
 *   actionRegistry,
 * });
 *
 * const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });
 * const setup = await platform.setupUnit(ctx);
 * ```
 */
export function createPlatform(config: PlatformConfig): Platform {
  const resolver = createProfileResolver(config.registry, config.profileStore);
  const gateMiddleware = createGateMiddleware(resolver);

  // Service bridge is only created if an adapter registry is provided
  let bridge: ServiceBridge | undefined;
  if (config.adapterRegistry) {
    bridge = createServiceBridge(config.adapterRegistry);
  }

  // Action executor delegates to the bridge for capability-based actions
  const executor = config.actionRegistry
    ? createActionExecutor(config.actionRegistry, bridge)
    : undefined;

  return {
    async resolveUnit(ctx: TenantContext): Promise<UnitSetupResult> {
      const profileConfig = await resolver.resolve(ctx);
      return {
        unitId: ctx.unitId,
        profileType: profileConfig.profileType,
        config: profileConfig,
      };
    },

    async setupUnit(ctx: TenantContext): Promise<UnitSetupResult> {
      const profileConfig = await resolver.resolve(ctx);
      const seedPlan = generateSeedPlan(profileConfig, ctx.unitId);
      return {
        unitId: ctx.unitId,
        profileType: profileConfig.profileType,
        config: profileConfig,
        seedPlan,
      };
    },

    async gateCheck(
      ctx: TenantContext,
      requiredModules: readonly string[],
    ): Promise<GateMiddlewareResult> {
      return gateMiddleware(ctx, requiredModules);
    },

    async getTermResolver(ctx: TenantContext): Promise<(key: string) => string> {
      const profileConfig = await resolver.resolve(ctx);
      return createTermResolver(profileConfig.terminology);
    },

    async getAvailableActions(ctx: TenantContext): Promise<readonly MCPToolDefinition[]> {
      if (!config.actionRegistry) {
        return [];
      }
      const profileConfig = await resolver.resolve(ctx);
      return config.actionRegistry.toMCPTools(profileConfig.enabledModules);
    },

    async executeAction(
      ctx: TenantContext,
      actionId: string,
      input: unknown,
    ): Promise<ActionResult> {
      if (!executor || !config.actionRegistry) {
        return Object.freeze({
          actionId,
          status: "error" as const,
          error: "No action registry configured",
          duration: 0,
        });
      }

      const action = config.actionRegistry.getAction(actionId);
      if (!action) {
        return Object.freeze({
          actionId,
          status: "error" as const,
          error: `Unknown action: "${actionId}"`,
          duration: 0,
        });
      }

      // Resolve once, reuse for gate check and execution context
      const profileConfig = await resolver.resolve(ctx);

      const gateResult = await gateMiddleware(ctx, action.requiredModules);
      if (!gateResult.allowed) {
        const deniedModules = gateResult.denied.map((d) => d.moduleId).join(", ");
        return Object.freeze({
          actionId,
          status: "error" as const,
          error: `Action requires disabled modules: ${deniedModules}`,
          duration: 0,
        });
      }

      return executor.execute(actionId, input, {
        profileType: profileConfig.profileType,
        unitId: ctx.unitId,
        userId: ctx.userId,
      });
    },
  };
}
