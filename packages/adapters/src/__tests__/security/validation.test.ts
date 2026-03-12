import { describe, it, expect } from "vitest";
import { createAdapterRegistry } from "../../adapterRegistry.js";
import { createServiceBridge } from "../../serviceBridge.js";
import type { Adapter, Capability, AdapterMapping } from "../../types.js";

describe("adapter registry validation", () => {
  it("detects unknown adapter in mapping", () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const mapping: AdapterMapping = { capabilityId: "cap", profileAdapters: { k12: "nonexistent" } };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [], mappings: [mapping] });
    expect(reg.validate().some((e) => e.includes("nonexistent"))).toBe(true);
  });

  it("detects unknown default adapter in mapping", () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const mapping: AdapterMapping = { capabilityId: "cap", profileAdapters: {}, defaultAdapterId: "ghost" };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [], mappings: [mapping] });
    expect(reg.validate().some((e) => e.includes("ghost"))).toBe(true);
  });

  it("throws on duplicate capability", () => {
    const cap: Capability = { id: "dup", name: "Dup", domain: "d", description: "d" };
    expect(() => createAdapterRegistry({ capabilities: [cap, cap], adapters: [], mappings: [] }))
      .toThrow("Duplicate capability");
  });

  it("throws on duplicate adapter", () => {
    const adp: Adapter = { id: "dup", name: "Dup", capabilityId: "x", async execute() { return {}; } };
    expect(() => createAdapterRegistry({ capabilities: [], adapters: [adp, adp], mappings: [] }))
      .toThrow("Duplicate adapter");
  });
});

describe("adapter error containment", () => {
  it("adapter throwing does not crash the bridge", async () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const badAdapter: Adapter = {
      id: "bad", name: "Bad", capabilityId: "cap",
      async execute() { throw new Error("boom"); },
    };
    const mapping: AdapterMapping = { capabilityId: "cap", profileAdapters: { p: "bad" } };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [badAdapter], mappings: [mapping] });
    const bridge = createServiceBridge(reg);

    const result = await bridge.execute("cap", {}, { profileType: "p", unitId: "u1" });
    expect(result.status).toBe("error");
    expect(result.error).toBe("boom");
  });

  it("non-Error throw is captured as string", async () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const badAdapter: Adapter = {
      id: "bad", name: "Bad", capabilityId: "cap",
      async execute() { throw "string error"; },
    };
    const mapping: AdapterMapping = { capabilityId: "cap", profileAdapters: { p: "bad" } };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [badAdapter], mappings: [mapping] });
    const bridge = createServiceBridge(reg);

    const result = await bridge.execute("cap", {}, { profileType: "p", unitId: "u1" });
    expect(result.error).toBe("string error");
  });
});

describe("prototype pollution prevention", () => {
  it("resolve does not traverse prototype chain", () => {
    const cap: Capability = { id: "cap", name: "Cap", domain: "d", description: "d" };
    const adp: Adapter = { id: "adp", name: "Adp", capabilityId: "cap", async execute() { return {}; } };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [adp], mappings: [] });

    expect(reg.getCapability("toString")).toBeUndefined();
    expect(reg.getAdapter("constructor")).toBeUndefined();
    expect(reg.resolve("hasOwnProperty", "k12")).toBeUndefined();
  });
});
