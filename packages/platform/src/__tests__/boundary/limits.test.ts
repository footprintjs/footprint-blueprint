import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import { createMemoryProfileStore, createTenantContext } from "@footprint/tenancy";
import { createActionRegistry } from "@footprint/actions";
import type { ActionDefinition } from "@footprint/actions";
import { createPlatform } from "../../platform.js";

describe("boundary: platform with many modules and actions", () => {
  it("handles 100 modules and 200 actions", async () => {
    const modules = Array.from({ length: 100 }, (_, i) =>
      defineModule({
        id: `mod-${i}`,
        name: `Module ${i}`,
        domain: `domain-${i % 5}`,
        description: `Module number ${i}`,
      }),
    );

    const profile = defineProfile({
      type: "large",
      displayName: "Large Profile",
      modules: modules.map((m) => m.id),
      roles: ["admin"],
    });

    const registry = createModuleRegistry({
      modules,
      profileTypes: [profile],
    });

    const actions: ActionDefinition[] = Array.from({ length: 200 }, (_, i) => ({
      id: `action-${i}`,
      name: `Action ${i}`,
      description: `Action number ${i}`,
      domain: `domain-${i % 5}`,
      category: "crud",
      parameters: [
        { name: "input", type: "string" as const, required: true, description: "Input" },
      ],
      requiredModules: [`mod-${i % 100}`],
    }));

    const actionRegistry = createActionRegistry({ actions });
    const store = createMemoryProfileStore([
      { unitId: "big-unit", profileType: "large", createdAt: "2024-01-01" },
    ]);

    const platform = createPlatform({
      registry,
      profileStore: store,
      actionRegistry,
    });

    const ctx = createTenantContext({ tenantId: "t1", unitId: "big-unit" });

    const result = await platform.resolveUnit(ctx);
    expect(result.config.enabledModules.size).toBe(100);

    const tools = await platform.getAvailableActions(ctx);
    expect(tools).toHaveLength(200);

    const setup = await platform.setupUnit(ctx);
    expect(setup.seedPlan).toBeDefined();
  });

  it("handles unknown unit gracefully", async () => {
    const mod = defineModule({ id: "m", name: "M", domain: "d", description: "d" });
    const profile = defineProfile({ type: "p", displayName: "P", modules: ["m"], roles: ["r"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });
    const store = createMemoryProfileStore([]);

    const platform = createPlatform({ registry, profileStore: store });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "nonexistent" });

    await expect(platform.resolveUnit(ctx)).rejects.toThrow();
  });

  it("handles unknown action in executeAction", async () => {
    const mod = defineModule({ id: "m", name: "M", domain: "d", description: "d" });
    const profile = defineProfile({ type: "p", displayName: "P", modules: ["m"], roles: ["r"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });
    const store = createMemoryProfileStore([
      { unitId: "u1", profileType: "p", createdAt: "2024-01-01" },
    ]);
    const actionRegistry = createActionRegistry({ actions: [] });

    const platform = createPlatform({ registry, profileStore: store, actionRegistry });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });

    const result = await platform.executeAction(ctx, "nonexistent", {});
    expect(result.status).toBe("error");
    expect(result.error).toContain("Unknown action");
  });
});
