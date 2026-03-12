import type { ResolvedProfileConfig } from "@footprint/features";
import type { SeedPlan, SeedEntry, SeedGenerator } from "./types.js";

/**
 * Generate a seed plan from a resolved profile config.
 *
 * The plan contains one entry per enabled module that has seed data.
 * Entries are ordered by dependency depth (modules with no deps first).
 *
 * @example
 * ```ts
 * const plan = generateSeedPlan(config, "school-1");
 * plan.entries; // [{ moduleId: "students", blueprint: {...}, order: 0 }, ...]
 * ```
 *
 * @param generators - Optional generators to transform blueprints
 */
export function generateSeedPlan(
  config: ResolvedProfileConfig,
  unitId: string,
  generators?: readonly SeedGenerator[],
): SeedPlan {
  const generatorMap = new Map<string, SeedGenerator>();
  for (const gen of generators ?? []) {
    generatorMap.set(gen.moduleId, gen);
  }

  // Build dependency depth map for ordering
  const depthMap = computeDepthMap(config);

  // Create entries from seed blueprints
  const entries: SeedEntry[] = [];
  for (const [moduleId, blueprint] of Object.entries(config.seed)) {
    const depth = depthMap.get(moduleId) ?? 0;
    const generator = generatorMap.get(moduleId);

    const context = {
      profileType: config.profileType,
      unitId,
      blueprints: config.seed,
      generated: Object.fromEntries(
        entries
          .filter((e) => e.transformed !== undefined)
          .map((e) => [e.moduleId, e.transformed]),
      ),
    };

    const entry: SeedEntry = {
      moduleId,
      blueprint,
      ...(generator ? { transformed: generator.generate(blueprint, context) } : {}),
      order: depth,
    };

    entries.push(entry);
  }

  // Sort by order (lower = first)
  entries.sort((a, b) => a.order - b.order);

  return Object.freeze({
    profileType: config.profileType,
    unitId,
    entries: Object.freeze(entries.map((e) => Object.freeze(e))),
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Compute the dependency depth for each module.
 * Modules with no deps = 0, modules depending on depth-0 = 1, etc.
 *
 * Uses a single shared `visiting` set with proper backtracking (delete after
 * recursion) to correctly handle diamond dependencies: A→B→D, A→C→D.
 */
function computeDepthMap(config: ResolvedProfileConfig): Map<string, number> {
  const depths = new Map<string, number>();
  const visiting = new Set<string>(); // cycle detection with backtracking

  function getDepth(moduleId: string): number {
    const cached = depths.get(moduleId);
    if (cached !== undefined) return cached;

    if (visiting.has(moduleId)) return 0; // cycle protection
    visiting.add(moduleId);

    const deps = config.dependencyTree.get(moduleId) ?? [];
    let depth: number;
    if (deps.length === 0) {
      depth = 0;
    } else {
      const maxDepth = Math.max(...deps.map((d) => getDepth(d)));
      depth = maxDepth + 1;
    }

    visiting.delete(moduleId); // backtrack
    depths.set(moduleId, depth);
    return depth;
  }

  for (const moduleId of config.enabledModules) {
    getDepth(moduleId);
  }

  return depths;
}
