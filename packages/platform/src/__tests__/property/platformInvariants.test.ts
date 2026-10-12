import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import { createMemoryProfileStore, createTenantContext } from "@footprint/tenancy";
import { createActionRegistry } from "@footprint/actions";
import type { ActionDefinition } from "@footprint/actions";
import { createAuthorizedTestPlatform as createPlatform } from "../fixtures.js";

// Arbitrary: valid identifier
const idArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/).filter((s) => s.length >= 2);

describe("property: platform invariants", () => {
  it("resolveUnit always returns the same profileType for a given unitId", async () => {
    await fc.assert(
      fc.asyncProperty(idArb, idArb, async (profileType, unitId) => {
        const mod = defineModule({
          id: "base",
          name: "Base",
          domain: "core",
          description: "Base module",
        });
        const profile = defineProfile({
          type: profileType,
          displayName: profileType,
          modules: ["base"],
          roles: ["admin"],
        });
        const registry = createModuleRegistry({
          modules: [mod],
          profileTypes: [profile],
        });
        const store = createMemoryProfileStore([
          { tenantId: "t1", revision: 0, unitId, profileType, createdAt: "2024-01-01" },
        ]);
        const platform = createPlatform({ registry, profileStore: store });
        const ctx = createTenantContext({ tenantId: "t1", unitId });

        const r1 = await platform.resolveUnit(ctx);
        const r2 = await platform.resolveUnit(ctx);

        expect(r1.profileType).toBe(r2.profileType);
        expect(r1.profileType).toBe(profileType);
      }),
      { numRuns: 30 },
    );
  });

  it("gate check with empty modules always allows", async () => {
    await fc.assert(
      fc.asyncProperty(idArb, async (unitId) => {
        const mod = defineModule({
          id: "base",
          name: "Base",
          domain: "core",
          description: "Base module",
        });
        const profile = defineProfile({
          type: "test",
          displayName: "Test",
          modules: ["base"],
          roles: ["admin"],
        });
        const registry = createModuleRegistry({
          modules: [mod],
          profileTypes: [profile],
        });
        const store = createMemoryProfileStore([
          { tenantId: "t1", revision: 0, unitId, profileType: "test", createdAt: "2024-01-01" },
        ]);
        const platform = createPlatform({ registry, profileStore: store });
        const ctx = createTenantContext({ tenantId: "t1", unitId });

        const result = await platform.gateCheck(ctx, []);
        expect(result.allowed).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it("MCP tools for a unit are always a subset of all registered actions", async () => {
    const mod1 = defineModule({ id: "mod-a", name: "A", domain: "d", description: "A" });
    const mod2 = defineModule({ id: "mod-b", name: "B", domain: "d", description: "B" });

    const actions: ActionDefinition[] = [
      {
        id: "act-a", name: "Act A", description: "A", domain: "d", category: "c",
        parameters: [], requiredModules: ["mod-a"],
      },
      {
        id: "act-b", name: "Act B", description: "B", domain: "d", category: "c",
        parameters: [], requiredModules: ["mod-b"],
      },
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(["mod-a", "mod-b"], { minLength: 1 }),
        async (mods) => {
          const profile = defineProfile({
            type: "p",
            displayName: "P",
            modules: mods,
            roles: ["r"],
          });
          const registry = createModuleRegistry({
            modules: [mod1, mod2],
            profileTypes: [profile],
          });
          const store = createMemoryProfileStore([
            { tenantId: "t1", revision: 0, unitId: "u1", profileType: "p", createdAt: "2024-01-01" },
          ]);
          const actionReg = createActionRegistry({ actions });
          const platform = createPlatform({
            registry,
            profileStore: store,
            actionRegistry: actionReg,
          });
          const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });

          const tools = await platform.getAvailableActions(ctx);
          const allActionIds = actions.map((a) => a.id);
          for (const tool of tools) {
            expect(allActionIds).toContain(tool.name);
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
