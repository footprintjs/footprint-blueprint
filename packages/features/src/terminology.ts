import type { ModuleDefinition } from "./types.js";

/**
 * Resolve terminology labels for a profile from a set of modules.
 *
 * Merge order:
 * 1. Each module's terminology for the specific profile
 * 2. Falls back to "default" if no school-type-specific label
 * 3. Falls back to the term key itself if no label defined at all
 *
 * @example
 * ```ts
 * const terms = resolveTerminology("dance", [attendanceModule, academicsModule]);
 * // { session: "Check-in", grade: "Level", ... }
 * ```
 */
export function resolveTerminology(
  profileType: string,
  modules: readonly ModuleDefinition[]
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const mod of modules) {
    for (const [termKey, labels] of Object.entries(mod.terminology)) {
      // First module to define a term wins (consistent first-wins for both
      // profile-specific and default labels)
      if (termKey in result) continue;

      const profileLabel = labels[profileType];
      const defaultLabel = labels["default"];
      if (profileLabel) {
        result[termKey] = profileLabel;
      } else if (defaultLabel) {
        result[termKey] = defaultLabel;
      }
    }
  }

  return result;
}

/**
 * Create a term resolver function for a specific school's resolved terminology.
 *
 * Returns a function that looks up a term key and returns the display label.
 * If the key isn't found, returns the key itself (no crashes, graceful fallback).
 *
 * @example
 * ```ts
 * const t = createTermResolver({ session: "Check-in", grade: "Level" });
 * t("session");  // "Check-in"
 * t("unknown");  // "unknown"
 * ```
 */
export function createTermResolver(
  terminology: Readonly<Record<string, string>>
): (key: string) => string {
  return (key: string) => terminology[key] ?? key;
}
