import { describe, it, expect } from "vitest";
import { createMemoryProfileStore } from "../../memoryProfileStore.js";

describe("createMemoryProfileStore", () => {
  it("stores and retrieves bindings", async () => {
    const store = createMemoryProfileStore([
      { unitId: "u1", profileType: "dance", createdAt: "2024-01-01" },
    ]);
    const binding = await store.getBinding("u1");
    expect(binding?.profileType).toBe("dance");
  });

  it("returns undefined for unknown units", async () => {
    const store = createMemoryProfileStore([]);
    expect(await store.getBinding("unknown")).toBeUndefined();
  });

  it("throws on duplicate unit IDs at creation", () => {
    expect(() => createMemoryProfileStore([
      { unitId: "u1", profileType: "dance", createdAt: "2024-01-01" },
      { unitId: "u1", profileType: "k12", createdAt: "2024-01-01" },
    ])).toThrow("Duplicate binding");
  });

  it("addBinding adds new bindings", async () => {
    const store = createMemoryProfileStore([]);
    store.addBinding({ unitId: "u1", profileType: "dance", createdAt: "2024-01-01" });
    expect(await store.getBinding("u1")).toBeDefined();
  });

  it("addBinding throws on duplicate", () => {
    const store = createMemoryProfileStore([
      { unitId: "u1", profileType: "dance", createdAt: "2024-01-01" },
    ]);
    expect(() => store.addBinding({ unitId: "u1", profileType: "k12", createdAt: "2024-01-01" }))
      .toThrow("Duplicate binding");
  });

  it("removeBinding removes a binding", async () => {
    const store = createMemoryProfileStore([
      { unitId: "u1", profileType: "dance", createdAt: "2024-01-01" },
    ]);
    expect(store.removeBinding("u1")).toBe(true);
    expect(await store.getBinding("u1")).toBeUndefined();
  });

  it("removeBinding returns false for unknown unit", () => {
    const store = createMemoryProfileStore([]);
    expect(store.removeBinding("unknown")).toBe(false);
  });

  it("allBindings returns frozen array of all bindings", () => {
    const store = createMemoryProfileStore([
      { unitId: "u1", profileType: "dance", createdAt: "2024-01-01" },
      { unitId: "u2", profileType: "k12", createdAt: "2024-01-01" },
    ]);
    const all = store.allBindings();
    expect(all).toHaveLength(2);
    expect(Object.isFrozen(all)).toBe(true);
  });

  it("freezes stored bindings", async () => {
    const store = createMemoryProfileStore([
      { unitId: "u1", profileType: "dance", createdAt: "2024-01-01" },
    ]);
    const binding = await store.getBinding("u1");
    expect(Object.isFrozen(binding)).toBe(true);
  });
});
