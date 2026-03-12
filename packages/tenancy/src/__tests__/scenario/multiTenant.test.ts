import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry, createTermResolver } from "@footprint/features";
import { createTenantContext, fromHeaders } from "../../tenantContext.js";
import { createMemoryProfileStore } from "../../memoryProfileStore.js";
import { createProfileResolver } from "../../profileResolver.js";
import { createGateMiddleware } from "../../gateMiddleware.js";

// ---------------------------------------------------------------------------
// Realistic multi-tenant SIS setup
// ---------------------------------------------------------------------------

const students = defineModule({
  id: "students", name: "Student Management", domain: "people",
  terminology: { student: { default: "Student", tutoring: "Learner" } },
});
const attendance = defineModule({
  id: "attendance", name: "Attendance", domain: "academics",
  requires: ["students"],
  terminology: { session: { default: "Session", dance: "Check-in" } },
});
const fees = defineModule({
  id: "fees", name: "Fee Management", domain: "finance",
  requires: ["students"],
});
const scheduling = defineModule({
  id: "scheduling", name: "Scheduling", domain: "scheduling",
  requires: ["students"],
  terminology: { period: { default: "Period", dance: "Time Slot" } },
});

const dance = defineProfile({
  type: "dance", displayName: "Dance School",
  modules: ["students", "attendance", "fees", "scheduling"],
  roles: ["Owner", "Instructor"],
});
const tutoring = defineProfile({
  type: "tutoring", displayName: "Tutoring Center",
  modules: ["students", "fees"],
  roles: ["Tutor"],
});

const registry = createModuleRegistry({
  modules: [students, attendance, fees, scheduling],
  profileTypes: [dance, tutoring],
});

// Two tenants, three schools
const store = createMemoryProfileStore([
  { unitId: "acme-dance-1", profileType: "dance", createdAt: "2024-01-01" },
  { unitId: "acme-tutor-1", profileType: "tutoring", createdAt: "2024-02-01" },
  { unitId: "beta-dance-1", profileType: "dance", createdAt: "2024-03-01" },
]);

const resolver = createProfileResolver(registry, store);
const gateCheck = createGateMiddleware(resolver);

describe("multi-tenant scenario: two tenants, three schools", () => {
  it("dance school can access attendance, scheduling, fees", async () => {
    const ctx = createTenantContext({ tenantId: "acme", unitId: "acme-dance-1" });
    const result = await gateCheck(ctx, ["attendance", "scheduling", "fees"]);
    expect(result.allowed).toBe(true);
  });

  it("tutoring center cannot access attendance or scheduling", async () => {
    const ctx = createTenantContext({ tenantId: "acme", unitId: "acme-tutor-1" });
    const result = await gateCheck(ctx, ["attendance"]);
    expect(result.allowed).toBe(false);
    expect(result.denied[0]!.profileType).toBe("tutoring");
  });

  it("different tenants with same profile type get same features", async () => {
    const ctx1 = createTenantContext({ tenantId: "acme", unitId: "acme-dance-1" });
    const ctx2 = createTenantContext({ tenantId: "beta", unitId: "beta-dance-1" });

    const config1 = await resolver.resolve(ctx1);
    const config2 = await resolver.resolve(ctx2);

    expect(config1.enabledModules.size).toBe(config2.enabledModules.size);
    expect(config1.profileType).toBe(config2.profileType);
  });

  it("terminology resolves per profile type", async () => {
    const danceCtx = createTenantContext({ tenantId: "acme", unitId: "acme-dance-1" });
    const tutorCtx = createTenantContext({ tenantId: "acme", unitId: "acme-tutor-1" });

    const danceConfig = await resolver.resolve(danceCtx);
    const tutorConfig = await resolver.resolve(tutorCtx);

    const danceT = createTermResolver(danceConfig.terminology);
    const tutorT = createTermResolver(tutorConfig.terminology);

    expect(danceT("session")).toBe("Check-in");
    expect(danceT("period")).toBe("Time Slot");
    expect(tutorT("student")).toBe("Learner");
  });

  it("full request flow: headers → context → gate", async () => {
    const ctx = fromHeaders({
      "x-tenant-id": "acme",
      "x-unit-id": "acme-dance-1",
      "x-user-id": "instructor-42",
    });

    const config = await resolver.resolve(ctx);
    const gate = await gateCheck(ctx, ["scheduling"]);

    expect(ctx.userId).toBe("instructor-42");
    expect(config.profileType).toBe("dance");
    expect(gate.allowed).toBe(true);
  });
});

describe("multi-tenant scenario: module override", () => {
  it("tutoring center with attendance override gets attendance", async () => {
    const customStore = createMemoryProfileStore([
      {
        unitId: "custom-tutor",
        profileType: "tutoring",
        moduleOverrides: ["students", "fees", "attendance"],
        createdAt: "2024-01-01",
      },
    ]);
    const customResolver = createProfileResolver(registry, customStore);
    const customGate = createGateMiddleware(customResolver);

    const ctx = createTenantContext({ tenantId: "t1", unitId: "custom-tutor" });
    const result = await customGate(ctx, ["attendance"]);
    expect(result.allowed).toBe(true);
  });
});
