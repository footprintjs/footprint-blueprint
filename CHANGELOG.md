# Changelog

## Prepared release: Actions / Platform 0.3.2; other packages 0.2.1

Prepared on 2026-10-12. These packages are local release candidates and have not been published to npm.

- Consolidated the tested FootPrint.js 10 migration and shared execution-evidence implementation into the canonical `footprintjs/footprint-blueprint` checkout.
- Added repository, issue, public-access and package-file metadata, plus a build-before-pack hook.
- Added release, consolidation and quickstart documentation and per-package changelogs.
- Added a tarball-based quickstart with reduced examples derived from the booking app and Charming Cherubs publication boundary.

Runtime source is unchanged from the tested local Actions / Platform 0.3.1 and Features / Tenancy / Seed / Adapters 0.2.0 baseline. The patch versions identify the new package metadata and documentation; they do not change receipt schema 1.

## Shared evidence baseline: Actions / Platform 0.3.1

- Added immutable, bounded `ExecutionEvidence` receipts and the pure `@footprint/actions/evidence` collector and validator.
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
