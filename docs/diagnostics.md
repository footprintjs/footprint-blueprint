# Stored failure diagnostics

`footprint-blueprint/diagnostics` provides two pure functions and TypeScript contracts. It does not run a flow, retry a request, access storage, contact a provider, send email or invoke a model. Hosts supply a redacted recording that they stored and reloaded. Commerce scenarios and provider-specific classifiers belong to the domain package or host adapter; admin views and translations belong to the application.

```ts
import { diagnoseFailureRecording, normalizeBoundaryError } from 'footprint-blueprint/diagnostics';
import type { BoundaryErrorOptions, FailureRecording } from 'footprint-blueprint/diagnostics';

const options: BoundaryErrorOptions = {
  system: 'directory',
  operation: 'directory.lookup',
  effect: 'read',
};
const boundaryError = normalizeBoundaryError({ status: 503 }, options);
// { category: 'server', code: 'DEPENDENCY_SERVER_ERROR', httpStatus: 503, effect: 'none' }

function inspectStoredRecord(record: unknown) {
  return diagnoseFailureRecording(record);
}
```

The focused entry imports the separately pinned FootprintJS runtime for its public error classifier and timeout type. It has no Node ambient-type requirement, React, cloud SDK or AgentFootprint dependency. A DOM consumer and the public subpath are checked during tests. Models may summarize the factual report later; no model is needed to produce it.

## Normalize before a generic error hides the cause

`normalizeBoundaryError(error, options)` reads only own data properties. Getters, raw messages, headers, stacks, nested causes and arbitrary provider payloads are not copied. It returns an immutable neutral classification and code. Numeric HTTP statuses are retained; strings such as `"500"` are not interpreted as status codes.

`system` is a logical label matching `^[a-z][a-z0-9-]{0,47}$` with secret-like prefixes excluded. Existing `database`, `payment` and `shipping` labels remain valid, and another application can use `directory`, `email` or `search`. `operation` is an opaque bounded identifier. Neither label is interpolated into findings.

A trusted adapter can project an actual numeric metadata status as `options.httpStatus` and inject a synchronous `classify(fields)` callback. Its frozen input contains only bounded `name`, `code`, numeric `httpStatus`, boolean `retryable` and finite bounded retry delays. The callback may return one of `timeout`, `rate-limited`, `server`, `network`, `auth`, `permanent`, `unknown`, or `undefined` to retain the SDK result. Throwing or returning another value retains the SDK result. The core has no vendor-name list or special metadata lookup. Do not invent an HTTP status to force a classification.

```ts
const policy: BoundaryErrorOptions = {
  system: 'directory', operation: 'directory.lookup', effect: 'read',
  httpStatus: 400, // Read by the trusted adapter from its provider's actual response.
  classify: fields => fields.name === 'DirectoryThrottle' && fields.httpStatus === 400
    ? 'rate-limited' : undefined,
};
normalizeBoundaryError({ name: 'DirectoryThrottle' }, policy);
```

A category is evidence, not retry permission. Hosts still own retry predicates, idempotency keys, remaining deadlines and reconciliation. A write timeout or server error keeps `effect: 'unknown'` unless the trusted boundary explicitly reports `effect: 'none'`; the normalizer never claims that a write was applied.

## Recording contract

`FailureRecording` uses schema version 1:

- `storeId`, `runId`, `flowId`: opaque identifiers. `runId` must equal the actual native engine snapshot's run ID.
- `nativeSnapshot`: a genuine redacted FootprintJS snapshot, or `null` when unavailable.
- `boundaryEvidence`: at most 200 normalized boundary observations. Each names its actual `runtimeStageId`, an ordered unique `sequence`, outcome, category and effect. `attemptId`, when supplied, is `${attempt.series}@${attempt.attempt}` from real engine attempt context; it is not a synthetic count or an SDK `id` field.
- `diagnostics`: storage and observer outcomes, kept separate from business outcomes.

Every attempt reference is resolved to one native attempt in the same stage. A supplied retry decision must match that attempt. Duplicate references, cross-run/stage references, invented attempts, causal cycles and forward cause edges are rejected. `causedBy` supplies an explicit link; timestamp order alone does not establish causality. Inputs are limited to plain JSON, 2 MiB, 50,000 nodes, depth 48, 500 native stages and bounded arrays. Getters, custom prototypes, symbols, cycles and extra envelope/boundary fields are rejected with the stable `FAILURE_RECORD_INVALID` code.

The host owns admission to its storage namespace, durable writes, redaction and retention. This module validates structural bindings; it does not authenticate imported evidence or prove that a provider caused an outage.

## Deterministic findings and limits

`diagnoseFailureRecording(record)` returns a deeply immutable `FailureDiagnosis` with `status`, `summary`, `causes`, `consequences`, `diagnosticFailures`, `recommendations`, `unknowns`, `evidenceRefs` and explicit `coverage`.

Findings contain neutral codes, bounded factual text and JSON pointer references such as `native#/executionTree/attempts/0` and `boundaryEvidence#/0`. Authentication and authorization evidence uses `AUTH_REJECTION_RECORDED` regardless of domain. Arbitrary target names, operations, raw errors and private codes never enter report text.

A failure followed by a real successful final attempt in the same physical series establishes recovery. Engine-authored logical retry links can establish recovery across distinct physical calls without conflating them. Missing or truncated records are disclosed; missing attempts never mean zero attempts. Unknown external effects, unresolved retry series or missing boundary bindings keep the operation uncertain. An unrelated stage with no attempt records remains a coverage warning and does not erase a fully bound boundary observation.

Persistence and observer failures appear separately and cannot reverse an acknowledged business result. A circuit-open finding establishes only that an adapter recorded blocking. An error class does not prove provider downtime. Physical upstream cause and imported-record authenticity remain explicitly unknown. These distinctions let a host show safe customer messages and give an optional low-cost investigator factual evidence without allowing it to invent a cause.
