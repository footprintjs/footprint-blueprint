import { immutableValue } from '../features/index.js';
import { createTenantContext } from './tenantContext.js';
import type { ProfileBinding, ProfileScope } from './types.js';

export function normalizedProfileScope(scope: ProfileScope): ProfileScope {
  const normalized = createTenantContext(scope);
  return Object.freeze({ tenantId: normalized.tenantId, ...(normalized.campusId !== undefined ? { campusId: normalized.campusId } : {}), unitId: normalized.unitId });
}

export function profileScopeKey(scope: ProfileScope): string {
  const normalized = normalizedProfileScope(scope);
  return JSON.stringify([normalized.tenantId, normalized.campusId ?? null, normalized.unitId]);
}

export function bindingRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Profile binding revision must be a nonnegative safe integer');
  return value;
}

export function captureProfileBinding(binding: ProfileBinding, expectedScope?: ProfileScope): ProfileBinding {
  const scope = normalizedProfileScope(binding);
  if (expectedScope && profileScopeKey(scope) !== profileScopeKey(expectedScope)) throw new Error('Profile binding scope does not match the requested tenant, campus and unit');
  if (typeof binding.profileType !== 'string' || !binding.profileType.trim()) throw new Error('Profile binding profileType is required');
  if (binding.moduleOverrides !== undefined && (!Array.isArray(binding.moduleOverrides) || binding.moduleOverrides.some((id) => typeof id !== 'string' || !id.trim()))) {
    throw new Error('Profile binding moduleOverrides must contain non-empty module IDs');
  }
  if (typeof binding.createdAt !== 'string' || !Number.isFinite(Date.parse(binding.createdAt))) throw new Error('Profile binding createdAt must be a valid timestamp');
  return immutableValue({ ...binding, ...scope, profileType: binding.profileType.trim(), revision: bindingRevision(binding.revision) });
}
