# Recorded cause and impact

`footprint-blueprint/diagnostics/cause` is an optional, read-only service over the public
`foottrace/cause` readers. It does not implement another dependency walker, load cloud storage,
call a model, retry a business operation or interpret provider internals.

```ts
import { createCauseCapture, createRecordedCauseReader, recordedCauseScopes } from 'footprint-blueprint/diagnostics/cause';

// Trusted host configuration; allocate one observer per executor/run.
const capture = createCauseCapture();
executor.attachFlowRecorder(capture.recorder);
// Configure the executor with readTracking:'summary', writeTracking:'summary',
// writeProvenance:'reads-prefix'. After the actual run (including a caught failure):
const nativeSnapshot = executor.getSnapshot({ redact: true });
const causeCapture = capture.snapshot(nativeSnapshot);
// Persist these private, bounded fields together through the existing archive port.
const reader = createRecordedCauseReader(recordedCauseScopes(nativeSnapshot, causeCapture));
const catalog = await reader.catalog({ signal });
const result = await reader.explain(catalog.nodes[0]!.id, { signal });
```

The sample's `executor` and `signal` are host-owned seams. Optional diagnostic capture must
be isolated from authoritative acknowledgements. The action/platform executor offers trusted
`captureCause:true`; it is off by default and never read from action input.

The host rule `recorded-facts-v1` observes actual flow error and attempt events, delegates control
tracking to FootprintJS's public `controlDepRecorder`, and retains fixed facts only. It is not
engine C2 attention. No error message, state value, arbitrary score or outlier threshold enters
the capture. An observed transport attempt's interpreted `next`/`reason` does not prove the SDK's
retry policy. A second observed attempt supports a retry; only an actual stage retry series with
more than one declared attempt supports the logical stop mark. A physical call is not a logical
stage exhaustion. Each mark has at most16 references, each stage at most32 marks; omissions,
terminal failed runs, pause/resume boundaries and unobserved tails remain incomplete. Causes,
candidates and impact remain queryable, but an absent final failure boundary prevents a definite
root. This integration does not claim engine C2 completeness.

`recordedCauseScopes` projects actual commit logs and explicit per-execution mounted logs. It
does not guess mounts from display names. Read-only executions without retained reads remain
unknown; explicit per-write empty prefixes can prove that a particular write consumed no tracked
state. Older recordings without capture maps are accepted with conservative gaps. Interrupted
durable journals must retain their reader's gaps, unread/truncated status and unknown tail. Do
not pass empty stand-ins for missing commits as genuine rows, synthesize a RuntimeSnapshot,
or fill absent control/attention maps with `{}` to obtain complete confidence.

`createRecordedCauseReader({scopes,incomplete}, limits?)` bounds scopes (default16), total commits
(256), discovery nodes (512), and each query (64 nodes,16 depth,128 edges,256 calls,1500ms).
`catalog()` returns private native references and fixed `Step N`/`Write N` labels, plus bounded
attention and gaps. `explain(id)` returns the public Foottrace result. Partial coverage suppresses
a confirmed root; ties remain alternatives. Input is detached before querying. The host still owns
authorization, record/store identity binding and cooperative cancellation of archive reads.

All native node IDs, state-key-qualified selections and evidence references are **private**. Before
returning results to a browser/model, a host must replace them with opaque references; navigation
references must be statelessly authenticated and bound to the authorized record. Never return
the reader's private `.scopes`, `.nodes` or raw result directly to a customer. Names/references
establish recorded application dependencies, not a provider's internal root cause.

## Expected inventory and missing evidence

The optional `footprint-blueprint/diagnostics/coverage` reader describes the expected work as
well as the work visible in a record. This is a separate projection: it never changes the
cause graph, creates execution nodes, marks an unobserved step as abnormal or upgrades a root.

