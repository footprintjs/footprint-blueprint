# Optional provider-boundary recording

`footprint-blueprint/diagnostics/runtime` adds a request-local collector for hosts that already execute real FootprintJS stages. It does not start a flow, retry a provider, persist a record or call a model. The existing `footprint-blueprint/diagnostics` subpath still exports only the two pure normalization and diagnosis functions.

```ts
import { createBoundaryRecorder } from 'footprint-blueprint/diagnostics/runtime';

const boundaries = createBoundaryRecorder(); // One instance per executor run.
executor.setRedactionPolicy({ keys: ['idempotencyKey', 'authorization', 'token'] });
executor.attachFlowRecorder(boundaries.flowRecorder); // Attach before running.

// Inside a genuine active stage. Keep the scope and live context out of serialized state.
const result = await boundaries.run(scope, {
  system: 'directory', target: 'directory.lookup', operation: 'lookup',
  effect: 'read', timeoutMs: 2_000,
}, async context => {
  // A host adapter passes context.signal and caps its own timeout by context.timeLeftMs().
  // It observes each actual SDK transport attempt at that transport boundary.
  return directoryAdapter.lookup({ signal: context.signal });
});
```

`run()` delegates to the active scope's public `call` or `$call` once, with `attempts: 1`. It adds no application retry loop. The native call owns its real deadline, timeout, cancellation and unknown-write protection. A trusted host can supply an existing durable provider `idempotencyKey` for a write; the collector never invents one or retains it in its own sidecar. The executor owner **must redact `idempotencyKey` in native diagnostics**, since the live native context must hand the real key to the provider. A diagnostic key does not establish provider idempotency support.

The optional `normalizeError` hook supplies provider-specific classification. It must return the existing neutral `NormalizedBoundaryError` projection. A broken hook is reported as a diagnostic failure and cannot replace an acknowledged result. Logical and physical errors are normalized before raw messages, causes, headers or bodies enter this collector's stored projection. An original completed provider error is rethrown to preserve existing business behavior, including atomic-conflict handling: **the host must catch/map private provider errors before they escape the parent stage**. Restoration is limited to the exact private error represented by the native call's safe projection (or the native unknown-effect wrapper of that exact projection). The genuine native effect record is never rewritten. An ambiguous completed write error remains unknown in the record and must still use the application's existing reconciliation policy; preserving its class is not permission to retry it. A native timeout/abort while the provider is unresolved remains the native guard. The collector cannot sanitize arbitrary code outside its call. Native cancellation forwards the native signal's own reason so the engine can retain true cancellation identity; cancellation reasons are trusted host controls and must not contain customer/provider data.

## Physical observations

The callback receives `BoundaryCallContext`: `attempt`, `signal`, optional `deadline` and `timeoutMs`, `timeLeftMs()` and `observePhysical(report)`. The live context is not serializable and must not be cached on a shared client. A host may use its own async context facility to resolve the active request and scope; the library imports no Node async context or cloud SDK.

Each physical report states only:

```ts
context.observePhysical({
  source: 'sdk-http', outcome: 'failed', startedAt, durationMs,
  attempt: actualObservedIndex, // Omit if the adapter cannot establish this index.
  // of: configuredMaximum,    // Include only when the SDK actually declares it.
  httpStatus: actualNumericStatus,
  error: originalError,        // Immediately projected; never retained raw.
  timeoutMs: actualTimeoutCap,
  timeLeftMs: actualRemainingBudget,
  phase: 'response-complete',  // Or 'headers' / 'dispatch', matching what was timed.
});
```

Report one observation per actual transport attempt. A dispatch is not proof that bytes reached the provider. A response that only reached headers is not a completed body. A successful transport response is not proof of a committed business action. Do not fabricate calls from an aggregate SDK attempt counter or treat one SDK call as one physical send. A provider SDK can retry internally even when its general retry option is zero. Report those attempts at its actual transport boundary or leave the coverage unknown.

