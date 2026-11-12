/** Shared inert-data boundary. Callers retain their own public refusal types. */
export function admitInertData(value: unknown, invalid: () => never, limit: () => never): void {
  const active = new Set<object>(); let fields = 0, chars = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++fields > 50000 || depth > 48) limit();
    if (item === undefined || item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { chars += item.length; if (item.length > 65536 || chars > 2 * 1024 * 1024) limit(); return; }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || active.has(item)) invalid();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if ((!array && prototype !== Object.prototype && prototype !== null)
      || (array && (prototype !== Array.prototype || item.length > 5000))) invalid();
    active.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key.length > 4096 || ['__proto__', 'prototype', 'constructor'].includes(key)) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(item, key); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid();
      chars += key.length; if (chars > 2 * 1024 * 1024) limit(); visit(descriptor.value, depth + 1);
    }
    if (array && Object.keys(item).length !== item.length) invalid();
    active.delete(item);
  };
  visit(value, 0);
}
