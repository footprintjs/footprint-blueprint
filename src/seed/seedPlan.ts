import { immutableValue } from '../features/index.js';
import type { ResolvedProfileConfig } from '../features/index.js';
import type { SeedPlan, SeedEntry, SeedGenerator } from './types.js';

/** Generate immutable authoring data in dependency order before invoking any generator. */
export function generateSeedPlan(config: ResolvedProfileConfig, unitId: string, generators: readonly SeedGenerator[] = []): SeedPlan {
  if (typeof unitId !== 'string' || !unitId.trim()) throw new Error('Seed unitId is required');
  const generatorMap = new Map<string, SeedGenerator>();
  for (const generator of generators) {
    if (generatorMap.has(generator.moduleId)) throw new Error(`Duplicate seed generator for ${generator.moduleId}`);
    generatorMap.set(generator.moduleId, generator);
  }
  const depths = new Map<string, number>();
  const prerequisites = new Map<string, readonly string[]>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (!config.enabledModules.has(id)) throw new Error(`Seed prerequisite ${id} is not enabled`);
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) throw new Error(`Circular seed dependency at ${id}`);
    visiting.add(id);
    const deps = config.dependencyTree.get(id) ?? [];
    const all = new Set<string>();
    let order = 0;
    for (const dep of deps) {
      order = Math.max(order, depth(dep) + 1);
      all.add(dep);
      for (const transitive of prerequisites.get(dep) ?? []) all.add(transitive);
    }
    visiting.delete(id);
    depths.set(id, order);
    prerequisites.set(id, Object.freeze([...all]));
    return order;
  };
  for (const id of config.enabledModules) depth(id);
  const seedIds = Object.keys(config.seed);
  for (const id of seedIds) if (!config.enabledModules.has(id)) throw new Error(`Seed module ${id} is not enabled`);
  seedIds.sort((a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0));
  const seedSet = new Set(seedIds);
  const blueprints = immutableValue(config.seed);
  const generated: Record<string, unknown> = Object.create(null);
  const entries: SeedEntry[] = [];
  for (const moduleId of seedIds) {
    const blueprint = blueprints[moduleId];
    const generator = generatorMap.get(moduleId);
    const transformed = generator?.generate(blueprint, Object.freeze({ profileType: config.profileType, unitId: unitId.trim(), blueprints, generated: immutableValue(generated) }));
    const entry = immutableValue({
      moduleId, blueprint, ...(generator ? { transformed } : {}),
      order: depths.get(moduleId) ?? 0,
      requires: (prerequisites.get(moduleId) ?? []).filter((id) => seedSet.has(id)),
    });
    entries.push(entry);
    // Dependent generators see the concrete output (or unchanged blueprint).
    generated[moduleId] = generator ? entry.transformed : entry.blueprint;
  }
  return Object.freeze({ profileType: config.profileType, unitId: unitId.trim(), entries: Object.freeze(entries), generatedAt: new Date().toISOString() });
}
