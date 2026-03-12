import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";
import { defineProfile } from "../../defineProfile.js";
import { createModuleRegistry } from "../../moduleRegistry.js";
import { resolveProfileConfig } from "../../resolveConfig.js";
import { createFeatureGate } from "../../featureGate.js";
import { resolveTransitiveDependencies } from "../../dependencyGraph.js";

describe("large registry", () => {
  it("handles 500 modules without performance issues", () => {
    const modules = [];
    for (let i = 0; i < 500; i++) {
      modules.push(
        defineModule({
          id: `module-${i}`,
          name: `Module ${i}`,
          domain: "test",
          requires: i > 0 ? [`module-${i - 1}`] : [],
        })
      );
    }

    const start = performance.now();
    const registry = createModuleRegistry({ modules });
    const config = resolveProfileConfig(registry, "test", ["module-499"]);
    const elapsed = performance.now() - start;

    expect(config.enabledModules.size).toBe(500);
    expect(elapsed).toBeLessThan(1000); // should complete in under 1 second
  });

  it("handles 100 modules in a wide dependency graph", () => {
    const base = defineModule({ id: "base", name: "Base", domain: "test" });
    const modules = [base];

    // 100 modules all depending on base
    for (let i = 0; i < 100; i++) {
      modules.push(
        defineModule({
          id: `feature-${i}`,
          name: `Feature ${i}`,
          domain: "test",
          requires: ["base"],
        })
      );
    }

    const allIds = modules.map((m) => m.id);
    const registry = createModuleRegistry({ modules });
    const config = resolveProfileConfig(registry, "test", allIds);

    expect(config.enabledModules.size).toBe(101);
  });
});

describe("deep dependency chains", () => {
  it("handles 50-level deep chain", () => {
    const modules = [];
    for (let i = 0; i < 50; i++) {
      modules.push(
        defineModule({
          id: `level-${i}`,
          name: `Level ${i}`,
          domain: "test",
          requires: i > 0 ? [`level-${i - 1}`] : [],
        })
      );
    }

    const registry = new Map(modules.map((m) => [m.id, m]));
    const { resolved, errors } = resolveTransitiveDependencies(["level-49"], registry);

    expect(errors).toEqual([]);
    expect(resolved.size).toBe(50);
  });
});

describe("empty and minimal configs", () => {
  it("handles school with zero modules", () => {
    const registry = createModuleRegistry({ modules: [] });
    const config = resolveProfileConfig(registry, "empty");

    expect(config.enabledModules.size).toBe(0);
    expect(config.terminology).toEqual({});
    expect(config.roles).toEqual([]);
    expect(config.seed).toEqual({});
  });

  it("handles profile with single module", () => {
    const mod = defineModule({ id: "only", name: "Only", domain: "test" });
    const st = defineProfile({ type: "minimal", displayName: "Minimal", modules: ["only"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [st] });
    const config = resolveProfileConfig(registry, "minimal");

    expect(config.enabledModules.size).toBe(1);
  });

  it("handles unknown profile gracefully", () => {
    const mod = defineModule({ id: "x", name: "X", domain: "d" });
    const registry = createModuleRegistry({ modules: [mod] });
    const config = resolveProfileConfig(registry, "nonexistent");

    expect(config.profileType).toBe("nonexistent");
    expect(config.enabledModules.size).toBe(0);
  });

  it("handles module overrides with unknown module IDs", () => {
    const mod = defineModule({ id: "known", name: "Known", domain: "d" });
    const registry = createModuleRegistry({ modules: [mod] });
    const config = resolveProfileConfig(registry, "test", ["known", "unknown-mod"]);

    expect(config.enabledModules).toContain("known");
    expect(config.enabledModules).not.toContain("unknown-mod");
  });
});

describe("all modules enabled", () => {
  it("handles every module enabled simultaneously", () => {
    const modules = [];
    for (let i = 0; i < 20; i++) {
      modules.push(
        defineModule({
          id: `mod-${i}`,
          name: `Module ${i}`,
          domain: "test",
          terminology: { [`term-${i}`]: { default: `Default ${i}`, custom: `Custom ${i}` } },
          roles: { canUse: [`Role${i}`] },
          seed: { default: { index: i } },
        })
      );
    }

    const registry = createModuleRegistry({ modules });
    const allIds = modules.map((m) => m.id);
    const config = resolveProfileConfig(registry, "custom", allIds);

    expect(config.enabledModules.size).toBe(20);
    expect(Object.keys(config.terminology).length).toBe(20);
    expect(Object.keys(config.seed).length).toBe(20);

    const gate = createFeatureGate(config);
    for (const mod of modules) {
      expect(gate.isEnabled(mod.id)).toBe(true);
    }
  });
});
