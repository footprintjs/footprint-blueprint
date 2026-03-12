# footprint-blueprint

**Define once, derive everything** — a domain-agnostic platform framework for building configurable multi-tenant systems.

## The problem

You're building a platform that serves different types of customers. Each customer type needs a different set of features, different terminology, different behavior for the same operations, and different seed data to get started.

Without structure, you get:
- Scattered `if (customerType === "...")` checks everywhere
- Features silently missing for some customers
- Inconsistent terminology across the UI
- No way for an AI to reason about what's enabled where
- Adapter logic tangled with business logic

## The solution

footprint-blueprint gives you a **layered framework** where one definition drives everything. Define your modules and profiles once, and the framework derives feature gates, terminology, roles, seed data, dependency trees, adapter routing, action registries, and MCP/OpenAPI exports — all from that single source of truth.

```typescript
// Define what exists
const attendance = defineModule({
  id: "attendance",
  name: "Attendance Tracking",
  domain: "academics",
  requires: ["students"],
  terminology: {
    session: { default: "Session", dance: "Check-in", clinic: "Visit" },
  },
});

// Define who gets what
const danceSchool = defineProfile({
  type: "dance",
  displayName: "Dance School",
  modules: ["students", "attendance", "fees"],
  roles: ["Owner", "Instructor"],
});

// Derive everything
const config = resolveProfileConfig(registry, "dance");
// → enabledModules: {students, attendance, fees}
// → terminology: { session: "Check-in", ... }
// → roles: ["Owner", "Instructor", "Admin", ...]
// → seed: { attendance: {...}, fees: { model: "per-class" } }
// → dependencyTree: Map { attendance → [students], ... }
// → warnings: []
```

## Why "blueprint"?

A blueprint is a plan that produces different buildings from the same architectural system. footprint-blueprint is the architectural system — you define the modules, profiles, and adapters, and it produces the right platform variant for each customer.

This is not a school system, not an e-commerce engine, not a healthcare platform. It's the **framework for building any of those** — the configurable layer beneath the domain-specific one.

## Architecture

```
Layer 1: features    → Module registry, profiles, gates, terminology, seed definitions
Layer 2: tenancy     → Multi-tenant context, profile resolution, gate middleware
Layer 3: seed        → Seed plan generation and execution per profile per module
Layer 4: adapters    → Capability contracts, adapter routing, service bridge
Layer 5: actions     → Action registry, MCP/OpenAPI export, traced execution
Layer 6: platform    → Orchestration — single entry point wiring all layers
```

```
features ← tenancy ← seed ← adapters ← actions ← platform
                                           ↑
                                      footprintjs
```

Dependencies flow strictly upward. No cycles, no peer deps between layers. Each package is independently testable, publishable, and replaceable.

## Packages

| Package | Layer | Purpose | Tests |
|---------|-------|---------|-------|
| [@footprint/features](packages/features/) | 1 | Module registry — define modules, profiles, feature gates, terminology | 129 |
| [@footprint/tenancy](packages/tenancy/) | 2 | Multi-tenant context resolution, profile binding, gate middleware | 62 |
| [@footprint/seed](packages/seed/) | 3 | Seed plan generation and execution per profile per module | 37 |
| [@footprint/adapters](packages/adapters/) | 4 | Capability contracts, adapter registry, service bridge | 39 |
| [@footprint/actions](packages/actions/) | 5 | Action registry, MCP/OpenAPI export, traced execution | 49 |
| [@footprint/platform](packages/platform/) | 6 | Orchestration — single entry point wiring all layers | 34 |

**350 tests** across 6 packages. Every package has unit, scenario, property-based, boundary, and security tests.

## How it works

### 1. Define modules (Layer 1)

Modules are the atomic units of your platform. Each module declares what it needs, what terms it uses, what roles it introduces, and what seed data it carries.

```typescript
import { defineModule } from "@footprint/features";

const scheduling = defineModule({
  id: "scheduling",
  name: "Scheduling",
  domain: "operations",
  requires: ["students", "academics"],
  capabilities: ["schedule-class"],
  terminology: {
    slot: { default: "Period", dance: "Time Slot", clinic: "Appointment" },
  },
  roles: { canSchedule: ["Admin", "Coordinator"] },
  seed: {
    k12: { pattern: "fixed-timetable", periods: 8 },
    dance: { pattern: "time-slots", duration: 60 },
  },
});
```

### 2. Define profiles (Layer 1)

Profiles are customer archetypes. Each profile cherry-picks which modules it needs.

```typescript
import { defineProfile } from "@footprint/features";

const danceSchool = defineProfile({
  type: "dance",
  displayName: "Dance School",
  modules: ["students", "attendance", "scheduling", "fees"],
  roles: ["Owner", "Instructor", "Front Desk"],
  schedulingPattern: "time-slots",
});
```

### 3. Resolve everything (Layer 1)

One call derives the full configuration — enabled modules (with transitive dependencies resolved), merged terminology, merged roles, profile-specific seed data, and the dependency tree.

