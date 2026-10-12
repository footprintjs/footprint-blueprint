/** Snapshot plain definition data without retaining caller-owned mutable objects. */
export function immutableValue<T>(value: T): T {
  const visiting = new WeakSet<object>();
  const clone = (input: unknown): unknown => {
    if (input === null || typeof input !== 'object') {
      if (typeof input === 'function' || typeof input === 'symbol') throw new TypeError('Definition data must contain plain values');
      return input;
    }
    if (visiting.has(input)) throw new TypeError('Definition data must not contain cycles');
    if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
      throw new TypeError('Definition data must contain plain objects and arrays');
    }
    visiting.add(input);
    let output: unknown;
    if (Array.isArray(input)) {
      output = Object.freeze(input.map(clone));
    } else {
      const record: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(input)) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || descriptor.get || descriptor.set) throw new TypeError('Definition data must not contain accessors');
        record[key] = clone(descriptor.value);
      }
      output = Object.freeze(record);
    }
    visiting.delete(input);
    return output;
  };
  return clone(value) as T;
}

/** A read-only facade, not a frozen Map whose internal mutation methods remain usable. */
export function immutableMap<Key, Value>(entries: Iterable<readonly [Key, Value]>): ReadonlyMap<Key, Value> {
  const backing = new Map(entries);
  const facade: ReadonlyMap<Key, Value> = {
    get size() { return backing.size; },
    get: (key) => backing.get(key),
    has: (key) => backing.has(key),
    entries: () => backing.entries(),
    keys: () => backing.keys(),
    values: () => backing.values(),
    [Symbol.iterator]: () => backing[Symbol.iterator](),
    forEach(callback, thisArg?: unknown) {
      for (const [key, value] of backing) callback.call(thisArg, value, key, facade);
    },
  };
  return Object.freeze(facade);
}

export function immutableSet<Value>(values: Iterable<Value>): ReadonlySet<Value> {
  const backing = new Set(values);
  const facade: ReadonlySet<Value> = {
    get size() { return backing.size; },
    has: (value) => backing.has(value),
    entries: () => backing.entries(),
    keys: () => backing.keys(),
    values: () => backing.values(),
    [Symbol.iterator]: () => backing[Symbol.iterator](),
    forEach(callback, thisArg?: unknown) {
      for (const value of backing) callback.call(thisArg, value, value, facade);
    },
  };
  return Object.freeze(facade);
}
