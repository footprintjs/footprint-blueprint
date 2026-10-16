# Features — footprint-blueprint/features

This module ships inside the single `footprint-blueprint@0.4.0` package. Use its focused public import path; see [the framework README](../README.md) and [release runbook](RELEASE.md).

Declarative module registry — define once, derive everything.

## Why this exists

Building a configurable platform means different customers need different features. A dance school needs attendance and scheduling. A tutoring center just needs students and fees. An e-commerce store needs inventory, payments, and shipping.

Without a system, you end up with scattered if-statements, inconsistent feature flags, and no way to reason about what's enabled where.

`footprint-blueprint/features` solves this by making **module definitions the single source of truth**. Define your modules once — with their dependencies, terminology, roles, and seed data — and the library derives everything else automatically.

This is Layer 1 of the [footprint-blueprint](../README.md) framework.

## What it does

```
defineModule()  ──┐
                  ├──→ createModuleRegistry() ──→ resolveProfileConfig() ──┬──→ feature gates
defineProfile() ──┘                                                        ├──→ terminology
                                                                           ├──→ roles
                                                                           ├──→ seed data
                                                                           └──→ dependency tree
```

One definition drives:
- **Feature gates** — is this module enabled for this profile?
- **Terminology** — "Grade" in K-12, "Level" in a dance school, "SKU" in e-commerce
- **Roles** — merged from profile defaults + module declarations
- **Seed data** — initial data blueprints per profile type
- **Dependency tree** — transitive deps resolved automatically with cycle detection

## Quick start

```typescript
import {
  defineModule,
  defineProfile,
  createModuleRegistry,
  resolveProfileConfig,
  createFeatureGate,
  createTermResolver,
} from "footprint-blueprint/features";

// 1. Define modules
const students = defineModule({
  id: "students",
  name: "Student Management",
  domain: "people",
  terminology: { student: { default: "Student", tutoring: "Learner" } },
  roles: { canEnroll: ["Admin", "Owner"] },
  seed: { default: { fields: ["name", "dob", "contact"] } },
});

const attendance = defineModule({
  id: "attendance",
  name: "Attendance Tracking",
  domain: "academics",
  requires: ["students"],
  terminology: { session: { default: "Session", dance: "Check-in" } },
});

// 2. Define profiles
const danceSchool = defineProfile({
  type: "dance",
  displayName: "Dance School",
  modules: ["students", "attendance"],
  roles: ["Owner", "Instructor"],
});

// 3. Create registry
const registry = createModuleRegistry({
  modules: [students, attendance],
  profileTypes: [danceSchool],
});

// 4. Resolve config
const config = resolveProfileConfig(registry, "dance");

// 5. Gate features
const gate = createFeatureGate(config);
gate.isEnabled("attendance"); // true
gate.isEnabled("billing");    // false

// 6. Resolve terminology
const t = createTermResolver(config.terminology);
t("session"); // "Check-in"
t("student"); // "Student" (default — no dance-specific override)
```

## API

| Export | Purpose |
|--------|---------|
| `defineModule(input)` | Create an immutable module definition |
| `defineProfile(input)` | Create an immutable profile preset |
| `createModuleRegistry({ modules, profileTypes })` | Build the central catalog |
| `resolveProfileConfig(registry, profileType, overrides?)` | Derive full config |
| `createFeatureGate(config)` | Gate features by enabled modules |
| `createTermResolver(terminology)` | Resolve terminology labels |
| `resolveTransitiveDependencies(ids, registry)` | Advanced: manual dep resolution |
| `buildDependencyTree(resolved, registry)` | Advanced: build dep tree |
| `validateRegistry(registry)` | Advanced: validate all definitions |

## Domain-agnostic

Nothing in this library is specific to schools, e-commerce, or any domain. Replace "dance school" with "clothing store" or "dental clinic" — the pattern is identical:

| Concept | Schools | E-commerce | Healthcare |
|---------|---------|------------|------------|
| **Profile** | K-12, Dance | Clothing, Electronics | Clinic, Hospital |
| **Module** | attendance, fees | inventory, shipping | appointments, billing |
| **Terminology** | "Grade" vs "Level" | "Product" vs "Item" | "Patient" vs "Client" |
| **Seed data** | Grade structures | Product categories | Appointment types |

## Testing

The inherited Features suite contains 136 checks covering pure definitions, realistic profile scenarios, property invariants, boundaries, validation and immutable snapshots. The consolidated Blueprint suite contains 440 tests. Consult the candidate's generated release validation record for actual results.

From the Blueprint repository root:

```bash
pnpm test
```

## Design principles

1. **Zero IO** — pure functions, no network, no filesystem, no database
2. **Immutable** — all outputs are `Object.freeze`'d, no runtime mutations
3. **Focused runtime graph** — the Features entry uses framework pure functions without loading the FootPrint executor; package installation still includes declared runtime dependencies
4. **Fail loud** — invalid definitions throw immediately, not at resolution time
5. **Consumer decides** — the library gives you seed blueprints, you decide how to apply them


## Contracts retained from the 0.2 migration

Resolution fails closed: unknown profiles, unknown modules, missing prerequisites, and dependency cycles throw. Call `registry.validate()` at startup to report the full definition graph; do not continue startup with its errors. An explicit empty module override is supported for a known profile.

Definitions and resolved configurations are cloned snapshots. Their nested plain objects and arrays are frozen. Registry Maps, resolved Sets, and dependency Maps expose a read-only facade with `get`, `has`, iteration, and `forEach`; they do not expose native mutation methods or raw backing collections. Convert them with `Array.from()` when producing serialized DTOs. Definition data supports plain objects/arrays/primitive values; accessors, functions, symbols, custom instances, and cycles are rejected. Adapter functions belong in injected ports rather than definition data.

A feature gate describes enabled modules. It does not authorize a user or validate business commands. Keep those checks at the authenticated action/domain boundary.
