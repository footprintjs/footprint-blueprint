# Incremental records in object storage

This adapter uses the published Foottrace 1.1 RecordSink and stored-record reader, and FootprintJS 10.1 executor sink option. It does not add a second execution record or reconstruct a native snapshot.

## Ownership and API

`footprint-blueprint/records/object-store` exports `createObjectRecordSink`, `readObjectRecord`, the injected `ObjectRecordStorage` port and bounded settings. The port supplies immutable `put`, bounded `get`, and paginated bounded `list`. A put resolves only after the storage provider acknowledges it; an in-memory queue admission is not a durable acknowledgement. The reader accepts the separate read-only `get`/`list` subset and has a total read-time cap. AWS/GCP/Azure SDKs, bucket selection, credentials, authorization, retention and tenant routing belong to the host adapter. Foottrace owns entry shapes, replay and incomplete/gap interpretation; FootprintJS owns native lifecycle, redaction, attempt notes and addresses.

Each sink belongs to one trusted store ID and application run ID. Keys are `prefix/storeId/runId/0000000000.json`. Each object has an exact versioned envelope binding those IDs, sequence and one original native entry. All root and mounted native logs are preserved. Root log identity is admitted from the genuine first root opening; mount addresses extend that root's drill path. Names are bounded safe opaque segments, never customer identifiers or secrets.

## Durability and cost

The sink starts bounded asynchronous puts immediately as entries arrive. It never waits until final flush to begin writes, never rewrites an acknowledged entry, and never writes the full snapshot per event. Two concurrent writes, finite admission/entry/byte/queue bounds and finite I/O deadlines bound work. The host may lower the defaults. No polling, model call or scheduled job is created.

An acknowledged immutable object survives termination of the writer. An in-flight or queued tail can be lost on SIGKILL. A killed Lambda's `/tmp` file is not remote durability. Native attempt notes are produced when attempts end; a killed in-progress attempt's outcome remains unknown. The current published P6 decisions remain: asynchronous writes and no retroactive scrubbing of an already stored base. Set all secret redaction rules before execution.

Default record failure mode should be `report` for checkout, so recording outages do not reverse known business results. The executor counts returned method failures; adapter admission/ack/failure counters separately report asynchronous losses. Flush drains bounded accepted work and rejects with a fixed public error code after loss. Its own deadline aborts diagnostic requests, rejects queued entries and stops future pumping; hosts must set the native flush wait longer than this adapter deadline. The explicit `cancel()` affects only diagnostic transport, never business work; it does not claim failed or pending work was stored.

One immutable object per entry is the simple initial cost model. Limits cap the maximum object operations and storage per run. Batching is deliberately absent from this first adapter because it widens the acknowledged durability window. The existing final compressed archive may remain the customer/admin viewer source.

## Read safety and honesty

A reader accepts trusted store/run configuration, never a model-supplied bucket or prefix. It limits pages, keys, bytes, entry size and read time. Any path, envelope, sequence or native-address identity mismatch fails closed. It delegates native entry validation and replay to `readStoredRecord`, retaining gaps and unread rows. Root completion means the writer emitted a covering terminal marker; it does not prove every note/commit arrived. Whole-record coverage also checks all mounted logs, native gaps, unread rows, missing sequence numbers and read limits. Missing unobserved tail entries and adapter drops remain unknown.

The diagnostic writer must use an uninstrumented cloud client or explicit tracing suppression to avoid recursive journal writes. Read-only investigator credentials require list/get only, scoped to the configured store prefix. Runtime credentials need create-only put plus read only if the host validates an identical immutable redelivery. Private encryption and short configured lifecycle retention remain deployment concerns.

## Required checks

- Real executor record round trip: success/failure, retries, mounted logs, correlation and redaction; bytes are native entries, not invented attempts.
- Kill a separate process after an object-store port has durably acknowledged a completed native attempt, while the next attempt blocks. Do not run a final flush. A fresh process reads the same acknowledged prefix, no close marker, and reports incomplete with the landed attempt. Never assert the unacknowledged tail survived.
- Losses: rejected/timed-out puts, queue/entry/run limits, malformed JSON, missing middle commit/note, truncated listing, repeated continuation token and foreign store/run/address. Retain valid native gaps/unread evidence or fail closed on identity corruption.
- Concurrency and isolation: independent runs and stores, bounded outstanding requests, immutable key retries, no traversal/prototype keys, no raw storage error or credential leakage, and zero model calls.

## Connected provider references

Optional provider request references retained by the diagnostics layer are host adapter observations. A validated namespace and opaque request ID can guide an owner or a selective read-only tool to provider support evidence. They are not provider-internal execution proof, are not authorization, and do not change the native attempt binding or unknown-effect rules. Do not record credentials, customer data or complete URLs as request references.
