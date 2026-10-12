import { describe, it, expect } from "vitest";
import { createTenantContext } from "../../../tenancy/index.js";
import { createAuthorizedTestPlatform as createPlatform } from "../fixtures.js";
import {
  createTestRegistry,
  createTestProfileStore,
  createTestAdapterRegistry,
  createTestActionRegistry,
} from "../fixtures.js";

describe("createPlatform", () => {
  it("creates a platform instance with all methods", () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });

    expect(platform).toBeDefined();
    expect(typeof platform.resolveUnit).toBe("function");
    expect(typeof platform.setupUnit).toBe("function");
    expect(typeof platform.gateCheck).toBe("function");
    expect(typeof platform.getTermResolver).toBe("function");
    expect(typeof platform.getAvailableActions).toBe("function");
    expect(typeof platform.executeAction).toBe("function");
  });
});

describe("resolveUnit", () => {
  it("resolves a dance school unit", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

    const result = await platform.resolveUnit(ctx);

    expect(result.unitId).toBe("dance-studio-1");
    expect(result.profileType).toBe("dance");
    expect(result.config.enabledModules.has("students")).toBe(true);
    expect(result.config.enabledModules.has("attendance")).toBe(true);
    expect(result.config.enabledModules.has("fees")).toBe(true);
    expect(result.config.enabledModules.has("scheduling")).toBe(true);
    expect(result.config.enabledModules.has("employees")).toBe(true);
    // Dance profile does not include grades
    expect(result.config.enabledModules.has("grades")).toBe(false);
    expect(result.seedPlan).toBeUndefined();
  });

  it("resolves a k12 school unit", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "k12-school-1" });

    const result = await platform.resolveUnit(ctx);

    expect(result.unitId).toBe("k12-school-1");
    expect(result.profileType).toBe("k12");
    expect(result.config.enabledModules.has("grades")).toBe(true);
    expect(result.config.enabledModules.has("students")).toBe(true);
  });
});

describe("setupUnit", () => {
  it("returns config and seed plan for a dance school", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

    const result = await platform.setupUnit(ctx);

    expect(result.unitId).toBe("dance-studio-1");
    expect(result.profileType).toBe("dance");
    expect(result.seedPlan).toBeDefined();
    expect(result.seedPlan!.profileType).toBe("dance");
    expect(result.seedPlan!.unitId).toBe("dance-studio-1");
    expect(result.seedPlan!.entries.length).toBeGreaterThan(0);
  });

  it("seed plan entries include dance-specific seed data", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

    const result = await platform.setupUnit(ctx);
    const studentsSeed = result.seedPlan!.entries.find((e) => e.moduleId === "students");

    expect(studentsSeed).toBeDefined();
    expect(studentsSeed!.blueprint).toEqual({ statuses: ["active", "on-break", "dropped"] });
  });
});

describe("gateCheck", () => {
  it("allows enabled modules", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

    const result = await platform.gateCheck(ctx, ["students", "attendance"]);

    expect(result.allowed).toBe(true);
    expect(result.denied).toHaveLength(0);
  });

  it("denies disabled modules", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

    // grades is not in the dance profile
    const result = await platform.gateCheck(ctx, ["grades"]);

    expect(result.allowed).toBe(false);
    expect(result.denied).toHaveLength(1);
    expect(result.denied[0]!.moduleId).toBe("grades");
  });

  it("allows empty module list", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

    const result = await platform.gateCheck(ctx, []);

    expect(result.allowed).toBe(true);
    expect(result.denied).toHaveLength(0);
  });
});

describe("getTermResolver", () => {
  it("returns dance-specific terminology", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

    const t = await platform.getTermResolver(ctx);

    expect(t("student")).toBe("Dancer");
    expect(t("session")).toBe("Check-in");
    expect(t("employee")).toBe("Instructor");
    expect(t("fee")).toBe("Tuition");
    // Unknown key returns the key itself
    expect(t("unknown-term")).toBe("unknown-term");
  });

  it("returns k12-specific terminology (defaults)", async () => {
    const platform = createPlatform({
      registry: createTestRegistry(),
      profileStore: createTestProfileStore(),
    });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "k12-school-1" });

    const t = await platform.getTermResolver(ctx);

    // K12 has no overrides, so it falls back to defaults
    expect(t("student")).toBe("Student");
    expect(t("session")).toBe("Session");
    expect(t("employee")).toBe("Employee");
  });
});
