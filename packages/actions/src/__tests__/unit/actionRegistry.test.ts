import { describe, it, expect } from "vitest";
import { createActionRegistry } from "../../actionRegistry.js";
import { createMCPExporter, createOpenAPIExporter } from "../../exporters.js";
import type { ActionDefinition, SchemaExporter } from "../../types.js";

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

describe("createActionRegistry", () => {
  it("registers actions and retrieves by ID", () => {
    const action = makeAction({ id: "a1" });
    const registry = createActionRegistry({ actions: [action] });

    expect(registry.getAction("a1")).toEqual(action);
  });

  it("returns undefined for unknown action ID", () => {
    const registry = createActionRegistry({ actions: [] });

    expect(registry.getAction("nope")).toBeUndefined();
  });

  it("returns all actions", () => {
    const a = makeAction({ id: "a1" });
    const b = makeAction({ id: "b1" });
    const registry = createActionRegistry({ actions: [a, b] });

    expect(registry.allActions()).toHaveLength(2);
    expect(registry.allActions()).toContainEqual(a);
    expect(registry.allActions()).toContainEqual(b);
  });

  it("returns frozen allActions array", () => {
    const registry = createActionRegistry({ actions: [makeAction({ id: "a1" })] });

    expect(Object.isFrozen(registry.allActions())).toBe(true);
  });
});

describe("forDomain", () => {
  it("filters actions by domain", () => {
    const a = makeAction({ id: "a1", domain: "people" });
    const b = makeAction({ id: "b1", domain: "scheduling" });
    const c = makeAction({ id: "c1", domain: "people" });
    const registry = createActionRegistry({ actions: [a, b, c] });

    const people = registry.forDomain("people");
    expect(people).toHaveLength(2);
    expect(people).toContainEqual(a);
    expect(people).toContainEqual(c);
  });

  it("returns empty array for unknown domain", () => {
    const registry = createActionRegistry({ actions: [makeAction({ id: "a1" })] });

    expect(registry.forDomain("nonexistent")).toHaveLength(0);
  });
});

describe("forModule", () => {
  it("filters actions that require a given module", () => {
    const a = makeAction({ id: "a1", requiredModules: ["students"] });
    const b = makeAction({ id: "b1", requiredModules: ["attendance", "students"] });
    const c = makeAction({ id: "c1", requiredModules: ["fees"] });
    const registry = createActionRegistry({ actions: [a, b, c] });

    const studentActions = registry.forModule("students");
    expect(studentActions).toHaveLength(2);
    expect(studentActions).toContainEqual(a);
    expect(studentActions).toContainEqual(b);
  });

  it("returns empty array for unknown module", () => {
    const registry = createActionRegistry({ actions: [makeAction({ id: "a1" })] });

    expect(registry.forModule("nonexistent")).toHaveLength(0);
  });
});

describe("toMCPTools", () => {
  it("exports actions as MCP tool definitions", () => {
    const action = makeAction({
      id: "create-student",
      description: "Create a student",
      parameters: [
        { name: "name", type: "string", required: true, description: "Student name" },
        { name: "age", type: "number", required: false, description: "Student age" },
      ],
      requiredModules: ["students"],
    });
    const registry = createActionRegistry({ actions: [action] });

    const tools = registry.exportMetadata(new Set(["students"]), createMCPExporter());
    expect(tools).toHaveLength(1);

    const tool = tools[0]!;
    expect(tool.name).toBe("create-student");
    expect(tool.description).toBe("Create a student");
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties["name"]).toEqual({ type: "string", description: "Student name" });
    expect(tool.inputSchema.properties["age"]).toEqual({ type: "number", description: "Student age" });
    expect(tool.inputSchema.required).toEqual(["name"]);
  });

  it("only includes actions whose required modules are all enabled", () => {
    const a = makeAction({ id: "a1", requiredModules: ["students"] });
    const b = makeAction({ id: "b1", requiredModules: ["students", "attendance"] });
    const c = makeAction({ id: "c1", requiredModules: ["fees"] });
    const registry = createActionRegistry({ actions: [a, b, c] });

    const tools = registry.exportMetadata(new Set(["students"]), createMCPExporter());
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("a1");
  });

  it("includes actions with no required modules", () => {
    const a = makeAction({ id: "a1", requiredModules: [] });
    const registry = createActionRegistry({ actions: [a] });

    const tools = registry.exportMetadata(new Set(), createMCPExporter());
    expect(tools).toHaveLength(1);
  });

  it("returns frozen MCP tool definitions", () => {
    const action = makeAction({
      id: "a1",
      parameters: [{ name: "x", type: "string", required: true, description: "X" }],
    });
    const registry = createActionRegistry({ actions: [action] });

    const tools = registry.exportMetadata(new Set(), createMCPExporter());
    expect(Object.isFrozen(tools)).toBe(true);
    expect(Object.isFrozen(tools[0])).toBe(true);
    expect(Object.isFrozen(tools[0]!.inputSchema)).toBe(true);
    expect(Object.isFrozen(tools[0]!.inputSchema.properties)).toBe(true);
    expect(Object.isFrozen(tools[0]!.inputSchema.required)).toBe(true);
  });
});

