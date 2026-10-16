import { describe, it, expect } from "vitest";
import { defineModule } from "../../defineModule.js";
import { defineProfile } from "../../defineProfile.js";
import { createModuleRegistry } from "../../moduleRegistry.js";
import { resolveProfileConfig } from "../../resolveConfig.js";
import { createFeatureGate } from "../../featureGate.js";
import { resolveTransitiveDependencies } from "../../dependencyGraph.js";

describe("invalid module definitions rejected", () => {
  it("rejects null/undefined id", () => {
    expect(() => defineModule({ id: null as any, name: "X", domain: "x" })).toThrow();
    expect(() => defineModule({ id: undefined as any, name: "X", domain: "x" })).toThrow();
  });

  it("rejects numeric id", () => {
    expect(() => defineModule({ id: 123 as any, name: "X", domain: "x" })).toThrow();
  });

  it("rejects whitespace-only id", () => {
    expect(() => defineModule({ id: "   ", name: "X", domain: "x" })).toThrow();
  });

  it("rejects id with special characters", () => {
    expect(() => defineModule({ id: "my_module", name: "X", domain: "x" })).toThrow();
    expect(() => defineModule({ id: "my.module", name: "X", domain: "x" })).toThrow();
    expect(() => defineModule({ id: "my/module", name: "X", domain: "x" })).toThrow();
  });

  it("rejects id with spaces", () => {
    expect(() => defineModule({ id: "my module", name: "X", domain: "x" })).toThrow();
  });
});

describe("circular dependency detection", () => {
  it("detects A → B → A cycle", () => {
    const a = defineModule({ id: "mod-a", name: "A", domain: "x", requires: ["mod-b"] });
    const b = defineModule({ id: "mod-b", name: "B", domain: "x", requires: ["mod-a"] });
    const registry = new Map([["mod-a", a], ["mod-b", b]]);

    const { errors } = resolveTransitiveDependencies(["mod-a"], registry);
    expect(errors.some((e) => e.type === "circular_dependency")).toBe(true);
  });

  it("detects A → B → C → A cycle", () => {
    const a = defineModule({ id: "mod-a", name: "A", domain: "x", requires: ["mod-b"] });
    const b = defineModule({ id: "mod-b", name: "B", domain: "x", requires: ["mod-c"] });
    const c = defineModule({ id: "mod-c", name: "C", domain: "x", requires: ["mod-a"] });
    const registry = new Map([["mod-a", a], ["mod-b", b], ["mod-c", c]]);

    const { errors } = resolveTransitiveDependencies(["mod-a"], registry);
    expect(errors.some((e) => e.type === "circular_dependency")).toBe(true);
  });

  it("detects self-referencing module", () => {
    const self = defineModule({ id: "self-ref", name: "Self", domain: "x", requires: ["self-ref"] });
    const registry = new Map([["self-ref", self]]);

    const { errors } = resolveTransitiveDependencies(["self-ref"], registry);
    expect(errors.some((e) => e.type === "circular_dependency")).toBe(true);
  });

  it("includes full chain in error details", () => {
    const a = defineModule({ id: "mod-a", name: "A", domain: "x", requires: ["mod-b"] });
    const b = defineModule({ id: "mod-b", name: "B", domain: "x", requires: ["mod-a"] });
    const registry = new Map([["mod-a", a], ["mod-b", b]]);

    const { errors } = resolveTransitiveDependencies(["mod-a"], registry);
    const circular = errors.find((e) => e.type === "circular_dependency");
    expect(circular).toBeDefined();
    expect(circular!.message).toContain("→");
  });
});

describe("immutability guards", () => {
  it("module definition cannot be mutated", () => {
    const mod = defineModule({
      id: "safe",
      name: "Safe",
      domain: "x",
      requires: ["dep"],
      terminology: { key: { default: "value" } },
    });

    expect(() => { (mod as any).id = "hacked"; }).toThrow();
    expect(() => { (mod.requires as any).push("injected"); }).toThrow();
    expect(() => { (mod.terminology as any).newKey = {}; }).toThrow();
  });

  it("profile definition cannot be mutated", () => {
    const st = defineProfile({ type: "safe", displayName: "Safe", modules: ["x"] });

    expect(() => { (st as any).type = "hacked"; }).toThrow();
    expect(() => { (st.modules as any).push("injected"); }).toThrow();
  });

  it("feature gate enabledModules list is frozen", () => {
    const mod = defineModule({ id: "x", name: "X", domain: "d" });
    const st = defineProfile({ type: "t", displayName: "T", modules: ["x"] });
    const registry = createModuleRegistry({ modules: [mod], profileTypes: [st] });
    const config = resolveProfileConfig(registry, "t");
    const gate = createFeatureGate(config);

    const list = gate.enabledModules();
    expect(Object.isFrozen(list)).toBe(true);
  });
});

describe("terminology injection prevention", () => {
  it("HTML in terminology values is preserved as-is (no interpretation)", () => {
    const mod = defineModule({
      id: "mod-html",
      name: "X",
      domain: "d",
      terminology: {
        label: { default: '<script>alert("xss")</script>' },
      },
    });

    // The library stores the string as-is — it's the consumer's
    // responsibility to sanitize before rendering in HTML.
    // But the value should NOT be interpreted or transformed.
    expect(mod.terminology.label.default).toBe('<script>alert("xss")</script>');
  });

  it("terminology values are strings, not objects", () => {
    const mod = defineModule({
      id: "mod-obj",
      name: "X",
      domain: "d",
      terminology: {
        label: { default: "safe" },
      },
    });

    expect(typeof mod.terminology.label.default).toBe("string");
  });
});

describe("prototype pollution prevention", () => {
  it("does not allow __proto__ as module id", () => {
    // __proto__ starts with underscore which fails the regex
    expect(() => defineModule({ id: "__proto__", name: "X", domain: "x" })).toThrow();
  });

  it("does not allow constructor as module id", () => {
    // "constructor" is valid per regex but let's ensure it doesn't break anything
    const mod = defineModule({ id: "constructor", name: "X", domain: "x" });
    expect(mod.id).toBe("constructor");

    const registry = createModuleRegistry({ modules: [mod] });
    expect(registry.getModule("constructor")).toEqual(mod);
    // Should NOT interfere with Object.prototype
    expect(({} as any).constructor).toBe(Object);
  });

  it("registry lookup does not traverse prototype chain", () => {
    const mod = defineModule({ id: "real", name: "Real", domain: "x" });
    const registry = createModuleRegistry({ modules: [mod] });

    // These exist on Object.prototype but should NOT be found
    expect(registry.getModule("toString")).toBeUndefined();
    expect(registry.getModule("hasOwnProperty")).toBeUndefined();
    expect(registry.getModule("valueOf")).toBeUndefined();
  });
});

describe("duplicate registration", () => {
  it("throws on duplicate module IDs", () => {
    const a = defineModule({ id: "dup", name: "A", domain: "x" });
    const b = defineModule({ id: "dup", name: "B", domain: "y" });

    expect(() => createModuleRegistry({ modules: [a, b] })).toThrow("Duplicate module");
  });

  it("throws on duplicate profile IDs", () => {
    const mod = defineModule({ id: "x", name: "X", domain: "d" });
    const a = defineProfile({ type: "dup", displayName: "A", modules: ["x"] });
    const b = defineProfile({ type: "dup", displayName: "B", modules: ["x"] });

    expect(() => createModuleRegistry({ modules: [mod], profileTypes: [a, b] })).toThrow("Duplicate profile");
  });
});
