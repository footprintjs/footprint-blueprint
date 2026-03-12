import { describe, it, expect } from "vitest";
import { createActionRegistry } from "../../actionRegistry.js";
import { createActionExecutor } from "../../actionExecutor.js";
import type { ActionDefinition } from "../../types.js";

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

describe("duplicate action ID rejection", () => {
  it("throws on duplicate action IDs", () => {
    const a = makeAction({ id: "dup" });
    const b = makeAction({ id: "dup" });

    expect(() => createActionRegistry({ actions: [a, b] })).toThrow('Duplicate action ID: "dup"');
  });

  it("allows different IDs", () => {
    const a = makeAction({ id: "a" });
    const b = makeAction({ id: "b" });

    expect(() => createActionRegistry({ actions: [a, b] })).not.toThrow();
  });
});

describe("error containment", () => {
  it("handler throwing does not crash executor", async () => {
    const action = makeAction({ id: "crash" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry);

    const result = await executor.execute(
      "crash",
      {},
      { profileType: "k12", unitId: "s1" },
      async () => { throw new Error("boom"); },
    );

    expect(result.status).toBe("error");
    expect(result.error).toBe("boom");
    expect(result.actionId).toBe("crash");
  });

  it("handler throwing non-Error does not crash executor", async () => {
    const action = makeAction({ id: "crash2" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry);

    const result = await executor.execute(
      "crash2",
      {},
      { profileType: "k12", unitId: "s1" },
      async () => { throw 42; },
    );

    expect(result.status).toBe("error");
    expect(result.error).toBe("42");
  });

  it("one action failure does not affect others", async () => {
    const good = makeAction({ id: "good" });
    const bad = makeAction({ id: "bad" });
    const registry = createActionRegistry({ actions: [good, bad] });
    const executor = createActionExecutor(registry);

    const ctx = { profileType: "k12", unitId: "s1" };

    const [goodResult, badResult] = await Promise.all([
      executor.execute("good", {}, ctx, async () => "ok"),
      executor.execute("bad", {}, ctx, async () => { throw new Error("fail"); }),
    ]);

    expect(goodResult.status).toBe("success");
    expect(goodResult.result).toBe("ok");
    expect(badResult.status).toBe("error");
    expect(badResult.error).toBe("fail");
  });

  it("result objects are frozen (immutable)", async () => {
    const action = makeAction({ id: "frozen" });
    const registry = createActionRegistry({ actions: [action] });
    const executor = createActionExecutor(registry);

    const successResult = await executor.execute(
      "frozen", {}, { profileType: "k12", unitId: "s1" },
      async () => "ok",
    );
    expect(Object.isFrozen(successResult)).toBe(true);

    const errorResult = await executor.execute(
      "frozen", {}, { profileType: "k12", unitId: "s1" },
      async () => { throw new Error("fail"); },
    );
    expect(Object.isFrozen(errorResult)).toBe(true);
  });

  it("unknown action returns error without throwing", async () => {
    const registry = createActionRegistry({ actions: [] });
    const executor = createActionExecutor(registry);

    const result = await executor.execute(
      "nonexistent", {}, { profileType: "k12", unitId: "s1" },
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("Unknown action");
    // Should not throw — returns a structured error
  });
});
