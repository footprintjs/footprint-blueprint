## Unreleased

- Add optional deterministic `formatFailureExplanation()` and `createFailureExplanation()` APIs on the diagnostics entry: Problem, Recorded cause and Suggested next step with bounded static templates.
- Preserve canonical observations, evidence references and unknowns independently of supplementary configured wording. Ambiguous matches use defaults; unknown external effects retain reconciliation guidance and withhold configured advice. Templates execute no action and establish no new causal authority.

# 1.0.0 — 2026-11-12

- Migration: require FootPrint 12.0.0 and Foottrace 1.15.0 on Node 24.15–24.x.
- Accept the engine’s current `answered` attempt decision while reading retained `succeeded` records without rewriting their evidence. Consumers handling every decision reason must include `answered`.
- Preserve native partial-write associations for Foottrace cause/impact readers; a recorded predecessor is distinct from a proven computation.
- Retain the published 0.9.0 functionality and current source checks. Missing, incomplete or failed capture stays unknown; no capture defaults, provider policy or business acknowledgement changes.
- Validate source candidates against the current source manifest, separately from exact-byte publication approval.

# 0.9.0 — expected-execution evidence

- Add the explicit, optional `footprint-blueprint/diagnostics/coverage` import for declared expected work beside genuine retained commits.
- Reuse Foottrace requirement checks and gap reasons: observation proves execution evidence only; missing steps and unknown inventories remain unresolved.
- Keep descriptions outside evidence references, validate exact run and scope bindings, bound and detach input/output, and leave native graph records unchanged.
- No model, storage provider, retry or business action is added.

Prepared 2026-10-18. Publication, registry-byte verification and application deployment are separate release steps.

## 0.7.0 — local connected-record candidate (not published)

- Add `footprint-blueprint/records/object-store`: a provider-neutral native Foottrace sink, immutable per-run objects, immediate bounded writes, cancellation on drain timeout, and a bounded read-only reader. The native record remains the source for replay, incomplete runs, gaps and unread entries.
- Add optional per-action native record-sink factories through ActionExecutor and Platform. Storage outages remain diagnostic and cannot reverse acknowledged business work.
- Retain optional adapter-reported provider request references on bound physical observations. These opaque lookup aids do not prove provider-internal execution or an outage; native attempt identities and unknown-effect rules remain authoritative.
- Preserve the published FootprintJS10.1/Foottrace1.1 asynchronous durability contract: only acknowledged objects are known stored; an unacknowledged tail stays unknown after a hard kill. Add a real SIGKILL/fresh-reader regression and browser-only public import checks.

## 0.6.0 — local provider-evidence candidate (not published)

- Add the explicit `footprint-blueprint/diagnostics/runtime` request-local native boundary collector, without changing the pure diagnostics runtime export surface.
- Bind logical SDK calls and real transport observations from public FootprintJS call/onAttempt APIs, with safe normalization, bounded frozen snapshots and explicit omitted/late/in-flight coverage.
- Extend schema-1 recordings with optional physical evidence and coverage, preserving legacy inputs. Validate genuine record kinds, identities, sources and timing before diagnosis.
- Separate logical calls from physical reports and engine-observed interpretation from SDK retry policy. Preserve unknown write effects and never infer a provider outage, guaranteed cancellation or zero sends from absent evidence.

## 0.5.0 — local diagnostics candidate (not published)

- Add the pure, typed `footprint-blueprint/diagnostics` subpath with adapter-boundary normalization and deterministic stored-record diagnosis.
- Generalize logical boundary labels without rendering arbitrary names in findings; keep provider-specific classification in trusted adapter hooks.
- Preserve schema-version-1 input, strict native run/stage/physical attempt bindings, logical retry recovery, JSON pointer evidence, unknown write effects and isolated diagnostic failures.
- Export browser-compatible contracts and neutral `AUTH_REJECTION_RECORDED` findings; no cloud, model, React or application dependency is introduced.

## 0.4.1 — 2026-10-16 (prepared; publication pending)

