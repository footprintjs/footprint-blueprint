import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { defineModule } from "../../defineModule.js";
import { defineProfile } from "../../defineProfile.js";
import { createModuleRegistry } from "../../moduleRegistry.js";
import { resolveProfileConfig } from "../../resolveConfig.js";
import { resolveTransitiveDependencies } from "../../dependencyGraph.js";
import { createFeatureGate } from "../../featureGate.js";
import { createTermResolver, resolveTerminology } from "../../terminology.js";

// ---------------------------------------------------------------------------
// Arbitraries — generate valid random inputs
// ---------------------------------------------------------------------------

/** Generate a valid module ID: lowercase letters + optional digits/hyphens */
const moduleIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/);

/** Generate a valid module with random terminology and roles */
const moduleArb = moduleIdArb.chain((id) =>
  fc.record({
    id: fc.constant(id),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    domain: fc.stringMatching(/^[a-z]{1,10}$/),
    requires: fc.constant([] as string[]),
    terminology: fc.dictionary(
      fc.stringMatching(/^[a-z]{1,10}$/),
      fc.dictionary(fc.stringMatching(/^[a-z]{1,10}$/), fc.string({ minLength: 1, maxLength: 30 })),
    ),
    roles: fc.dictionary(
      fc.stringMatching(/^[a-z]{1,10}$/),
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
    ),
  }),
);

// ---------------------------------------------------------------------------
// Property: defineModule invariants
// ---------------------------------------------------------------------------

