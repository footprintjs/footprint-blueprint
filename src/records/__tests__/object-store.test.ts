import { test, expect } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { stateAt } from 'foottrace';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createObjectRecordSink, readObjectRecord, ObjectRecordError, type ObjectRecordStorage, type ObjectRecordOptions } from '../object-store.js';

function memoryStorage() {
  const objects = new Map<string, string>(); let writes = 0;
  const storage: ObjectRecordStorage = {
    async put({ key, body }) { writes++; if (objects.has(key) && objects.get(key) !== body) throw new Error('immutable-object-conflict'); objects.set(key, body); },
    async get({ key, maxBytes }) { const body = objects.get(key); if (body && Buffer.byteLength(body) > maxBytes) throw new Error('oversized'); return body; },
    async list({ prefix, limit, continuationToken }) { const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort(); const from = continuationToken ? Number(continuationToken) : 0;
      return { keys: keys.slice(from, from + limit), ...(from + limit < keys.length ? { continuationToken: String(from + limit) } : {}) }; },
  };
  return { objects, storage, writes: () => writes };
}
const quiet = Object.fromEntries(['info', 'log', 'debug', 'error', 'warn'].map(key => [key, () => {}]));
const settings = (storage: ObjectRecordStorage, more: Partial<ObjectRecordOptions> = {}): ObjectRecordOptions => ({ storage, storeId: 'brand-one', runId: 'application-run-1', ...more });
async function nativeRun(more: Partial<ObjectRecordOptions> = {}) {
  const port = memoryStorage(); const options = settings(port.storage, more); const sink = createObjectRecordSink(options);
  const sub = flowChart<Record<string, unknown>>('Child', s => { s.child = 2; }, 'child').setLogger(quiet).build();
  const chart = flowChart<Record<string, unknown>>('Seed', s => { s.total = 1; s.secret = 'PRIVATE_INITIAL_AND_WRITE'; }, 'seed')
    .addSubFlowChartNext('mounted', sub, 'Mounted').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart, { sink, initialContext: { secret: 'PRIVATE_INITIAL_AND_WRITE' } });
  executor.setRedactionPolicy({ keys: ['secret'] });
  await executor.run({ timeoutMs: 1000, env: { traceId: 'caller-trace', operationId: 'caller-operation' } });
  return { ...port, options, sink, executor };
}

test('native root and mounted records persist incrementally with correlation, redaction and exact replay', async () => {
  const run = await nativeRun(); const read = await readObjectRecord(run.options);
  expect(read.status).toBe('available'); expect(read.coverage).toMatchObject({ writerComplete: true, whole: true, gaps: 0, unread: 0, missingMountParents: 0, adapterDrops: 'unknown', unacknowledgedTail: 'unknown' });
  expect(read.record!.logs.size).toBe(2); expect(read.root!.meta.opened?.correlation).toEqual({ traceId: 'caller-trace', operationId: 'caller-operation' });
  expect(read.root!.commitLog).toEqual(run.executor.getSnapshot().commitLog);
  expect(stateAt(read.root!.source(), read.root!.commitLog.length - 1).state).toMatchObject({ total: 1, secret: 'REDACTED' });
  expect(JSON.stringify([...run.objects.values()])).not.toContain('PRIVATE_INITIAL_AND_WRITE');
  expect(run.sink.stats()).toMatchObject({ acknowledged: run.objects.size, failed: 0, pending: 0, queuedBytes: 0, durability: 'acknowledged-prefix-only' });
  const nativeIds = new Set([...read.record!.logs.values()].map(log => log.address.logRunId)); expect(nativeIds.size).toBe(1);
});

test('puts start immediately before flush or run completion, and an unfinished prefix remains incomplete', async () => {
  const port = memoryStorage(); const options = settings(port.storage); const sink = createObjectRecordSink(options);
  sink.opened({ address: { logRunId: 'native-run', drillPath: [] }, at: 1, initialState: {} });
  expect(port.writes()).toBe(1); await sink.flush();
  const read = await readObjectRecord(options); expect(read.status).toBe('partial'); expect(read.root!.complete).toBe(false); expect(read.root!.outcome).toBeUndefined();
});

