import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createEvidenceCollector, EXECUTION_EVIDENCE_LIMITATIONS, validateExecutionEvidence } from "../../evidence.js";
import type { EvidenceCollectorOptions, EvidenceEffectPhase, ExecutionEvidence, JsonValue } from "../../evidence.js";

const identity = { runId: "run-1", actionId: "booking.create", outcome: { status: "succeeded" as const } };
const pass = (_kind: unknown, value: unknown): JsonValue => value as JsonValue;
function receipt(): ExecutionEvidence {
  return createEvidenceCollector().finalize(identity)!;
}
function imported(value: unknown): boolean { return validateExecutionEvidence(value).valid; }

describe("execution evidence defaults and trusted projection", () => {
  it("stores opaque metadata and omits all request and provider values by default", () => {
    const collector = createEvidenceCollector();
    const secret = { email: "private@example.com", accessToken: "not-for-a-receipt" };
    expect(collector.observe({ kind: "database", operation: "booking.lookup", recordIds: ["booking-7"], parameters: secret, data: secret })).toBe(true);
    expect(collector.effect({ kind: "database", operation: "booking.insert", phase: "applied", count: 1, data: secret })).toBe(true);
    const evidence = collector.finalize({ ...identity, actorId: "actor-1", request: secret, nativeRecording: true })!;
    expect(evidence.observations).toEqual([{ kind: "database", operation: "booking.lookup", recordIds: ["booking-7"] }]);
    expect(evidence.effects).toEqual([{ kind: "database", operation: "booking.insert", phase: "applied", count: 1 }]);
    expect(evidence).not.toHaveProperty("request");
    expect(JSON.stringify(evidence)).not.toContain("private@example.com");
    expect(evidence.coverage).toEqual({ nativeRecording: "provided", observations: "captured", effects: "captured", droppedEntries: 0, values: "metadata-only" });
  });

  it("takes only the host-projected payload and detaches it before callers can change it", () => {
    const safe = { number: 7, nested: { state: "held" } };
    const collector = createEvidenceCollector({ project(kind, value) {
      if (kind === "request") return { resourceId: "teacher-1" };
      const source = value as { data: typeof safe };
      return { data: source.data };
    } });
    expect(collector.observe({ kind: "database", operation: "lookup", data: safe, parameters: { secret: "never" } })).toBe(true);
    safe.number = 8; safe.nested.state = "changed";
    const evidence = collector.finalize({ ...identity, request: { password: "never" } })!;
    expect(evidence.request).toEqual({ resourceId: "teacher-1" });
    expect(evidence.observations[0]!.data).toEqual({ number: 7, nested: { state: "held" } });
    expect(evidence.observations[0]).not.toHaveProperty("parameters");
    expect(evidence.coverage.values).toBe("host-projected");
    expect(JSON.stringify(evidence)).not.toContain("never");
  });

  it("reports projection failures without leaking the thrown error or changing success", () => {
    const collector = createEvidenceCollector({ project() { throw new Error("secret provider credential"); } });
    expect(collector.effect({ kind: "provider", operation: "payment.capture", phase: "acknowledged", data: { acknowledged: true } })).toBe(false);
    const evidence = collector.finalize({ ...identity, request: { secret: true } })!;
    expect(evidence.outcome.status).toBe("succeeded");
    expect(evidence.effects).toEqual([]);
    expect(evidence.coverage.droppedEntries).toBe(2);
    expect(collector.report()).toEqual({ droppedEntries: 2, reasons: { invalidInput: 0, projectionFailed: 2, budgetExceeded: 0 } });
    expect(JSON.stringify([evidence, collector.report()])).not.toContain("credential");
  });

  it("rejects mistyped async projections and consumes their rejection without affecting the outcome", async () => {
    const project = (async () => { throw new Error("private asynchronous failure"); }) as unknown as EvidenceCollectorOptions["project"];
    const collector = createEvidenceCollector({ project });
    expect(collector.observe({ kind: "database", operation: "lookup", data: { value: 1 } })).toBe(false);
    const evidence = collector.finalize({ ...identity, request: { value: 1 } })!;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(evidence.outcome.status).toBe("succeeded");
    expect(evidence.coverage.droppedEntries).toBe(2);
    expect(collector.report().reasons.projectionFailed).toBe(2);
    expect(JSON.stringify(evidence)).not.toContain("asynchronous failure");
  });

  it("consumes a rejected native Promise from another realm while preserving the action outcome", async () => {
    const project = (() => runInNewContext('Promise.reject(new Error("foreign private failure"))')) as EvidenceCollectorOptions["project"];
    const collector = createEvidenceCollector({ project });
    expect(collector.observe({ kind: "database", operation: "lookup", data: { value: 1 } })).toBe(false);
    const evidence = collector.finalize({ ...identity, request: { value: 1 } })!;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(evidence.outcome.status).toBe("succeeded");
    expect(evidence.coverage.droppedEntries).toBe(2);
    expect(collector.report().reasons.projectionFailed).toBe(2);
    expect(JSON.stringify(evidence)).not.toContain("foreign private failure");
  });

  it("rejects ordinary thenables without reading their then getter or invoking a then method", () => {
    let reads = 0;
    const thenable = Object.defineProperty({}, "then", { enumerable: true, get() { reads++; throw new Error("must not read"); } });
    const getterCollector = createEvidenceCollector({ project: () => thenable as JsonValue });
    expect(getterCollector.observe({ kind: "database", operation: "lookup", data: {} })).toBe(false);
    expect(getterCollector.finalize({ ...identity, request: {} })!.coverage.droppedEntries).toBe(2);
    expect(reads).toBe(0);
    const methodCollector = createEvidenceCollector({ project: (() => ({ then() { reads++; } })) as unknown as EvidenceCollectorOptions["project"] });
    expect(methodCollector.observe({ kind: "database", operation: "lookup", data: {} })).toBe(false);
    expect(methodCollector.finalize({ ...identity, request: {} })!.coverage.droppedEntries).toBe(2);
    expect(reads).toBe(0);
  });

  it("never invokes capture input getters, even on omitted fields", () => {
    let calls = 0;
    const input = Object.defineProperty({ kind: "database", operation: "lookup" }, "data", { enumerable: true, get() { calls++; return "secret"; } });
    const collector = createEvidenceCollector();
    expect(collector.observe(input)).toBe(false);
    expect(calls).toBe(0);
    expect(collector.finalize(identity)!.coverage.droppedEntries).toBe(1);
  });

  it("allows intentional omission without reporting it as a dropped entry", () => {
    const collector = createEvidenceCollector({ project: () => undefined });
    collector.observe({ kind: "database", operation: "lookup", data: { secret: true } });
    const evidence = collector.finalize({ ...identity, request: { secret: true } })!;
    expect(evidence.coverage.values).toBe("metadata-only");
    expect(evidence.coverage.droppedEntries).toBe(0);
  });

  it("omits invalid optional identities while preserving a truthful base outcome", () => {
    const collector = createEvidenceCollector();
    const evidence = collector.finalize({ ...identity, actorId: "person@example.com", engineRunId: "run\n2", scope: { unitId: "school@example.com" } })!;
    expect(evidence).not.toHaveProperty("actorId");
    expect(evidence).not.toHaveProperty("engineRunId");
    expect(evidence).not.toHaveProperty("scope");
    expect(evidence.outcome.status).toBe("succeeded");
    expect(evidence.coverage.droppedEntries).toBe(3);
    expect(createEvidenceCollector().finalize({ ...identity, runId: "" })).toBeUndefined();
  });

  it("does not infer observed facts, write phases or native recording availability from success", () => {
    const evidence = receipt();
    expect(evidence.observations).toEqual([]);
    expect(evidence.effects).toEqual([]);
    expect(evidence.coverage).toEqual({ nativeRecording: "not-provided", observations: "not-recorded", effects: "not-recorded", droppedEntries: 0, values: "metadata-only" });
    expect(evidence.limitations).toEqual(EXECUTION_EVIDENCE_LIMITATIONS);
  });
});