- Pin FootprintJS 10.1.0 and retain the reviewed host-owned execution controls.
- Read actual runtime metadata from the public installed SDK package manifest; no private version export is required.
- Validate the release kit against installed engine/record versions and portable shared dependencies before building.
- Preserve authorization, provider adapters, execution evidence and acknowledged writes.

Publication and final stable-package validation are pending.

# Changelog

## 0.8.0 — local release candidate

- Add the optional `/diagnostics/cause` host service using public Foottrace1.4 cause/impact queries, bounded discovery and honest incomplete coverage.
- Add a bounded, versioned host factual/control observer and trusted action/platform capture opt-in. Keep messages, payloads and provider-internal conclusions outside its maps.
- Pin the record runtime to Foottrace1.4.0; no npm publication or cloud deployment is implied by this candidate.

## Private engine preparation — historical, unpublished

- Prepared a private engine candidate without changing default action behavior.
- Read trace runtime version from the engine export rather than a hardcoded application value.
- Add optional host-owned deadline, signal and correlation pass-through for Actions and Platform, with a closed payload-free boundary.
- Preserve existing authorization, evidence, adapter and acknowledged-write invariants.

This historical local candidate was not an npm publication.

## 0.4.0 — prepared single-package release

Prepared on 2026-10-12. This is a local release candidate; publication is pending.

- Consolidated Features, Tenancy, Adapters, Seed, Actions and Platform into one public `footprint-blueprint` package with one version and focused import paths.
- Added `footprint-blueprint/evidence` as a direct pure collector/validator entry, with `footprint-blueprint/actions/evidence` as an alias.
- Retained the root entry as a convenience export of the complete Platform; use module subpaths for focused loading and dynamic imports for loading on demand.
- Moved module source to `src/<module>` and module guides to `docs/<module>.md`. The inherited standalone-package changelogs remain under `docs/history`.
- Prepared a two-artifact kit with optional `smallbusiness-footprint@0.3.0`, reduced booking/publication examples, source provenance and verification records.
- Kept `footprintjs@10.0.0` separate and pinned. Source builds use Node 24.15–24.x and pnpm 12.11.2.

This packaging supersedes the earlier seven-package release kit. Replace former `@footprint/<module>` imports with `footprint-blueprint/<module>` when migrating a modern consumer. Existing legacy school and booking consumers remain on their separate compatibility path. Receipt schema 1 and host-owned transaction, authorization and privacy boundaries remain unchanged.

The inherited verification suites contain 440 Blueprint tests and 217 SMB tests. The generated release record identifies the actual validation results for this candidate, including focused loader checks and clean consumer installation.

## Earlier standalone-package preparation — historical

The previous local preparation used Actions / Platform 0.3.2, Features / Tenancy / Seed / Adapters 0.2.1, and SMB 0.2.4. That kit and its source commits remain historical references. See [module changelog history](docs/history/) for those package-specific versions.

## Shared evidence baseline: Actions / Platform 0.3.1

- Added immutable, bounded `ExecutionEvidence` receipts and the pure `@footprint/actions/evidence` collector (the historical import path) and validator.
- Added the optional handler `EvidenceReporter`, trusted projection callbacks and explicit observations, effect phases, run links and capture limitations.
- Preserved native FootPrint recordings alongside portable receipts. Capture failures cannot reverse an acknowledged operation.
- Contained rejected native promises returned accidentally by synchronous capture callbacks, including promises from another JavaScript realm.

## FootPrint.js 10 migration baseline: 0.2

- Pinned `footprintjs@10.0.0` and adopted ESM, Node 24.15–24.x, TypeScript 7 and pnpm 12.11.2.
- Required full tenant/campus/unit profile scope and monotonic binding revisions.
- Added immutable definitions, bounded derived configuration caches, dependency validation and strict action schemas.
- Required explicit trusted authorization and configured implementations for discovery and execution.
- Ran action authorization, validation, execution and acknowledgement through actual FootPrint stages.

This baseline changes the older 0.1 APIs. The school workspace remains on its separate compatibility path; the pure evidence helper is backported there without replacing SchoolFootprint's framework APIs.
