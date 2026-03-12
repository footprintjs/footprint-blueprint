import { describe, it, expect } from "vitest";
import { createTenantContext } from "@footprint/tenancy";
import { createPlatform } from "../../platform.js";
import {
  createTestRegistry,
  createTestProfileStore,
  createTestAdapterRegistry,
  createTestActionRegistry,
} from "../fixtures.js";

describe("scenario: full platform workflow for a dance school", () => {
  const platform = createPlatform({
    registry: createTestRegistry(),
    profileStore: createTestProfileStore(),
    adapterRegistry: createTestAdapterRegistry(),
    actionRegistry: createTestActionRegistry(),
  });
  const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

  it("step 1: resolve the unit to get its profile config", async () => {
    const result = await platform.resolveUnit(ctx);
    expect(result.profileType).toBe("dance");
    expect(result.config.enabledModules.has("students")).toBe(true);
    expect(result.config.enabledModules.has("scheduling")).toBe(true);
  });

  it("step 2: setup the unit to get config + seed plan", async () => {
    const result = await platform.setupUnit(ctx);
    expect(result.seedPlan).toBeDefined();
    expect(result.seedPlan!.entries.length).toBeGreaterThan(0);
    const moduleIds = result.seedPlan!.entries.map((e) => e.moduleId);
    expect(moduleIds).toContain("students");
  });

  it("step 3: gate check passes for dance modules", async () => {
    const result = await platform.gateCheck(ctx, ["students", "attendance", "scheduling"]);
    expect(result.allowed).toBe(true);
  });

  it("step 4: gate check fails for k12-only modules", async () => {
    const result = await platform.gateCheck(ctx, ["grades"]);
    expect(result.allowed).toBe(false);
  });

  it("step 5: terminology resolves to dance terms", async () => {
    const t = await platform.getTermResolver(ctx);
    expect(t("student")).toBe("Dancer");
    expect(t("session")).toBe("Check-in");
  });

  it("step 6: available actions reflect dance modules", async () => {
    const tools = await platform.getAvailableActions(ctx);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("enroll-student");
    expect(toolNames).toContain("schedule-class");
    // grades is not enabled for dance, so grade-student should be absent
    expect(toolNames).not.toContain("grade-student");
  });

  it("step 7: execute action through adapter bridge", async () => {
    const result = await platform.executeAction(ctx, "enroll-student", { studentName: "Luna" });
    expect(result.status).toBe("success");
    expect((result.result as Record<string, unknown>).registered).toBe(true);
    expect((result.result as Record<string, unknown>).dancerName).toBe("Luna");
  });

  it("step 8: action denied when module not enabled", async () => {
    const result = await platform.executeAction(ctx, "grade-student", { studentId: "s1", grade: "A" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("disabled modules");
  });
});

describe("scenario: K-12 school has full access", () => {
  const platform = createPlatform({
    registry: createTestRegistry(),
    profileStore: createTestProfileStore(),
    adapterRegistry: createTestAdapterRegistry(),
    actionRegistry: createTestActionRegistry(),
  });
  const ctx = createTenantContext({ tenantId: "t1", unitId: "k12-school-1" });

  it("K-12 sees all actions including grades", async () => {
    const tools = await platform.getAvailableActions(ctx);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("enroll-student");
    expect(toolNames).toContain("schedule-class");
    expect(toolNames).toContain("grade-student");
  });

  it("K-12 uses default enrollment adapter", async () => {
    const result = await platform.executeAction(ctx, "enroll-student", { studentName: "Bob" });
    expect(result.status).toBe("success");
    expect((result.result as Record<string, unknown>).enrolled).toBe(true);
    expect((result.result as Record<string, unknown>).studentName).toBe("Bob");
  });

  it("K-12 terminology uses defaults", async () => {
    const t = await platform.getTermResolver(ctx);
    expect(t("student")).toBe("Student");
    expect(t("session")).toBe("Session");
  });
});

describe("scenario: platform without adapters/actions", () => {
  const platform = createPlatform({
    registry: createTestRegistry(),
    profileStore: createTestProfileStore(),
  });
  const ctx = createTenantContext({ tenantId: "t1", unitId: "dance-studio-1" });

  it("resolve and setup still work", async () => {
    const result = await platform.setupUnit(ctx);
    expect(result.profileType).toBe("dance");
    expect(result.seedPlan).toBeDefined();
  });

  it("getAvailableActions returns empty", async () => {
    const tools = await platform.getAvailableActions(ctx);
    expect(tools).toHaveLength(0);
  });

  it("executeAction returns error", async () => {
    const result = await platform.executeAction(ctx, "enroll-student", {});
    expect(result.status).toBe("error");
    expect(result.error).toContain("No action registry");
  });
});
