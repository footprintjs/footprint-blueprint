import type { RunOptions } from 'footprintjs';

/** Trusted host controls only. Payloads, executor state and engine dials are not accepted here. */
export type ExecutionRunOptions = Readonly<Pick<RunOptions, 'signal' | 'timeoutMs' | 'deadline'> & {
  readonly env?: Readonly<Pick<NonNullable<RunOptions['env']>, 'signal' | 'deadline' | 'traceparent' | 'traceId' | 'operationId'>>;
}>;

const ownData = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    // A host accidentally returning a rejected native Promise must not create an unhandled rejection.
    // Do not call ordinary thenables or read a caller's `then` getter.
    try { Promise.prototype.then.call(value as Promise<unknown>, () => undefined, () => undefined); } catch { /* Not a native Promise. */ }
    throw new TypeError('Execution options must be plain host controls');
  }
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Execution options contain unsupported controls');
    result[key] = descriptor.value;
  }
  return result;
};

/** Capture the narrow boundary synchronously; the engine owns validation and enforcement. */
export function captureExecutionRunOptions(value: ExecutionRunOptions | undefined): RunOptions | undefined {
  if (value === undefined) return undefined;
  const captured = ownData(value, ['signal', 'timeoutMs', 'deadline', 'env']);
  if (captured.env !== undefined) captured.env = ownData(captured.env, ['signal', 'deadline', 'traceparent', 'traceId', 'operationId']);
  return captured as RunOptions;
}
