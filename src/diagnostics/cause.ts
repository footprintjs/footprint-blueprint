import { isExecutionKey, type LogAddress } from 'foottrace';
import { attentionList, createRecordGraph, explain, type AttentionListResult, type CauseGraph, type CauseResult,
  type ExplainOptions, type RecordNode, type RecordScope } from 'foottrace/cause';
import type { CauseCapture } from './causeCapture.js';
export { createCauseCapture } from './causeCapture.js';
export type { CauseCapture } from './causeCapture.js';
export type { RecordScope, CauseResult } from 'foottrace/cause';

export class CauseRecordingError extends Error {
  constructor(readonly code: 'CAUSE_RECORD_INVALID' | 'CAUSE_RECORD_LIMIT' | 'CAUSE_SELECTION_INVALID') {
    super('Cause recording is unavailable'); this.name = 'CauseRecordingError';
  }
}
export interface RecordedCauseSource { readonly scopes: readonly RecordScope[]; readonly incomplete: boolean; }
export interface CauseCatalogNode {
  readonly id: string; readonly address: LogAddress; readonly selection: RecordNode; readonly label: string; readonly scopeIndex: number;
}
export interface CauseReaderLimits { readonly maxScopes?: number; readonly maxCommits?: number; readonly maxCatalogNodes?: number; readonly timeoutMs?: number; }
function fail(code: CauseRecordingError['code'] = 'CAUSE_RECORD_INVALID'): never { throw new CauseRecordingError(code); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: unknown, key: string): unknown => { if (!value || typeof value !== 'object') return undefined; const d = Object.getOwnPropertyDescriptor(value, key); return d && 'value' in d ? d.value : undefined; };

/** Admit bounded inert JSON before any projection. Getters, thenables, cycles and prototype keys are refused. */
function admit(value: unknown): void {
  const active = new Set<object>(); let fields = 0, chars = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++fields > 50000 || depth > 48) fail('CAUSE_RECORD_LIMIT');
    if (item === undefined || item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { chars += item.length; if (item.length > 65536 || chars > 2 * 1024 * 1024) fail('CAUSE_RECORD_LIMIT'); return; }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || active.has(item)) fail();
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if ((!array && prototype !== Object.prototype && prototype !== null) || (array && item.length > 5000)) fail();
    active.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || key.length > 4096 || ['__proto__', 'prototype', 'constructor'].includes(key)) fail();
      const d = Object.getOwnPropertyDescriptor(item, key); if (!d || !d.enumerable || !('value' in d)) fail();
      chars += key.length; if (chars > 2 * 1024 * 1024) fail('CAUSE_RECORD_LIMIT'); visit(d.value, depth + 1);
    }
    if (array && Object.keys(item).length !== item.length) fail();
    active.delete(item);
  };
  try { visit(value, 0); } catch (error) { if (error instanceof CauseRecordingError) throw error; fail(); }
}

