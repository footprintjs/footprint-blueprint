/** Provider-neutral evidence supplied by trusted application adapters.
 * Native FootPrint recordings remain separate and must not be rewritten here.
 */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type EvidenceProjectionKind = "request" | "observation" | "effect";
export type EvidenceEffectPhase = "prepared" | "applied" | "acknowledged" | "committed" | "rolled-back" | "unknown";
export type EvidenceOutcome = { readonly status: "succeeded" | "rejected" | "failed"; readonly code?: string };
export type EvidenceScope = { readonly tenantId?: string; readonly campusId?: string; readonly unitId?: string; readonly profileType?: string };
export type EvidenceObservation = {
  readonly kind: string; readonly operation: string; readonly recordIds?: readonly string[];
  readonly parameters?: JsonValue; readonly data?: JsonValue; readonly runtimeStageId?: string;
};
export type EvidenceEffect = {
  readonly kind: string; readonly operation: string; readonly phase: EvidenceEffectPhase;
  readonly count?: number; readonly recordIds?: readonly string[]; readonly data?: JsonValue; readonly runtimeStageId?: string;
};
export type EvidenceLink = { readonly relation: "calls" | "triggered-by" | "continues" | "related"; readonly runId: string };
export type EvidenceObservationInput = Omit<EvidenceObservation, "parameters" | "data"> & { readonly parameters?: unknown; readonly data?: unknown };
export type EvidenceEffectInput = Omit<EvidenceEffect, "data"> & { readonly data?: unknown };
export type ExecutionEvidence = {
  readonly schemaVersion: 1; readonly runId: string; readonly engineRunId?: string; readonly actionId: string;
  readonly actorId?: string; readonly scope?: EvidenceScope; readonly request?: JsonValue;
  readonly observations: readonly EvidenceObservation[]; readonly effects: readonly EvidenceEffect[]; readonly links: readonly EvidenceLink[];
  readonly outcome: EvidenceOutcome;
  readonly coverage: {
    readonly nativeRecording: "provided" | "not-provided"; readonly observations: "captured" | "not-recorded";
    readonly effects: "captured" | "not-recorded"; readonly droppedEntries: number; readonly values: "host-projected" | "metadata-only";
  };
  readonly limitations: readonly string[];
};
export type EvidenceCollectorOptions = {
  /** Explicitly project only information the host permits storing. Undefined intentionally omits values. */
  readonly project?: (kind: EvidenceProjectionKind, value: unknown) => JsonValue | undefined;
  readonly maxObservations?: number; readonly maxEffects?: number; readonly maxLinks?: number;
  readonly maxDataDepth?: number; readonly maxBytes?: number;
};
export type EvidenceFinalizeInput = {
  readonly runId: string; readonly engineRunId?: string; readonly actionId: string; readonly actorId?: string;
  readonly scope?: EvidenceScope; readonly request?: unknown; readonly outcome: EvidenceOutcome; readonly nativeRecording?: boolean;
};
export type EvidenceCaptureReport = {
  readonly droppedEntries: number;
  readonly reasons: { readonly invalidInput: number; readonly projectionFailed: number; readonly budgetExceeded: number };
};
export type EvidenceCollector = {
  observe(input: EvidenceObservationInput): boolean;
  effect(input: EvidenceEffectInput): boolean;
  link(input: EvidenceLink): boolean;
  report(): EvidenceCaptureReport;
  /** Invalid required run/action identities produce no receipt; invalid optional metadata is omitted. */
  finalize(input: EvidenceFinalizeInput): ExecutionEvidence | undefined;
};
/** Handlers may report facts; only the owning executor finalizes run identity and outcome. */
export type EvidenceReporter = Pick<EvidenceCollector, "observe" | "effect" | "link" | "report">;
export type EvidenceValidationResult = { readonly valid: true; readonly evidence: ExecutionEvidence } | { readonly valid: false; readonly reason: "invalid-evidence" };

