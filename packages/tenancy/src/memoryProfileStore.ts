import type { ProfileBinding, ProfileStore } from "./types.js";

/**
 * In-memory profile store — useful for testing and simple deployments.
 *
 * @example
 * ```ts
 * const store = createMemoryProfileStore([
 *   { unitId: "school-1", profileType: "dance", createdAt: "2024-01-01" },
 *   { unitId: "school-2", profileType: "k12", createdAt: "2024-01-01" },
 * ]);
 *
 * await store.getBinding("school-1"); // { unitId: "school-1", profileType: "dance", ... }
 * ```
 */
export function createMemoryProfileStore(
  bindings: readonly ProfileBinding[],
): ProfileStore & {
  /** Add a binding at runtime (for testing) */
  addBinding(binding: ProfileBinding): void;
  /** Remove a binding at runtime (for testing) */
  removeBinding(unitId: string): boolean;
  /** Get all bindings */
  allBindings(): readonly ProfileBinding[];
} {
  const store = new Map<string, ProfileBinding>();

  for (const binding of bindings) {
    if (store.has(binding.unitId)) {
      throw new Error(`Duplicate binding for unit "${binding.unitId}"`);
    }
    store.set(binding.unitId, Object.freeze(binding));
  }

  return {
    async getBinding(unitId: string): Promise<ProfileBinding | undefined> {
      return store.get(unitId);
    },

    addBinding(binding: ProfileBinding): void {
      if (store.has(binding.unitId)) {
        throw new Error(`Duplicate binding for unit "${binding.unitId}"`);
      }
      store.set(binding.unitId, Object.freeze(binding));
    },

    removeBinding(unitId: string): boolean {
      return store.delete(unitId);
    },

    allBindings(): readonly ProfileBinding[] {
      return Object.freeze(Array.from(store.values()));
    },
  };
}
