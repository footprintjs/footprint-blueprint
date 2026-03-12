import { createFeatureGate } from "@footprint/features";
import type { ProfileResolver } from "./profileResolver.js";
import type {
  TenantContext,
  TenantGateResult,
  GateMiddlewareResult,
} from "./types.js";

/**
 * Feature gate middleware — checks if all required modules are enabled
 * for the current tenant before allowing the request to proceed.
 *
 * @example
 * ```ts
 * const gateCheck = createGateMiddleware(resolver);
 *
 * // In a Fastify route:
 * app.addHook("preHandler", async (req, reply) => {
 *   const result = await gateCheck(req.ctx, ["attendance", "scheduling"]);
 *   if (!result.allowed) {
 *     reply.code(403).send({ error: "Module not enabled", denied: result.denied });
 *   }
 * });
 * ```
 */

export type GateMiddleware = (
  ctx: TenantContext,
  requiredModules: readonly string[],
) => Promise<GateMiddlewareResult>;

/**
 * Create a gate middleware function.
 *
 * The middleware resolves the profile for the tenant, creates a feature gate,
 * and checks each required module. If any module is not enabled, the request
 * is denied with a detailed reason.
 */
export function createGateMiddleware(resolver: ProfileResolver): GateMiddleware {
  return async (
    ctx: TenantContext,
    requiredModules: readonly string[],
  ): Promise<GateMiddlewareResult> => {
    if (requiredModules.length === 0) {
      return { allowed: true, denied: [] };
    }

    const config = await resolver.resolve(ctx);
    const gate = createFeatureGate(config);
    const denied: TenantGateResult[] = [];

    for (const moduleId of requiredModules) {
      const check = gate.check(moduleId);
      if (!check.allowed) {
        denied.push({
          allowed: false,
          moduleId,
          unitId: ctx.unitId,
          profileType: config.profileType,
          reason: check.reason,
        });
      }
    }

    return {
      allowed: denied.length === 0,
      denied,
    };
  };
}
