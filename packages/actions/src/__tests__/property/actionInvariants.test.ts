import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createActionRegistry } from "../../actionRegistry.js";
import type { ActionDefinition, ActionParameter } from "../../types.js";

const paramTypeArb = fc.constantFrom("string", "number", "boolean", "object") as fc.Arbitrary<ActionParameter["type"]>;

const paramArb: fc.Arbitrary<ActionParameter> = fc.record({
  name: fc.stringMatching(/^[a-z]{1,8}$/),
  type: paramTypeArb,
  required: fc.boolean(),
  description: fc.stringMatching(/^[a-z ]{1,20}$/),
});

const moduleIdArb = fc.stringMatching(/^[a-z]{1,6}$/);

const actionArb = (id: string): fc.Arbitrary<ActionDefinition> =>
  fc.record({
    id: fc.constant(id),
    name: fc.stringMatching(/^[A-Z][a-z]{1,10}$/),
    description: fc.stringMatching(/^[a-z ]{1,30}$/),
    domain: fc.stringMatching(/^[a-z]{1,8}$/),
    category: fc.constantFrom("crud", "workflow", "report"),
    parameters: fc.array(paramArb, { maxLength: 5 }),
    requiredModules: fc.array(moduleIdArb, { maxLength: 3 }),
  });

describe("property: MCP tools always have valid schema", () => {
  it("every exported tool has type=object, properties object, and required array", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 10 })
          .chain((ids) => {
            const uniqueIds = [...new Set(ids)];
            return fc.tuple(
              ...uniqueIds.map((id) => actionArb(id)),
            ).map((actions) => actions as ActionDefinition[]);
          }),
        fc.array(moduleIdArb, { maxLength: 5 }).map((ids) => new Set(ids)),
        (actions, enabledModules) => {
          const registry = createActionRegistry({ actions });
          const tools = registry.toMCPTools(enabledModules);

          for (const tool of tools) {
            expect(tool.inputSchema.type).toBe("object");
            expect(typeof tool.inputSchema.properties).toBe("object");
            expect(Array.isArray(tool.inputSchema.required)).toBe(true);

            // Every required field exists in properties
            for (const reqName of tool.inputSchema.required) {
              expect(tool.inputSchema.properties).toHaveProperty(reqName);
            }

            // Every property has a type field
            for (const prop of Object.values(tool.inputSchema.properties)) {
              expect(prop).toHaveProperty("type");
            }
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it("filtered actions are always a subset of all actions", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 8 })
          .chain((ids) => {
            const uniqueIds = [...new Set(ids)];
            return fc.tuple(
              ...uniqueIds.map((id) => actionArb(id)),
            ).map((actions) => actions as ActionDefinition[]);
          }),
        fc.array(moduleIdArb, { maxLength: 5 }).map((ids) => new Set(ids)),
        (actions, enabledModules) => {
          const registry = createActionRegistry({ actions });
          const tools = registry.toMCPTools(enabledModules);
          const allIds = new Set(registry.allActions().map((a) => a.id));

          for (const tool of tools) {
            expect(allIds.has(tool.name)).toBe(true);
          }

          expect(tools.length).toBeLessThanOrEqual(registry.allActions().length);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("domain filter always returns subset of all actions", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 8 })
          .chain((ids) => {
            const uniqueIds = [...new Set(ids)];
            return fc.tuple(
              ...uniqueIds.map((id) => actionArb(id)),
            ).map((actions) => actions as ActionDefinition[]);
          }),
        fc.stringMatching(/^[a-z]{1,8}$/),
        (actions, domain) => {
          const registry = createActionRegistry({ actions });
          const domainActions = registry.forDomain(domain);
          const allIds = new Set(registry.allActions().map((a) => a.id));

          for (const action of domainActions) {
            expect(allIds.has(action.id)).toBe(true);
            expect(action.domain).toBe(domain);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
