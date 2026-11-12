import { readStoredRecord, type StoredRecord, type StoredLog } from 'foottrace';
import type { RecordEntry, RecordSink } from 'foottrace/write';

/** The host must create immutable objects; an identical redelivery may succeed, a different body must fail. */
export interface ObjectRecordStorage {
  put(request: { readonly key: string; readonly body: string; readonly signal: AbortSignal }): Promise<void>;
  get(request: { readonly key: string; readonly maxBytes: number; readonly signal: AbortSignal }): Promise<string | undefined>;
  list(request: { readonly prefix: string; readonly limit: number; readonly continuationToken?: string; readonly signal: AbortSignal }): Promise<{ readonly keys: readonly string[]; readonly continuationToken?: string }>;
}
export type ObjectRecordReadStorage = Pick<ObjectRecordStorage, 'get' | 'list'>;
export interface ObjectRecordLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
  readonly maxQueuedBytes: number;
  readonly concurrency: number;
  readonly operationTimeoutMs: number;
  readonly flushTimeoutMs: number;
  readonly maxReadPages: number;
  readonly readTimeoutMs: number;
}
export const DEFAULT_OBJECT_RECORD_LIMITS: Readonly<ObjectRecordLimits> = Object.freeze({
  maxEntries: 1000, maxEntryBytes: 256 * 1024, maxTotalBytes: 2 * 1024 * 1024,
  maxQueuedBytes: 1024 * 1024, concurrency: 2, operationTimeoutMs: 2000, flushTimeoutMs: 2000, maxReadPages: 20, readTimeoutMs: 10000,
});
export type ObjectRecordErrorCode = 'RECORD_STORAGE_CONFIGURATION' | 'RECORD_STORAGE_INVALID' | 'RECORD_STORAGE_LIMIT' | 'RECORD_STORAGE_UNAVAILABLE' | 'RECORD_STORAGE_TIMEOUT' | 'RECORD_STORAGE_CANCELLED' | 'RECORD_STORAGE_CORRUPT';
/** Fixed public code only: raw storage errors, credentials and request bodies are never attached. */
export class ObjectRecordError extends Error {
  constructor(readonly code: ObjectRecordErrorCode) { super(code); this.name = 'ObjectRecordError'; }
}
export interface ObjectRecordIdentityOptions {
  /** Trusted deployment identifiers; never take these or the prefix from a model or customer input. */
  readonly storeId: string;
  readonly runId: string;
  readonly prefix?: string;
  readonly limits?: Partial<ObjectRecordLimits>;
}
export interface ObjectRecordOptions extends ObjectRecordIdentityOptions { readonly storage: ObjectRecordStorage; }
export interface ObjectRecordReadOptions extends ObjectRecordIdentityOptions { readonly storage: ObjectRecordReadStorage; readonly signal?: AbortSignal; }
export interface ObjectRecordSinkStats {
  readonly entries: number;
  readonly accepted: number;
  readonly acknowledged: number;
  readonly failed: number;
  readonly pending: number;
  readonly queuedBytes: number;
  readonly bytesAcknowledged: number;
  readonly durability: 'acknowledged-prefix-only';
}
export interface ObjectRecordSink extends RecordSink {
  flush(): Promise<void>;
  stats(): Readonly<ObjectRecordSinkStats>;
  /** Stop diagnostic I/O only; already acknowledged objects remain. Future entries are refused and counted. */
  cancel(): void;
}
export interface ObjectRecordReadResult {
  readonly status: 'available' | 'partial' | 'unavailable';
  readonly reason?: ObjectRecordErrorCode;
  readonly identity: Readonly<{ storeId: string; runId: string; nativeRunId?: string }>;
  readonly record?: StoredRecord;
  readonly root?: StoredLog;
  readonly coverage: Readonly<{
    objectsListed: number; objectsRead: number; bytesRead: number;
    writerComplete: boolean; whole: boolean; gaps: number; unread: number;
    missingSequences: readonly number[]; missingMountParents: number; postCloseEntries: number; truncated: boolean;
    adapterDrops: 'unknown'; unacknowledgedTail: 'unknown';
  }>;
}
type Envelope = { schemaVersion: 1; storeId: string; runId: string; sequence: number; entry: RecordEntry };
type Job = { key: string; body: string; bytes: number; resolve: () => void; reject: (error: ObjectRecordError) => void };
function fail(code: ObjectRecordErrorCode): never { throw new ObjectRecordError(code); }
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const segment = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const own = (v: object, key: string): unknown => { const d = Object.getOwnPropertyDescriptor(v, key); return d && 'value' in d ? d.value : undefined; };
const utf8 = (v: string): number => new TextEncoder().encode(v).byteLength;