describe("property: defineModule invariants", () => {
  it("always returns a frozen object", () => {
    fc.assert(
      fc.property(moduleArb, (input) => {
        const mod = defineModule(input);
        expect(Object.isFrozen(mod)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("id is always trimmed and preserved", () => {
    fc.assert(
      fc.property(moduleArb, (input) => {
        const mod = defineModule(input);
        expect(mod.id).toBe(input.id.trim());
      }),
      { numRuns: 50 },
    );
  });

  it("requires is always a frozen array", () => {
    fc.assert(
      fc.property(moduleArb, (input) => {
        const mod = defineModule(input);
        expect(Object.isFrozen(mod.requires)).toBe(true);
        expect(Array.isArray(mod.requires)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property: dependency resolution invariants
// ---------------------------------------------------------------------------

describe("property: dependency resolution invariants", () => {
  it("resolved set always contains the requested modules", () => {
    fc.assert(
      fc.property(
        fc.array(moduleIdArb, { minLength: 1, maxLength: 10 }).chain((ids) => {
          // Create unique IDs
          const uniqueIds = [...new Set(ids)];
          const modules = uniqueIds.map((id) => defineModule({ id, name: id, domain: "d" }));
          return fc.constant({ modules, requestedIds: uniqueIds });
        }),
        ({ modules, requestedIds }) => {
          const registry = new Map(modules.map((m) => [m.id, m]));
          const { resolved } = resolveTransitiveDependencies(requestedIds, registry);
          for (const id of requestedIds) {
            expect(resolved.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("resolved set is a superset of requested modules (never loses modules)", () => {
    fc.assert(
      fc.property(
        fc.array(moduleIdArb, { minLength: 1, maxLength: 5 }).chain((ids) => {
          const uniqueIds = [...new Set(ids)];
          const modules = uniqueIds.map((id) => defineModule({ id, name: id, domain: "d" }));
          return fc.constant({ modules, requestedIds: uniqueIds });
        }),
        ({ modules, requestedIds }) => {
          const registry = new Map(modules.map((m) => [m.id, m]));
          const { resolved } = resolveTransitiveDependencies(requestedIds, registry);
          expect(resolved.size).toBeGreaterThanOrEqual(requestedIds.length);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("adding a dependency only grows the resolved set, never shrinks it", () => {
    // If module A has no deps → resolved = {A}
    // If module A requires B → resolved ⊇ {A, B}
    const a = defineModule({ id: "aaa", name: "A", domain: "d" });
    const b = defineModule({ id: "bbb", name: "B", domain: "d" });
    const aWithDep = defineModule({ id: "aaa", name: "A", domain: "d", requires: ["bbb"] });

    const reg1 = new Map([["aaa", a], ["bbb", b]]);
    const reg2 = new Map([["aaa", aWithDep], ["bbb", b]]);

    const { resolved: r1 } = resolveTransitiveDependencies(["aaa"], reg1);
    const { resolved: r2 } = resolveTransitiveDependencies(["aaa"], reg2);

    expect(r2.size).toBeGreaterThanOrEqual(r1.size);
    // r1 is a subset of r2
    for (const id of r1) {
      expect(r2.has(id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: terminology resolution invariants
// ---------------------------------------------------------------------------

describe("property: terminology resolution invariants", () => {
  it("resolved terminology keys are union of all module terminology keys", () => {
    fc.assert(
      fc.property(
        fc.array(moduleArb, { minLength: 1, maxLength: 5 }).chain((inputs) => {
          // Deduplicate IDs
          const seen = new Set<string>();
          const unique = inputs.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          return fc.constant(unique.map((i) => defineModule(i)));
        }),
        (modules) => {
          const allKeys = new Set<string>();
          for (const mod of modules) {
            for (const key of Object.keys(mod.terminology)) {
              allKeys.add(key);
            }
          }

          const resolved = resolveTerminology("default", modules);
          for (const key of Object.keys(resolved)) {
            expect(allKeys.has(key)).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("createTermResolver always returns a string (never undefined)", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), fc.string({ minLength: 1, maxLength: 20 })),
        fc.stringMatching(/^[a-z]{1,8}$/),
        (terminology, key) => {
          const t = createTermResolver(terminology);
          const result = t(key);
          expect(typeof result).toBe("string");
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property: feature gate invariants
// ---------------------------------------------------------------------------

describe("property: feature gate invariants", () => {
  it("isEnabled is consistent with check().allowed", () => {
    fc.assert(
      fc.property(
        fc.array(moduleIdArb, { minLength: 1, maxLength: 8 }).chain((ids) => {
          const uniqueIds = [...new Set(ids)];
          const modules = uniqueIds.map((id) => defineModule({ id, name: id, domain: "d" }));
          const profile = defineProfile({ type: "test", displayName: "Test", modules: uniqueIds });
          return fc.tuple(fc.constant({ modules, profile }), fc.constantFrom(...uniqueIds, "nonexistent"));
        }),
        ([{ modules, profile }, queryId]) => {
          const registry = createModuleRegistry({ modules, profileTypes: [profile] });
          const config = resolveProfileConfig(registry, "test");
          const gate = createFeatureGate(config);

          expect(gate.isEnabled(queryId)).toBe(gate.check(queryId).allowed);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("enabledModules list matches isEnabled for every module", () => {
    fc.assert(
      fc.property(
        fc.array(moduleIdArb, { minLength: 1, maxLength: 8 }).chain((ids) => {
          const uniqueIds = [...new Set(ids)];
          const modules = uniqueIds.map((id) => defineModule({ id, name: id, domain: "d" }));
          const profile = defineProfile({ type: "test", displayName: "Test", modules: uniqueIds });
          return fc.constant({ modules, profile, allIds: uniqueIds });
        }),
        ({ modules, profile, allIds }) => {
          const registry = createModuleRegistry({ modules, profileTypes: [profile] });
          const config = resolveProfileConfig(registry, "test");
          const gate = createFeatureGate(config);
          const enabledList = gate.enabledModules();

          for (const id of allIds) {
            expect(enabledList.includes(id)).toBe(gate.isEnabled(id));
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property: resolveProfileConfig invariants
// ---------------------------------------------------------------------------

describe("property: resolveProfileConfig invariants", () => {
  it("config.profileType always matches the requested profile", () => {
    fc.assert(
      fc.property(
        fc.array(moduleIdArb, { minLength: 1, maxLength: 5 }).chain((ids) => {
          const uniqueIds = [...new Set(ids)];
          const modules = uniqueIds.map((id) => defineModule({ id, name: id, domain: "d" }));
          const profileId = uniqueIds[0]! + "-profile";
          return fc.constant({ modules, uniqueIds, profileId });
        }),
        ({ modules, uniqueIds, profileId }) => {
          const profile = defineProfile({ type: profileId, displayName: "Test", modules: uniqueIds });
          const registry = createModuleRegistry({ modules, profileTypes: [profile] });
          const config = resolveProfileConfig(registry, profileId);
          expect(config.profileType).toBe(profileId);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("roles array contains all profile roles", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 15 }), { minLength: 1, maxLength: 5 }),
        (profileRoles) => {
          const mod = defineModule({ id: "mod", name: "Mod", domain: "d" });
          const profile = defineProfile({
            type: "test",
            displayName: "Test",
            modules: ["mod"],
            roles: profileRoles,
          });
          const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });
          const config = resolveProfileConfig(registry, "test");

          for (const role of profileRoles) {
            expect(config.roles).toContain(role);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("seed keys are always a subset of enabled module IDs", () => {
    fc.assert(
      fc.property(
        fc.array(moduleIdArb, { minLength: 1, maxLength: 5 }).chain((ids) => {
          const uniqueIds = [...new Set(ids)];
          const modules = uniqueIds.map((id) =>
            defineModule({
              id,
              name: id,
              domain: "d",
              seed: { default: { data: true } },
            }),
          );
          return fc.constant({ modules, uniqueIds });
        }),
        ({ modules, uniqueIds }) => {
          const profile = defineProfile({ type: "test", displayName: "Test", modules: uniqueIds });
          const registry = createModuleRegistry({ modules, profileTypes: [profile] });
          const config = resolveProfileConfig(registry, "test");

          for (const seedKey of Object.keys(config.seed)) {
            expect(config.enabledModules.has(seedKey)).toBe(true);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
