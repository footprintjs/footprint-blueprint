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

## 0.4.1-gamma.1 — private coordinated engine candidate

- Pin the reviewed `footprintjs@10.1.0-gamma.1` runtime without changing default action behavior.
- Read trace runtime version from the engine export rather than a hardcoded application value.
- Add optional host-owned deadline, signal and correlation pass-through for Actions and Platform, with a closed payload-free boundary.
- Preserve existing authorization, evidence, adapter and acknowledged-write invariants.

This is a local Gamma candidate, not an npm publication.

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