test('a covering close cannot hide a missing native commit or missing note sequence', async () => {
  const run = await nativeRun(); const commit = [...run.objects].find(([, v]) => JSON.parse(v).entry.kind === 'commit')!;
  run.objects.delete(commit[0]); const result = await readObjectRecord(run.options);
  expect(result.status).toBe('partial'); expect(result.coverage.writerComplete).toBe(true); expect(result.coverage.whole).toBe(false);
  expect(result.coverage.gaps).toBeGreaterThan(0); expect(result.coverage.missingSequences.length).toBe(1);
});

test('losing only a note still prevents a whole-evidence claim even when native commits have no gaps', async () => {
  const run = await nativeRun(); const note = [...run.objects].find(([, v]) => JSON.parse(v).entry.kind === 'note')!; run.objects.delete(note[0]);
  const result = await readObjectRecord(run.options); expect(result.coverage.writerComplete).toBe(true); expect(result.coverage.gaps).toBe(0);
  expect(result.coverage.missingSequences).toHaveLength(1); expect(result.status).toBe('partial');
});

test.each(['storeId', 'runId', 'sequence', 'nativeRunId'])('a foreign or corrupt %s fails closed without returning its record', async field => {
  const run = await nativeRun(); const [key, body] = [...run.objects][0]!; const value = JSON.parse(body);
  if (field === 'nativeRunId') value.entry.address.logRunId = 'foreign-native'; else value[field] = field === 'sequence' ? 99 : 'foreign';
  run.objects.set(key, JSON.stringify(value)); const result = await readObjectRecord(run.options);
  expect(result.status).toBe('unavailable'); expect(result.reason).toBe('RECORD_STORAGE_CORRUPT'); expect(result.record).toBeUndefined();
});

test('native malformed entries remain listed in unread rather than being silently cast into valid records', async () => {
  const run = await nativeRun(); const [key, body] = [...run.objects].find(([, v]) => JSON.parse(v).entry.kind === 'commit')!;
  const value = JSON.parse(body); value.entry.bundle = 'malformed'; run.objects.set(key, JSON.stringify(value));
  const read = await readObjectRecord(run.options); expect(read.status).toBe('partial'); expect(read.coverage.unread).toBeGreaterThan(0); expect(read.coverage.whole).toBe(false);
});

test('listing caps and missing mounted parents stay visible', async () => {
  const run = await nativeRun(); const cut = await readObjectRecord({ ...run.options, limits: { maxEntries: 2, maxReadPages: 1 } });
  expect(cut.status).toBe('partial'); expect(cut.coverage.truncated).toBe(true); expect(cut.coverage.whole).toBe(false);
  const rootOpen = [...run.objects].find(([, v]) => { const e = JSON.parse(v).entry; return e.kind === 'opened' && e.address.drillPath.length === 0; })!;
  run.objects.delete(rootOpen[0]); const missing = await readObjectRecord(run.options); expect(missing.status).toBe('partial'); expect(missing.coverage.whole).toBe(false);
});

test('read-only reader refuses repeated tokens, foreign keys, duplicates and malformed JSON', async () => {
  const run = await nativeRun();
  for (const listing of [async () => ({ keys: [], continuationToken: 'repeat' }), async () => ({ keys: ['other-store/run/0000000000.json'] }), async () => ({ keys: [ [...run.objects.keys()][0]!, [...run.objects.keys()][0]! ] })]) {
    const read = await readObjectRecord({ ...run.options, storage: { ...run.storage, list: listing } }); expect(read.status).toBe('unavailable'); expect(read.reason).toBe('RECORD_STORAGE_CORRUPT');
  }
  run.objects.set([...run.objects.keys()][0]!, '{bad'); expect((await readObjectRecord(run.options)).reason).toBe('RECORD_STORAGE_CORRUPT');
});

