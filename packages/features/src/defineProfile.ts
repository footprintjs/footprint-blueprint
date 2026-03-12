import type { ProfileDefinition } from "./types.js";

/**
 * Input shape for defineProfile — allows optional fields with sensible defaults.
 */
export type ProfileInput = {
  type: string;
  displayName: string;
  modules: string[];
  roles?: string[];
  schedulingPattern?: string;
  meta?: Record<string, unknown>;
};

/**
 * Define a profile preset.
 *
 * A profile is a template that says "schools of this kind get
 * these modules, these roles, and this scheduling pattern by default."
 *
 * @example
 * ```ts
 * const danceSchool = defineProfile({
 *   type: "dance",
 *   displayName: "Dance School",
 *   modules: ["students", "employees", "attendance", "fees"],
 *   roles: ["Owner", "Instructor", "Front Desk"],
 *   schedulingPattern: "time-slots",
 * });
 * ```
 */
export function defineProfile(input: ProfileInput): ProfileDefinition {
  if (!input.type || typeof input.type !== "string") {
    throw new Error("Profile is required and must be a non-empty string");
  }
  if (!input.displayName || typeof input.displayName !== "string") {
    throw new Error(`Profile "${input.type}": displayName is required`);
  }
  if (!Array.isArray(input.modules) || input.modules.length === 0) {
    throw new Error(`Profile "${input.type}": at least one module is required`);
  }

  const type = input.type.trim();
  if (!/^[a-z][a-z0-9-]*$/.test(type)) {
    throw new Error(`Profile "${type}" must start with a lowercase letter and contain only lowercase letters, digits, and hyphens`);
  }

  const definition: ProfileDefinition = {
    type,
    displayName: input.displayName.trim(),
    modules: Object.freeze([...input.modules]),
    roles: Object.freeze([...(input.roles ?? [])]),
    schedulingPattern: (input.schedulingPattern ?? "default").trim(),
    meta: Object.freeze({ ...(input.meta ?? {}) }),
  };

  return Object.freeze(definition);
}