```ts
import { readRecordedCoverage } from 'footprint-blueprint/diagnostics/coverage';

const coverage = readRecordedCoverage({
  source: recordedCauseScopes(nativeSnapshot, causeCapture),
  findingRef: 'finding:owner-investigation',
  windowRef: 'window:authorized-record',
  declaration: {
    version: 1,
    runId: nativeSnapshot.runId,
    definitionRef: 'definition:checkout-v1',
    label: 'Checkout',
    description: 'Expected application work; observed execution does not prove payment success.',
    complete: false,
    scopes: [{
      ref: 'scope:checkout-root',
      address: { logRunId: nativeSnapshot.runId, drillPath: [] },
      steps: [{
        ref: 'requirement:payment-session',
        stageId: 'create-session',
        label: 'Create payment session',
        description: 'Ask the configured payment adapter to create a session.',
      }],
    }],
  },
});
```

The host supplies trusted, versioned declarations from the actual chart definition. The SDK's
runtime manifest lists only entered subflows, so it cannot inventory branches that were not
entered. Use the public builder/spec readers for declared work. Exact scope addresses and full
static stage IDs matter; display names, local IDs, prose rationale and array position do not
identify a stage. The reader rejects a declaration naming a different run from retained scopes.
When no scope is retained, it cannot establish that binding and leaves the inventory unknown.

`complete` describes the expected inventory only. A root-only declaration is partial when it
does not cover nested or dynamically generated work. Do not invent child addresses before a
mount executes, treat a loop back-reference as an executable stage, or treat a dynamic fan-out
template as evidence of a particular number of runtime children. A trusted description explains
the intended job; it is not evidence that this job ran.

The report starts with an inventory row and then a row per declared step. Each row carries a
shared Foottrace `RequirementResult`, admitted by `readRequirementResults`. Descriptions stay
outside that reference-only contract. A retained commit yields `observed` and a `checked-pass`
for the narrow requirement **execution is observed in this retained record**. It says nothing
about success, provider effects, full attempt history, or whether a retained execution belongs
to the current resume leg. Up to16 actual commit references support that existential check;
they are representative evidence, not an exhaustive list of executions. No attempt is invented.

If no matching commit was retained, the row is `not-observed`, with an unresolved
`not-collected` result. It has no completed execution check (`checks: []`): searching a scope without finding
proof does not make the business stage unreachable. A check is `unreachable` only when its
declaration or scope is unavailable, and describes check availability, not business reachability. An absent declared scope
is `unknown`, also unresolved with `not-collected`. Fixed `coverage:execution-not-collected`
and `coverage:scope-not-collected` detail identifiers distinguish those cases. Missing or partial
declarations yield an explicit unknown inventory row. Existing incomplete source coverage is
retained as a `not-collected` gap. No missing record becomes an empty successful record.

This version never infers skipped, not-applicable, failed or blocked from absence. A different
selected branch or an upstream error is insufficient proof by itself. In particular, the SDK's
decision display name does not prove which same-named static branch was excluded. A later
adapter may supply separately verified decision evidence through the existing requirement
contract; structural admission alone must never make that assertion authoritative.

Inputs are bounded and inert: at most16 declared scopes,256 total steps,16 mount-path entries,
120 characters per label,1024 per description, and512 per non-secret reference. Unknown fields,
duplicates, accessors, cycles, sparse arrays and invalid prototypes are rejected without keeping
their values in an error. Results are detached and frozen. Admission is atomic and uses the
shared Foottrace reason vocabulary; there is no second gap registry or claim engine.

All declarations, native references and source pointers are private. The host must authenticate
the source, check run/store/window/finding bindings and producer authority, replace references
with opaque authorized handles, and choose trusted text before presenting data to a browser or
model. Identifiers and descriptions do not detect secrets automatically. Render descriptions as
text, never HTML. A satisfied execution-observed result must not override any unresolved result
affecting the same finding. The existing claim gate remains responsible for factual claims.
Consumers must also retain the report's source gaps when evaluating complete claims: narrow
execution-observed checks do not satisfy a separate requirement for complete source evidence.
