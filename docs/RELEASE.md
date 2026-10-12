# Prepared release runbook

This runbook describes the local release candidate prepared on 2026-10-12. It is not a record of npm publication. Registry checks on that date found `footprintjs@10.0.0` available and no public package metadata for these seven library names. Install the candidate through the included tarball kit until publication is separately authorized and completed.

## Version matrix

| Package | Prepared version | Required internal packages |
| --- | --- | --- |
| `@footprint/features` | 0.2.1 | none |
| `@footprint/tenancy` | 0.2.1 | Features 0.2.1 |
| `@footprint/adapters` | 0.2.1 | none |
| `@footprint/seed` | 0.2.1 | Features 0.2.1 |
| `@footprint/actions` | 0.3.2 | Features / Adapters 0.2.1 |
| `@footprint/platform` | 0.3.2 | Actions 0.3.2; Features / Tenancy / Seed / Adapters 0.2.1 |
| `smallbusiness-footprint` | 0.2.4 | Actions / Platform 0.3.2; other four packages 0.2.1 |

All packages pin `footprintjs@10.0.0`; SMB also pins `zod@4.6.5`. Use Node 24.15–24.x and pnpm 12.11.2 for source builds. Internal source dependencies use `workspace:*`; packing with pnpm must convert them to the exact versions above.

These patch versions change documentation, package metadata and build-before-pack preparation over the tested migration/evidence baseline. Receipt schema 1 and runtime source are unchanged. The migration from older 0.1 libraries remains an API and Node-runtime migration, rather than a drop-in patch upgrade.

## Local source verification

Place the canonical `footprint-blueprint` and `smallbusiness-footprint` checkouts beside one another. The SMB workspace includes itself and the sibling Blueprint packages. From SMB, verify the pinned graph and all library packages:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --config.verify-deps-before-run=false -r run typecheck
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false -r run test
pnpm --config.verify-deps-before-run=false run test
pnpm --config.verify-deps-before-run=false -r run build
pnpm --config.verify-deps-before-run=false run build
```

Recursive workspace commands exclude the root SMB package; the explicit root commands cover it. The baseline suite contains 440 Blueprint and 217 SMB tests, including boundary and privacy regressions. Use the candidate's generated validation report for the actual release verification result. Test names and typechecks are evidence of specific checks, not a blanket security certification.

Build before packing. Each publishable package has a `prepack` hook that builds its output; the preparation process also builds the dependency graph first. Inspect every tarball for its `dist`, license, README, changelog, declaration files and valid export targets. Ensure packed dependencies contain neither `workspace:` nor machine-specific paths.

Run the kit's [quickstart](QUICKSTART.md) from a clean extraction, using `npm ci --ignore-scripts`, both examples and `npm test`. Check recorded hashes and consumer installation before accepting a release candidate.

## Prepare another local kit

After installing the two sibling source workspaces, run the preparation helper from Blueprint. Use a new output directory for a new candidate:

```sh
node scripts/prepare-local-release.mjs --output /absolute/path/to/release-kit
cd /absolute/path/to/release-kit/quickstart
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The helper builds and packs all seven libraries, verifies packed dependencies and export targets, copies the examples and documentation, and records source revisions and artifact hashes. It refuses to replace an existing package tarball with different bytes under the same version. The following npm commands create the consumer lockfile and check the kit; record the source suite and clean-install results before distributing it. This process does not publish packages.

## Publication procedure for a later authorized release

Publication is a separate maintainer action. Before doing it, inspect the current registry, namespace ownership, candidate versions, repository state and generated validation report. Review and commit the release source, then publish the exact reviewed tarballs rather than rebuilding an unidentified artifact during publication.

The dependency order is:

1. Features 0.2.1.
2. Tenancy 0.2.1 and Adapters 0.2.1.
3. Seed 0.2.1.
4. Actions 0.3.2.
5. Platform 0.3.2.
6. SMB 0.2.4.

Verify registry availability and exact dependency metadata after each step before advancing to its dependents. Package metadata declares public access. An explicit publication command for one approved artifact would have the form `npm publish <reviewed-package.tgz> --access public`; no publication commands are executed by this preparation.

If a version already exists, compare it with the reviewed candidate. Do not overwrite an artifact under an existing version or silently reuse a different version's validation. A failed partial publication needs registry inspection before resuming.

After publication, verify a clean registry-only consumer install and both examples. Update release links and consumer application references to the verified artifacts, and identify the corresponding reviewed source revision in the release record.

## Application and runtime limits

The full booking app retains a pure-helper backport for Node 22.13 and the existing SchoolFootprint APIs. It is not replaced by this SDK release. Charming Cherubs' authoritative publication port owns durable compare-and-swap, version guards and transaction receipts; the local quickstart models that boundary with fixtures.

Effects are host-reported facts with explicit phases. Receipts do not prove complete database causality, authenticity, private model reasoning or a durable retry guarantee. Hosts own authentication, storage transactions, idempotency, providers, transport and recovery. This release adds no agent, model, hosting resources or deployment.
