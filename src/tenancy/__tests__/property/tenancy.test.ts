import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { defineModule, defineProfile, createModuleRegistry } from "../../../features/index.js";
import { createTenantContext } from "../../tenantContext.js";
import { createMemoryProfileStore } from "../../memoryProfileStore.js";
import { createProfileResolver } from "../../profileResolver.js";
import { createGateMiddleware } from "../../gateMiddleware.js";

// Fixed registry for property tests
const mod = defineModule({ id: "core", name: "Core", domain: "d" });
const profile = defineProfile({ type: "basic", displayName: "Basic", modules: ["core"] });
const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });

describe("property: tenant context invariants", () => {
  it("created context always has tenantId and unitId", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        (tenantId, unitId) => {
          const ctx = createTenantContext({ tenantId, unitId });
          expect(ctx.tenantId).toBeTruthy();
          expect(ctx.unitId).toBeTruthy();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("context is always frozen", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        (tenantId, unitId) => {
          const ctx = createTenantContext({ tenantId, unitId });
          expect(Object.isFrozen(ctx)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("property: gate middleware invariants", () => {
  it("empty requiredModules always results in allowed=true", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/),
        async (unitId) => {
          const store = createMemoryProfileStore([
            { tenantId: "t1", revision: 0, unitId, profileType: "basic", createdAt: "2024-01-01" },
          ]);
          const resolver = createProfileResolver(registry, store);
          const gate = createGateMiddleware(resolver);
          const ctx = createTenantContext({ tenantId: "t1", unitId });

          const result = await gate(ctx, []);
          expect(result.allowed).toBe(true);
          expect(result.denied).toHaveLength(0);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("denied count equals number of modules not enabled", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 5 }),
        async (requiredModules) => {
          const store = createMemoryProfileStore([
            { tenantId: "t1", revision: 0, unitId: "u1", profileType: "basic", createdAt: "2024-01-01" },
          ]);
          const resolver = createProfileResolver(registry, store);
          const gate = createGateMiddleware(resolver);
          const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });

          const result = await gate(ctx, requiredModules);
          const notEnabled = requiredModules.filter((m) => m !== "core");
          const uniqueNotEnabled = [...new Set(notEnabled)];
          expect(result.denied.length).toBe(uniqueNotEnabled.length);
        },
      ),
      { numRuns: 20 },
    );
  });
});
