import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createAdapterRegistry } from "../../adapterRegistry.js";
import { createServiceBridge } from "../../serviceBridge.js";
import type { Adapter, Capability, AdapterMapping } from "../../types.js";

describe("property: adapter registry invariants", () => {
  it("resolve always returns an adapter or undefined (never throws)", () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const adapter: Adapter = {
      id: "adp", name: "Adp", capabilityId: "cap",
      async execute() { return {}; },
    };
    const mapping: AdapterMapping = { capabilityId: "cap", profileAdapters: { p1: "adp" } };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [adapter], mappings: [mapping] });

    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        (capId, profile) => {
          const result = reg.resolve(capId, profile);
          expect(result === undefined || typeof result.execute === "function").toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("hasAdapter is consistent with execute result status", async () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const adapter: Adapter = {
      id: "adp", name: "Adp", capabilityId: "cap",
      async execute() { return { ok: true }; },
    };
    const mapping: AdapterMapping = { capabilityId: "cap", profileAdapters: { mapped: "adp" } };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [adapter], mappings: [mapping] });
    const bridge = createServiceBridge(reg);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("mapped", "unmapped", "random"),
        async (profile) => {
          const has = bridge.hasAdapter("cap", profile);
          const result = await bridge.execute("cap", {}, { profileType: profile, unitId: "u1" });

          if (has) {
            expect(result.status).not.toBe("no-adapter");
          } else {
            expect(result.status).toBe("no-adapter");
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