/** Project actual own logs only. No guessed mount names, synthetic commits, scores or post-hoc dependency traversal. */
export function recordedCauseScopes(nativeSnapshot: unknown, capture?: unknown): RecordedCauseSource {
  admit(nativeSnapshot); if (capture !== undefined) admit(capture);
  if (!object(nativeSnapshot) || typeof nativeSnapshot.runId !== 'string' || !nativeSnapshot.runId || !Array.isArray(nativeSnapshot.commitLog)) fail();
  const captured = object(capture) && capture.version === 1 && capture.ruleVersion === 'recorded-facts-v1'
    && capture.runId === nativeSnapshot.runId && typeof capture.complete === 'boolean'
    && object(capture.controlDeps) && object(capture.attention) && Array.isArray(capture.facts) ? capture as unknown as CauseCapture : undefined;
  if (captured) {
    if (captured.facts.length > 1024 || Object.keys(captured.attention).length > 512 || Object.keys(captured.controlDeps).length > 512) fail('CAUSE_RECORD_LIMIT');
    const facts = new Map(captured.facts.map((fact, index) => {
      if (!object(fact) || fact.id !== `capture:${index}` || typeof fact.runtimeStageId !== 'string' || typeof fact.kind !== 'string') fail();
      return [fact.id, fact] as const;
    }));
    const reasons: Record<string, string> = { error: 'ERROR_RECORDED', 'unknown-effect': 'UNKNOWN_EFFECT_RECORDED', 'gave-up': 'RETRY_STOP_RECORDED', timeout: 'TIMEOUT_RECORDED', retried: 'RETRY_RECORDED' };
    for (const [runtimeId, values] of Object.entries(captured.attention)) {
      if (!Array.isArray(values) || values.length > 32) fail();
      for (const mark of values) {
        if (!object(mark) || typeof mark.kind !== 'string' || !Object.hasOwn(reasons, mark.kind) || mark.reason !== reasons[mark.kind] || !Array.isArray(mark.evidence) || !mark.evidence.length || mark.evidence.length > 16) fail();
        for (const reference of mark.evidence) { const fact = facts.get(reference); if (!fact || fact.kind !== mark.kind || fact.runtimeStageId !== runtimeId) fail(); }
      }
    }
  }
  const scopes: RecordScope[] = []; let incomplete = !captured?.complete;
  const mounted = object(nativeSnapshot.subflowResults) ? nativeSnapshot.subflowResults : {};
  const queue: Array<{ address: LogAddress; log: unknown[]; tree: unknown }> = [{ address: { logRunId: nativeSnapshot.runId, drillPath: [] }, log: nativeSnapshot.commitLog, tree: nativeSnapshot.executionTree }];
  const addresses = new Set<string>();
  const committedStages = new Set<string>();
  while (queue.length) {
    const entry = queue.shift()!; if (scopes.length >= 16) fail('CAUSE_RECORD_LIMIT');
    const addressKey = JSON.stringify(entry.address); if (addresses.has(addressKey)) fail(); addresses.add(addressKey);
    if (entry.log.length > 256) fail('CAUSE_RECORD_LIMIT');
    const reads: Record<string, readonly string[]> = Object.create(null); let readsComplete = true;
    const nodes = new Map<string, Record<string, unknown>>(); let stageCount = 0;
    const tree = (node: unknown): void => {
      if (!object(node) || ++stageCount > 512) fail('CAUSE_RECORD_LIMIT');
      if (typeof node.runtimeStageId === 'string') nodes.set(node.runtimeStageId, node);
      if (node.children !== undefined) { if (!Array.isArray(node.children)) fail(); node.children.forEach(tree); }
      if (node.next !== undefined && node.next !== null) tree(node.next);
    };
    if (entry.tree !== undefined) tree(entry.tree); else readsComplete = false;
    const controls: Record<string, { deciderId: string }> = Object.create(null), marks: Record<string, readonly import('foottrace').Attention[]> = Object.create(null);
    const ids = new Set<string>();
    for (const bundle of entry.log) {
      if (!object(bundle) || typeof bundle.runtimeStageId !== 'string') fail();
      const runtimeId = bundle.runtimeStageId; ids.add(runtimeId); committedStages.add(runtimeId);
      const node = nodes.get(runtimeId);
      if (node && object(node.stageReads)) reads[runtimeId] = Object.keys(node.stageReads);
      else if (Array.isArray(bundle.trace) && bundle.trace.length > 0 && bundle.trace.every(row => object(row) && Array.isArray(row.readKeys)))
        reads[runtimeId] = [...new Set(bundle.trace.flatMap(row => (row as { readKeys: string[] }).readKeys))];
      else readsComplete = false;
      if (captured?.controlDeps[runtimeId]) controls[runtimeId] = captured.controlDeps[runtimeId]!;
      if (captured?.attention[runtimeId]) marks[runtimeId] = captured.attention[runtimeId]!;
      if (isExecutionKey(runtimeId) && object(mounted[runtimeId])) {
        const context = own(mounted[runtimeId], 'treeContext'), log = own(context, 'history');
        const childAddress = { logRunId: entry.address.logRunId, drillPath: [...entry.address.drillPath, runtimeId] };
        if (Array.isArray(log) && !addresses.has(JSON.stringify(childAddress)) && !queue.some(item => JSON.stringify(item.address) === JSON.stringify(childAddress)))
          queue.push({ address: childAddress, log, tree: own(context, 'stageContexts') });
        else if (!Array.isArray(log)) incomplete = true;
      }
    }
    if (!readsComplete) incomplete = true;
    scopes.push({ address: entry.address, commitLog: entry.log, ...(readsComplete ? { reads } : {}),
      ...(captured ? { controlDeps: controls, attention: marks } : {}), complete: Boolean(captured?.complete && readsComplete) });
  }
  // A factual failure with no retained commit has no selectable causal node; disclose that missing boundary.
  if (captured?.facts.some(fact => !committedStages.has(fact.runtimeStageId))) incomplete = true;
  return { scopes, incomplete };
}

