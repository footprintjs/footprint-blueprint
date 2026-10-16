import type { MCPToolDefinition, SchemaExporter } from "./types.js";
import { freezeData, inputSchemaForAction } from "./validation.js";

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

        return Object.freeze({
          name: action.id,
          description: action.description,
          inputSchema: freezeData(inputSchemaForAction(action)) as MCPToolDefinition['inputSchema'],
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
        readonly schema: MCPToolDefinition['inputSchema'];
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

        return Object.freeze({
          operationId: action.id,
          summary: action.name,
          description: action.description,
          tags: Object.freeze([action.domain, action.category]),
          requestBody: Object.freeze({
            content: Object.freeze({
              "application/json": Object.freeze({
                schema: freezeData(inputSchemaForAction(action)) as OpenAPIPathEntry['requestBody']['content']['application/json']['schema'],
              }),
            }),
          }),
        });
      }));
    },
  };
}
