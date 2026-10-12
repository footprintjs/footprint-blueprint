import { describe, it, expect } from "vitest";
import { createAdapterRegistry } from "../../adapterRegistry.js";
import type { Capability, Adapter, AdapterMapping } from "../../types.js";

const cap: Capability = { id: "schedule", name: "Schedule", domain: "scheduling", description: "Schedule classes" };

const fixedAdapter: Adapter = {
  id: "fixed-timetable", name: "Fixed Timetable", capabilityId: "schedule",
  async execute(input) { return { type: "fixed", input }; },
};
const slotsAdapter: Adapter = {
  id: "time-slots", name: "Time Slots", capabilityId: "schedule",
  async execute(input) { return { type: "slots", input }; },
};

const mapping: AdapterMapping = {
  capabilityId: "schedule",
  profileAdapters: { k12: "fixed-timetable", dance: "time-slots" },
  defaultAdapterId: "fixed-timetable",
};

describe("createAdapterRegistry", () => {
  it("creates registry with capabilities, adapters, and mappings", () => {
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [fixedAdapter, slotsAdapter], mappings: [mapping] });
    expect(reg.capabilityIds()).toContain("schedule");
    expect(reg.adapterIds()).toContain("fixed-timetable");
    expect(reg.adapterIds()).toContain("time-slots");
  });

  it("resolves correct adapter by profile type", () => {
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [fixedAdapter, slotsAdapter], mappings: [mapping] });
    expect(reg.resolve("schedule", "k12")?.id).toBe("fixed-timetable");
    expect(reg.resolve("schedule", "dance")?.id).toBe("time-slots");
  });

  it("falls back to default adapter for unknown profile", () => {
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [fixedAdapter, slotsAdapter], mappings: [mapping] });
    expect(reg.resolve("schedule", "unknown")?.id).toBe("fixed-timetable");
  });

  it("returns undefined for unknown capability", () => {
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [fixedAdapter], mappings: [] });
    expect(reg.resolve("nonexistent", "k12")).toBeUndefined();
  });

  it("getCapability returns capability by ID", () => {
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [], mappings: [] });
    expect(reg.getCapability("schedule")?.name).toBe("Schedule");
    expect(reg.getCapability("unknown")).toBeUndefined();
  });

  it("getAdapter returns adapter by ID", () => {
    const reg = createAdapterRegistry({ capabilities: [], adapters: [fixedAdapter], mappings: [] });
    expect(reg.getAdapter("fixed-timetable")?.name).toBe("Fixed Timetable");
    expect(reg.getAdapter("unknown")).toBeUndefined();
  });

  it("throws on duplicate capability ID", () => {
    expect(() => createAdapterRegistry({
      capabilities: [cap, cap], adapters: [], mappings: [],
    })).toThrow("Duplicate capability");
  });

  it("throws on duplicate adapter ID", () => {
    expect(() => createAdapterRegistry({
      capabilities: [], adapters: [fixedAdapter, fixedAdapter], mappings: [],
    })).toThrow("Duplicate adapter");
  });

  it("throws on duplicate mapping for same capability", () => {
    expect(() => createAdapterRegistry({
      capabilities: [cap], adapters: [fixedAdapter], mappings: [mapping, mapping],
    })).toThrow("Duplicate mapping");
  });

  it("validate catches unknown adapter in mapping", () => {
    const badMapping: AdapterMapping = {
      capabilityId: "schedule",
      profileAdapters: { k12: "nonexistent" },
    };
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [], mappings: [badMapping] });
    const errors = reg.validate();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  it("validate passes for valid registry", () => {
    const reg = createAdapterRegistry({ capabilities: [cap], adapters: [fixedAdapter, slotsAdapter], mappings: [mapping] });
    expect(reg.validate()).toHaveLength(0);
  });
});