export const EXECUTION_EVIDENCE_LIMITATIONS: readonly string[] = Object.freeze([
  "Observations and effects are supplied by trusted host adapters; completeness is not inferred.",
  "Effect phases report host assertions and do not independently verify a database or provider commit.",
  "Receipts are not cryptographic proof, identity anonymization, or model reasoning.",
  "Native recordings remain separate from this receipt and are only described by its coverage.",
]);

const MAX_BYTES = 262144;
const DEFAULT_BYTES = 65536;
const RESERVED_BYTES = 4096;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const EFFECT_PHASES = new Set(["prepared", "applied", "acknowledged", "committed", "rolled-back", "unknown"]);
const RELATIONS = new Set(["calls", "triggered-by", "continues", "related"]);
const OUTCOMES = new Set(["succeeded", "rejected", "failed"]);
const encoder = new TextEncoder();
type DataObject = Record<string, unknown>;

function objectData(value: unknown): DataObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error("invalid");
  const result: DataObject = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) throw new Error("invalid");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("invalid");
    result[key] = descriptor.value;
  }
  return result;
}
function onlyKeys(object: DataObject, keys: readonly string[]): void {
  if (Object.keys(object).some(key => !keys.includes(key))) throw new Error("invalid");
}
function identity(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\p{Cc}\p{Cf}@]/u.test(value);
}
function label(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\p{Cc}\p{Cf}@]/u.test(value);
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function bytes(value: unknown): number { return encoder.encode(JSON.stringify(value)).byteLength; }
/** Walk descriptors instead of serialization hooks; reject accessors, cycles and sparse/extended arrays. */
function jsonCopy(value: unknown, maxDepth: number, maxBytes = MAX_BYTES, maxNodes = 8192): JsonValue {
  const active = new Set<object>();
  let nodes = 0;
  let estimatedBytes = 0;
  const visit = (item: unknown, depth: number): JsonValue => {
    if (++nodes > maxNodes || depth > maxDepth) throw new Error("invalid");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("invalid");
      return item;
    }
    if (typeof item === "string") {
      estimatedBytes += encoder.encode(item).byteLength;
      if (estimatedBytes > maxBytes) throw new Error("invalid");
      return item;
    }
    if (typeof item !== "object" || active.has(item)) throw new Error("invalid");
    active.add(item);
    let result: JsonValue;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) throw new Error("invalid");
      if (item.length > 8192) throw new Error("invalid");
      const ownKeys = Reflect.ownKeys(item);
      if (ownKeys.length !== item.length + 1 || !ownKeys.includes("length")) throw new Error("invalid");
      const list: JsonValue[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("invalid");
        list.push(visit(descriptor.value, depth + 1));
      }
      result = list;
    } else {
      const source = objectData(item);
      const target: Record<string, JsonValue> = {};
      for (const [key, child] of Object.entries(source)) {
        estimatedBytes += encoder.encode(key).byteLength;
        if (estimatedBytes > maxBytes) throw new Error("invalid");
        target[key] = visit(child, depth + 1);
      }
      result = target;
    }
    active.delete(item);
    return result;
  };
  const result = visit(value, 0);
  if (bytes(result) > maxBytes) throw new Error("invalid");
  return result;
}
function recordIds(value: unknown): readonly string[] {
  const copied = jsonCopy(value, 1);
  if (!Array.isArray(copied) || copied.length > 256 || !copied.every(item => identity(item))) throw new Error("invalid");
  return copied as readonly string[];
}
function validateScope(value: unknown): EvidenceScope {
  const scope = objectData(value);
  onlyKeys(scope, ["tenantId", "campusId", "unitId", "profileType"]);
  for (const item of Object.values(scope)) if (!identity(item)) throw new Error("invalid");
  return scope as EvidenceScope;
}
function validateOutcome(value: unknown): EvidenceOutcome {
  const outcome = objectData(value);
  onlyKeys(outcome, ["status", "code"]);
  if (typeof outcome.status !== "string" || !OUTCOMES.has(outcome.status) || ("code" in outcome && !identity(outcome.code, 128))) throw new Error("invalid");
  return outcome as EvidenceOutcome;
}
function observationMetadata(value: unknown): EvidenceObservation {
  const input = objectData(value);
  onlyKeys(input, ["kind", "operation", "recordIds", "parameters", "data", "runtimeStageId"]);
  if (!label(input.kind) || !label(input.operation)) throw new Error("invalid");
  const result: { kind: string; operation: string; recordIds?: readonly string[]; runtimeStageId?: string } = { kind: input.kind, operation: input.operation };
  if (input.recordIds !== undefined) result.recordIds = recordIds(input.recordIds);
  if (input.runtimeStageId !== undefined) {
    if (!identity(input.runtimeStageId)) throw new Error("invalid");
    result.runtimeStageId = input.runtimeStageId;
  }
  return result;
}
function effectMetadata(value: unknown): EvidenceEffect {
  const input = objectData(value);
  onlyKeys(input, ["kind", "operation", "phase", "count", "recordIds", "data", "runtimeStageId"]);
  const { phase, count, ...remaining } = input;
  const base = observationMetadata(remaining);
  if (typeof phase !== "string" || !EFFECT_PHASES.has(phase) || (count !== undefined && !integer(count))) throw new Error("invalid");
  return { ...base, phase: phase as EvidenceEffectPhase, ...(count !== undefined ? { count: count as number } : {}) };
}
function validateLink(value: unknown): EvidenceLink {
  const link = objectData(value);
  onlyKeys(link, ["relation", "runId"]);
  if (typeof link.relation !== "string" || !RELATIONS.has(link.relation) || !identity(link.runId)) throw new Error("invalid");
  return link as EvidenceLink;
}
/** A mistyped async host projector must not create an unhandled rejection. Thenable payloads are never invoked. */
function rejectAsyncProjection(value: unknown): void {
  let nativePromise = false;
  try {
    // The built-in checks the Promise internal brand across realms; it never reads value.then.
    Promise.prototype.then.call(value as Promise<unknown>, () => undefined, () => undefined);
    nativePromise = true;
  } catch { /* Ordinary JSON values and thenables fail the internal brand check. */ }
  if (nativePromise) throw new Error("invalid");
}
function payloadKeys(value: DataObject, keys: readonly string[], depth: number): Record<string, JsonValue> {
  const projected = objectData(value);
  onlyKeys(projected, keys);
  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(projected)) output[key] = jsonCopy(item, depth);
  return output;
}
function hasPayload(receipt: { request?: JsonValue; observations: readonly EvidenceObservation[]; effects: readonly EvidenceEffect[] }): boolean {
  return "request" in receipt || receipt.observations.some(item => "parameters" in item || "data" in item) || receipt.effects.some(item => "data" in item);
}