function configured<T extends ObjectRecordIdentityOptions & { readonly storage: ObjectRecordReadStorage }>(options: T, writable = false) {
  if (!object(options) || !segment(options.storeId) || !segment(options.runId)
      || !object(options.storage) || !(writable ? ['put', 'get', 'list'] : ['get', 'list']).every(k => typeof (options.storage as unknown as Record<string, unknown>)[k] === 'function')) fail('RECORD_STORAGE_CONFIGURATION');
  const prefix = options.prefix ?? 'footprint-records/v1';
  if (typeof prefix !== 'string' || prefix.length > 256 || !prefix.split('/').every(segment)) fail('RECORD_STORAGE_CONFIGURATION');
  const limits = { ...DEFAULT_OBJECT_RECORD_LIMITS, ...options.limits };
  const upper: ObjectRecordLimits = { maxEntries: 100000, maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024,
    maxQueuedBytes: 16 * 1024 * 1024, concurrency: 16, operationTimeoutMs: 30000, flushTimeoutMs: 30000, maxReadPages: 1000, readTimeoutMs: 30000 };
  for (const k of Object.keys(upper) as (keyof ObjectRecordLimits)[]) if (!Number.isSafeInteger(limits[k]) || limits[k] < 1 || limits[k] > upper[k]) fail('RECORD_STORAGE_CONFIGURATION');
  return { ...options, limits, keyPrefix: `${prefix}/${options.storeId}/${options.runId}/` };
}
/** Restrict this adapter to bounded plain JSON, without invoking payload getters or toJSON methods. */
function encode(value: unknown, maxBytes: number): string {
  const active = new Set<object>(); let nodes = 0, estimate = 0;
  const spend = (n: number) => { estimate += n; if (estimate > maxBytes) fail('RECORD_STORAGE_LIMIT'); };
  const copy = (v: unknown, depth: number): unknown => {
    if (++nodes > 50000 || depth > 64) fail('RECORD_STORAGE_LIMIT');
    if (v === undefined || v === null || typeof v === 'boolean') { spend(5); return v; }
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail('RECORD_STORAGE_INVALID'); spend(24); return v; }
    if (typeof v === 'string') { if (v.length > maxBytes) fail('RECORD_STORAGE_LIMIT'); spend(utf8(v) + 2); return v; }
    if (typeof v !== 'object') fail('RECORD_STORAGE_INVALID');
    if (active.has(v)) fail('RECORD_STORAGE_INVALID');
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) fail('RECORD_STORAGE_INVALID');
    active.add(v); spend(2);
    let retained: unknown;
    if (Array.isArray(v)) {
      if (v.length > 50000 - nodes || v.length > maxBytes) fail('RECORD_STORAGE_LIMIT');
      const items: unknown[] = []; Object.defineProperty(items, 'toJSON', { value: undefined });
      for (let index = 0; index < v.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(index));
        if (descriptor && !('value' in descriptor)) fail('RECORD_STORAGE_INVALID');
        spend(1); items.push(copy(descriptor?.value, depth + 1));
      }
      retained = items;
    } else {
      const keys = Object.keys(v); if (keys.length > 50000 - nodes) fail('RECORD_STORAGE_LIMIT');
      const record = Object.create(null) as Record<string, unknown>;
      for (const key of keys) {
        if (key.length > maxBytes) fail('RECORD_STORAGE_LIMIT'); spend(utf8(key) + 4);
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (!descriptor || !('value' in descriptor)) fail('RECORD_STORAGE_INVALID');
        Object.defineProperty(record, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
      }
      retained = record;
    }
    active.delete(v); return retained;
  };
  // Detached inert containers also prevent inherited or non-enumerable toJSON hooks from running.
  const body = JSON.stringify(copy(value, 0));
  if (typeof body !== 'string') fail('RECORD_STORAGE_INVALID');
  if (utf8(body) > maxBytes) fail('RECORD_STORAGE_LIMIT');
  return body;
}