describe("bounds, lifecycle and explicit effect phases", () => {
  it("caps observations, effects and links and records omissions", () => {
    const collector = createEvidenceCollector({ maxObservations: 1, maxEffects: 1, maxLinks: 1 });
    expect(collector.observe({ kind: "database", operation: "lookup" })).toBe(true);
    expect(collector.observe({ kind: "database", operation: "lookup" })).toBe(false);
    expect(collector.effect({ kind: "database", operation: "insert", phase: "prepared" })).toBe(true);
    expect(collector.effect({ kind: "database", operation: "insert", phase: "committed" })).toBe(false);
    expect(collector.link({ relation: "calls", runId: "run-2" })).toBe(true);
    expect(collector.link({ relation: "related", runId: "run-3" })).toBe(false);
    const evidence = collector.finalize(identity)!;
    expect(evidence.coverage.droppedEntries).toBe(3);
    expect(collector.report().reasons.budgetExceeded).toBe(3);
  });

  it("keeps complete receipts inside the byte limit, including request and header overhead", () => {
    const collector = createEvidenceCollector({ maxBytes: 8192, project: pass });
    for (let i = 0; i < 64; i++) collector.observe({ kind: "database", operation: "lookup", data: { text: "x".repeat(512) } });
    const evidence = collector.finalize({ ...identity, request: { text: "x".repeat(7000) } })!;
    expect(new TextEncoder().encode(JSON.stringify(evidence)).byteLength).toBeLessThanOrEqual(8192);
    expect(evidence.coverage.droppedEntries).toBeGreaterThan(0);
    expect(imported(evidence)).toBe(true);
  });

  it("imports bounded receipts containing more than one payload-sized set of metadata nodes", () => {
    const collector = createEvidenceCollector();
    for (let i = 0; i < 64; i++) collector.observe({ kind: "database", operation: "lookup", recordIds: Array.from({ length: 256 }, () => "x") });
    const evidence = collector.finalize(identity)!;
    expect(evidence.observations.length).toBeGreaterThan(32);
    expect(imported(evidence)).toBe(true);
  });

  it("rejects overly deep projections and unsafe count metadata without throwing", () => {
    const collector = createEvidenceCollector({ maxDataDepth: 1, project: pass });
    expect(collector.observe({ kind: "database", operation: "lookup", data: { nested: { too: "deep" } } })).toBe(false);
    expect(collector.effect({ kind: "database", operation: "insert", phase: "applied", count: -1 })).toBe(false);
    expect(collector.effect({ kind: "database", operation: "insert", phase: "applied", count: Number.POSITIVE_INFINITY })).toBe(false);
    expect(collector.finalize(identity)!.coverage.droppedEntries).toBe(3);
  });

  it.each(["prepared", "applied", "acknowledged", "committed", "rolled-back", "unknown"] as EvidenceEffectPhase[])("preserves explicit %s assertions without upgrading them", phase => {
    const collector = createEvidenceCollector();
    expect(collector.effect({ kind: "provider", operation: "write", phase, count: 0 })).toBe(true);
    expect(collector.finalize(identity)!.effects[0]!.phase).toBe(phase);
  });

  it("captures related runs and the caller-supplied native stage identity without manufacturing either", () => {
    const collector = createEvidenceCollector();
    collector.link({ relation: "triggered-by", runId: "prior-run" });
    collector.observe({ kind: "database", operation: "lookup", runtimeStageId: "nested-run/stage-3" });
    const evidence = collector.finalize({ ...identity, engineRunId: "native-run", scope: { tenantId: "tenant-1", campusId: "campus-1", unitId: "unit-1", profileType: "tutoring" } })!;
    expect(evidence.links).toEqual([{ relation: "triggered-by", runId: "prior-run" }]);
    expect(evidence.observations[0]!.runtimeStageId).toBe("nested-run/stage-3");
    expect(evidence.engineRunId).toBe("native-run");
    expect(evidence.scope!.tenantId).toBe("tenant-1");
  });

  it("freezes every output and seals successful collectors", () => {
    const collector = createEvidenceCollector({ project: pass });
    collector.observe({ kind: "database", operation: "lookup", recordIds: ["record-1"], data: { items: [{ n: 1 }] } });
    const evidence = collector.finalize(identity)!;
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.observations[0]!.data)).toBe(true);
    expect(Object.isFrozen(evidence.observations[0]!.recordIds)).toBe(true);
    expect(() => (evidence.observations[0]!.data as { items: { n: number }[] }).items[0]!.n = 2).toThrow();
    expect(collector.observe({ kind: "database", operation: "late" })).toBe(false);
    expect(collector.finalize({ ...identity, runId: "another-run" })).toBe(evidence);
    expect(collector.report().droppedEntries).toBe(evidence.coverage.droppedEntries);
  });
});

