import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry, resolveProfileConfig } from "../../../features/index.js";
import { generateSeedPlan, executeSeedPlan } from "../../index.js";
import type { SeedApplier, SeedGenerator } from "../../types.js";

// ---------------------------------------------------------------------------
// Realistic SIS modules with seed data
// ---------------------------------------------------------------------------

const students = defineModule({
  id: "students", name: "Students", domain: "people",
  seed: { default: { fields: ["name", "dob", "contact"] } },
});
const academics = defineModule({
  id: "academics", name: "Academics", domain: "academics",
  requires: ["students"],
  seed: {
    k12: { grades: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"] },
    dance: { grades: ["Beginner", "Intermediate", "Advanced"] },
  },
});
const attendance = defineModule({
  id: "attendance", name: "Attendance", domain: "academics",
  requires: ["students", "academics"],
  seed: {
    k12: { statuses: ["present", "absent", "late", "excused"] },
    dance: { statuses: ["present", "absent"] },
  },
});
const fees = defineModule({
  id: "fees", name: "Fees", domain: "finance",
  requires: ["students"],
  seed: {
    k12: { model: "per-term", types: ["tuition", "registration"] },
    dance: { model: "per-class", types: ["class-fee", "costume"] },
  },
});

const k12 = defineProfile({ type: "k12", displayName: "K-12", modules: ["students", "academics", "attendance", "fees"], roles: ["Teacher", "Admin"] });
const dance = defineProfile({ type: "dance", displayName: "Dance", modules: ["students", "academics", "attendance", "fees"], roles: ["Instructor"] });

const registry = createModuleRegistry({ modules: [students, academics, attendance, fees], profileTypes: [k12, dance] });

describe("scenario: setting up a K-12 school", () => {
  const config = resolveProfileConfig(registry, "k12");
  const plan = generateSeedPlan(config, "lincoln-high");

  it("generates plan with 4 seed entries", () => {
    expect(plan.entries).toHaveLength(4);
  });

  it("has K-12 specific grade structure", () => {
    const academicEntry = plan.entries.find((e) => e.moduleId === "academics");
    expect(academicEntry?.blueprint).toEqual({ grades: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"] });
  });

  it("has 4-status attendance", () => {
    const entry = plan.entries.find((e) => e.moduleId === "attendance");
    expect(entry?.blueprint).toEqual({ statuses: ["present", "absent", "late", "excused"] });
  });

  it("orders students before attendance (dependency order)", () => {
    const sIdx = plan.entries.findIndex((e) => e.moduleId === "students");
    const aIdx = plan.entries.findIndex((e) => e.moduleId === "attendance");
    expect(sIdx).toBeLessThan(aIdx);
  });
});

describe("scenario: setting up a dance school", () => {
  const config = resolveProfileConfig(registry, "dance");
  const plan = generateSeedPlan(config, "rhythm-studio");

  it("has dance-specific grades", () => {
    const entry = plan.entries.find((e) => e.moduleId === "academics");
    expect(entry?.blueprint).toEqual({ grades: ["Beginner", "Intermediate", "Advanced"] });
  });

  it("has simplified attendance", () => {
    const entry = plan.entries.find((e) => e.moduleId === "attendance");
    expect(entry?.blueprint).toEqual({ statuses: ["present", "absent"] });
  });

  it("has per-class fee model", () => {
    const entry = plan.entries.find((e) => e.moduleId === "fees");
    expect(entry?.blueprint).toEqual({ model: "per-class", types: ["class-fee", "costume"] });
  });
});

describe("scenario: full seed execution with generator + applier", () => {
  it("generates, transforms, and applies seed data", async () => {
    const config = resolveProfileConfig(registry, "dance");

    // Generator that expands grade shorthand into objects
    const academicsGenerator: SeedGenerator = {
      moduleId: "academics",
      generate(blueprint) {
        const b = blueprint as { grades: string[] };
        return {
          grades: b.grades.map((name, idx) => ({ id: idx + 1, name, order: idx })),
        };
      },
    };

    const plan = generateSeedPlan(config, "studio-1", [academicsGenerator]);

    // Verify generator was applied
    const academicEntry = plan.entries.find((e) => e.moduleId === "academics");
    expect(academicEntry?.transformed).toEqual({
      grades: [
        { id: 1, name: "Beginner", order: 0 },
        { id: 2, name: "Intermediate", order: 1 },
        { id: 3, name: "Advanced", order: 2 },
      ],
    });

    // Apply with mock applier
    const applied: Array<{ moduleId: string; data: unknown }> = [];
    const applier: SeedApplier = {
      async apply(entry) {
        applied.push({ moduleId: entry.moduleId, data: entry.transformed ?? entry.blueprint });
        return { moduleId: entry.moduleId, status: "success", recordsCreated: 1 };
      },
    };

    const result = await executeSeedPlan(plan, applier);
    expect(result.status).toBe("success");
    expect(applied).toHaveLength(4);
    expect(applied.find((a) => a.moduleId === "academics")?.data).toEqual({
      grades: [
        { id: 1, name: "Beginner", order: 0 },
        { id: 2, name: "Intermediate", order: 1 },
        { id: 3, name: "Advanced", order: 2 },
      ],
    });
  });
});