function address(entry: unknown): { logRunId: string; drillPath: string[] } | undefined {
  if (!object(entry)) return undefined;
  const a = own(entry, 'address');
  if (!object(a)) return undefined;
  const id = own(a, 'logRunId'), path = own(a, 'drillPath');
  if (typeof id !== 'string' || id.length < 1 || id.length > 256 || !/^[!-~]+$/.test(id) || !Array.isArray(path) || path.length > 32
      || !path.every(v => typeof v === 'string' && v.length > 0 && v.length <= 1024) || path.join('').length > 8192) return undefined;
  return { logRunId: id, drillPath: [...path] };
}
function keyFor(prefix: string, sequence: number) { return `${prefix}${String(sequence).padStart(10, '0')}.json`; }
/** Invoke the port immediately; cancellation is bounded even if the host ignores the signal. */
function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, outer?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController(); let finished = false;
    const done = (error?: ObjectRecordError, value?: T) => { if (finished) return; finished = true; clearTimeout(timer); outer?.removeEventListener('abort', cancelled); error ? reject(error) : resolve(value as T); };
    const cancelled = () => { controller.abort(); done(new ObjectRecordError('RECORD_STORAGE_CANCELLED')); };
    const timer = setTimeout(() => { controller.abort(); done(new ObjectRecordError('RECORD_STORAGE_TIMEOUT')); }, timeoutMs);
    if (outer?.aborted) { cancelled(); return; }
    outer?.addEventListener('abort', cancelled, { once: true });
    try { Promise.resolve(work(controller.signal)).then(value => done(undefined, value), () => done(new ObjectRecordError('RECORD_STORAGE_UNAVAILABLE'))); }
    catch { done(new ObjectRecordError('RECORD_STORAGE_UNAVAILABLE')); }
  });
}

/** A fresh sink for one store/application run. Already acknowledged objects survive a killed writer; the tail is unknown. */
export function createObjectRecordSink(options: ObjectRecordOptions): ObjectRecordSink {
  const cfg = configured(options, true), queue: Job[] = [], idle = new Set<() => void>(), opened = new Set<string>();
  const stopper = new AbortController(); let stopped = false;
  let nativeRunId: string | undefined, sequence = 0, entries = 0, accepted = 0, acknowledged = 0, failed = 0, queuedBytes = 0, bytesAccepted = 0, bytesAcknowledged = 0, running = 0;
  const pending = () => queue.length + running;
  const notify = () => { if (!pending()) for (const wake of [...idle]) wake(); };
  const stop = () => {
    if (stopped) return; stopped = true; stopper.abort();
    for (const job of queue.splice(0)) { failed++; queuedBytes -= job.bytes; job.reject(new ObjectRecordError('RECORD_STORAGE_CANCELLED')); }
    notify();
  };
  const pump = () => {
    while (!stopped && running < cfg.limits.concurrency && queue.length) {
      const job = queue.shift()!; running++;
      bounded(signal => cfg.storage.put({ key: job.key, body: job.body, signal }), cfg.limits.operationTimeoutMs, stopper.signal).then(() => {
        acknowledged++; bytesAcknowledged += job.bytes; job.resolve();
      }, error => { failed++; job.reject(error); if (error.code === 'RECORD_STORAGE_TIMEOUT' || error.code === 'RECORD_STORAGE_CANCELLED') stop(); }).finally(() => { running--; queuedBytes -= job.bytes; pump(); notify(); });
    }
  };
  const admit = (entry: RecordEntry): Promise<void> => {
    entries++; const seq = sequence++;
    try {
      if (stopped) fail('RECORD_STORAGE_CANCELLED');
      const a = address(entry);
      if (!a) fail('RECORD_STORAGE_INVALID');
      const pathKey = JSON.stringify(a.drillPath);
      if (nativeRunId === undefined) {
        if (entry.kind !== 'opened' || a.drillPath.length) fail('RECORD_STORAGE_INVALID');
        nativeRunId = a.logRunId;
      }
      if (a.logRunId !== nativeRunId) fail('RECORD_STORAGE_INVALID');
      if (entry.kind === 'opened') {
        if (opened.has(pathKey) || a.drillPath.length && !opened.has(JSON.stringify(a.drillPath.slice(0, -1)))) fail('RECORD_STORAGE_INVALID');
        opened.add(pathKey);
      } else if (!opened.has(pathKey)) fail('RECORD_STORAGE_INVALID');
      const body = encode({ schemaVersion: 1, storeId: cfg.storeId, runId: cfg.runId, sequence: seq, entry } satisfies Envelope, cfg.limits.maxEntryBytes);
      const bytes = utf8(body);
      if (seq >= cfg.limits.maxEntries || accepted >= cfg.limits.maxEntries || bytesAccepted + bytes > cfg.limits.maxTotalBytes || queuedBytes + bytes > cfg.limits.maxQueuedBytes) fail('RECORD_STORAGE_LIMIT');
      accepted++; queuedBytes += bytes; bytesAccepted += bytes;
      const promise = new Promise<void>((resolve, reject) => { queue.push({ key: keyFor(cfg.keyPrefix, seq), body, bytes, resolve, reject }); });
      // The native log observes this rejection. Also consume it here for direct void-typed RecordSink callers.
      void promise.catch(() => {}); pump(); return promise;
    } catch (error) { failed++; throw error instanceof ObjectRecordError ? error : new ObjectRecordError('RECORD_STORAGE_INVALID'); }
  };
  const sink: ObjectRecordSink = {
    opened: entry => admit({ ...entry, kind: 'opened' }),
    commit: entry => admit({ ...entry, kind: 'commit' }),
    note: entry => { const { kind, ...rest } = entry; return admit({ ...rest, kind: 'note', note: kind }); },
    closed: entry => admit({ ...entry, kind: 'closed' }),
    async flush() {
      if (pending()) {
        let wake: (() => void) | undefined;
        try { await bounded(() => new Promise<void>(resolve => { wake = () => { idle.delete(wake!); resolve(); }; idle.add(wake); if (!pending()) wake(); }), cfg.limits.flushTimeoutMs); }
        catch (error) { stop(); throw error; }
        finally { if (wake) idle.delete(wake); }
      }
      if (failed) fail('RECORD_STORAGE_UNAVAILABLE');
    },
    cancel: stop,
    stats: () => Object.freeze({ entries, accepted, acknowledged, failed, pending: pending(), queuedBytes, bytesAcknowledged, durability: 'acknowledged-prefix-only' as const }),
  };
  return Object.freeze(sink);
}

