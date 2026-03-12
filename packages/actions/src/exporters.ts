import type { MCPToolDefinition, SchemaExporter } from "./types.js";

/**
 * Built-in MCP schema exporter.
 *
 * Transforms action definitions into MCP-compatible tool definitions
 * (Model Context Protocol format for LLM tool use).
 */
export function createMCPExporter(): SchemaExporter<readonly MCPToolDefinition[]> {
  return {
    id: "mcp",
    export(actions) {
      return Object.freeze(actions.map((action) => {
        const properties: Record<string, Record<string, unknown>> = {};
        const required: string[] = [];

        for (const param of action.parameters) {
          properties[param.name] = Object.freeze({
            type: param.type,
            description: param.description,
          });
          if (param.required) {
            required.push(param.name);
          }
        }

        return Object.freeze({
          name: action.id,
          description: action.description,
          inputSchema: Object.freeze({
            type: "object" as const,
            properties: Object.freeze(properties),
            required: Object.freeze(required),
          }),
        });
      }));
    },
  };
}

/**
 * OpenAPI path entry for an action.
 */
export type OpenAPIPathEntry = {
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly requestBody: {
    readonly content: {
      readonly "application/json": {
        readonly schema: {
          readonly type: "object";
          readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
          readonly required: readonly string[];
        };
      };
    };
  };
};

/**
 * Built-in OpenAPI schema exporter.
 *
 * Transforms action definitions into OpenAPI-style path entries.
 * Each action becomes an operation with a request body schema.
 */
export function createOpenAPIExporter(): SchemaExporter<readonly OpenAPIPathEntry[]> {
  return {
    id: "openapi",
    export(actions) {
      return Object.freeze(actions.map((action) => {
        const properties: Record<string, Record<string, unknown>> = {};
        const required: string[] = [];

        for (const param of action.parameters) {
          properties[param.name] = Object.freeze({
            type: param.type,
            description: param.description,
          });
          if (param.required) {
            required.push(param.name);
          }
        }

        return Object.freeze({
          operationId: action.id,
          summary: action.name,
          description: action.description,
          tags: Object.freeze([action.domain, action.category]),
          requestBody: Object.freeze({
            content: Object.freeze({
              "application/json": Object.freeze({
                schema: Object.freeze({
                  type: "object" as const,
                  properties: Object.freeze(properties),
                  required: Object.freeze(required),
                }),
              }),
            }),
          }),
        });
      }));
    },
  };
}
