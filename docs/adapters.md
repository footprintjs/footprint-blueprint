# Adapters — footprint-blueprint/adapters

This module ships inside the single `footprint-blueprint@0.4.0` package. Use its focused public import path; see [the framework README](../README.md) and [release runbook](RELEASE.md).

Adapter registry, capability contracts, and service bridge for profile-based behavior switching.

## Why this exists

Different profile types need different implementations for the same operation. A K-12 school schedules with fixed timetables; a dance studio uses flexible time slots; a music school books individual appointments. The operation is the same ("schedule a class"), but the logic differs per profile.

This module solves that by introducing **capabilities** (what needs to be done) and **adapters** (how to do it per profile). The **service bridge** routes calls to the right adapter at runtime based on the requesting unit's profile type.

This is the core of the "Shopify for X" configurability — one platform, many behaviors.

## Concepts

| Concept | Description |
|---------|-------------|
| **Capability** | A named operation contract (e.g., "schedule-class", "process-payment") |
| **Adapter** | A concrete implementation of a capability for a specific context |
| **AdapterMapping** | Routes `capabilityId + profileType → adapterId` |
| **ServiceBridge** | Runtime dispatcher — resolves the adapter, calls it, wraps the result |

## Usage

```ts
import { createAdapterRegistry, createServiceBridge } from "footprint-blueprint/adapters";

// Define capabilities
const capabilities = [
  { id: "schedule", name: "Schedule Class", domain: "scheduling", description: "Schedule a class" },
];

// Define adapters
const fixedTimetable = {
  id: "fixed-timetable",
  name: "Fixed Timetable",
  capabilityId: "schedule",
  async execute(input, context) {
    return { scheduled: true, pattern: "fixed" };
  },
};

const timeSlots = {
  id: "time-slots",
  name: "Time Slots",
  capabilityId: "schedule",
  async execute(input, context) {
    return { scheduled: true, pattern: "slots" };
  },
};

// Wire them together
const registry = createAdapterRegistry({
  capabilities,
  adapters: [fixedTimetable, timeSlots],
  mappings: [
    { capabilityId: "schedule", profileAdapters: { k12: "fixed-timetable", dance: "time-slots" } },
  ],
});

// Use the bridge
const bridge = createServiceBridge(registry);
const result = await bridge.execute("schedule", { className: "Math" }, {
  profileType: "dance",
  unitId: "studio-1",
});
// → Uses timeSlots adapter
```

## API

### `createAdapterRegistry(input)`

Creates an adapter registry from capabilities, adapters, and mappings.

- `getCapability(id)` — Look up a capability definition
- `getAdapter(id)` — Look up an adapter by ID
- `resolve(capabilityId, profileType)` — Find the right adapter for a capability + profile
- `capabilityIds()` — List all registered capability IDs
- `validate()` — Check for orphaned references

### `createServiceBridge(registry)`

Creates a service bridge that dispatches calls.

- `execute(capabilityId, input, context)` — Route to the correct adapter
- `hasAdapter(capabilityId, profileType)` — Check if a route exists
- `availableCapabilities(profileType)` — List available capabilities for a profile

## Error handling

- Adapter throws → bridge catches, returns `{ status: "error", error: "..." }`
- No adapter found → returns `{ status: "no-adapter" }`
- Non-Error throws → captured as string

## Tests

The inherited Adapters suite contains 42 checks covering registries, service routing, realistic profile scenarios, properties, boundaries, validation and error containment. Consult the generated release validation record for actual results from the consolidated package.

## Runtime contracts retained from 0.2

Capability metadata, adapter port selection and profile mappings are captured and frozen at registration. Changing caller-owned arrays, definitions or mappings afterward cannot reroute a bridge. Adapter code remains a trusted injected port; use closures for provider state rather than mutating registry definitions.

`registry.validate()` reports unknown capabilities/adapters and mappings selecting an adapter for a different capability. `createServiceBridge()` rejects invalid registries before provider execution. Resolution only considers own profile mapping keys, then the declared default; inherited object properties cannot select a provider.

Bridge calls preserve tenant/campus/unit context and optional exact `actionId`. Results retain provider error code, HTTP status and trace run ID, plus a nonenumerable original cause. These fields let the host preserve typed conflict/payment outcomes. The bridge itself does not authorize callers or validate action inputs: use `footprint-blueprint/actions` / `footprint-blueprint/platform` with a trusted authorizer and schema before reaching it.
