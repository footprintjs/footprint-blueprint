import { describe, it, expect } from "vitest";
import { createAdapterRegistry } from "../../adapterRegistry.js";
import { createServiceBridge } from "../../serviceBridge.js";
import type { Adapter, Capability, AdapterMapping } from "../../types.js";

describe("boundary: large registry", () => {
  it("handles 100 capabilities with 100 adapters", () => {
    const capabilities: Capability[] = Array.from({ length: 100 }, (_, i) => ({
      id: `cap-${i}`, name: `Cap ${i}`, domain: "d", description: `Cap ${i}`,
    }));

    const adapters: Adapter[] = Array.from({ length: 100 }, (_, i) => ({
      id: `adp-${i}`, name: `Adp ${i}`, capabilityId: `cap-${i}`,
      async execute() { return { idx: i }; },
    }));

    const mappings: AdapterMapping[] = capabilities.map((cap, i) => ({
      capabilityId: cap.id,
      profileAdapters: { default: `adp-${i}` },
    }));

    const reg = createAdapterRegistry({ capabilities, adapters, mappings });
    expect(reg.capabilityIds()).toHaveLength(100);
    expect(reg.adapterIds()).toHaveLength(100);
    expect(reg.resolve("cap-50", "default")?.id).toBe("adp-50");
  });
});

describe("boundary: many profiles per capability", () => {
  it("handles 50 profile mappings for one capability", async () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const adapters: Adapter[] = Array.from({ length: 50 }, (_, i) => ({
      id: `adp-${i}`, name: `Adp ${i}`, capabilityId: "cap",
      async execute() { return { idx: i }; },
    }));

    const profileAdapters: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      profileAdapters[`profile-${i}`] = `adp-${i}`;
    }

    const reg = createAdapterRegistry({
      capabilities: [cap],
      adapters,
      mappings: [{ capabilityId: "cap", profileAdapters }],
    });

    const bridge = createServiceBridge(reg);

    for (let i = 0; i < 50; i++) {
      const result = await bridge.execute("cap", {}, { profileType: `profile-${i}`, unitId: "u1" });
      expect(result.status).toBe("success");
      expect(result.adapterId).toBe(`adp-${i}`);
    }
  });
});
