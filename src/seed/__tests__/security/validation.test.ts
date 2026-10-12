import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry, resolveProfileConfig } from "../../../features/index.js";
import { generateSeedPlan, executeSeedPlan } from "../../index.js";

describe("seed plan immutability", () => {
  const mod = defineModule({ id: "x", name: "X", domain: "d", seed: { default: { v: 1 } } });
  const prof = defineProfile({ type: "t", displayName: "T", modules: ["x"] });
  const reg = createModuleRegistry({ modules: [mod], profileTypes: [prof] });
  const config = resolveProfileConfig(reg, "t");

  it("plan is frozen", () => {
    const plan = generateSeedPlan(config, "u1");
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("entries array is frozen", () => {
    const plan = generateSeedPlan(config, "u1");
    expect(Object.isFrozen(plan.entries)).toBe(true);
  });

  it("individual entries are frozen", () => {
    const plan = generateSeedPlan(config, "u1");
    for (const entry of plan.entries) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe("generator error isolation", () => {
  it("generator throwing does not affect plan generation", () => {
    const mod = defineModule({ id: "x", name: "X", domain: "d", seed: { default: { v: 1 } } });
    const mod2 = defineModule({ id: "y", name: "Y", domain: "d", seed: { default: { v: 2 } } });
    const prof = defineProfile({ type: "t", displayName: "T", modules: ["x", "y"] });
    const reg = createModuleRegistry({ modules: [mod, mod2], profileTypes: [prof] });
    const config = resolveProfileConfig(reg, "t");

    const badGenerator = {
      moduleId: "x",
      generate() { throw new Error("generator crash"); },
    };

    // Generator error should propagate — it's a programming error, not a data error
    expect(() => generateSeedPlan(config, "u1", [badGenerator])).toThrow("generator crash");
  });
});

describe("applier error containment", () => {
  it("applier error on one module does not prevent others", async () => {
    const a = defineModule({ id: "aaa", name: "A", domain: "d", seed: { default: { v: 1 } } });
    const b = defineModule({ id: "bbb", name: "B", domain: "d", seed: { default: { v: 2 } } });
    const prof = defineProfile({ type: "t", displayName: "T", modules: ["aaa", "bbb"] });
    const reg = createModuleRegistry({ modules: [a, b], profileTypes: [prof] });
    const config = resolveProfileConfig(reg, "t");
    const plan = generateSeedPlan(config, "u1");

    const result = await executeSeedPlan(plan, {
      async apply(entry) {
        if (entry.moduleId === "aaa") throw new Error("DB down");
        return { moduleId: entry.moduleId, status: "success", recordsCreated: 1 };
      },
    }, { failureMode: "partial" });

    expect(result.status).toBe("partial");
    expect(result.results.find((r) => r.moduleId === "bbb")?.status).toBe("success");
  });

  it("non-Error throw is captured as string", async () => {
    const mod = defineModule({ id: "x", name: "X", domain: "d", seed: { default: { v: 1 } } });
    const prof = defineProfile({ type: "t", displayName: "T", modules: ["x"] });
    const reg = createModuleRegistry({ modules: [mod], profileTypes: [prof] });
    const config = resolveProfileConfig(reg, "t");
    const plan = generateSeedPlan(config, "u1");

    const result = await executeSeedPlan(plan, {
      async apply() { throw "string error"; },
    });

    expect(result.results[0]?.error).toBe("string error");
  });
});
