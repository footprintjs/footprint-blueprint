# @footprint/platform

Orchestration layer — single entry point that wires all packages into a cohesive platform instance.

## Why this exists

The lower-level packages (features, tenancy, seed, adapters, actions) are deliberately independent. Each one does one thing well. But using them together requires boilerplate: create a registry, create a profile store, create a resolver, create middleware, create a bridge, create an executor...

This package is the glue. `createPlatform()` takes a configuration object and returns a **Platform** — a single object with everything wired together. It also re-exports all public APIs from every package, so consumers only need one import.

## Usage

```ts
import {
  createPlatform,
  defineModule,
  defineProfile,
  createModuleRegistry,
  createMemoryProfileStore,
  createTenantContext,
  createAdapterRegistry,
  createActionRegistry,
} from "@footprint/platform";

// 1. Define your domain
const students = defineModule({ id: "students", name: "Students", domain: "people", description: "..." });
const dance = defineProfile({ type: "dance", displayName: "Dance", modules: ["students"], roles: ["Owner"] });

// 2. Create registries
const registry = createModuleRegistry({ modules: [students], profileTypes: [dance] });
const store = createMemoryProfileStore([
  { unitId: "studio-1", profileType: "dance", createdAt: "2024-01-01" },
]);

// 3. Create platform
const platform = createPlatform({
  registry,
  profileStore: store,
  adapterRegistry: createAdapterRegistry({ capabilities: [...], adapters: [...], mappings: [...] }),
  actionRegistry: createActionRegistry({ actions: [...] }),
});

// 4. Use it
const ctx = createTenantContext({ tenantId: "t1", unitId: "studio-1" });

const setup = await platform.setupUnit(ctx);       // → config + seed plan
const gate = await platform.gateCheck(ctx, ["attendance"]);  // → allowed/denied
const t = await platform.getTermResolver(ctx);      // → term resolver function
const tools = await platform.getAvailableActions(ctx);  // → MCP tool definitions
const result = await platform.executeAction(ctx, "enroll-student", { name: "Luna" });
```

## API

### `createPlatform(config)`

| Method | Description |
|--------|-------------|
| `resolveUnit(ctx)` | Resolve a unit's full profile configuration |
| `setupUnit(ctx)` | Resolve config + generate seed plan |
| `gateCheck(ctx, modules)` | Check if modules are enabled for a unit |
| `getTermResolver(ctx)` | Get a terminology resolver for a unit's profile |
| `getAvailableActions(ctx)` | Get MCP tools available for a unit |
| `executeAction(ctx, actionId, input)` | Execute an action with gate check + tracing |

### Configuration

```ts
type PlatformConfig = {
  registry: ModuleRegistry;          // Required
  profileStore: ProfileStore;         // Required
  adapterRegistry?: AdapterRegistry;  // Optional
  actionRegistry?: ActionRegistry;    // Optional
};
```

A platform can start with just features and tenancy (profile resolution + gate checks + terminology). Adapters and actions can be added later without changing existing code.

## Gate enforcement

`executeAction` enforces module gates automatically:
1. Looks up the action's `requiredModules`
2. Checks if all are enabled for the requesting unit's profile
3. Only executes if all gates pass
4. Returns `{ status: "error", error: "Action requires disabled modules: ..." }` otherwise

## Tests

34 tests across 5 files:
- **Unit**: platform factory, resolveUnit, setupUnit, gateCheck, getTermResolver
- **Scenario**: full workflow (dance vs K-12), platform without adapters
- **Property**: deterministic resolution, gate invariants, tool subset invariants
- **Boundary**: 100 modules + 200 actions, unknown units, unknown actions
- **Security**: gate enforcement, adapter error containment, state isolation
