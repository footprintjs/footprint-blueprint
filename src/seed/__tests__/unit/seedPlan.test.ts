import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry, resolveProfileConfig } from "../../../features/index.js";
import { generateSeedPlan } from "../../seedPlan.js";
import type { SeedGenerator } from "../../types.js";

const students = defineModule({
  id: "students", name: "Students", domain: "people",
  seed: { default: { fields: ["name", "dob"] } },
});
const attendance = defineModule({
  id: "attendance", name: "Attendance", domain: "academics",
  requires: ["students"],
  seed: { dance: { statuses: ["present", "absent"] }, default: { statuses: ["present", "absent", "late"] } },
});
const fees = defineModule({
  id: "fees", name: "Fees", domain: "finance",
  requires: ["students"],
  seed: { dance: { model: "per-class" }, default: { model: "per-term" } },
});
const noSeed = defineModule({ id: "noseed", name: "No Seed", domain: "other" });

const dance = defineProfile({
  type: "dance", displayName: "Dance School",
  modules: ["students", "attendance", "fees", "noseed"],
});

const registry = createModuleRegistry({ modules: [students, attendance, fees, noSeed], profileTypes: [dance] });
const config = resolveProfileConfig(registry, "dance");

describe("generateSeedPlan", () => {
  it("creates a plan with entries for modules that have seed data", () => {
    const plan = generateSeedPlan(config, "school-1");
    expect(plan.entries.length).toBe(3); // students, attendance, fees — not noseed
    expect(plan.entries.map((e) => e.moduleId)).not.toContain("noseed");
  });

  it("sets profileType and unitId", () => {
    const plan = generateSeedPlan(config, "school-1");
    expect(plan.profileType).toBe("dance");
    expect(plan.unitId).toBe("school-1");
  });

  it("includes generatedAt timestamp", () => {
    const plan = generateSeedPlan(config, "school-1");
    expect(plan.generatedAt).toBeTruthy();
    expect(new Date(plan.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("orders entries by dependency depth (no-dep modules first)", () => {
    const plan = generateSeedPlan(config, "school-1");
    const studentIdx = plan.entries.findIndex((e) => e.moduleId === "students");
    const attendanceIdx = plan.entries.findIndex((e) => e.moduleId === "attendance");
    expect(studentIdx).toBeLessThan(attendanceIdx); // students has no deps, attendance depends on students
  });

  it("uses profile-specific seed data", () => {
    const plan = generateSeedPlan(config, "school-1");
    const attendanceEntry = plan.entries.find((e) => e.moduleId === "attendance");
    expect(attendanceEntry?.blueprint).toEqual({ statuses: ["present", "absent"] }); // dance-specific
  });

  it("plan is frozen", () => {
    const plan = generateSeedPlan(config, "school-1");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.entries)).toBe(true);
  });

  it("applies generators when provided", () => {
    const generator: SeedGenerator = {
      moduleId: "students",
      generate(blueprint) {
        return { ...(blueprint as any), generatedId: "gen-001" };
      },
    };

    const plan = generateSeedPlan(config, "school-1", [generator]);
    const studentEntry = plan.entries.find((e) => e.moduleId === "students");
    expect(studentEntry?.transformed).toEqual({ fields: ["name", "dob"], generatedId: "gen-001" });
  });

  it("leaves transformed undefined when no generator matches", () => {
    const plan = generateSeedPlan(config, "school-1");
    const studentEntry = plan.entries.find((e) => e.moduleId === "students");
    expect(studentEntry?.transformed).toBeUndefined();
  });

  it("handles empty seed config", () => {
    const mod = defineModule({ id: "empty", name: "Empty", domain: "d" });
    const prof = defineProfile({ type: "basic", displayName: "Basic", modules: ["empty"] });
    const reg = createModuleRegistry({ modules: [mod], profileTypes: [prof] });
    const cfg = resolveProfileConfig(reg, "basic");

    const plan = generateSeedPlan(cfg, "u1");
    expect(plan.entries).toHaveLength(0);
  });

  it("computes correct depths for diamond dependencies (a->b->d, a->c->d)", () => {
    const modD = defineModule({ id: "d", name: "D", domain: "test", seed: { default: { d: true } } });
    const modB = defineModule({ id: "b", name: "B", domain: "test", requires: ["d"], seed: { default: { b: true } } });
    const modC = defineModule({ id: "c", name: "C", domain: "test", requires: ["d"], seed: { default: { c: true } } });
    const modA = defineModule({ id: "a", name: "A", domain: "test", requires: ["b", "c"], seed: { default: { a: true } } });
    const prof = defineProfile({ type: "diamond", displayName: "Diamond", modules: ["a", "b", "c", "d"] });
    const reg = createModuleRegistry({ modules: [modA, modB, modC, modD], profileTypes: [prof] });
    const cfg = resolveProfileConfig(reg, "diamond");

    const plan = generateSeedPlan(cfg, "u1");

    const entryD = plan.entries.find((e) => e.moduleId === "d")!;
    const entryB = plan.entries.find((e) => e.moduleId === "b")!;
    const entryC = plan.entries.find((e) => e.moduleId === "c")!;
    const entryA = plan.entries.find((e) => e.moduleId === "a")!;

    expect(entryD.order).toBe(0); // no deps
    expect(entryB.order).toBe(1); // depends on D (depth 0)
    expect(entryC.order).toBe(1); // depends on D (depth 0)
    expect(entryA.order).toBe(2); // depends on B,C (depth 1)

    // D should come before B and C, which should come before A
    const idxD = plan.entries.indexOf(entryD);
    const idxB = plan.entries.indexOf(entryB);
    const idxC = plan.entries.indexOf(entryC);
    const idxA = plan.entries.indexOf(entryA);
    expect(idxD).toBeLessThan(idxB);
    expect(idxD).toBeLessThan(idxC);
    expect(idxB).toBeLessThan(idxA);
    expect(idxC).toBeLessThan(idxA);
  });
});
