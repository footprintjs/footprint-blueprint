# @footprint/seed

Generate dependency-ordered initial data and apply it through an injected `SeedApplier`. The package supplies plans and explicit outcomes; the host supplies scoped data access, authorization, and persistence.

## Generate a plan

```ts
const config = resolveProfileConfig(registry, "fashion");
const plan = generateSeedPlan(config, "store-1", generators);
```

Generation sorts modules before calling any generator. A dependent generator sees previously captured prerequisite data through `context.generated`; this includes untransformed prerequisite blueprints. Each entry includes transitive `requires` that have seed entries, including prerequisites reached through modules without seed data. Cycles, disabled prerequisites, duplicate generators, and unknown seed modules are rejected.

Plans, blueprints, generated output, and context data are immutable snapshots of plain data. Generators must return plain objects/arrays/primitive values rather than provider instances. Bind the applier to the complete authenticated tenant/campus/unit scope; a plan's unit ID alone is not an authorization boundary.

## Apply a plan

```ts
const result = await executeSeedPlan(plan, scopedApplier); // default failureMode: "stop"
const partial = await executeSeedPlan(plan, scopedApplier, { failureMode: "partial" });
```

The default stops all later writes after the first `error` or `skipped` outcome. Later entries receive explicit skipped reasons. In partial mode, independent branches continue, but entries whose prerequisites did not succeed are skipped. If an adapter verifies an existing seed record as correct, return `success` with `recordsCreated: 0`; `skipped` is not a successful prerequisite receipt.

Receipts must identify the entry that was applied. Invalid or throwing receipts are reported as failures. An invalid or reordered plan is rejected before any adapter write.

**Execution is not atomic.** An earlier successful write remains persisted if a later entry fails; the result reports partial completion. This package does not roll back storage, compare-and-swap publication pointers, or publish a public storefront snapshot. Use the domain's transaction/publication service for those operations. Apply seed data to authoring state and publish through the guarded storefront engine afterward.

## Breaking changes from 0.1

- `SeedEntry.requires` is required for manually constructed plans.
- Generators run in dependency order before transformation.
- Execution stops after failure by default; partial continuation requires an explicit option.
- A dependent seed is never applied after a failed or skipped prerequisite.
