import { immutableValue } from "./immutable.js";
import type { ModuleDefinition } from "./types.js";

/**
 * Input shape for defineModule — allows optional fields with sensible defaults.
 */
export type ModuleInput = {
  id: string;
  name: string;
  description?: string;
  domain: string;
  requires?: readonly string[];
  capabilities?: readonly string[];
  terminology?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  seed?: Readonly<Record<string, unknown>>;
  roles?: Readonly<Record<string, readonly string[]>>;
};

/**
 * Define a feature module.
 *
 * Returns a frozen, validated ModuleDefinition. Once created, a module
 * definition is immutable — no accidental mutations downstream.
 *
 * @example
 * ```ts
 * const attendance = defineModule({
 *   id: "attendance",
 *   name: "Attendance Tracking",
 *   domain: "academics",
 *   requires: ["students", "academics"],
 *   terminology: {
 *     session: { default: "Session", dance: "Check-in" },
 *   },
 * });
 * ```
 */
export function defineModule(input: ModuleInput): ModuleDefinition {
  if (!input.id || typeof input.id !== "string") {
    throw new Error("Module id is required and must be a non-empty string");
  }
  if (!input.name || typeof input.name !== "string") {
    throw new Error(`Module "${input.id}": name is required and must be a non-empty string`);
  }
  if (!input.domain || typeof input.domain !== "string") {
    throw new Error(`Module "${input.id}": domain is required and must be a non-empty string`);
  }

  const id = input.id.trim();
  if (id.length === 0) {
    throw new Error("Module id must be a non-empty string");
  }
  if (id.length > 64) {
    throw new Error(`Module id "${id}" exceeds 64 characters`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`Module id "${id}" must start with a lowercase letter and contain only lowercase letters, digits, and hyphens`);
  }

  const definition: ModuleDefinition = {
    id,
    name: input.name.trim(),
    description: (input.description ?? "").trim(),
    domain: input.domain.trim(),
    requires: Object.freeze([...(input.requires ?? [])]),
    capabilities: Object.freeze([...(input.capabilities ?? [])]),
    terminology: immutableValue(input.terminology ?? {}),
    seed: immutableValue(input.seed ?? {}),
    roles: immutableValue(input.roles ?? {}),
  };

  return Object.freeze(definition);
}
