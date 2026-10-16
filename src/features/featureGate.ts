import type { GateResult, ResolvedProfileConfig } from "./types.js";

/**
 * A feature gate checks whether a module is enabled for a specific school.
 *
 * @example
 * ```ts
 * const gate = createFeatureGate(resolvedConfig);
 * gate.isEnabled("attendance");     // true
 * gate.isEnabled("departments");    // false
 * gate.check("departments");
 * // { allowed: false, moduleId: "departments", reason: "Module not enabled for this school" }
 * ```
 */
export type FeatureGate = {
  /** Quick boolean check */
  isEnabled(moduleId: string): boolean;
  /** Detailed check with reason */
  check(moduleId: string): GateResult;
  /** List all enabled module IDs */
  enabledModules(): readonly string[];
};

/**
 * Create a feature gate from a resolved school configuration.
 */
export function createFeatureGate(config: ResolvedProfileConfig): FeatureGate {
  const enabled = config.enabledModules;
  const frozenList = Object.freeze(Array.from(enabled));

  return {
    isEnabled(moduleId: string): boolean {
      return enabled.has(moduleId);
    },

    check(moduleId: string): GateResult {
      if (enabled.has(moduleId)) {
        return {
          allowed: true,
          moduleId,
          reason: `Module "${moduleId}" is enabled for ${config.profileType} school`,
        };
      }

      return {
        allowed: false,
        moduleId,
        reason: `Module "${moduleId}" is not enabled for ${config.profileType} school`,
      };
    },

    enabledModules(): readonly string[] {
      return frozenList;
    },
  };
}
