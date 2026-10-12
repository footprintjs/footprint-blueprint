import type { TenantContext } from "./types.js";

/**
 * Create and validate a tenant context.
 *
 * @example
 * ```ts
 * const ctx = createTenantContext({ tenantId: "t1", unitId: "u1", userId: "usr1" });
 * ctx.tenantId; // "t1"
 * ```
 *
 * @example
 * ```ts
 * // From HTTP headers
 * const ctx = fromHeaders({
 *   "x-tenant-id": "t1",
 *   "x-campus-id": "c1",
 *   "x-unit-id": "u1",
 *   "x-user-id": "usr1",
 * });
 * ```
 */

export type TenantContextInput = {
  tenantId: string;
  campusId?: string;
  unitId: string;
  userId?: string;
};

/**
 * Create a validated, frozen tenant context.
 */
export function createTenantContext(input: TenantContextInput): TenantContext {
  const required = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) {
      throw new Error(`${field} is required and must be a non-empty string of at most 160 characters`);
    }
    return value.trim();
  };
  const optional = (value: unknown, field: string): string | undefined => value === undefined ? undefined : required(value, field);
  const campusId = optional(input.campusId, 'campusId');
  const userId = optional(input.userId, 'userId');
  const ctx: TenantContext = {
    tenantId: required(input.tenantId, 'tenantId'),
    ...(campusId !== undefined ? { campusId } : {}),
    unitId: required(input.unitId, 'unitId'),
    ...(userId !== undefined ? { userId } : {}),
  };

  return Object.freeze(ctx);
}

/**
 * Extract tenant context from a headers-like object.
 *
 * Header names are configurable via the optional `headerMap` parameter.
 * Defaults to: x-tenant-id, x-campus-id, x-unit-id, x-user-id.
 */
export type HeaderMap = {
  tenantId?: string;
  campusId?: string;
  unitId?: string;
  userId?: string;
};

const DEFAULT_HEADERS: Required<HeaderMap> = {
  tenantId: "x-tenant-id",
  campusId: "x-campus-id",
  unitId: "x-unit-id",
  userId: "x-user-id",
};

export function fromHeaders(
  headers: Readonly<Record<string, string | undefined>>,
  headerMap?: HeaderMap,
): TenantContext {
  const map = { ...DEFAULT_HEADERS, ...headerMap };

  const tenantId = headers[map.tenantId];
  const campusId = headers[map.campusId];
  const unitId = headers[map.unitId];
  const userId = headers[map.userId];

  if (!tenantId) {
    throw new Error(`Missing required header: ${map.tenantId}`);
  }
  if (!unitId) {
    throw new Error(`Missing required header: ${map.unitId}`);
  }

  return createTenantContext({
    tenantId,
    campusId: campusId || undefined,
    unitId,
    userId: userId || undefined,
  });
}
