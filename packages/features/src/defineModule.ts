import type { ModuleDefinition } from "./types.js";

/**
 * Input shape for defineModule — allows optional fields with sensible defaults.
 */
export type ModuleInput = {
  id: string;
  name: string;
  description?: string;
  domain: string;
  requires?: string[];
  capabilities?: string[];
  terminology?: Record<string, Record<string, string>>;
  seed?: Record<string, unknown>;
  roles?: Record<string, string[]>;
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
    terminology: deepFreeze(input.terminology ?? {}),
    seed: deepFreeze(input.seed ?? {}),
    roles: deepFreezeRoles(input.roles ?? {}),
  };

  return Object.freeze(definition);
}

function deepFreeze<T extends Record<string, unknown>>(obj: T): Readonly<T> {
  const frozen: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
      if (Array.isArray(value)) {
        frozen[key] = Object.freeze(value.map((item) =>
          typeof item === "object" && item !== null ? Object.freeze({ ...item }) : item
        ));
      } else {
        frozen[key] = deepFreeze(value as Record<string, unknown>);
      }
    } else {
      frozen[key] = value;
    }
  }
  return Object.freeze(frozen) as Readonly<T>;
}

function deepFreezeRoles(
  roles: Record<string, string[]>
): Readonly<Record<string, readonly string[]>> {
  const frozen: Record<string, readonly string[]> = {};
  for (const key of Object.keys(roles)) {
    frozen[key] = Object.freeze([...roles[key]!]);
  }
  return Object.freeze(frozen);
}