test('all work is bounded by entry, byte, request and total-read limits, with fixed public errors', async () => {
  const port = memoryStorage(); const sink = createObjectRecordSink(settings(port.storage, { limits: { maxEntryBytes: 200 } }));
  expect(() => sink.opened({ address: { logRunId: 'native', drillPath: [] }, at: 1, initialState: { large: 'x'.repeat(500) } })).toThrow('RECORD_STORAGE_LIMIT');
  expect(sink.stats().failed).toBe(1); expect(port.objects.size).toBe(0);
  const privateError = new Error('https://private.example/?token=TOP_SECRET');
  const broken = { ...port.storage, list: async () => { throw privateError; } };
  const read = await readObjectRecord(settings(broken)); expect(JSON.stringify(read)).not.toContain('TOP_SECRET'); expect(read.reason).toBe('RECORD_STORAGE_UNAVAILABLE');
  const blocked = { ...port.storage, list: () => new Promise<never>(() => {}) };
  const timed = await readObjectRecord(settings(blocked, { limits: { operationTimeoutMs: 10, readTimeoutMs: 5 } })); expect(timed.reason).toBe('RECORD_STORAGE_TIMEOUT');
  const ac = new AbortController(); ac.abort(); expect((await readObjectRecord({ ...settings(blocked), signal: ac.signal })).reason).toBe('RECORD_STORAGE_CANCELLED');
});

test('a rejected or timed-out put is separately counted and does not reverse a completed business write', async () => {
  const port = memoryStorage(); let businessWrites = 0;
  const sink = createObjectRecordSink(settings({ ...port.storage, put: async () => { throw new Error('SECRET_STORAGE_PROVIDER'); } }));
  const chart = flowChart('Write', () => { businessWrites++; }, 'write').setLogger(quiet).build(); const executor = new FlowChartExecutor(chart, { sink });
  await executor.run(); expect(businessWrites).toBe(1); expect(executor.getSnapshot().sink!.failed).toBeGreaterThan(0); expect(sink.stats().acknowledged).toBe(0); expect(sink.stats().pending).toBe(0);
  expect(JSON.stringify(executor.getSnapshot().sink)).not.toContain('SECRET_STORAGE_PROVIDER');
  const timeout = createObjectRecordSink(settings({ ...port.storage, put: () => new Promise<never>(() => {}) }, { limits: { operationTimeoutMs: 5, flushTimeoutMs: 20 } }));
  timeout.opened({ address: { logRunId: 'native', drillPath: [] }, at: 1, initialState: {} }); await expect(timeout.flush()).rejects.toThrow('RECORD_STORAGE_UNAVAILABLE'); expect(timeout.stats().failed).toBe(1);
});

test('concurrency and queue admission are bounded; accepted entries retain immutable sequence keys', async () => {
  const port = memoryStorage(); let active = 0, peak = 0; const releases: (() => void)[] = [];
  const storage = { ...port.storage, put: ({ key, body }: Parameters<ObjectRecordStorage['put']>[0]) => new Promise<void>(resolve => { active++; peak = Math.max(peak, active); releases.push(() => { active--; port.objects.set(key, body); resolve(); }); }) };
  const sink = createObjectRecordSink(settings(storage, { limits: { concurrency: 2, maxEntries: 4 } })); const address = { logRunId: 'native', drillPath: [] };
  sink.opened({ address, at: 1, initialState: {} }); for (let n = 0; n < 3; n++) sink.note({ address, at: n + 2, kind: 'diagnostic', data: { n } });
  expect(peak).toBe(2); expect(sink.stats().pending).toBe(4); expect(() => sink.note({ address, at: 9, kind: 'diagnostic', data: {} })).toThrow('RECORD_STORAGE_LIMIT');
  while (sink.stats().pending) { for (const release of releases.splice(0)) release(); await new Promise(resolve => setTimeout(resolve, 0)); }
  await expect(sink.flush()).rejects.toThrow('RECORD_STORAGE_UNAVAILABLE'); expect(port.objects.size).toBe(4); expect(peak).toBe(2);
  expect([...port.objects.keys()].sort().map(k => k.slice(-15))).toEqual(['0000000000.json', '0000000001.json', '0000000002.json', '0000000003.json']);
});

