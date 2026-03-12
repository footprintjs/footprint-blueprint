import { describe, it, expect } from "vitest";
import { createActionRegistry } from "../../actionRegistry.js";
import { createActionExecutor } from "../../actionExecutor.js";
import type { ActionDefinition } from "../../types.js";

describe("boundary: large action count", () => {
  it("registers and retrieves 100 actions", () => {
    const actions: ActionDefinition[] = Array.from({ length: 100 }, (_, i) => ({
      id: `action-${i}`,
      name: `Action ${i}`,
      description: `Does thing ${i}`,
      domain: `domain-${i % 5}`,
      category: "crud",
      parameters: [
        { name: "input", type: "string" as const, required: true, description: "Input" },
      ],
      requiredModules: [`mod-${i % 10}`],
    }));

    const registry = createActionRegistry({ actions });

    expect(registry.allActions()).toHaveLength(100);

    // Spot check
    expect(registry.getAction("action-0")).toBeDefined();
    expect(registry.getAction("action-99")).toBeDefined();
  });

  it("domain filtering on 100 actions is fast", () => {
    const actions: ActionDefinition[] = Array.from({ length: 100 }, (_, i) => ({
      id: `action-${i}`,
      name: `Action ${i}`,
      description: `Does thing ${i}`,
      domain: `domain-${i % 5}`,
      category: "crud",
      parameters: [],
      requiredModules: [],
    }));

    const registry = createActionRegistry({ actions });

    const start = performance.now();
    const result = registry.forDomain("domain-0");
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(20); // 100/5
    expect(elapsed).toBeLessThan(50); // well under 50ms
  });

  it("toMCPTools on 100 actions with module filtering", () => {
    const actions: ActionDefinition[] = Array.from({ length: 100 }, (_, i) => ({
      id: `action-${i}`,
      name: `Action ${i}`,
      description: `Does thing ${i}`,
      domain: "d",
      category: "crud",
      parameters: [
        { name: "x", type: "string" as const, required: true, description: "X" },
        { name: "y", type: "number" as const, required: false, description: "Y" },
      ],
      requiredModules: [`mod-${i % 10}`],
    }));

    const registry = createActionRegistry({ actions });

    // Enable 3 of 10 module groups → 30 actions
    const enabled = new Set(["mod-0", "mod-3", "mod-7"]);

    const start = performance.now();
    const tools = registry.toMCPTools(enabled);
    const elapsed = performance.now() - start;

    expect(tools).toHaveLength(30);
    expect(elapsed).toBeLessThan(100);

    // All tools have valid structure
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("executor handles rapid sequential execution", async () => {
    const actions: ActionDefinition[] = Array.from({ length: 100 }, (_, i) => ({
      id: `action-${i}`,
      name: `Action ${i}`,
      description: `Does thing ${i}`,
      domain: "d",
      category: "crud",
      parameters: [],
      requiredModules: [],
    }));

    const registry = createActionRegistry({ actions });
    const executor = createActionExecutor(registry);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        executor.execute(
          `action-${i}`,
          {},
          { profileType: "k12", unitId: "s1" },
          async () => i,
        ),
      ),
    );

    expect(results).toHaveLength(100);
    for (const r of results) {
      expect(r.status).toBe("success");
    }
  });
});