describe("strict receipt import boundary", () => {
  it("returns detached immutable evidence and rejects legacy/unversioned evidence", () => {
    const raw = JSON.parse(JSON.stringify(receipt()));
    const result = validateExecutionEvidence(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected valid evidence");
    raw.outcome.status = "failed";
    expect(result.evidence.outcome.status).toBe("succeeded");
    expect(Object.isFrozen(result.evidence.coverage)).toBe(true);
    expect(imported({ runId: "old-run", status: "success" })).toBe(false);
  });

  it("does not invoke getters or serialization hooks", () => {
    let reads = 0;
    const getter = Object.defineProperty({ ...receipt() }, "request", { enumerable: true, get() { reads++; throw new Error("secret"); } });
    expect(imported(getter)).toBe(false);
    expect(reads).toBe(0);
    const hook = { ...receipt(), request: { toJSON() { reads++; return { secret: "bad" }; } } };
    expect(imported(hook)).toBe(false);
    expect(reads).toBe(0);
  });

  it("rejects prototype keys, accessors nested in arrays, custom prototypes and cycles", () => {
    expect(imported({ ...receipt(), request: JSON.parse('{"__proto__":{"polluted":true}}') })).toBe(false);
    expect(imported({ ...receipt(), request: JSON.parse('{"nested":{"constructor":1}}') })).toBe(false);
    expect(imported({ ...receipt(), request: new Date() })).toBe(false);
    class CustomArray extends Array<number> {}
    expect(imported({ ...receipt(), request: new CustomArray(1, 2) })).toBe(false);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(imported({ ...receipt(), request: cyclic })).toBe(false);
    let calls = 0;
    const array = Object.defineProperty([], "0", { enumerable: true, get() { calls++; return 1; } });
    expect(imported({ ...receipt(), request: array })).toBe(false);
    expect(calls).toBe(0);
  });

  it.each([NaN, Infinity, undefined, () => 1, 1n, Symbol("x"), [, "sparse"]])("rejects non-JSON values without throwing: %s", value => {
    expect(() => validateExecutionEvidence({ ...receipt(), request: value })).not.toThrow();
    expect(imported({ ...receipt(), request: value })).toBe(false);
  });

  it("rejects unknown keys, email identities, false coverage, unsupported phases and forged limitations", () => {
    expect(imported({ ...receipt(), password: "unknown-field" })).toBe(false);
    expect(imported({ ...receipt(), actorId: "person@example.com" })).toBe(false);
    expect(imported({ ...receipt(), coverage: { ...receipt().coverage, observations: "captured" } })).toBe(false);
    expect(imported({ ...receipt(), effects: [{ kind: "database", operation: "write", phase: "done" }] })).toBe(false);
    expect(imported({ ...receipt(), limitations: ["Verified full causal history"] })).toBe(false);
    expect(imported({ ...receipt(), request: { x: 1 }, coverage: { ...receipt().coverage, values: "metadata-only" } })).toBe(false);
    expect(imported({ ...receipt(), coverage: { ...receipt().coverage, values: "host-projected" } })).toBe(false);
  });

  it("rejects oversized imports and unknown stage keys without evaluating supplied values", () => {
    expect(imported({ ...receipt(), request: "x".repeat(262145), coverage: { ...receipt().coverage, values: "host-projected" } })).toBe(false);
    const collector = createEvidenceCollector();
    expect(collector.observe({ kind: "database", operation: "lookup", recordIds: ["person@example.com"] })).toBe(false);
    expect(collector.link({ relation: "calls", runId: "unsafe\nrun" })).toBe(false);
    expect(collector.link({ relation: "calls", runId: "unsafe\u202erun" })).toBe(false);
    expect(collector.finalize(identity)!.coverage.droppedEntries).toBe(3);
  });
});