test('traversal names, invalid limits, foreign native runs and unparented mounts are refused', () => {
  const port = memoryStorage(); for (const more of [{ storeId: '../other' }, { runId: 'bad/child' }, { prefix: 'traces//private' }, { limits: { concurrency: 0 } }]) expect(() => createObjectRecordSink(settings(port.storage, more))).toThrow(ObjectRecordError);
  const sink = createObjectRecordSink(settings(port.storage)); sink.opened({ address: { logRunId: 'native', drillPath: [] }, at: 1, initialState: {} });
  expect(() => sink.opened({ address: { logRunId: 'foreign', drillPath: ['mount#1'] }, at: 1, initialState: {} })).toThrow('RECORD_STORAGE_INVALID');
  expect(() => sink.opened({ address: { logRunId: 'native', drillPath: ['missing#1', 'child#2'] }, at: 1, initialState: {} })).toThrow('RECORD_STORAGE_INVALID');
});

test('separate stores and application runs stay isolated even on a shared storage port', async () => {
  const port = memoryStorage();
  for (const [storeId, runId] of [['one', 'run-1'], ['two', 'run-1'], ['one', 'run-2']]) {
    const sink = createObjectRecordSink(settings(port.storage, { storeId, runId })); const address = { logRunId: `${storeId}-${runId}`, drillPath: [] };
    sink.opened({ address, at: 1, initialState: { storeId } }); sink.closed({ address, at: 2, commits: 0, outcome: 'ok' }); await sink.flush();
  }
  const read = await readObjectRecord(settings(port.storage, { storeId: 'one', runId: 'run-1' })); expect(read.root!.initialState).toEqual({ storeId: 'one' }); expect(read.record!.logs.size).toBe(1); expect(read.coverage.objectsRead).toBe(2);
});

test('a real SIGKILL preserves the acknowledged native prefix and reports the unfinished retry without a model', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bp-record-kill-'));
  try {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/killed-writer.mjs', import.meta.url)), directory], { encoding: 'utf8', timeout: 10000 });
    expect(child.signal).toBe('SIGKILL'); expect(child.status).toBeNull();
    const bodies = readdirSync(directory).filter(n => n.endsWith('.json')).sort().map(n => JSON.parse(readFileSync(join(directory, n), 'utf8')));
    expect(bodies.some(e => e.entry.kind === 'closed')).toBe(false);
    const recordProgram = `import {readObjectRecord} from './dist/records/object-store.js'; import {readFileSync,readdirSync} from 'node:fs'; import {join} from 'node:path'; const dir=process.argv[1]; const keys=readdirSync(dir).filter(k=>k.endsWith('.json')).map(k=>'footprint-records/v1/brand-one/application-run-1/'+k); const result=await readObjectRecord({storeId:'brand-one',runId:'application-run-1',storage:{put:async()=>{throw Error('READ_ONLY')},list:async()=>({keys}),get:async({key})=>readFileSync(join(dir,key.split('/').pop()),'utf8')}}); console.log(JSON.stringify({status:result.status,coverage:result.coverage,notes:result.root?.notes,modelCalls:0}));`;
    const read = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', recordProgram, directory], { cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8', timeout: 5000 }));
    expect(read.status).toBe('partial'); expect(read.coverage.writerComplete).toBe(false); expect(read.coverage.gaps).toBe(0); expect(read.modelCalls).toBe(0);
    expect(read.notes.some((n: any) => n.kind === 'attempt' && n.data.record.target === 'dependency.read' && n.data.record.attempt === 1 && n.data.record.outcome === 'failed' && n.data.record.next === 'retry')).toBe(true);
    expect(read.notes.some((n: any) => n.kind === 'attempt' && n.data.record.target === 'dependency.read' && n.data.record.attempt === 2)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('flush timeout cancels diagnostic I/O, discards the queue and never pumps it after return', async () => {
  const port = memoryStorage(); const signals: AbortSignal[] = []; const resolutions: (() => void)[] = []; let calls = 0;
  const storage = { ...port.storage, put: ({ signal }: Parameters<ObjectRecordStorage['put']>[0]) => { calls++; signals.push(signal); return new Promise<void>(resolve => resolutions.push(resolve)); } };
  const sink = createObjectRecordSink(settings(storage, { limits: { concurrency: 2, operationTimeoutMs: 1000, flushTimeoutMs: 5 } })); const address = { logRunId: 'native', drillPath: [] };
  sink.opened({ address, at: 1, initialState: {} }); for (let n = 0; n < 8; n++) sink.note({ address, at: n + 2, kind: 'diagnostic', data: { n } });
  expect(calls).toBe(2); await expect(sink.flush()).rejects.toThrow('RECORD_STORAGE_TIMEOUT');
  await new Promise(resolve => setTimeout(resolve, 10)); expect(signals.every(s => s.aborted)).toBe(true); expect(calls).toBe(2);
  expect(sink.stats()).toMatchObject({ entries: 9, accepted: 9, acknowledged: 0, failed: 9, pending: 0, queuedBytes: 0 });
  expect(() => sink.closed({ address, at: 99, commits: 0, outcome: 'ok' })).toThrow('RECORD_STORAGE_CANCELLED');
  for (const resolve of resolutions) resolve(); await new Promise(resolve => setTimeout(resolve, 0)); expect(calls).toBe(2); expect(sink.stats().acknowledged).toBe(0);
});

test('manual cancellation preserves acknowledged objects and only stops the diagnostic transport', async () => {
  const port = memoryStorage(); const options = settings(port.storage); const sink = createObjectRecordSink(options); const address = { logRunId: 'native', drillPath: [] };
  sink.opened({ address, at: 1, initialState: { safe: true } }); await sink.flush(); sink.cancel();
  expect(sink.stats().acknowledged).toBe(1); expect(port.objects.size).toBe(1);
  const result = await readObjectRecord({ storeId: options.storeId, runId: options.runId, storage: { get: port.storage.get, list: port.storage.list } });
  expect(result.status).toBe('partial'); expect(result.root!.initialState).toEqual({ safe: true }); expect(result.root!.complete).toBe(false);
});

test('shared JSON values are supported while cycles, payload accessors and toJSON functions are refused without running them', async () => {
  const port = memoryStorage(); const sink = createObjectRecordSink(settings(port.storage)); const address = { logRunId: 'native', drillPath: [] }; const shared = { safe: 1 };
  sink.opened({ address, at: 1, initialState: { a: shared, b: shared } }); await sink.flush(); expect(sink.stats().acknowledged).toBe(1);
  let invoked = 0; const hostile = Object.defineProperty({}, 'secret', { enumerable: true, get() { invoked++; return 'PRIVATE'; } });
  expect(() => sink.note({ address, at: 2, kind: 'bad', data: hostile })).toThrow('RECORD_STORAGE_INVALID');
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => sink.note({ address, at: 3, kind: 'bad', data: cycle })).toThrow('RECORD_STORAGE_INVALID');
  expect(() => sink.note({ address, at: 4, kind: 'bad', data: { toJSON() { invoked++; return 'PRIVATE'; } } })).toThrow('RECORD_STORAGE_INVALID'); expect(invoked).toBe(0);
});

