/**
 * footprint-blueprint/seed — Seed data templates and generators.
 *
 * Given a resolved profile config, generates a seed plan that describes
 * what initial data to create. The consumer applies the plan using their
 * own data access layer (Prisma, SQL, API, etc.).
 *
 * @example
 * ```ts
 * import { resolveProfileConfig } from "footprint-blueprint/features";
 * import { generateSeedPlan, executeSeedPlan } from "footprint-blueprint/seed";
 *
 * const config = resolveProfileConfig(registry, "dance");
 * const plan = generateSeedPlan(config, "school-1");
 *
 * // Apply with your own adapter
 * const result = await executeSeedPlan(plan, myApplier);
 * ```
 */

// Types
export type {
  SeedPlan,
  SeedEntry,
  SeedGenerator,
  SeedContext,
  SeedApplier,
  SeedApplyResult,
  SeedExecutionResult,
  SeedExecutionOptions,
} from "./types.js";

// Plan generation
export { generateSeedPlan } from "./seedPlan.js";

// Plan execution
export { executeSeedPlan } from "./seedExecutor.js";
