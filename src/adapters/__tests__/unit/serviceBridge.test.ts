import { describe, it, expect } from "vitest";
import { createAdapterRegistry } from "../../adapterRegistry.js";
import { createServiceBridge } from "../../serviceBridge.js";
import type { Capability, Adapter, AdapterMapping } from "../../types.js";

const cap: Capability = { id: "schedule", name: "Schedule", domain: "scheduling", description: "Schedule" };
const fixedAdapter: Adapter = {
  id: "fixed", name: "Fixed", capabilityId: "schedule",
  async execute(input) { return { scheduled: true, input }; },
};
const slotsAdapter: Adapter = {
  id: "slots", name: "Slots", capabilityId: "schedule",
  async execute(input) { return { slotted: true, input }; },
};
const failAdapter: Adapter = {
  id: "fail", name: "Fail", capabilityId: "schedule",
  async execute() { throw new Error("adapter crashed"); },
};

const mapping: AdapterMapping = {
  capabilityId: "schedule",
  profileAdapters: { k12: "fixed", dance: "slots", broken: "fail" },
};

const reg = createAdapterRegistry({
  capabilities: [cap],
  adapters: [fixedAdapter, slotsAdapter, failAdapter],
  mappings: [mapping],
});
const bridge = createServiceBridge(reg);

describe("createServiceBridge", () => {
  it("executes correct adapter for profile", async () => {
    const result = await bridge.execute("schedule", { day: "Mon" }, { profileType: "k12", unitId: "u1" });
    expect(result.status).toBe("success");
    expect(result.adapterId).toBe("fixed");
    expect(result.result).toEqual({ scheduled: true, input: { day: "Mon" } });
  });

  it("uses different adapter for different profile", async () => {
    const result = await bridge.execute("schedule", { day: "Mon" }, { profileType: "dance", unitId: "u1" });
    expect(result.status).toBe("success");
    expect(result.adapterId).toBe("slots");
  });

  it("returns no-adapter for unknown capability", async () => {
    const result = await bridge.execute("unknown-cap", {}, { profileType: "k12", unitId: "u1" });
    expect(result.status).toBe("no-adapter");
    expect(result.error).toContain("No adapter found");
  });

  it("returns no-adapter for unmapped profile without default", async () => {
    const result = await bridge.execute("schedule", {}, { profileType: "tutoring", unitId: "u1" });
    expect(result.status).toBe("no-adapter");
  });

  it("captures adapter errors", async () => {
    const result = await bridge.execute("schedule", {}, { profileType: "broken", unitId: "u1" });
    expect(result.status).toBe("error");
    expect(result.error).toBe("adapter crashed");
    expect(result.adapterId).toBe("fail");
  });

  it("includes duration in results", async () => {
    const result = await bridge.execute("schedule", {}, { profileType: "k12", unitId: "u1" });
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("hasAdapter returns true for mapped profiles", () => {
    expect(bridge.hasAdapter("schedule", "k12")).toBe(true);
    expect(bridge.hasAdapter("schedule", "dance")).toBe(true);
    expect(bridge.hasAdapter("schedule", "tutoring")).toBe(false);
    expect(bridge.hasAdapter("unknown", "k12")).toBe(false);
  });

  it("availableCapabilities lists what a profile can do", () => {
    expect(bridge.availableCapabilities("k12")).toContain("schedule");
    expect(bridge.availableCapabilities("tutoring")).toHaveLength(0);
  });
});