test('activity after a native close cannot be called a whole record even if the native covering close still exists', async () => {
  const port = memoryStorage(); const options = settings(port.storage); const sink = createObjectRecordSink(options); const address = { logRunId: 'native', drillPath: [] };
  sink.opened({ address, at: 1, initialState: {} }); sink.closed({ address, at: 2, commits: 0, outcome: 'paused' }); sink.note({ address, at: 3, kind: 'resume', data: { runId: 'resumed-native' } }); await sink.flush();
  const result = await readObjectRecord(options); expect(result.root!.complete).toBe(true); expect(result.coverage.writerComplete).toBe(true);
  expect(result.coverage.postCloseEntries).toBe(1); expect(result.coverage.whole).toBe(false); expect(result.status).toBe('partial');
});


test('non-enumerable toJSON hooks and huge sparse arrays cannot execute or bypass encoding bounds', async () => {
  const port = memoryStorage(); const sink = createObjectRecordSink(settings(port.storage)); const address = { logRunId: 'native', drillPath: [] }; let calls = 0;
  const payload = Object.defineProperty({ safe: 1 }, 'toJSON', { get() { calls++; throw new Error('PRIVATE_GETTER'); } });
  sink.opened({ address, at: 1, initialState: payload }); await sink.flush(); expect(calls).toBe(0); expect(JSON.parse([...port.objects.values()][0]!).entry.initialState).toEqual({ safe: 1 });
  expect(() => sink.note({ address, at: 2, kind: 'sparse', data: { values: new Array(1000000) } })).toThrow('RECORD_STORAGE_LIMIT');
});
