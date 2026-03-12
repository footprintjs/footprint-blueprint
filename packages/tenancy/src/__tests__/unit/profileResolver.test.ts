import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import { createProfileResolver } from "../../profileResolver.js";
import { createMemoryProfileStore } from "../../memoryProfileStore.js";
import { createTenantContext } from "../../tenantContext.js";

const students = defineModule({ id: "students", name: "Students", domain: "people" });
const fees = defineModule({ id: "fees", name: "Fees", domain: "finance", requires: ["students"] });
const attendance = defineModule({ id: "attendance", name: "Attendance", domain: "academics", requires: ["students"] });

const dance = defineProfile({ type: "dance", displayName: "Dance School", modules: ["students", "fees", "attendance"], roles: ["Owner"] });
const tutoring = defineProfile({ type: "tutoring", displayName: "Tutoring", modules: ["students", "fees"], roles: ["Tutor"] });

const registry = createModuleRegistry({
  modules: [students, fees, attendance],
  profileTypes: [dance, tutoring],
});

describe("createProfileResolver", () => {
  it("resolves config for a bound unit", async () => {
    const store = createMemoryProfileStore([
      { unitId: "school-1", profileType: "dance", createdAt: "2024-01-01" },
    ]);
    const resolver = createProfileResolver(registry, store);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });

    const config = await resolver.resolve(ctx);
    expect(config.profileType).toBe("dance");
    expect(config.enabledModules.has("attendance")).toBe(true);
  });

  it("resolves different configs for different units", async () => {
    const store = createMemoryProfileStore([
      { unitId: "school-1", profileType: "dance", createdAt: "2024-01-01" },
      { unitId: "school-2", profileType: "tutoring", createdAt: "2024-01-01" },
    ]);
    const resolver = createProfileResolver(registry, store);

    const c1 = await resolver.resolve(createTenantContext({ tenantId: "t1", unitId: "school-1" }));
    const c2 = await resolver.resolve(createTenantContext({ tenantId: "t1", unitId: "school-2" }));

    expect(c1.enabledModules.has("attendance")).toBe(true);
    expect(c2.enabledModules.has("attendance")).toBe(false);
  });

  it("throws when no binding exists", async () => {
    const store = createMemoryProfileStore([]);
    const resolver = createProfileResolver(registry, store);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "unknown" });

    await expect(resolver.resolve(ctx)).rejects.toThrow("No profile binding");
  });

  it("caches resolved config by unitId", async () => {
    let lookupCount = 0;
    const store: import("../../types.js").ProfileStore = {
      async getBinding(unitId) {
        lookupCount++;
        return { unitId, profileType: "dance", createdAt: "2024-01-01" };
      },
    };
    const resolver = createProfileResolver(registry, store);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });

    await resolver.resolve(ctx);
    await resolver.resolve(ctx);

    expect(lookupCount).toBe(1);
  });

  it("clearCache allows re-resolution", async () => {
    let lookupCount = 0;
    const store: import("../../types.js").ProfileStore = {
      async getBinding(unitId) {
        lookupCount++;
        return { unitId, profileType: "dance", createdAt: "2024-01-01" };
      },
    };
    const resolver = createProfileResolver(registry, store);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });

    await resolver.resolve(ctx);
    resolver.clearCache();
    await resolver.resolve(ctx);

    expect(lookupCount).toBe(2);
  });

  it("respects module overrides in binding", async () => {
    const store = createMemoryProfileStore([
      { unitId: "school-1", profileType: "tutoring", moduleOverrides: ["students", "fees", "attendance"], createdAt: "2024-01-01" },
    ]);
    const resolver = createProfileResolver(registry, store);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });

    const config = await resolver.resolve(ctx);
    // Tutoring normally doesn't have attendance, but overrides add it
    expect(config.enabledModules.has("attendance")).toBe(true);
  });

  it("getBinding returns raw binding without resolution", async () => {
    const store = createMemoryProfileStore([
      { unitId: "school-1", profileType: "dance", createdAt: "2024-01-01" },
    ]);
    const resolver = createProfileResolver(registry, store);
    const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });

    const binding = await resolver.getBinding(ctx);
    expect(binding?.profileType).toBe("dance");
    expect(binding?.unitId).toBe("school-1");
  });

  it("cache expires after TTL", async () => {
    let lookupCount = 0;
    const store: import("../../types.js").ProfileStore = {
      async getBinding(unitId) {
        lookupCount++;
        return { unitId, profileType: "dance", createdAt: "2024-01-01" };
      },
    };
    const resolver = createProfileResolver(registry, store, { cacheTtlMs: 50 });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "school-1" });

    await resolver.resolve(ctx);
    expect(lookupCount).toBe(1);

    // Immediate second call should use cache
    await resolver.resolve(ctx);
    expect(lookupCount).toBe(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 60));

    // After TTL, should re-resolve
    await resolver.resolve(ctx);
    expect(lookupCount).toBe(2);
  });
});
