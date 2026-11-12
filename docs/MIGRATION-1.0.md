# Migration to 1.0.0

This is an unreleased source candidate. Source verification and publication approval are separate: the immutable approval record is unchanged and cannot publish these bytes.

## Runtime requirements

Use Node 24.15–24.x with exactly FootPrint 12.0.0 and Foottrace 1.15.0. Rebuild consumers and handle the current native `answered` attempt decision. Blueprint still reads saved `succeeded` decisions as their original stored label; it does not relabel them or infer stronger evidence.

## Evidence boundaries

Native commit records pass to Foottrace’s shared cause graph, including partial-write predecessors. These links show recorded writes and reads, not which JavaScript expression computed a value. A retained initial value with no recorded writer does not gain an invented source. Missing or incomplete capture remains unknown. A completed boundary call does not prove a provider’s internal root cause, physical retry count, cancellation or durable storage.

Rich `getSnapshot()` recordings are consumed through their actual native contracts. This migration does not claim every snapshot tree is an array or accept a minimal execution chain as a complete diagnostic recording. Existing recording defaults, redaction, optional capture and authoritative business acknowledgements are unchanged. Saved failed-run closure admission is a separate capability; a failed snapshot alone is not complete evidence.

## Public decision type

`AttemptDecision.reason` adds `answered`. Update exhaustive switches before adopting this major version. Both native attempt rows and the diagnostic sidecar must carry an admitted reason; arbitrary provider-defined strings are refused. Existing focused subpaths remain available.
