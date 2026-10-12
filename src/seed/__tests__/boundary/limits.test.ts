import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry, resolveProfileConfig } from "../../../features/index.js";
import { generateSeedPlan, executeSeedPlan } from "../../index.js";

describe("boundary: large number of modules with seed", () => {
  it("generates plan for 100 modules with seed data", () => {
    const modules = Array.from({ length: 100 }, (_, i) =>
      defineModule({ id: `mod-${i}`, name: `Mod ${i}`, domain: "d", seed: { default: { idx: i } } }),
    );
    const profile = defineProfile({ type: "big", displayName: "Big", modules: modules.map((m) => m.id) });
    const registry = createModuleRegistry({ modules, profileTypes: [profile] });
    const config = resolveProfileConfig(registry, "big");
    const plan = generateSeedPlan(config, "u1");

    expect(plan.entries).toHaveLength(100);
  });
});

describe("boundary: deep dependency chain ordering", () => {
  it("correctly orders a 20-level deep chain", () => {
    const modules = Array.from({ length: 20 }, (_, i) =>
      defineModule({
        id: `level-${i}`,
        name: `Level ${i}`,
        domain: "d",
        requires: i > 0 ? [`level-${i - 1}`] : [],
        seed: { default: { level: i } },
      }),
    );
    const profile = defineProfile({ type: "deep", displayName: "Deep", modules: modules.map((m) => m.id) });
    const registry = createModuleRegistry({ modules, profileTypes: [profile] });
    const config = resolveProfileConfig(registry, "deep");
    const plan = generateSeedPlan(config, "u1");

    // level-0 should come first, level-19 should come last
    expect(plan.entries[0]!.moduleId).toBe("level-0");
    expect(plan.entries[plan.entries.length - 1]!.moduleId).toBe("level-19");
  });
});

describe("boundary: execution with slow applier", () => {
  it("measures duration correctly with async delays", async () => {
    const mod = defineModule({ id: "slow", name: "Slow", domain: "d", seed: { default: { v: 1 } } });
    const profile = defineProfile({ type: "t", displayName: "T", modules: ["slow"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });
    const config = resolveProfileConfig(registry, "t");
    const plan = generateSeedPlan(config, "u1");

    const result = await executeSeedPlan(plan, {
      async apply(entry) {
        await new Promise((r) => setTimeout(r, 10));
        return { moduleId: entry.moduleId, status: "success", recordsCreated: 1 };
      },
    });

    expect(result.duration).toBeGreaterThanOrEqual(10);
  });
});
