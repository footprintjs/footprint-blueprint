import type { BoundaryRequestReference } from './types.js';
const own = (value: unknown, name: string): unknown => {
  try { if (!value || typeof value !== 'object') return undefined; const field = Object.getOwnPropertyDescriptor(value, name); return field && 'value' in field ? field.value : undefined; } catch { return undefined; }
};
/** Shape validation only. The trusted transport adapter must select the provider's actual request-ID field. */
export function readBoundaryRequestReference(value: unknown): BoundaryRequestReference | undefined {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return undefined;
    const namespace = own(value, 'namespace'), id = own(value, 'id');
    if (typeof namespace !== 'string' || !/^[a-z][a-z0-9.-]{0,47}$/.test(namespace)
      || typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)
      || /^(?:sk_|pk_|AKIA|ASIA|eyJ|token|secret|password)/i.test(id)) return undefined;
    return Object.freeze({ namespace, id });
  } catch { return undefined; }
}
