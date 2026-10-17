# footprint-blueprint

**Define once, derive everything** — a domain-agnostic platform framework for building configurable multi-tenant systems.

## One package, focused modules

This local **`footprint-blueprint@0.5.0`** candidate pairs with the local `smallbusiness-footprint@0.5.0` candidate, adds reusable stored-failure diagnostics, and pins the separate `footprintjs@10.1.0` engine. It has not been published. The existing six framework modules and focused import paths remain available.

Use Node 24.15–24.x. Source builds use TypeScript 7 and pnpm 12.11.2. Start with the entry point that matches your task:

```ts
import { defineModule, defineProfile } from 'footprint-blueprint/features';
import { createEvidenceCollector } from 'footprint-blueprint/evidence';
import { diagnoseFailureRecording } from 'footprint-blueprint/diagnostics';
import { createPlatform } from 'footprint-blueprint/platform';

// Load actions when your application reaches this point.
const { createActionRegistry } = await import('footprint-blueprint/actions');
```

Subpaths select a module and its runtime dependencies. Static imports load that entry's dependency graph immediately; `await import()` defers loading until called. The root `footprint-blueprint` entry is a convenience re-export of Platform and loads all its framework layers. The focused Features and Evidence entries avoid the executor graph. Diagnostics uses the public engine error classifier but executes no flow or provider request. Package installation still downloads all declared dependencies: focused imports do not make npm download only part of the package. The release's loader checks record the modules loaded by these focused entries. Bundler tree shaking depends on the consuming application's configuration.

The [release runbook](docs/RELEASE.md), [consolidation record](docs/CONSOLIDATION.md) and [changelog](CHANGELOG.md) describe the two-artifact release and the separate Node 22 school compatibility path. The earlier seven-artifact kit is retained as a historical reference and is superseded by this packaging.

Profile stores accept the complete `{tenantId, campusId?, unitId}` scope and return a matching binding with a monotonically increasing `revision`. Definitions are immutable; caches derive configuration from strong binding reads, expire after 30 seconds by default, are bounded, and expose invalidation. Missing registry dependencies fail validation. Seed execution stops by default on failure; it does not provide a publication transaction.

Execution and tool discovery require a trusted host `authorizer`, an actual handler/adapter, enabled modules and strict input schemas. Missing authorization denies access. Role declarations alone do not grant access. The host owns authentication, CSRF, durable transactions and provider acknowledgements. Trace recording uses real SDK stages without private payloads by default and cannot turn an acknowledged success into failure. See the module guides below for those contracts.

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
footprint-blueprint
  ├─ features      ├─ tenancy      ├─ seed
  ├─ adapters      ├─ actions      ├─ platform
  └─ evidence (direct pure collector entry)

