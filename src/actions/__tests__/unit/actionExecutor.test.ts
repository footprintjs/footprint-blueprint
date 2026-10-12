import { describe, it, expect } from "vitest";
import { createActionRegistry } from "../../actionRegistry.js";
import { createActionExecutor } from "../../actionExecutor.js";
import type { ActionDefinition, ActionExecutionContext } from "../../types.js";
import type { ServiceBridge } from "../../../adapters/index.js";

function makeAction(overrides: Partial<ActionDefinition> & { id: string }): ActionDefinition {
  return {
    name: overrides.id,
    description: `Action ${overrides.id}`,
    domain: "test",
    category: "crud",
    parameters: [],
    requiredModules: [],
    ...overrides,
  };
}

const ctx: ActionExecutionContext = {
  profileType: "k12",
  unitId: "school-1",
};

describe("createActionExecutor", () => {
  it("returns error for unknown action", async () => {
    const registry = createActionRegistry({ actions: [] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute("nope", {}, ctx);

    expect(result.status).toBe("error");
    expect(result.error).toContain("Unknown action");
    expect(result.actionId).toBe("nope");
  });

  it("executes action via handler when no capabilityId", async () => {
    const action = makeAction({ id: "greet", parameters: [{name:"name",type:"string",required:true,description:"Name"}] });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute(
      "greet",
      { name: "Alice" },
      ctx,
      async (_actionId, input) => `Hello ${(input as { name: string }).name}`,
    );

    expect(result.status).toBe("success");
    expect(result.result).toBe("Hello Alice");
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it("produces trace on success", async () => {
    const action = makeAction({ id: "traced" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute("traced", {}, ctx, async () => "ok");

    expect(result.trace).toBeDefined();
    expect(result.trace!.actionId).toBe("traced");
    expect(result.trace!.profileType).toBe("k12");
    expect(result.trace!.unitId).toBe("school-1");
    expect(result.trace!.completedAt).toBeGreaterThanOrEqual(result.trace!.startedAt);
  });

  it("captures handler errors", async () => {
    const action = makeAction({ id: "fail" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute("fail", {}, ctx, async () => {
      throw new Error("handler broke");
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("handler broke");
    expect(result.trace).toBeDefined();
  });

  it("captures non-Error throws", async () => {
    const action = makeAction({ id: "fail2" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute("fail2", {}, ctx, async () => {
      throw "string error";
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("string error");
  });

  it("returns error when no handler and no capabilityId", async () => {
    const action = makeAction({ id: "nohandler" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute("nohandler", {}, ctx);

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("ACTION_IMPLEMENTATION_UNAVAILABLE");
  });

  it("returns error when capabilityId set but no bridge", async () => {
    const action = makeAction({ id: "cap-action", capabilityId: "some-cap" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute("cap-action", {}, ctx);

    expect(result.status).toBe("error");
    expect(result.errorCode).toBe("ACTION_IMPLEMENTATION_UNAVAILABLE");
  });

  it("returns frozen results", async () => {
    const action = makeAction({ id: "frozen" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry, undefined, { authorizer: () => true });

    const result = await executor.execute("frozen", {}, ctx, async () => "ok");

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trace)).toBe(true);
  });
});

describe("capability-based execution", () => {
  it("delegates to service bridge when capabilityId is set", async () => {
    const action = makeAction({ id: "schedule", capabilityId: "schedule-class", parameters: [{name:"classId",type:"string",required:true,description:"Class ID"}] });
    const registry = createActionRegistry({ actions: [action] });

    const mockBridge: ServiceBridge = {
      async execute(capabilityId, input, bridgeCtx) {
        return {
          status: "success" as const,
          capabilityId,
          adapterId: "fixed-timetable",
          result: { scheduled: true, input, profile: bridgeCtx.profileType },
          duration: 5,
        };
      },
      hasAdapter: () => true,
      availableCapabilities: () => [],
    };

    const executor = createActionExecutor(registry, mockBridge, { authorizer: () => true });
    const result = await executor.execute("schedule", { classId: "c1" }, ctx);

    expect(result.status).toBe("success");
    expect(result.trace!.adapterId).toBe("fixed-timetable");
    expect((result.result as Record<string, unknown>).scheduled).toBe(true);
  });

  it("propagates bridge error status", async () => {
    const action = makeAction({ id: "bad-cap", capabilityId: "broken" });
    const registry = createActionRegistry({ actions: [action] });

    const mockBridge: ServiceBridge = {
      async execute(capabilityId) {
        return {
          status: "no-adapter" as const,
          capabilityId,
          error: "No adapter found",
          duration: 1,
        };
      },
      hasAdapter: () => false,
      availableCapabilities: () => [],
    };

    const executor = createActionExecutor(registry, mockBridge, { authorizer: () => true });
    const result = await executor.execute("bad-cap", {}, ctx);

    expect(result.status).toBe("error");
    expect(result.error).toContain("No adapter found");
  });
});