/** Strict import boundary. Returns a detached, deeply frozen receipt, never the supplied object. */
export function validateExecutionEvidence(value: unknown): EvidenceValidationResult {
  try {
    const copied = jsonCopy(value, 12, MAX_BYTES, 131072);
    const receipt = objectData(copied);
    onlyKeys(receipt, ["schemaVersion", "runId", "engineRunId", "actionId", "actorId", "scope", "request", "observations", "effects", "links", "outcome", "coverage", "limitations"]);
    if (receipt.schemaVersion !== 1 || !identity(receipt.runId) || !identity(receipt.actionId)) throw new Error("invalid");
    for (const key of ["engineRunId", "actorId"] as const) if (key in receipt && !identity(receipt[key])) throw new Error("invalid");
    if ("scope" in receipt) validateScope(receipt.scope);
    if ("request" in receipt) jsonCopy(receipt.request, 6);
    if (!Array.isArray(receipt.observations) || receipt.observations.length > 64 || !Array.isArray(receipt.effects) || receipt.effects.length > 64 || !Array.isArray(receipt.links) || receipt.links.length > 32) throw new Error("invalid");
    for (const entry of receipt.observations) {
      observationMetadata(entry);
      const data = objectData(entry);
      if ("parameters" in data) jsonCopy(data.parameters, 6);
      if ("data" in data) jsonCopy(data.data, 6);
    }
    for (const entry of receipt.effects) {
      effectMetadata(entry);
      const data = objectData(entry);
      if ("data" in data) jsonCopy(data.data, 6);
    }
    for (const entry of receipt.links) validateLink(entry);
    validateOutcome(receipt.outcome);
    const coverage = objectData(receipt.coverage);
    onlyKeys(coverage, ["nativeRecording", "observations", "effects", "droppedEntries", "values"]);
    if (!["provided", "not-provided"].includes(coverage.nativeRecording as string) || coverage.observations !== (receipt.observations.length ? "captured" : "not-recorded") || coverage.effects !== (receipt.effects.length ? "captured" : "not-recorded") || !integer(coverage.droppedEntries) || !["host-projected", "metadata-only"].includes(coverage.values as string)) throw new Error("invalid");
    if (!Array.isArray(receipt.limitations) || receipt.limitations.length !== EXECUTION_EVIDENCE_LIMITATIONS.length || receipt.limitations.some((item, index) => item !== EXECUTION_EVIDENCE_LIMITATIONS[index])) throw new Error("invalid");
    const evidence = copied as unknown as ExecutionEvidence;
    if (coverage.values !== (hasPayload(evidence) ? "host-projected" : "metadata-only")) throw new Error("invalid");
    return Object.freeze({ valid: true, evidence: deepFreeze(evidence) });
  } catch { return Object.freeze({ valid: false, reason: "invalid-evidence" }); }
}