```typescript
const config = resolveProfileConfig(registry, "dance");
```

This is the **Profile-Derived Context (PDC)** pattern — a single pure function call that produces all the runtime context a profile needs, in O(n×d) time where n is the number of modules and d is the dependency depth.

### 4. Gate features at runtime (Layer 2)

Tenancy binds profiles to units (tenants, campuses, stores — whatever your domain calls them) and gates features in middleware.

```typescript
const resolver = createProfileResolver(registry, profileStore);
const config = await resolver.resolve(ctx);
const gate = createFeatureGate(config);

if (gate.isEnabled("scheduling")) {
  // show scheduling UI
}
```

### 5. Route to the right adapter (Layer 4)

Different profiles need different implementations for the same operation. The adapter registry and service bridge handle this routing.

```typescript
const bridge = createServiceBridge(adapterRegistry);

// Same operation, different implementation per profile
const result = await bridge.execute("schedule-class", input, {
  profileType: "dance",  // → uses time-slots adapter
  unitId: "studio-1",
});
```

### 6. Export actions for AI consumption (Layer 5)

Actions are exported as MCP tool definitions (for LLMs) or OpenAPI specs (for REST clients) via the SchemaExporter adapter pattern.

```typescript
// Built-in MCP export
const tools = actionRegistry.toMCPTools(config.enabledModules);

// Built-in OpenAPI export
const openapi = actionRegistry.exportActions(config.enabledModules, createOpenAPIExporter());

// Custom export format
const custom = actionRegistry.exportActions(config.enabledModules, myCustomExporter);
```

### 7. Wire everything with one call (Layer 6)

The platform package is the glue. One `createPlatform()` call wires all layers together.

```typescript
const platform = createPlatform({ registry, profileStore, adapterRegistry, actionRegistry });

const setup = await platform.setupUnit(ctx);          // config + seed plan
const gate = await platform.gateCheck(ctx, ["fees"]); // feature gate
const t = await platform.getTermResolver(ctx);        // terminology
const tools = await platform.getAvailableActions(ctx); // MCP tools
const result = await platform.executeAction(ctx, "enroll-student", { name: "Luna" });
```

## Key design patterns

| Pattern | Where | What it does |
|---------|-------|-------------|
| **Profile-Derived Context (PDC)** | features | One profile definition derives all modules, terminology, roles, seed, gates in a single pure call |
| **Port/Adapter** | tenancy, seed, actions | `ProfileStore`, `SeedApplier`, `SchemaExporter` — interfaces the consumer implements |
| **Registry** | features, adapters, actions | Immutable after construction, duplicate-ID prevention, read-only facades |
| **Strategy** | adapters | `AdapterMapping` routes capabilities to per-profile implementations |
| **Schema Exporter** | actions | Adapter pattern for export formats — MCP, OpenAPI, or custom |
| **Factory Functions** | everywhere | `createFoo(input): Foo` — no classes, no `this` binding issues |

## Domain agnostic

Nothing in this framework is specific to schools, e-commerce, healthcare, or any domain. The same patterns work everywhere:

| Concept | Schools | E-commerce | Healthcare | SaaS |
|---------|---------|------------|------------|------|
| **Profile** | K-12, Dance | Clothing, Electronics | Clinic, Hospital | Starter, Enterprise |
| **Module** | attendance, fees | inventory, shipping | appointments, billing | analytics, SSO |
| **Terminology** | "Grade" vs "Level" | "Product" vs "Item" | "Patient" vs "Client" | "Workspace" vs "Org" |
| **Adapter** | fixed-timetable vs time-slots | warehouse vs dropship | in-person vs telehealth | basic vs advanced |
| **Seed data** | grade structures | product categories | appointment types | dashboard layouts |

## Relationship to footprintjs

[footprintjs](https://github.com/footprintjs/footPrint) is the execution engine — it turns flowcharts into running code with automatic causal traces for AI reasoning.

footprint-blueprint is the configuration layer — it defines **what** exists (modules, profiles, gates, adapters, actions) but not **how** things execute.

A domain-specific wrapper (e.g., SchoolFootprint) brings them together: blueprint modules become footprintjs services, each service is a flowchart with stages, and the manifest tracks which services ran and what happened.

```
footprintjs             → execution engine (flowcharts, traces, AI-explainability)
footprint-blueprint      → configuration framework (modules, profiles, adapters, actions)
domain-specific wrapper  → brings them together for a specific domain
your app                 → consumes the wrapper
```

## Testing strategy

Every package has 5 types of tests:

- **Unit** — pure function logic, isolated
- **Scenario** — realistic end-to-end workflows
- **Property** — invariant verification via [fast-check](https://github.com/dubzzz/fast-check)
- **Boundary** — limits, edge cases, performance
- **Security** — validation, injection prevention, immutability

## Setup

```bash
pnpm install
pnpm test        # run all 350 tests
pnpm typecheck   # type-check all packages
pnpm build       # build all packages
```

## License

MIT
