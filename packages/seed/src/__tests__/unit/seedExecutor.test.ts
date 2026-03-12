import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry, resolveProfileConfig } from "@footprint/features";
import { generateSeedPlan } from "../../seedPlan.js";
import { executeSeedPlan } from "../../seedExecutor.js";
import type { SeedApplier, SeedEntry } from "../../types.js";

const students = defineModule({ id: "students", name: "Students", domain: "people", seed: { default: { fields: ["name"] } } });
const fees = defineModule({ id: "fees", name: "Fees", domain: "finance", requires: ["students"], seed: { default: { model: "per-term" } } });

const basic = defineProfile({ type: "basic", displayName: "Basic", modules: ["students", "fees"] });
const registry = createModuleRegistry({ modules: [students, fees], profileTypes: [basic] });
const config = resolveProfileConfig(registry, "basic");
const plan = generateSeedPlan(config, "u1");

const successApplier: SeedApplier = {
  async apply(entry) {
    return { moduleId: entry.moduleId, status: "success", recordsCreated: 1 };
  },
};

describe("executeSeedPlan", () => {
  it("executes all entries and returns success", async () => {
    const result = await executeSeedPlan(plan, successApplier);
    expect(result.status).toBe("success");
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.status === "success")).toBe(true);
  });

  it("includes duration", async () => {
    const result = await executeSeedPlan(plan, successApplier);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("returns partial when some entries fail", async () => {
    const partialApplier: SeedApplier = {
      async apply(entry) {
        if (entry.moduleId === "fees") throw new Error("DB error");
        return { moduleId: entry.moduleId, status: "success", recordsCreated: 1 };
      },
    };

    const result = await executeSeedPlan(plan, partialApplier);
    expect(result.status).toBe("partial");
    expect(result.results.find((r) => r.moduleId === "students")?.status).toBe("success");
    expect(result.results.find((r) => r.moduleId === "fees")?.status).toBe("error");
    expect(result.results.find((r) => r.moduleId === "fees")?.error).toBe("DB error");
  });

  it("returns error when all entries fail", async () => {
    const failApplier: SeedApplier = {
      async apply() { throw new Error("fail"); },
    };

    const result = await executeSeedPlan(plan, failApplier);
    expect(result.status).toBe("error");
  });

  it("continues after an entry failure", async () => {
    const applied: string[] = [];
    const applier: SeedApplier = {
      async apply(entry) {
        applied.push(entry.moduleId);
        if (entry.moduleId === "students") throw new Error("fail");
        return { moduleId: entry.moduleId, status: "success", recordsCreated: 1 };
      },
    };

    await executeSeedPlan(plan, applier);
    expect(applied).toHaveLength(2); // both executed despite first failure
  });

  it("handles skipped entries", async () => {
    const skipApplier: SeedApplier = {
      async apply(entry) {
        return { moduleId: entry.moduleId, status: "skipped" };
      },
    };

    const result = await executeSeedPlan(plan, skipApplier);
    expect(result.status).toBe("success"); // skipped is not an error
  });

  it("handles empty plan", async () => {
    const emptyPlan = generateSeedPlan(
      resolveProfileConfig(
        createModuleRegistry({
          modules: [defineModule({ id: "x", name: "X", domain: "d" })],
          profileTypes: [defineProfile({ type: "t", displayName: "T", modules: ["x"] })],
        }),
        "t",
      ),
      "u1",
    );

    const result = await executeSeedPlan(emptyPlan, successApplier);
    expect(result.status).toBe("success");
    expect(result.results).toHaveLength(0);
  });
});
