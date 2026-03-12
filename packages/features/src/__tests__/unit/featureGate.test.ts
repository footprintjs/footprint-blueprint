import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";
import { defineProfile } from "../../defineProfile.js";
import { createModuleRegistry } from "../../moduleRegistry.js";
import { resolveProfileConfig } from "../../resolveConfig.js";
import { createFeatureGate } from "../../featureGate.js";

const students = defineModule({ id: "students", name: "Students", domain: "people" });
const academics = defineModule({ id: "academics", name: "Academics", domain: "academics", requires: ["students"] });
const attendance = defineModule({ id: "attendance", name: "Attendance", domain: "academics", requires: ["students", "academics"] });
const departments = defineModule({ id: "departments", name: "Departments", domain: "org" });

const dance = defineProfile({ type: "dance", displayName: "Dance", modules: ["students", "attendance"] });

describe("createFeatureGate", () => {
  const registry = createModuleRegistry({
    modules: [students, academics, attendance, departments],
    profileTypes: [dance],
  });
  const config = resolveProfileConfig(registry, "dance");
  const gate = createFeatureGate(config);

  it("returns true for enabled modules", () => {
    expect(gate.isEnabled("students")).toBe(true);
    expect(gate.isEnabled("attendance")).toBe(true);
    expect(gate.isEnabled("academics")).toBe(true); // transitive dep
  });

  it("returns false for disabled modules", () => {
    expect(gate.isEnabled("departments")).toBe(false);
  });

  it("returns false for unknown modules", () => {
    expect(gate.isEnabled("nonexistent")).toBe(false);
  });

  it("check() returns detailed allowed result", () => {
    const result = gate.check("attendance");
    expect(result.allowed).toBe(true);
    expect(result.moduleId).toBe("attendance");
    expect(result.reason).toContain("enabled");
  });

  it("check() returns detailed denied result", () => {
    const result = gate.check("departments");
    expect(result.allowed).toBe(false);
    expect(result.moduleId).toBe("departments");
    expect(result.reason).toContain("not enabled");
  });

  it("enabledModules() returns frozen list", () => {
    const list = gate.enabledModules();
    expect(list).toContain("students");
    expect(list).toContain("attendance");
    expect(list).toContain("academics");
    expect(list).not.toContain("departments");
    expect(Object.isFrozen(list)).toBe(true);
  });
});