The collector delegates each observation to genuine `AttemptContext.observed()`. It obtains the resulting series/attempt ID from the real synchronous `FlowRecorder.onAttempt` event; it does not predict IDs. Unknown SDK maxima stay absent. Native observed records without `of` retain the engine's count-unknown semantics; the separate physical sidecar identifies what the host actually observed. Native observed `next`/`reason` is the engine's interpretation, **not the SDK's retry decision**. The diagnoser never treats it as proof of SDK exhaustion.

When an adapter knows that it cannot faithfully observe a dispatch, call `context.markIncomplete('multiple-dispatches' | 'response-unconsumed' | 'observation-unavailable')`. For example, an SDK redirect can dispatch twice inside one middleware boundary, or a streaming body can remain unconsumed after headers arrive. This increments `coverage.omittedObservations`, an omission-notice count rather than a guessed missing-attempt count, and marks collection incomplete. It creates no native attempt and does not increment physical observation counts. One valid observed try followed by an explicit gap still diagnoses unknown. Earlier coverage records without this optional field remain readable.

`physicalEvidence.parentAttemptId` is the adapter's association with its live logical call, validated against genuine same-stage/same-target native records. FootprintJS 10.1.0 observed records contain no independent parent-call field. This association remains a host assertion; imported evidence is not authenticated by this library. Parallel calls are kept separate through their live bound contexts rather than inferred retry ordinals.

## Snapshot and storage

After the executor ends, `snapshot()` returns detached deeply frozen JSON:

- `boundaryEvidence`: logical calls plus native physical observations, each with a real native attempt reference;
- `physicalEvidence`: distinguishes physical observations and their logical parent, timing scope and reported maxima;
- `coverage`: counts reported logical invocations and transport observations, in-flight work, dropped/unbound events and late reports;
- `diagnostics`: observer status only. Persistence status belongs to the host.

Do not sum logical call rows and physical rows as separate sends. A logical call with no physical reports establishes neither zero physical sends nor a known retry count. The diagnoser reports physical counts separately and keeps SDK retry decisions unknown. A successful native touching call owns its acknowledged effect; its physical observations do not assert additional business effects. An unknown native write remains unknown after a later successful physical response or reconciliation read. An earlier ambiguous or partial write observation is not cleared by a final rejected try's no-effect assertion; the logical failure still records unknown. Absence of a transport report never establishes no-effect: a no-effect declaration requires explicit trusted adapter evidence about the operation. Resolve uncertainty through the business workflow's authoritative receipt, not by rewriting a diagnostic row.

Assemble the optional, backward-compatible schema-1 extension using the **same genuine redacted snapshot**, then store it through the host's existing private storage adapter:

```ts
const sidecar = boundaries.snapshot();
const nativeSnapshot = executor.getSnapshot({ redact: true });
const recording = {
  schemaVersion: 1, storeId, flowId, runId: nativeSnapshot.runId, nativeSnapshot,
  boundaryEvidence: sidecar.boundaryEvidence,
  physicalEvidence: sidecar.physicalEvidence,
  coverage: sidecar.coverage,
  diagnostics: { persistence: 'stored', ...sidecar.diagnostics },
};
// Claim 'stored' only after storage acknowledged this exact recording.
```

The default shared row limit is 200, configurable downwards with `maxEvents`. Caps remove dangling parent links and expose omissions. If a native timer stops waiting while the SDK still runs, `inFlightCalls` remains visible. Late callbacks cannot append to an earlier frozen stored snapshot, and a later snapshot reports dropped late observations. The host must not infer a clean cancellation or no external effect from missing late results. This is end-of-run evidence collection, not a crash-safe journal: a killed process can still lose unsaved records. Trace storage itself should stay outside the completed provider flow to avoid recursive incident recording.

Legacy schema-1 recordings without either new field remain valid. Stored extensions validate genuine observed/call kinds, stage and target, source, clock and optional maximum bindings before diagnosis. Neither a model nor a scenario name is involved in finding the recorded category or distinguishing logical calls from transport reports.
