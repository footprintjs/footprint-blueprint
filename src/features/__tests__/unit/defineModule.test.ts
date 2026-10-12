import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";

describe("defineModule", () => {
  it("creates a valid module definition", () => {
    const mod = defineModule({
      id: "students",
      name: "Student Management",
      domain: "people",
    });

    expect(mod.id).toBe("students");
    expect(mod.name).toBe("Student Management");
    expect(mod.domain).toBe("people");
    expect(mod.requires).toEqual([]);
    expect(mod.capabilities).toEqual([]);
    expect(mod.terminology).toEqual({});
    expect(mod.seed).toEqual({});
    expect(mod.roles).toEqual({});
  });

  it("preserves all provided fields", () => {
    const mod = defineModule({
      id: "attendance",
      name: "Attendance Tracking",
      description: "Track student attendance per session",
      domain: "academics",
      requires: ["students", "academics"],
      capabilities: ["create-session", "mark-attendance"],
      terminology: {
        session: { default: "Session", dance: "Check-in" },
      },
      seed: {
        k12: { statuses: ["present", "absent", "late", "excused"] },
        dance: { statuses: ["present", "absent"] },
      },
      roles: {
        canMark: ["Teacher", "Instructor"],
        canView: ["Principal", "Teacher"],
      },
    });

    expect(mod.requires).toEqual(["students", "academics"]);
    expect(mod.capabilities).toEqual(["create-session", "mark-attendance"]);
    expect(mod.terminology.session.dance).toBe("Check-in");
    expect(mod.seed.k12).toEqual({ statuses: ["present", "absent", "late", "excused"] });
    expect(mod.roles.canMark).toEqual(["Teacher", "Instructor"]);
  });

  it("returns a frozen object", () => {
    const mod = defineModule({ id: "students", name: "Students", domain: "people" });

    expect(Object.isFrozen(mod)).toBe(true);
    expect(Object.isFrozen(mod.requires)).toBe(true);
    expect(Object.isFrozen(mod.capabilities)).toBe(true);
    expect(Object.isFrozen(mod.terminology)).toBe(true);
    expect(Object.isFrozen(mod.seed)).toBe(true);
    expect(Object.isFrozen(mod.roles)).toBe(true);
  });

  it("trims whitespace from string fields", () => {
    const mod = defineModule({ id: "students", name: "  Students  ", domain: "  people  ", description: "  desc  " });
    expect(mod.name).toBe("Students");
    expect(mod.domain).toBe("people");
    expect(mod.description).toBe("desc");
  });

  it("throws on empty id", () => {
    expect(() => defineModule({ id: "", name: "X", domain: "x" })).toThrow();
  });

  it("throws on missing name", () => {
    expect(() => defineModule({ id: "x", name: "", domain: "x" })).toThrow();
  });

  it("throws on missing domain", () => {
    expect(() => defineModule({ id: "x", name: "X", domain: "" })).toThrow();
  });

  it("throws on id exceeding 64 characters", () => {
    const longId = "a".repeat(65);
    expect(() => defineModule({ id: longId, name: "X", domain: "x" })).toThrow("64 characters");
  });

  it("throws on id with uppercase letters", () => {
    expect(() => defineModule({ id: "MyModule", name: "X", domain: "x" })).toThrow();
  });

  it("throws on id starting with a digit", () => {
    expect(() => defineModule({ id: "1module", name: "X", domain: "x" })).toThrow();
  });

  it("allows hyphens in id", () => {
    const mod = defineModule({ id: "fee-management", name: "Fees", domain: "finance" });
    expect(mod.id).toBe("fee-management");
  });

  it("defaults description to empty string", () => {
    const mod = defineModule({ id: "x", name: "X", domain: "d" });
    expect(mod.description).toBe("");
  });
});
