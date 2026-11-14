import { admitInertData } from '../coverageAdmission.js';

export class FailureExplanationError extends Error {
  constructor(readonly code: 'EXPLANATION_INVALID' | 'EXPLANATION_LIMIT') {
    super(code === 'EXPLANATION_LIMIT'
      ? 'Failure explanation is too large. Use fewer findings or shorter plain-text templates.'
      : 'Failure explanation is unavailable. Provide an admitted diagnosis and valid plain-text templates.');
    this.name = 'FailureExplanationError';
  }
}
export function invalid(): never { throw new FailureExplanationError('EXPLANATION_INVALID'); }
export function limit(): never { throw new FailureExplanationError('EXPLANATION_LIMIT'); }
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function keys(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid();
}
/** Detached descriptors only. Accessor values and functions are rejected before property reads. */
export function inertCopy<T>(value: T): T {
  try { admitInertData(value, invalid, limit); }
  catch (error) { if (error instanceof FailureExplanationError) throw error; invalid(); }
  const copy = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    const out: Record<string, unknown> | unknown[] = Array.isArray(item) ? [] : {};
    for (const key of Object.keys(item)) Object.defineProperty(out, key, { value: copy(Object.getOwnPropertyDescriptor(item, key)!.value), enumerable: true, writable: false, configurable: false });
    return Object.freeze(out);
  };
  return copy(value) as T;
}
export function text(value: unknown, maximum = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\p{C}]/u.test(value) && new TextEncoder().encode(value).byteLength <= maximum;
}
export function code(value: unknown): value is string { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value); }
export function status(value: unknown): boolean { return ['ok', 'recovered', 'failed', 'unknown'].includes(value as string); }
export function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const key of Object.keys(value)) freeze(Object.getOwnPropertyDescriptor(value, key)!.value); Object.freeze(value); } return value; }
