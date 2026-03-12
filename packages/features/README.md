# @footprint/features

Declarative module registry — define once, derive everything.

## Why this exists

Building a configurable platform means different customers need different features. A dance school needs attendance and scheduling. A tutoring center just needs students and fees. An e-commerce store needs inventory, payments, and shipping.

Without a system, you end up with scattered if-statements, inconsistent feature flags, and no way to reason about what's enabled where.

`@footprint/features` solves this by making **module definitions the single source of truth**. Define your modules once — with their dependencies, terminology, roles, and seed data — and the library derives everything else automatically.

This is Layer 1 of the [footprint-blueprint](../../) framework.

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
} from "@footprint/features";

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

126 tests across 5 categories:

| Category | What it verifies |
|----------|-----------------|
| **Unit** (67) | Pure function logic — defineModule, defineProfile, registry, terminology, gates, config |
| **Scenario** (19) | Realistic end-to-end: 11 modules, 5 profiles, full resolution + gating |
| **Property** (13) | Invariants via fast-check: frozen outputs, superset guarantees, consistency |
| **Boundary** (8) | 500 modules, 50-level dep chains, zero modules, edge cases |
| **Security** (19) | Validation, injection prevention, immutability, prototype pollution |

```bash
pnpm test
```

## Design principles

1. **Zero IO** — pure functions, no network, no filesystem, no database
2. **Immutable** — all outputs are `Object.freeze`'d, no runtime mutations
3. **Zero dependencies** — only TypeScript, nothing else at runtime
4. **Fail loud** — invalid definitions throw immediately, not at resolution time
5. **Consumer decides** — the library gives you seed blueprints, you decide how to apply them
