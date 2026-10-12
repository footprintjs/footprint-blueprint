import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import { createTenantContext } from "../../tenantContext.js";
import { createMemoryProfileStore } from "../../memoryProfileStore.js";
import { createProfileResolver } from "../../profileResolver.js";
import { createGateMiddleware } from "../../gateMiddleware.js";

describe("boundary: large number of units", () => {
  it("handles 1000 units in memory store", async () => {
    const mod = defineModule({ id: "core", name: "Core", domain: "d" });
    const profile = defineProfile({ type: "basic", displayName: "Basic", modules: ["core"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });

    const bindings = Array.from({ length: 1000 }, (_, i) => ({
      tenantId: "t1", revision: 0, unitId: `unit-${i}`, profileType: "basic" as const,
      createdAt: "2024-01-01",
    }));

    const store = createMemoryProfileStore(bindings);
    const resolver = createProfileResolver(registry, store);

    // First and last
    const first = await resolver.resolve(createTenantContext({ tenantId: "t1", unitId: "unit-0" }));
    const last = await resolver.resolve(createTenantContext({ tenantId: "t1", unitId: "unit-999" }));

    expect(first.profileType).toBe("basic");
    expect(last.profileType).toBe("basic");
  });
});

describe("boundary: many required modules in gate check", () => {
  it("checks 50 modules in a single gate call", async () => {
    const modules = Array.from({ length: 50 }, (_, i) =>
      defineModule({ id: `mod-${i}`, name: `Mod ${i}`, domain: "d" }),
    );
    const moduleIds = modules.map((m) => m.id);
    const profile = defineProfile({ type: "big", displayName: "Big", modules: moduleIds });
    const registry = createModuleRegistry({ modules, profileTypes: [profile] });

    const store = createMemoryProfileStore([
      { tenantId: "t1", revision: 0, unitId: "u1", profileType: "big", createdAt: "2024-01-01" },
    ]);
    const resolver = createProfileResolver(registry, store);
    const gate = createGateMiddleware(resolver);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });

    const result = await gate(ctx, moduleIds);
    expect(result.allowed).toBe(true);
    expect(result.denied).toHaveLength(0);
  });
});

describe("boundary: cache behavior", () => {
  it("resolver serves from cache after first resolve", async () => {
    const mod = defineModule({ id: "core", name: "Core", domain: "d" });
    const profile = defineProfile({ type: "basic", displayName: "Basic", modules: ["core"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });

    let callCount = 0;
    const store: import("../../types.js").ProfileStore = {
      async getBinding(scope) {
        callCount++;
        return { ...scope, revision: 0, profileType: "basic", createdAt: "2024-01-01" };
      },
    };

    const resolver = createProfileResolver(registry, store);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });

    // Each resolve strongly reads the revision; only the immutable derivation is cached
    for (let i = 0; i < 100; i++) {
      await resolver.resolve(ctx);
    }
    expect(callCount).toBe(100);
  });
});

describe("boundary: extreme input values", () => {
  it("handles very long tenantId and unitId", () => {
    const longId = "a".repeat(1000);
    expect(() => createTenantContext({ tenantId: longId, unitId: longId })).toThrow("160 characters");
  });

  it("handles unicode in tenant context", () => {
    const ctx = createTenantContext({ tenantId: "\u5b66\u6821", unitId: "\u30c0\u30f3\u30b9" });
    expect(ctx.tenantId).toBe("\u5b66\u6821");
    expect(ctx.unitId).toBe("\u30c0\u30f3\u30b9");
  });
});