describe("exportActions", () => {
  it("gives same results as toMCPTools when using MCP exporter", () => {
    const action = makeAction({
      id: "create-student",
      description: "Create a student",
      parameters: [
        { name: "name", type: "string", required: true, description: "Student name" },
        { name: "age", type: "number", required: false, description: "Student age" },
      ],
      requiredModules: ["students"],
    });
    const registry = createActionRegistry({ actions: [action] });
    const enabled = new Set(["students"]);

    const mcpTools = registry.exportMetadata(enabled, createMCPExporter());
    const exportedTools = registry.exportMetadata(enabled, createMCPExporter());

    expect(exportedTools).toHaveLength(mcpTools.length);
    expect(exportedTools[0]!.name).toBe(mcpTools[0]!.name);
    expect(exportedTools[0]!.description).toBe(mcpTools[0]!.description);
    expect(exportedTools[0]!.inputSchema).toEqual(mcpTools[0]!.inputSchema);
  });

  it("produces valid OpenAPI entries with the OpenAPI exporter", () => {
    const action = makeAction({
      id: "enroll-student",
      name: "Enroll Student",
      description: "Enroll a new student",
      domain: "people",
      category: "workflow",
      parameters: [
        { name: "studentId", type: "string", required: true, description: "Student ID" },
      ],
      requiredModules: [],
    });
    const registry = createActionRegistry({ actions: [action] });

    const entries = registry.exportMetadata(new Set(), createOpenAPIExporter());

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.operationId).toBe("enroll-student");
    expect(entry.summary).toBe("Enroll Student");
    expect(entry.description).toBe("Enroll a new student");
    expect(entry.tags).toContain("people");
    expect(entry.tags).toContain("workflow");
    expect(entry.requestBody.content["application/json"].schema.type).toBe("object");
    expect(entry.requestBody.content["application/json"].schema.properties["studentId"]).toEqual({
      type: "string",
      description: "Student ID",
    });
    expect(entry.requestBody.content["application/json"].schema.required).toEqual(["studentId"]);
  });

  it("works with a custom user-defined exporter", () => {
    const action = makeAction({ id: "a1", domain: "test" });
    const registry = createActionRegistry({ actions: [action] });

    const customExporter: SchemaExporter<string[]> = {
      id: "custom",
      export(actions) {
        return actions.map((a) => `${a.domain}:${a.id}`);
      },
    };

    const result = registry.exportMetadata(new Set(), customExporter);
    expect(result).toEqual(["test:a1"]);
  });
});

describe("action validation", () => {
  it("throws on empty id", () => {
    expect(() =>
      createActionRegistry({ actions: [makeAction({ id: "" })] })
    ).toThrow("Action id is required");
  });

  it("throws on missing name", () => {
    expect(() =>
      createActionRegistry({ actions: [{ id: "a1", name: "", description: "d", domain: "d", category: "c", parameters: [], requiredModules: [] }] })
    ).toThrow('Action "a1": name is required');
  });

  it("throws on missing domain", () => {
    expect(() =>
      createActionRegistry({ actions: [{ id: "a1", name: "A", description: "d", domain: "", category: "c", parameters: [], requiredModules: [] }] })
    ).toThrow('Action "a1": domain is required');
  });
});
