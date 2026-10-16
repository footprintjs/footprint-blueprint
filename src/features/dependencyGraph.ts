import { immutableMap, immutableSet, immutableValue } from "./immutable.js";
import type { ModuleDefinition, ValidationError } from "./types.js";

/**
 * Resolve transitive dependencies for a set of module IDs.
 *
 * Given ["attendance"] and a registry where attendance requires ["students", "academics"],
 * and academics requires ["students"], returns the full set: {"attendance", "academics", "students"}.
 *
 * Detects circular dependencies and missing modules.
 */
export function resolveTransitiveDependencies(
  moduleIds: readonly string[],
  registry: ReadonlyMap<string, ModuleDefinition>
): { resolved: ReadonlySet<string>; errors: readonly ValidationError[] } {
  const resolved = new Set<string>();
  const errors: ValidationError[] = [];
  const visiting = new Set<string>(); // cycle detection
  const failed = new Set<string>();

  function visit(id: string, chain: readonly string[]): boolean {
    if (resolved.has(id)) return true;
    if (failed.has(id)) return false;

    if (visiting.has(id)) {
      errors.push({
        type: "circular_dependency",
        moduleId: id,
        message: `Circular dependency detected: ${[...chain, id].join(" → ")}`,
        details: { chain: [...chain, id] },
      });
      failed.add(id);
      return false;
    }

    const mod = registry.get(id);
    if (!mod) {
      errors.push({
        type: "unknown_module",
        moduleId: id,
        message: `Module "${id}" is not registered`,
      });
      failed.add(id);
      return false;
    }

    visiting.add(id);
    let complete = true;
    for (const dep of mod.requires) {
      if (!visit(dep, [...chain, id])) complete = false;
    }
    visiting.delete(id);
    if (!complete) { failed.add(id); return false; }
    resolved.add(id);
    return true;
  }

  for (const id of moduleIds) {
    visit(id, []);
  }

  return { resolved: immutableSet(resolved), errors: immutableValue(errors) };
}

/**
 * Build a dependency tree: for each module, list its direct dependencies.
 * Only includes modules in the resolved set.
 */
export function buildDependencyTree(
  resolved: ReadonlySet<string>,
  registry: ReadonlyMap<string, ModuleDefinition>
): ReadonlyMap<string, readonly string[]> {
  const tree = new Map<string, readonly string[]>();
  for (const id of resolved) {
    const mod = registry.get(id);
    if (mod) {
      tree.set(id, Object.freeze(mod.requires.filter((dep) => resolved.has(dep))));
    }
  }
  return immutableMap(tree);
}

/**
 * Validate that all module definitions in a registry have consistent dependencies.
 * Returns errors for any modules that reference unknown dependencies.
 */
export function validateRegistry(
  registry: ReadonlyMap<string, ModuleDefinition>
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [id, mod] of registry) {
    for (const dep of mod.requires) {
      if (!registry.has(dep)) {
        errors.push({
          type: "missing_dependency",
          moduleId: id,
          message: `Module "${id}" requires "${dep}" which is not registered`,
          details: { missingDep: dep },
        });
      }
    }
  }

  // Check for circular dependencies by resolving all modules
  const allIds = Array.from(registry.keys());
  const { errors: circularErrors } = resolveTransitiveDependencies(allIds, registry);
  errors.push(...circularErrors);

  return errors;
}
