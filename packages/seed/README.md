# @footprint/seed

Seed data templates and generators per profile type.

## Why this exists

When a new unit is created (a school, store, clinic), it needs initial data — grade structures, attendance statuses, fee models, product categories. Different profile types need different seed data.

Without a system, onboarding code becomes a mess of profile-specific if-statements with no consistent ordering or error handling.

`@footprint/seed` solves this by generating a **seed plan** from the resolved config. The plan describes what data to create, in what order (respecting module dependencies), with optional generators that transform raw blueprints into concrete data. The consumer applies the plan using their own data access layer.

This is Layer 3 of the [footprint-blueprint](../../) framework. It depends on `@footprint/features` (Layer 1).

## What it does

```
ResolvedProfileConfig
  → generateSeedPlan(config, unitId, generators?)
  → SeedPlan { entries: [{ moduleId, blueprint, transformed?, order }] }
  → executeSeedPlan(plan, applier)
  → SeedExecutionResult { status, results, duration }
```

1. **Plan generation** — one entry per module with seed data, ordered by dependency depth
2. **Generators** — optional transforms that expand blueprints into concrete data
3. **Execution** — sequential apply with error containment (one failure doesn't stop others)

## Quick start

```typescript
import { resolveProfileConfig } from "@footprint/features";
import { generateSeedPlan, executeSeedPlan } from "@footprint/seed";

const config = resolveProfileConfig(registry, "dance");
const plan = generateSeedPlan(config, "school-1");

// Apply with your own adapter
const result = await executeSeedPlan(plan, {
  async apply(entry, ctx) {
    await db.insert(entry.moduleId, entry.transformed ?? entry.blueprint);
    return { moduleId: entry.moduleId, status: "success", recordsCreated: 1 };
  },
});
```

## Testing

36 tests across 5 categories:

| Category | What it verifies |
|----------|-----------------|
| **Unit** (16) | Plan generation, ordering, generators, executor status logic |
| **Scenario** (8) | K-12 vs dance school setup, full generate+transform+apply flow |
| **Property** (3) | Entries subset of enabled modules, frozen plans, ordering invariant |
| **Boundary** (3) | 100 modules, 20-level deep chains, async timing |
| **Security** (6) | Immutability, generator error propagation, applier error containment |

```bash
pnpm test
```