/** Read-only graph service. Authentication, storage and public reference encoding remain host ports. */
export function createRecordedCauseReader(input: RecordedCauseSource, limits: CauseReaderLimits = {}) {
  admit(input); admit(limits);
  let source: RecordedCauseSource;
  try { source = structuredClone(input); } catch { fail(); }
  const bounded = (value: number | undefined, fallback: number, maximum: number) => {
    const n = value ?? fallback; if (!Number.isSafeInteger(n) || n < 1 || n > maximum) fail('CAUSE_RECORD_LIMIT'); return n;
  };
  const maxScopes = bounded(limits.maxScopes, 16, 32), maxCommits = bounded(limits.maxCommits, 256, 1024);
  const maxCatalogNodes = bounded(limits.maxCatalogNodes, 512, 2048), timeoutMs = bounded(limits.timeoutMs, 1500, 5000);
  if (!Array.isArray(source.scopes) || source.scopes.length > maxScopes || typeof source.incomplete !== 'boolean') fail();
  for (const scope of source.scopes) if (!object(scope) || !Array.isArray(scope.commitLog)) fail();
  if (source.scopes.reduce((n, scope) => n + scope.commitLog.length, 0) > maxCommits) fail('CAUSE_RECORD_LIMIT');
  const native = createRecordGraph(source.scopes, { maxScopes, maxCommits, maxFields: 50000, maxEdges: 128 });
  const graph: CauseGraph = source.incomplete ? {
    parents: native.parents.bind(native), children: native.children.bind(native), attention: native.attention.bind(native),
    roots: native.roots?.bind(native), gaps: async (node, context) => [...await native.gaps(node, context), { code: 'not-collected', evidence: [] }],
  } : native;
  const nodes: CauseCatalogNode[] = [], byId = new Map<string, CauseCatalogNode>();
  const add = (scopeIndex: number, selection: RecordNode, label: string) => {
    const address = source.scopes[scopeIndex]!.address, nodeId = native.nodeId(address, selection);
    if (byId.has(nodeId)) return;
    if (nodes.length >= maxCatalogNodes) fail('CAUSE_RECORD_LIMIT');
    const item = Object.freeze({ id: nodeId, address, selection, label, scopeIndex }); nodes.push(item); byId.set(nodeId, item);
  };
  for (const [scopeIndex, scope] of source.scopes.entries()) {
    let step = 0, write = 0;
    for (const [index, raw] of scope.commitLog.entries()) {
      if (!object(raw) || typeof raw.runtimeStageId !== 'string' || !Array.isArray(raw.trace)) fail();
      add(scopeIndex, { runtimeStageId: raw.runtimeStageId, commitIdx: index }, `Step ${++step}`);
      for (const row of raw.trace) { if (!object(row) || typeof row.path !== 'string') fail(); add(scopeIndex, { runtimeStageId: raw.runtimeStageId, commitIdx: index, key: row.path }, `Write ${++write}`); }
    }
  }
  const options = (signal?: AbortSignal): ExplainOptions => ({ maxNodes: 64, maxDepth: 16, maxEdges: 128, maxCalls: 256, timeoutMs, ...(signal ? { signal } : {}) });
  return Object.freeze({
    nodes: Object.freeze(nodes), scopes: source.scopes,
    async catalog({ signal }: { signal?: AbortSignal } = {}): Promise<Omit<AttentionListResult, 'nodes'> & { nodes: readonly CauseCatalogNode[]; marks: AttentionListResult['nodes'] }> {
      const result = await attentionList(graph, { ...options(signal), nodeIds: nodes.map(node => node.id) });
      return { ...result, marks: result.nodes, nodes: Object.freeze(nodes) };
    },
    async explain(nodeId: string, { signal }: { signal?: AbortSignal } = {}): Promise<CauseResult> {
      if (!byId.has(nodeId)) {
        // Public readers can return qualified read-only child IDs absent from the discovery catalog.
        // Let that same reader validate them against these authorized scopes; never parse its codec here.
        if (typeof nodeId !== 'string' || nodeId.length > 2048) fail('CAUSE_SELECTION_INVALID');
        const checked = await native.gaps(nodeId, { signal: signal ?? new AbortController().signal });
        if (checked.some(gap => gap.code === 'invalid-data' || gap.code === 'unavailable')) fail('CAUSE_SELECTION_INVALID');
      }
      return explain(graph, nodeId, options(signal));
    },
  });
}