/** Privacy-preserving defaults: identities and counts only; payloads need a trusted projector. */
export function createEvidenceCollector(options: EvidenceCollectorOptions = {}): EvidenceCollector {
  let configuration: DataObject;
  try { configuration = objectData(options); } catch { configuration = {}; }
  const bounded = (key: string, fallback: number, maximum: number, minimum = 0): number => {
    const value = configuration[key];
    return integer(value, maximum) && value >= minimum ? value : fallback;
  };
  const maxObservations = bounded("maxObservations", 64, 64);
  const maxEffects = bounded("maxEffects", 64, 64);
  const maxLinks = bounded("maxLinks", 32, 32);
  const maxDataDepth = bounded("maxDataDepth", 6, 6);
  const maxBytes = bounded("maxBytes", DEFAULT_BYTES, MAX_BYTES, 8192);
  const project = typeof configuration.project === "function" ? configuration.project as NonNullable<EvidenceCollectorOptions["project"]> : undefined;
  const observations: EvidenceObservation[] = [];
  const effects: EvidenceEffect[] = [];
  const links: EvidenceLink[] = [];
  const reasons = { invalidInput: 0, projectionFailed: 0, budgetExceeded: 0 };
  let capturedBytes = 0;
  let finalized: ExecutionEvidence | undefined;
  const dropped = (reason: keyof typeof reasons): false => { reasons[reason]++; return false; };
  const droppedEntries = (): number => reasons.invalidInput + reasons.projectionFailed + reasons.budgetExceeded;
  const capture = <T>(entry: T, entries: T[], limit: number): boolean => {
    if (entries.length >= limit) return dropped("budgetExceeded");
    const size = bytes(entry);
    if (capturedBytes + size > maxBytes - RESERVED_BYTES) return dropped("budgetExceeded");
    entries.push(deepFreeze(entry)); capturedBytes += size; return true;
  };
  const projected = (kind: "observation" | "effect", input: DataObject): Record<string, JsonValue> => {
    if (!project) return {};
    const source: DataObject = {};
    const keys = kind === "observation" ? ["parameters", "data"] : ["data"];
    for (const key of keys) if (key in input) source[key] = input[key];
    if (!Object.keys(source).length) return {};
    const result = project(kind, source);
    rejectAsyncProjection(result);
    if (result === undefined) return {};
    return payloadKeys(result as DataObject, keys, maxDataDepth);
  };
  return Object.freeze({
    observe(input: EvidenceObservationInput): boolean {
      if (finalized) return false;
      let metadata: EvidenceObservation; let source: DataObject;
      try { source = objectData(input); metadata = observationMetadata(input); } catch { return dropped("invalidInput"); }
      let data: Record<string, JsonValue>;
      try { data = projected("observation", source); } catch { return dropped("projectionFailed"); }
      try { return capture({ ...metadata, ...data }, observations, maxObservations); } catch { return dropped("invalidInput"); }
    },
    effect(input: EvidenceEffectInput): boolean {
      if (finalized) return false;
      let metadata: EvidenceEffect; let source: DataObject;
      try { source = objectData(input); metadata = effectMetadata(input); } catch { return dropped("invalidInput"); }
      let data: Record<string, JsonValue>;
      try { data = projected("effect", source); } catch { return dropped("projectionFailed"); }
      try { return capture({ ...metadata, ...data }, effects, maxEffects); } catch { return dropped("invalidInput"); }
    },
    link(input: EvidenceLink): boolean {
      if (finalized) return false;
      try { return capture(validateLink(input), links, maxLinks); } catch { return dropped("invalidInput"); }
    },
    report(): EvidenceCaptureReport { return deepFreeze({ droppedEntries: droppedEntries(), reasons: { ...reasons } }); },
    finalize(input: EvidenceFinalizeInput): ExecutionEvidence | undefined {
      if (finalized) return finalized;
      try {
        const source = objectData(input);
        onlyKeys(source, ["runId", "engineRunId", "actionId", "actorId", "scope", "request", "outcome", "nativeRecording"]);
        if (!identity(source.runId) || !identity(source.actionId) || (source.nativeRecording !== undefined && typeof source.nativeRecording !== "boolean")) throw new Error("invalid");
        const header: { runId: string; actionId: string; engineRunId?: string; actorId?: string; scope?: EvidenceScope; request?: JsonValue } = { runId: source.runId, actionId: source.actionId };
        for (const key of ["engineRunId", "actorId"] as const) if (source[key] !== undefined) {
          if (!identity(source[key])) { dropped("invalidInput"); continue; }
          header[key] = source[key];
        }
        if (source.scope !== undefined) {
          try { header.scope = validateScope(source.scope); } catch { dropped("invalidInput"); }
        }
        const rawOutcome = objectData(source.outcome);
        onlyKeys(rawOutcome, ["status", "code"]);
        const outcomeInput: DataObject = { status: rawOutcome.status };
        if (rawOutcome.code !== undefined) {
          if (identity(rawOutcome.code, 128)) outcomeInput.code = rawOutcome.code; else dropped("invalidInput");
        }
        const outcome = validateOutcome(outcomeInput);
        if (project && "request" in source) {
          try { const value = project("request", source.request); rejectAsyncProjection(value); if (value !== undefined) header.request = jsonCopy(value, maxDataDepth, maxBytes); }
          catch { dropped("projectionFailed"); }
        }
        const currentObservations = [...observations]; const currentEffects = [...effects]; const currentLinks = [...links];
        const assemble = (): ExecutionEvidence => ({ schemaVersion: 1, ...header, observations: currentObservations, effects: currentEffects, links: currentLinks, outcome,
          coverage: { nativeRecording: source.nativeRecording === true ? "provided" : "not-provided", observations: currentObservations.length ? "captured" : "not-recorded", effects: currentEffects.length ? "captured" : "not-recorded", droppedEntries: droppedEntries(), values: hasPayload({ ...header, observations: currentObservations, effects: currentEffects }) ? "host-projected" : "metadata-only" }, limitations: EXECUTION_EVIDENCE_LIMITATIONS });
        let receipt = assemble();
        if (bytes(receipt) > maxBytes && "request" in header) { delete header.request; dropped("budgetExceeded"); receipt = assemble(); }
        while (bytes(receipt) > maxBytes && (currentLinks.length || currentEffects.length || currentObservations.length)) {
          if (currentLinks.length) currentLinks.pop(); else if (currentEffects.length) currentEffects.pop(); else currentObservations.pop();
          dropped("budgetExceeded"); receipt = assemble();
        }
        if (bytes(receipt) > maxBytes) throw new Error("invalid");
        const valid = validateExecutionEvidence(receipt);
        if (!valid.valid) throw new Error("invalid");
        finalized = valid.evidence; return finalized;
      } catch { dropped("invalidInput"); return undefined; }
    },
  });
}
