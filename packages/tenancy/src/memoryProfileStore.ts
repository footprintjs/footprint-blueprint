import type { ProfileBinding, ProfileScope, ProfileStore } from './types.js';
import { bindingRevision, captureProfileBinding, normalizedProfileScope, profileScopeKey } from './profileScope.js';

export type MemoryProfileStore = ProfileStore & {
  addBinding(binding: ProfileBinding): void;
  /** Same scope only; the next revision must be expectedRevision + 1. */
  updateBinding(binding: ProfileBinding, expectedRevision: number): void;
  removeBinding(scope: ProfileScope, expectedRevision: number): boolean;
  /** Enumerate one tenant/campus namespace, never all tenants implicitly. */
  allBindings(namespace: Pick<ProfileScope, 'tenantId' | 'campusId'>): readonly ProfileBinding[];
};

/** Test/local adapter. Persistent adapters must enforce equivalent scope and revision checks. */
export function createMemoryProfileStore(bindings: readonly ProfileBinding[]): MemoryProfileStore {
  const store = new Map<string, ProfileBinding>();
  const addBinding = (binding: ProfileBinding) => {
    const captured = captureProfileBinding(binding);
    const key = profileScopeKey(captured);
    if (store.has(key)) throw new Error(`Duplicate binding for scope ${key}`);
    store.set(key, captured);
  };
  for (const binding of bindings) addBinding(binding);
  return {
    async getBinding(scope) { return store.get(profileScopeKey(scope)); },
    addBinding,
    updateBinding(binding, expectedRevision) {
      const captured = captureProfileBinding(binding);
      const key = profileScopeKey(captured);
      const current = store.get(key);
      bindingRevision(expectedRevision);
      if (!current || current.revision !== expectedRevision || captured.revision !== expectedRevision + 1) throw new Error('Profile binding revision conflict');
      store.set(key, captured);
    },
    removeBinding(scope, expectedRevision) {
      const key = profileScopeKey(scope);
      bindingRevision(expectedRevision);
      const current = store.get(key);
      if (!current) return false;
      if (current.revision !== expectedRevision) throw new Error('Profile binding revision conflict');
      return store.delete(key);
    },
    allBindings(namespace) {
      const scope = normalizedProfileScope({ ...namespace, unitId: 'namespace' });
      return Object.freeze([...store.values()].filter((binding) => binding.tenantId === scope.tenantId && binding.campusId === scope.campusId));
    },
  };
}
