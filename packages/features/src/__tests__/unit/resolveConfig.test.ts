import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";
import { defineProfile } from "../../defineProfile.js";
import { createModuleRegistry } from "../../moduleRegistry.js";
import { resolveProfileConfig } from "../../resolveConfig.js";

const students = defineModule({
  id: "students", name: "Students", domain: "people",
  terminology: { student: { default: "Student" } },
  roles: { canEnroll: ["Admin", "Front Desk"] },
  seed: { default: { fields: ["name", "dob"] } },
});
const academics = defineModule({
  id: "academics", name: "Academics", domain: "academics",
  requires: ["students"],
  terminology: { grade: { default: "Grade", dance: "Level" } },
  seed: { k12: { grades: 12 }, dance: { grades: 3 } },
});
const attendance = defineModule({
  id: "attendance", name: "Attendance", domain: "academics",
  requires: ["students", "academics"],
  terminology: { session: { default: "Session", dance: "Check-in" } },
  roles: { canMark: ["Teacher", "Instructor"] },
  seed: { default: { statuses: ["present", "absent"] } },
});
const departments = defineModule({ id: "departments", name: "Departments", domain: "org" });
const fees = defineModule({
  id: "fees", name: "Fees", domain: "finance",
  requires: ["students"],
  seed: { dance: { model: "per-class" }, k12: { model: "per-term" } },
});

const k12 = defineProfile({
  type: "k12", displayName: "K-12",
  modules: ["students", "academics", "attendance", "departments", "fees"],
  roles: ["Principal", "Vice Principal", "Teacher", "Admin"],
  schedulingPattern: "fixed-timetable",
});
const dance = defineProfile({
  type: "dance", displayName: "Dance School",
  modules: ["students", "attendance", "fees"],
  roles: ["Owner", "Instructor", "Front Desk"],
  schedulingPattern: "time-slots",
});

const registry = createModuleRegistry({
  modules: [students, academics, attendance, departments, fees],
  profileTypes: [k12, dance],
});

describe("resolveProfileConfig", () => {
  it("resolves enabled modules with transitive deps for dance school", () => {
    const config = resolveProfileConfig(registry, "dance");

    expect(config.profileType).toBe("dance");
    expect(config.enabledModules).toContain("students");
    expect(config.enabledModules).toContain("attendance");
    expect(config.enabledModules).toContain("academics"); // transitive
    expect(config.enabledModules).toContain("fees");
    expect(config.enabledModules).not.toContain("departments");
  });

  it("resolves enabled modules for K-12 school", () => {
    const config = resolveProfileConfig(registry, "k12");

    expect(config.enabledModules).toContain("students");
    expect(config.enabledModules).toContain("academics");
    expect(config.enabledModules).toContain("attendance");
    expect(config.enabledModules).toContain("departments");
    expect(config.enabledModules).toContain("fees");
  });

  it("resolves terminology for dance school", () => {
    const config = resolveProfileConfig(registry, "dance");

    expect(config.terminology.grade).toBe("Level");
    expect(config.terminology.session).toBe("Check-in");
    expect(config.terminology.student).toBe("Student"); // default
  });

  it("resolves terminology for K-12 school", () => {
    const config = resolveProfileConfig(registry, "k12");

    expect(config.terminology.grade).toBe("Grade"); // default
    expect(config.terminology.session).toBe("Session"); // default
  });

  it("merges roles from profile and modules", () => {
    const config = resolveProfileConfig(registry, "dance");

    // From profile
    expect(config.roles).toContain("Owner");
    expect(config.roles).toContain("Instructor");
    expect(config.roles).toContain("Front Desk");
    // From module roles
    expect(config.roles).toContain("Admin"); // from students.canEnroll
    expect(config.roles).toContain("Teacher"); // from attendance.canMark
  });

  it("resolves seed data for dance school", () => {
    const config = resolveProfileConfig(registry, "dance");

    expect(config.seed.academics).toEqual({ grades: 3 }); // dance-specific
    expect(config.seed.fees).toEqual({ model: "per-class" }); // dance-specific
    expect(config.seed.attendance).toEqual({ statuses: ["present", "absent"] }); // default
    expect(config.seed.students).toEqual({ fields: ["name", "dob"] }); // default
  });

  it("resolves seed data for K-12 school", () => {
    const config = resolveProfileConfig(registry, "k12");

    expect(config.seed.academics).toEqual({ grades: 12 }); // k12-specific
    expect(config.seed.fees).toEqual({ model: "per-term" }); // k12-specific
  });

  it("builds dependency tree", () => {
    const config = resolveProfileConfig(registry, "dance");

    expect(config.dependencyTree.get("students")).toEqual([]);
    expect(config.dependencyTree.get("academics")).toEqual(["students"]);
    expect(config.dependencyTree.get("attendance")).toContain("students");
    expect(config.dependencyTree.get("attendance")).toContain("academics");
  });

  it("returns empty config for unknown profile", () => {
    const config = resolveProfileConfig(registry, "unknown");

    expect(config.profileType).toBe("unknown");
    expect(config.enabledModules.size).toBe(0);
    expect(config.roles).toEqual([]);
  });

  it("accepts module overrides", () => {
    const config = resolveProfileConfig(registry, "dance", ["students", "fees"]);

    // Only students and fees (and students as transitive dep of fees)
    expect(config.enabledModules).toContain("students");
    expect(config.enabledModules).toContain("fees");
    expect(config.enabledModules).not.toContain("attendance");
    expect(config.enabledModules).not.toContain("departments");
  });

  it("provides module definitions in config", () => {
    const config = resolveProfileConfig(registry, "dance");

    expect(config.modules.get("students")).toBe(students);
    expect(config.modules.get("attendance")).toBe(attendance);
    expect(config.modules.has("departments")).toBe(false);
  });

  it("throws on circular dependencies", () => {
    const modA = defineModule({ id: "mod-a", name: "A", domain: "test", requires: ["mod-b"] });
    const modB = defineModule({ id: "mod-b", name: "B", domain: "test", requires: ["mod-a"] });
    const prof = defineProfile({ type: "circ", displayName: "Circular", modules: ["mod-a", "mod-b"] });
    const reg = createModuleRegistry({ modules: [modA, modB], profileTypes: [prof] });

    expect(() => resolveProfileConfig(reg, "circ")).toThrow("Circular dependency");
  });

  it("returns warnings for unknown modules (not silent drops)", () => {
    const prof = defineProfile({
      type: "partial", displayName: "Partial",
      modules: ["students", "ghost_module"],
    });
    const reg = createModuleRegistry({ modules: [students], profileTypes: [prof] });

    const config = resolveProfileConfig(reg, "partial");

    expect(config.enabledModules).toContain("students");
    expect(config.enabledModules).not.toContain("ghost_module");
    expect(config.warnings.length).toBeGreaterThan(0);
    expect(config.warnings.some((w) => w.type === "unknown_module" && w.moduleId === "ghost_module")).toBe(true);
  });

  it("returns empty warnings for valid configs", () => {
    const config = resolveProfileConfig(registry, "k12");

    expect(config.warnings).toEqual([]);
  });
});
