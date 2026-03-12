import type { ModuleDefinition, ProfileDefinition, ValidationError } from "./types.js";
import { validateRegistry } from "./dependencyGraph.js";

/**
 * A registry of module and profile definitions.
 *
 * The registry is the central catalog — all resolution, gating, and
 * terminology lookups go through it.
 *
 * @example
 * ```ts
 * const registry = createModuleRegistry({
 *   modules: [students, attendance, fees],
 *   profileTypes: [k12, danceSchool],
 * });
 *
 * registry.getModule("attendance");
 * registry.getProfile("dance");
 * registry.validate(); // checks all dependencies
 * ```
 */
export type ModuleRegistry = {
  /** Get a module definition by ID */
  getModule(id: string): ModuleDefinition | undefined;
  /** Get all registered module definitions */
  getAllModules(): ReadonlyMap<string, ModuleDefinition>;
  /** Get a profile definition by type */
  getProfile(type: string): ProfileDefinition | undefined;
  /** Get all registered profile definitions */
  getAllProfiles(): ReadonlyMap<string, ProfileDefinition>;
  /** Validate all definitions for consistency (missing deps, circular deps) */
  validate(): ValidationError[];
  /** List all registered module IDs */
  moduleIds(): readonly string[];
  /** List all registered profile IDs */
  profileTypeIds(): readonly string[];
};

export type ModuleRegistryInput = {
  modules: readonly ModuleDefinition[];
  profileTypes?: readonly ProfileDefinition[];
};

/**
 * Create a module registry from a set of definitions.
 *
 * The registry itself is immutable — you cannot add or remove modules
 * after creation. This prevents runtime mutations that would make
 * behavior unpredictable.
 */
export function createModuleRegistry(input: ModuleRegistryInput): ModuleRegistry {
  const modules = new Map<string, ModuleDefinition>();
  const profileTypes = new Map<string, ProfileDefinition>();

  for (const mod of input.modules) {
    if (modules.has(mod.id)) {
      throw new Error(`Duplicate module ID: "${mod.id}"`);
    }
    modules.set(mod.id, mod);
  }

  for (const st of input.profileTypes ?? []) {
    if (profileTypes.has(st.type)) {
      throw new Error(`Duplicate profile: "${st.type}"`);
    }
    profileTypes.set(st.type, st);
  }

  const frozenModuleIds = Object.freeze(Array.from(modules.keys()));
  const frozenProfileTypeIds = Object.freeze(Array.from(profileTypes.keys()));

  return {
    getModule(id: string) {
      return modules.get(id);
    },
    getAllModules() {
      return modules;
    },
    getProfile(type: string) {
      return profileTypes.get(type);
    },
    getAllProfiles() {
      return profileTypes;
    },
    validate() {
      const errors: ValidationError[] = [];

      // Validate module dependency graph
      errors.push(...validateRegistry(modules));

      // Validate profiles reference existing modules
      for (const [type, st] of profileTypes) {
        for (const modId of st.modules) {
          if (!modules.has(modId)) {
            errors.push({
              type: "unknown_module",
              moduleId: modId,
              message: `Profile "${type}" references unknown module "${modId}"`,
              details: { profileType: type },
            });
          }
        }
      }

      return errors;
    },
    moduleIds() {
      return frozenModuleIds;
    },
    profileTypeIds() {
      return frozenProfileTypeIds;
    },
  };
}