footprintjs → separate execution engine used by Actions
```

The modules remain separate source and test boundaries inside one package. Internal imports use relative module paths, and consumers use the public subpaths. They share one release version; `footprintjs` remains a separate runtime dependency.

## Module entry points

| Import path | Purpose | Guide |
| --- | --- | --- |
| `footprint-blueprint/features` | Module registry, profiles, gates and terminology | [Features](docs/features.md) |
| `footprint-blueprint/tenancy` | Scoped profile binding and gate middleware | [Tenancy](docs/tenancy.md) |
| `footprint-blueprint/seed` | Dependency-ordered seed plans and application | [Seed](docs/seed.md) |
| `footprint-blueprint/adapters` | Capabilities, adapter routing and service bridge | [Adapters](docs/adapters.md) |
| `footprint-blueprint/actions` | Action registry, descriptors and traced execution | [Actions](docs/actions.md) |
| `footprint-blueprint/platform` | Orchestration of all six modules | [Platform](docs/platform.md) |
| `footprint-blueprint/diagnostics` | Pure stored-failure validation and deterministic findings | [Diagnostics API](docs/diagnostics.md) |
| `footprint-blueprint/evidence` | Pure receipt collector and validator | [Evidence API](docs/actions.md#shared-execution-evidence) |

`footprint-blueprint/actions/evidence` is an alias of the same pure Evidence entry. The root entry provides Platform's convenience exports. Advanced module-specific APIs remain available from their own subpaths.

The inherited test suite contains 440 Blueprint tests. The optional commerce library contains 217 more. Consult the generated release validation record for the actual results from the consolidated candidate.

## How it works

### 1. Define modules (Layer 1)

Modules are the atomic units of your platform. Each module declares what it needs, what terms it uses, what roles it introduces, and what seed data it carries.

```typescript
import { defineModule } from "footprint-blueprint/features";

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
import { defineProfile } from "footprint-blueprint/features";

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
const discovery = {
  enabledModules: config.enabledModules,
  context: { tenantId: "tenant-1", unitId: "studio-1", profileType: "dance", userId: session.userId },
  authorizer: ({ action, context, purpose }) => verifiedPolicy.can(context.userId, action.id, purpose),
  hasImplementation: action => registeredHandlers.has(action.id),
};
const tools = await actionRegistry.toMCPTools(discovery);
const openapi = await actionRegistry.exportActions(discovery, createOpenAPIExporter());
const custom = await actionRegistry.exportActions(discovery, myCustomExporter);
// These are descriptors. The host supplies an authenticated MCP/HTTP transport.
```

### 7. Wire everything with one call (Layer 6)

The Platform module is the glue. One `createPlatform()` call wires all layers together.

```typescript
const platform = createPlatform({
  registry, profileStore, adapterRegistry, actionRegistry,
  authorizer: ({ action, context, purpose }) => verifiedPolicy.can(context.userId, action.id, purpose),
  handlers: { "enroll-student": async (_id, input, context) => enrollment.enroll(input, context) },
  traceRecorder,
});

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

[footprintjs](https://github.com/footprintjs/footPrint) is the execution engine: it runs flowcharts and records the stages and state made visible by the application. Shared execution receipts supplement those native recordings with host-reported observations, effect phases, outcomes and related runs. Their coverage and limitations remain explicit; they do not establish complete database causality or private model reasoning.

footprint-blueprint defines modules, profiles, gates, adapters and actions. Its action executor runs deterministic authorize/validate/execute/acknowledge stages with FootprintJS 10. Domain-specific workflows still own the business operations and storage/provider transactions.

A domain-specific wrapper (e.g., SchoolFootprint) brings them together: blueprint modules become footprintjs services, each service is a flowchart with stages, and the manifest tracks which services ran and what happened.

```
footprintjs             → execution engine (flowcharts and execution recordings)
footprint-blueprint      → configuration framework (modules, profiles, adapters, actions)
domain-specific wrapper  → brings them together for a specific domain
your app                 → consumes the wrapper
```

## Testing strategy

The framework suite covers five kinds of checks:

- **Unit** — pure function logic, isolated
- **Scenario** — realistic end-to-end workflows
- **Property** — invariant verification via [fast-check](https://github.com/dubzzz/fast-check)
- **Boundary** — limits, edge cases, performance
- **Security** — validation, injection prevention, immutability

## Source setup

Use Node 24.15–24.x and pnpm 12.11.2. For a consumer example, use the [release-kit quickstart](docs/QUICKSTART.md). From the Blueprint repository root:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
pnpm test
```

## License

MIT

## Caller execution controls

`ActionExecutorOptions.executionOptions` and `PlatformConfig.executionOptions` accept an optional synchronous host callback receiving `{actionId, context}`. It returns the engine's `signal`, `timeoutMs`, `deadline` and an `env` containing only `signal`, `deadline`, `traceparent`, `traceId` and `operationId`. The callback is trusted application configuration; tool input and `context.meta` cannot select these controls. No budget is added when it is omitted.

Blueprint captures this narrow envelope and delegates validation, cancellation, deadline composition and correlation to FootprintJS. It does not add retries, storage journaling or provider policy. Provider adapters still need to honor the host's cancellation signal and reconcile uncertain external outcomes. Trace runtime metadata comes from the public `footprintjs/package.json` manifest resolved by this library, so it reports the installed engine without an application-specific SDK export.
