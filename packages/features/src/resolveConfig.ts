import type { ModuleDefinition, ResolvedProfileConfig, ValidationError } from "./types.js";
import type { ModuleRegistry } from "./moduleRegistry.js";
import { resolveTransitiveDependencies, buildDependencyTree } from "./dependencyGraph.js";
import { resolveTerminology } from "./terminology.js";

/**
 * Resolve the full configuration for a profile type.
 *
 * This is the "define once, derive everything" function. Given a profile
 * and a registry of modules, it produces:
 * - Which modules are enabled (including transitive dependencies)
 * - Resolved terminology labels
 * - Merged roles
 * - Seed data blueprints
 * - The full dependency tree
 * - Warnings for any issues encountered (e.g., unknown modules skipped)
 *
 * Throws on circular dependencies (unrecoverable).
 * Skips unknown modules and surfaces them as warnings.
 *
 * @param moduleOverrides - Optional list of module IDs to use instead of the
 *   profile's defaults. Useful when a unit has customized its modules.
 */
export function resolveProfileConfig(
  registry: ModuleRegistry,
  profileType: string,
  moduleOverrides?: readonly string[]
): ResolvedProfileConfig {
  const profileTypeDef = registry.getProfile(profileType);

  // Determine which modules to enable
  const requestedModules = moduleOverrides
    ?? profileTypeDef?.modules
    ?? [];

  if (requestedModules.length === 0) {
    return emptyConfig(profileType);
  }

  // Resolve transitive dependencies
  const allModules = registry.getAllModules();
  const { resolved, errors } = resolveTransitiveDependencies(requestedModules, allModules);

  const warnings: ValidationError[] = [];

  if (errors.length > 0) {
    for (const err of errors) {
      if (err.type === "circular_dependency") {
        throw new Error(err.message);
      }
      if (err.type === "unknown_module") {
        resolved.delete(err.moduleId);
        warnings.push(err);
      }
    }
  }

  // Build enabled module map
  const enabledModuleMap = new Map<string, ModuleDefinition>();
  for (const id of resolved) {
    const mod = allModules.get(id);
    if (mod) enabledModuleMap.set(id, mod);
  }

  // Resolve terminology
  const enabledModuleDefs = Array.from(enabledModuleMap.values());
  const terminology = resolveTerminology(profileType, enabledModuleDefs);

  // Merge roles: profile roles + module-declared roles
  const roleSet = new Set<string>();
  if (profileTypeDef) {
    for (const role of profileTypeDef.roles) {
      roleSet.add(role);
    }
  }
  for (const mod of enabledModuleDefs) {
    for (const roleList of Object.values(mod.roles)) {
      for (const role of roleList) {
        roleSet.add(role);
      }
    }
  }

  // Collect seed blueprints
  const seed: Record<string, unknown> = {};
  for (const mod of enabledModuleDefs) {
    const moduleSeed = mod.seed[profileType] ?? mod.seed["default"] ?? null;
    if (moduleSeed !== null) {
      seed[mod.id] = moduleSeed;
    }
  }

  // Build dependency tree
  const dependencyTree = buildDependencyTree(resolved, allModules);

  return {
    profileType,
    enabledModules: resolved,
    modules: enabledModuleMap,
    terminology,
    roles: Object.freeze(Array.from(roleSet)),
    seed: Object.freeze(seed),
    dependencyTree,
    warnings: Object.freeze(warnings),
  };
}

function emptyConfig(profileType: string): ResolvedProfileConfig {
  return {
    profileType,
    enabledModules: new Set(),
    modules: new Map(),
    terminology: {},
    roles: [],
    seed: {},
    dependencyTree: new Map(),
    warnings: [],
  };
}
