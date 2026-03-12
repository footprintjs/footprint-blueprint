import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { defineModule, defineProfile, createModuleRegistry, resolveProfileConfig } from "@footprint/features";
import { generateSeedPlan } from "../../seedPlan.js";

describe("property: seed plan invariants", () => {
  it("plan entries are always a subset of enabled modules", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 5 }).chain((ids) => {
          const uniqueIds = [...new Set(ids)];
          return fc.constant(uniqueIds);
        }),
        (ids) => {
          const modules = ids.map((id) =>
            defineModule({ id, name: id, domain: "d", seed: { default: { key: id } } }),
          );
          const profile = defineProfile({ type: "test", displayName: "Test", modules: ids });
          const registry = createModuleRegistry({ modules, profileTypes: [profile] });
          const config = resolveProfileConfig(registry, "test");
          const plan = generateSeedPlan(config, "u1");

          for (const entry of plan.entries) {
            expect(config.enabledModules.has(entry.moduleId)).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("plan is always frozen", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 3 }).chain((ids) => {
          const uniqueIds = [...new Set(ids)];
          return fc.constant(uniqueIds);
        }),
        (ids) => {
          const modules = ids.map((id) =>
            defineModule({ id, name: id, domain: "d", seed: { default: { v: 1 } } }),
          );
          const profile = defineProfile({ type: "test", displayName: "Test", modules: ids });
          const registry = createModuleRegistry({ modules, profileTypes: [profile] });
          const config = resolveProfileConfig(registry, "test");
          const plan = generateSeedPlan(config, "u1");

          expect(Object.isFrozen(plan)).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("entries are ordered by non-decreasing order field", () => {
    const a = defineModule({ id: "aaa", name: "A", domain: "d", seed: { default: { v: 1 } } });
    const b = defineModule({ id: "bbb", name: "B", domain: "d", requires: ["aaa"], seed: { default: { v: 2 } } });
    const c = defineModule({ id: "ccc", name: "C", domain: "d", requires: ["bbb"], seed: { default: { v: 3 } } });
    const profile = defineProfile({ type: "test", displayName: "Test", modules: ["aaa", "bbb", "ccc"] });
    const registry = createModuleRegistry({ modules: [a, b, c], profileTypes: [profile] });
    const config = resolveProfileConfig(registry, "test");
    const plan = generateSeedPlan(config, "u1");

    for (let i = 1; i < plan.entries.length; i++) {
      expect(plan.entries[i]!.order).toBeGreaterThanOrEqual(plan.entries[i - 1]!.order);
    }
  });
});
