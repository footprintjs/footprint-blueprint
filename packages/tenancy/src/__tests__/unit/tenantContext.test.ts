import { describe, it, expect } from "vitest";
import { createTenantContext, fromHeaders } from "../../tenantContext.js";

describe("createTenantContext", () => {
  it("creates a valid context with required fields", () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.unitId).toBe("u1");
    expect(ctx.campusId).toBeUndefined();
    expect(ctx.userId).toBeUndefined();
  });

  it("includes optional fields when provided", () => {
    const ctx = createTenantContext({ tenantId: "t1", campusId: "c1", unitId: "u1", userId: "usr1" });
    expect(ctx.campusId).toBe("c1");
    expect(ctx.userId).toBe("usr1");
  });

  it("trims whitespace from all fields", () => {
    const ctx = createTenantContext({ tenantId: "  t1  ", unitId: "  u1  ", userId: " usr1 " });
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.unitId).toBe("u1");
    expect(ctx.userId).toBe("usr1");
  });

  it("freezes the returned object", () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("throws on empty tenantId", () => {
    expect(() => createTenantContext({ tenantId: "", unitId: "u1" })).toThrow("tenantId");
  });

  it("throws on empty unitId", () => {
    expect(() => createTenantContext({ tenantId: "t1", unitId: "" })).toThrow("unitId");
  });

  it("throws on null tenantId", () => {
    expect(() => createTenantContext({ tenantId: null as any, unitId: "u1" })).toThrow("tenantId");
  });
});

describe("fromHeaders", () => {
  it("extracts context from default header names", () => {
    const ctx = fromHeaders({
      "x-tenant-id": "t1",
      "x-campus-id": "c1",
      "x-unit-id": "u1",
      "x-user-id": "usr1",
    });
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.campusId).toBe("c1");
    expect(ctx.unitId).toBe("u1");
    expect(ctx.userId).toBe("usr1");
  });

  it("works with custom header names", () => {
    const ctx = fromHeaders(
      { "tenant": "t1", "school": "u1" },
      { tenantId: "tenant", unitId: "school" },
    );
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.unitId).toBe("u1");
  });

  it("throws on missing tenant header", () => {
    expect(() => fromHeaders({ "x-unit-id": "u1" })).toThrow("x-tenant-id");
  });

  it("throws on missing unit header", () => {
    expect(() => fromHeaders({ "x-tenant-id": "t1" })).toThrow("x-unit-id");
  });

  it("handles optional headers gracefully", () => {
    const ctx = fromHeaders({ "x-tenant-id": "t1", "x-unit-id": "u1" });
    expect(ctx.campusId).toBeUndefined();
    expect(ctx.userId).toBeUndefined();
  });
});
