import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import { createProfileResolver } from "../../profileResolver.js";
import { createGateMiddleware } from "../../gateMiddleware.js";
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

const store = createMemoryProfileStore([
  { tenantId: "t1", revision: 0, unitId: "dance-1", profileType: "dance", createdAt: "2024-01-01" },
  { tenantId: "t1", revision: 0, unitId: "tutor-1", profileType: "tutoring", createdAt: "2024-01-01" },
]);

const resolver = createProfileResolver(registry, store);
const gateCheck = createGateMiddleware(resolver);

describe("createGateMiddleware", () => {
  it("allows when all required modules are enabled", async () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-1" });
    const result = await gateCheck(ctx, ["students", "attendance"]);
    expect(result.allowed).toBe(true);
    expect(result.denied).toHaveLength(0);
  });

  it("denies when a required module is not enabled", async () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "tutor-1" });
    const result = await gateCheck(ctx, ["attendance"]);
    expect(result.allowed).toBe(false);
    expect(result.denied).toHaveLength(1);
    expect(result.denied[0]!.moduleId).toBe("attendance");
    expect(result.denied[0]!.unitId).toBe("tutor-1");
    expect(result.denied[0]!.profileType).toBe("tutoring");
  });

  it("denies multiple modules at once", async () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "tutor-1" });
    const result = await gateCheck(ctx, ["attendance", "scheduling"]);
    expect(result.allowed).toBe(false);
    expect(result.denied).toHaveLength(2);
  });

  it("allows when no modules are required", async () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "tutor-1" });
    const result = await gateCheck(ctx, []);
    expect(result.allowed).toBe(true);
  });

  it("includes detailed reason in denied results", async () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "tutor-1" });
    const result = await gateCheck(ctx, ["attendance"]);
    expect(result.denied[0]!.reason).toBeTruthy();
    expect(typeof result.denied[0]!.reason).toBe("string");
  });

  it("captures caller scope and module requirements before an asynchronous binding read", async () => {
    let finish!: () => void;
    const pendingResolver = createProfileResolver(registry, {
      async getBinding(scope) {
        await new Promise<void>((resolve) => { finish = resolve; });
        return store.getBinding(scope);
      },
    });
    const ctx = { tenantId: "t1", unitId: "tutor-1" };
    const requiredModules = ["attendance"];
    const pending = createGateMiddleware(pendingResolver)(ctx, requiredModules);
    ctx.tenantId = "other-tenant";
    ctx.unitId = "dance-1";
    requiredModules.splice(0, 1, "students");
    finish();
    const result = await pending;
    expect(result.allowed).toBe(false);
    expect(result.denied).toEqual([
      expect.objectContaining({ moduleId: "attendance", unitId: "tutor-1", profileType: "tutoring" }),
    ]);
  });
});
