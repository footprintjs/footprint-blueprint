import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";
import { resolveTransitiveDependencies, buildDependencyTree, validateRegistry } from "../../dependencyGraph.js";

function makeRegistry(modules: ReturnType<typeof defineModule>[]) {
  return new Map(modules.map((m) => [m.id, m]));
}

const students = defineModule({ id: "students", name: "Students", domain: "people" });
const academics = defineModule({ id: "academics", name: "Academics", domain: "academics", requires: ["students"] });
const attendance = defineModule({ id: "attendance", name: "Attendance", domain: "academics", requires: ["students", "academics"] });
const scheduling = defineModule({ id: "scheduling", name: "Scheduling", domain: "scheduling", requires: ["academics"] });

describe("resolveTransitiveDependencies", () => {
  it("resolves direct dependencies", () => {
    const registry = makeRegistry([students, academics]);
    const { resolved, errors } = resolveTransitiveDependencies(["academics"], registry);

    expect(errors).toEqual([]);
    expect(resolved).toContain("academics");
    expect(resolved).toContain("students");
  });

  it("resolves transitive dependencies", () => {
    const registry = makeRegistry([students, academics, attendance]);
    const { resolved, errors } = resolveTransitiveDependencies(["attendance"], registry);

    expect(errors).toEqual([]);
    expect(resolved.size).toBe(3);
    expect(resolved).toContain("attendance");
    expect(resolved).toContain("academics");
    expect(resolved).toContain("students");
  });

  it("resolves deep chains", () => {
    const registry = makeRegistry([students, academics, attendance, scheduling]);
    const { resolved, errors } = resolveTransitiveDependencies(["scheduling"], registry);

    expect(errors).toEqual([]);
    expect(resolved.size).toBe(3); // scheduling, academics, students
    expect(resolved).toContain("scheduling");
    expect(resolved).toContain("academics");
    expect(resolved).toContain("students");
  });

  it("handles modules with no dependencies", () => {
    const registry = makeRegistry([students]);
    const { resolved, errors } = resolveTransitiveDependencies(["students"], registry);

    expect(errors).toEqual([]);
    expect(resolved.size).toBe(1);
    expect(resolved).toContain("students");
  });

  it("detects unknown modules", () => {
    const registry = makeRegistry([students]);
    const { errors } = resolveTransitiveDependencies(["unknown"], registry);

    expect(errors.length).toBe(1);
    expect(errors[0].type).toBe("unknown_module");
    expect(errors[0].moduleId).toBe("unknown");
  });

  it("detects circular dependencies", () => {
    const a = defineModule({ id: "mod-a", name: "A", domain: "x", requires: ["mod-b"] });
    const b = defineModule({ id: "mod-b", name: "B", domain: "x", requires: ["mod-a"] });
    const registry = makeRegistry([a, b]);

    const { errors } = resolveTransitiveDependencies(["mod-a"], registry);
    expect(errors.some((e) => e.type === "circular_dependency")).toBe(true);
  });

  it("deduplicates shared dependencies", () => {
    const registry = makeRegistry([students, academics, attendance]);
    // Both attendance and academics require students
    const { resolved } = resolveTransitiveDependencies(["attendance", "academics"], registry);

    const studentCount = Array.from(resolved).filter((id) => id === "students").length;
    expect(studentCount).toBe(1);
  });
});

describe("buildDependencyTree", () => {
  it("builds tree for resolved modules", () => {
    const registry = makeRegistry([students, academics, attendance]);
    const resolved = new Set(["students", "academics", "attendance"]);
    const tree = buildDependencyTree(resolved, registry);

    expect(tree.get("students")).toEqual([]);
    expect(tree.get("academics")).toEqual(["students"]);
    expect(tree.get("attendance")).toEqual(["students", "academics"]);
  });

  it("filters out dependencies not in resolved set", () => {
    const registry = makeRegistry([students, academics, attendance]);
    const resolved = new Set(["attendance"]); // students and academics NOT resolved
    const tree = buildDependencyTree(resolved, registry);

    expect(tree.get("attendance")).toEqual([]); // deps filtered out
  });
});

describe("validateRegistry", () => {
  it("returns no errors for valid registry", () => {
    const registry = makeRegistry([students, academics, attendance]);
    const errors = validateRegistry(registry);
    expect(errors).toEqual([]);
  });

  it("detects missing dependencies", () => {
    const orphan = defineModule({ id: "orphan", name: "Orphan", domain: "x", requires: ["nonexistent"] });
    const registry = makeRegistry([orphan]);
    const errors = validateRegistry(registry);

    expect(errors.some((e) => e.type === "missing_dependency")).toBe(true);
  });

  it("detects circular dependencies in full registry", () => {
    const a = defineModule({ id: "mod-a", name: "A", domain: "x", requires: ["mod-b"] });
    const b = defineModule({ id: "mod-b", name: "B", domain: "x", requires: ["mod-a"] });
    const registry = makeRegistry([a, b]);
    const errors = validateRegistry(registry);

    expect(errors.some((e) => e.type === "circular_dependency")).toBe(true);
  });
});
