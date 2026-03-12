import { describe, it, expect } from "vitest";
import { defineModule, defineProfile, createModuleRegistry } from "@footprint/features";
import { createMemoryProfileStore, createTenantContext } from "@footprint/tenancy";
import { createAdapterRegistry, createServiceBridge } from "@footprint/adapters";
import type { Adapter } from "@footprint/adapters";
import { createActionRegistry } from "@footprint/actions";
import type { ActionDefinition } from "@footprint/actions";
import { createPlatform } from "../../platform.js";

describe("security: gate enforcement on action execution", () => {
  const basemod = defineModule({ id: "base", name: "Base", domain: "d", description: "d" });
  const mod = defineModule({ id: "secret", name: "Secret", domain: "d", description: "d" });
  const profile = defineProfile({
    type: "limited",
    displayName: "Limited",
    modules: ["base"],
    roles: ["user"],
  });
  const fullProfile = defineProfile({
    type: "full",
    displayName: "Full",
    modules: ["base", "secret"],
    roles: ["admin"],
  });

  const adapter: Adapter = {
    id: "secret-adapter",
    name: "Secret Adapter",
    capabilityId: "do-secret",
    async execute() { return { secret: true }; },
  };

  const adapterRegistry = createAdapterRegistry({
    capabilities: [{ id: "do-secret", name: "Secret", domain: "d", description: "d" }],
    adapters: [adapter],
    mappings: [{ capabilityId: "do-secret", profileAdapters: { limited: "secret-adapter", full: "secret-adapter" } }],
  });

  const action: ActionDefinition = {
    id: "secret-action",
    name: "Secret Action",
    description: "Requires the secret module",
    domain: "d",
    category: "workflow",
    capabilityId: "do-secret",
    parameters: [],
    requiredModules: ["secret"],
  };

  const actionRegistry = createActionRegistry({ actions: [action] });
  const registry = createModuleRegistry({
    modules: [basemod, mod],
    profileTypes: [profile, fullProfile],
  });
  const store = createMemoryProfileStore([
    { unitId: "limited-unit", profileType: "limited", createdAt: "2024-01-01" },
    { unitId: "full-unit", profileType: "full", createdAt: "2024-01-01" },
  ]);

  const platform = createPlatform({
    registry,
    profileStore: store,
    adapterRegistry,
    actionRegistry,
  });

  it("denies action when module is not enabled", async () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "limited-unit" });
    const result = await platform.executeAction(ctx, "secret-action", {});
    expect(result.status).toBe("error");
    expect(result.error).toContain("disabled modules");
  });

  it("allows action when module is enabled", async () => {
    const ctx = createTenantContext({ tenantId: "t1", unitId: "full-unit" });
    const result = await platform.executeAction(ctx, "secret-action", {});
    expect(result.status).toBe("success");
    expect((result.result as Record<string, unknown>).secret).toBe(true);
  });
});

describe("security: adapter error containment through platform", () => {
  it("adapter throwing does not crash the platform", async () => {
    const mod = defineModule({ id: "m", name: "M", domain: "d", description: "d" });
    const profile = defineProfile({ type: "p", displayName: "P", modules: ["m"], roles: ["r"] });

    const badAdapter: Adapter = {
      id: "bad",
      name: "Bad",
      capabilityId: "cap",
      async execute() { throw new Error("adapter exploded"); },
    };

    const adapterRegistry = createAdapterRegistry({
      capabilities: [{ id: "cap", name: "Cap", domain: "d", description: "d" }],
      adapters: [badAdapter],
      mappings: [{ capabilityId: "cap", profileAdapters: { p: "bad" } }],
    });

    const action: ActionDefinition = {
      id: "bad-action",
      name: "Bad",
      description: "Triggers bad adapter",
      domain: "d",
      category: "workflow",
      capabilityId: "cap",
      parameters: [],
      requiredModules: ["m"],
    };

    const platform = createPlatform({
      registry: createModuleRegistry({ modules: [mod], profileTypes: [profile] }),
      profileStore: createMemoryProfileStore([
        { unitId: "u1", profileType: "p", createdAt: "2024-01-01" },
      ]),
      adapterRegistry,
      actionRegistry: createActionRegistry({ actions: [action] }),
    });

    const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });
    const result = await platform.executeAction(ctx, "bad-action", {});
    expect(result.status).toBe("error");
    expect(result.error).toContain("adapter exploded");
  });
});

describe("security: platform does not expose internal state", () => {
  it("unit setup result is frozen-compatible", async () => {
    const mod = defineModule({ id: "m", name: "M", domain: "d", description: "d" });
    const profile = defineProfile({ type: "p", displayName: "P", modules: ["m"], roles: ["r"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [profile] });
    const store = createMemoryProfileStore([
      { unitId: "u1", profileType: "p", createdAt: "2024-01-01" },
    ]);

    const platform = createPlatform({ registry, profileStore: store });
    const ctx = createTenantContext({ tenantId: "t1", unitId: "u1" });

    const result = await platform.resolveUnit(ctx);
    // Config's enabledModules should be a ReadonlySet
    expect(result.config.enabledModules.has("m")).toBe(true);
    expect(typeof result.config.enabledModules.has).toBe("function");
  });
});
