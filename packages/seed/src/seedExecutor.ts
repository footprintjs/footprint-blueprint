import type { SeedPlan, SeedApplier, SeedApplyResult, SeedExecutionResult } from "./types.js";

/**
 * Execute a seed plan by applying each entry through a SeedApplier.
 *
 * Entries are applied in order (by their `order` field). If an entry
 * fails, subsequent entries still execute (partial success).
 *
 * @example
 * ```ts
 * const result = await executeSeedPlan(plan, myPrismaApplier);
 * result.status; // "success" | "partial" | "error"
 * result.results; // per-entry results
 * ```
 */
export async function executeSeedPlan(
  plan: SeedPlan,
  applier: SeedApplier,
): Promise<SeedExecutionResult> {
  const start = Date.now();
  const results: SeedApplyResult[] = [];

  // Precompute blueprints map once (O(n) instead of O(n²))
  const blueprints: Record<string, unknown> = {};
  const entryByModule = new Map<string, typeof plan.entries[number]>();
  for (const entry of plan.entries) {
    blueprints[entry.moduleId] = entry.blueprint;
    entryByModule.set(entry.moduleId, entry);
  }

  // Build generated map incrementally
  const generated: Record<string, unknown> = {};

  for (const entry of plan.entries) {
    const context = {
      profileType: plan.profileType,
      unitId: plan.unitId,
      blueprints,
      generated: { ...generated },
    };

    try {
      const result = await applier.apply(entry, context);
      results.push(result);
      if (result.status === "success") {
        generated[entry.moduleId] = entry.transformed ?? entry.blueprint;
      }
    } catch (err) {
      results.push({
        moduleId: entry.moduleId,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const duration = Date.now() - start;
  const hasErrors = results.some((r) => r.status === "error");
  const allErrors = results.length > 0 && results.every((r) => r.status === "error");

  return {
    plan,
    results,
    status: allErrors ? "error" : hasErrors ? "partial" : "success",
    duration,
  };
}