/** Bounded read-only reconstruction of genuine native entries. No cloud SDK, model call, business action or snapshot invention. */
export async function readObjectRecord(options: ObjectRecordReadOptions): Promise<ObjectRecordReadResult> {
  const cfg = configured(options); const deadline = Date.now() + cfg.limits.readTimeoutMs;
  const timeLeft = () => { const remaining = deadline - Date.now(); if (remaining <= 0) fail('RECORD_STORAGE_TIMEOUT'); return Math.min(cfg.limits.operationTimeoutMs, remaining); };
  let objectsListed = 0, objectsRead = 0, bytesRead = 0, truncated = false;
  const identity = Object.freeze({ storeId: cfg.storeId, runId: cfg.runId });
  const base = () => ({ objectsListed, objectsRead, bytesRead, writerComplete: false, whole: false, gaps: 0, unread: 0,
    missingSequences: [] as number[], missingMountParents: 0, postCloseEntries: 0, truncated, adapterDrops: 'unknown' as const, unacknowledgedTail: 'unknown' as const });
  const unavailable = (reason: ObjectRecordErrorCode): ObjectRecordReadResult => Object.freeze({ status: 'unavailable', reason, identity, coverage: Object.freeze(base()) });
  const keys = new Set<string>(), tokens = new Set<string>(); let token: string | undefined;
  try {
    for (let page = 0; page < cfg.limits.maxReadPages; page++) {
      const remaining = cfg.limits.maxEntries - keys.size;
      if (remaining <= 0) { truncated = true; break; }
      const result = await bounded(signal => cfg.storage.list({ prefix: cfg.keyPrefix, limit: Math.min(100, remaining), ...(token === undefined ? {} : { continuationToken: token }), signal }), timeLeft(), options.signal);
      if (!object(result) || !Array.isArray(result.keys) || result.keys.length > Math.min(100, remaining)) return unavailable('RECORD_STORAGE_CORRUPT');
      for (const key of result.keys) {
        if (typeof key !== 'string' || !key.startsWith(cfg.keyPrefix) || !/^\d{10}\.json$/.test(key.slice(cfg.keyPrefix.length)) || keys.has(key)) return unavailable('RECORD_STORAGE_CORRUPT');
        keys.add(key); objectsListed++;
      }
      if (result.continuationToken === undefined) { token = undefined; break; }
      token = result.continuationToken;
      if (typeof token !== 'string' || !token.length || token.length > 4096 || tokens.has(token)) return unavailable('RECORD_STORAGE_CORRUPT');
      tokens.add(token);
      if (page === cfg.limits.maxReadPages - 1) truncated = true;
    }
    const entries: unknown[] = [], sequences: number[] = []; let nativeRunId: string | undefined;
    for (const key of [...keys].sort()) {
      const body = await bounded(signal => cfg.storage.get({ key, maxBytes: cfg.limits.maxEntryBytes, signal }), timeLeft(), options.signal);
      if (typeof body !== 'string' || body.length > cfg.limits.maxEntryBytes) return unavailable('RECORD_STORAGE_CORRUPT');
      const bytes = utf8(body); bytesRead += bytes; objectsRead++;
      if (bytes > cfg.limits.maxEntryBytes || bytesRead > cfg.limits.maxTotalBytes) return unavailable('RECORD_STORAGE_LIMIT');
      let envelope: unknown;
      try { envelope = JSON.parse(body); } catch { return unavailable('RECORD_STORAGE_CORRUPT'); }
      if (!object(envelope) || Object.keys(envelope).length !== 5 || envelope.schemaVersion !== 1 || envelope.storeId !== cfg.storeId || envelope.runId !== cfg.runId
          || !Number.isSafeInteger(envelope.sequence) || (envelope.sequence as number) < 0 || key !== keyFor(cfg.keyPrefix, envelope.sequence as number) || !object(envelope.entry)) return unavailable('RECORD_STORAGE_CORRUPT');
      const a = address(envelope.entry);
      if (a) { if (nativeRunId !== undefined && a.logRunId !== nativeRunId) return unavailable('RECORD_STORAGE_CORRUPT'); nativeRunId ??= a.logRunId; }
      sequences.push(envelope.sequence as number); entries.push(envelope.entry);
    }
    if (!entries.length) return unavailable('RECORD_STORAGE_UNAVAILABLE');
    const record = readStoredRecord(entries, { entries: cfg.limits.maxEntries + 1, missingCommits: cfg.limits.maxEntries, drillDepth: 32, addressLength: 8192 });
    const root = nativeRunId === undefined ? undefined : record.root(nativeRunId);
    const missingSequences: number[] = []; let expected = 0;
    for (const sequence of sequences) { while (expected < sequence && missingSequences.length < cfg.limits.maxEntries) missingSequences.push(expected++); expected = sequence + 1; }
    let gaps = 0, missingMountParents = 0, postCloseEntries = 0, allClosed = record.logs.size > 0;
    for (const log of record.logs.values()) {
      gaps += log.gaps.length; allClosed &&= log.complete;
      const lastClose = log.entries.map(e => e.kind).lastIndexOf('closed');
      if (lastClose >= 0) postCloseEntries += log.entries.length - lastClose - 1;
      if (log.address.drillPath.length && !record.log({ logRunId: log.address.logRunId, drillPath: log.address.drillPath.slice(0, -1) })) missingMountParents++;
    }
    const whole = Boolean(root?.complete && allClosed && !gaps && !record.unread.length && !missingSequences.length && !missingMountParents && !postCloseEntries && !truncated && root.initialState !== undefined);
    return Object.freeze({ status: whole ? 'available' : 'partial', identity: Object.freeze({ ...identity, ...(nativeRunId === undefined ? {} : { nativeRunId }) }), record,
      ...(root === undefined ? {} : { root }), coverage: Object.freeze({ objectsListed, objectsRead, bytesRead, writerComplete: root?.complete ?? false, whole, gaps, unread: record.unread.length,
        missingSequences: Object.freeze(missingSequences), missingMountParents, postCloseEntries, truncated, adapterDrops: 'unknown', unacknowledgedTail: 'unknown' }) });
  } catch (error) { return unavailable(error instanceof ObjectRecordError ? error.code : 'RECORD_STORAGE_CORRUPT'); }
}
