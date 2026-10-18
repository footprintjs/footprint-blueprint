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
terminal failed10.1 runs, pause/resume boundaries and unobserved tails remain incomplete. Causes,
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
