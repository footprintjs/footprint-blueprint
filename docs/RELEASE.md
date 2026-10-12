# Prepared release runbook

This runbook describes the single-package local candidate prepared on 2026-10-12. It is not a record of npm publication. Use the included tarball kit until the names, account ownership, candidate versions and registry publication are verified. The earlier seven-artifact kit remains a historical reference and is superseded by this release.

## Version matrix

| Package | Prepared version | Runtime dependencies |
| --- | --- | --- |
| `footprint-blueprint` | 0.4.0 | `footprintjs@10.0.0`, AJV and formats |
| `smallbusiness-footprint` | 0.3.0 | `footprint-blueprint@0.4.0`, `footprintjs@10.0.0`, `zod@4.6.5` |

Blueprint contains all six framework modules and the pure Evidence entry. The commerce package is optional. `footprintjs` stays separate as the execution engine. Use Node 24.15–24.x and pnpm 12.11.2 for source builds. SMB's source dependency uses `workspace:*`; packing must replace it with exact `footprint-blueprint@0.4.0`.

This release changes the package layout and public import paths. It preserves receipt schema 1 and the migrated runtime's contracts. The move from older 0.1 libraries remains an API and Node-runtime migration; those applications are not automatically upgraded.

## Local source verification

Place the canonical `footprint-blueprint` and `smallbusiness-footprint` checkouts beside one another. Install and verify Blueprint from its repository root first:

```sh
cd /absolute/path/to/footprint-blueprint
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
pnpm test
```

Then verify the commerce repository from its own root:

```sh
cd /absolute/path/to/smallbusiness-footprint
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
pnpm test
```

SMB's workspace includes its sibling Blueprint root. These commands intentionally run each root package's scripts, rather than recursive workspace commands. The inherited suite contains 440 Blueprint and 217 SMB tests, including privacy and boundary regressions. Use the generated release validation record for actual candidate results. Also verify public exports and the runtime loader graph: Features and Evidence must not load the FootPrint executor or unrelated modules. Loading the root or Platform entry loads the complete platform graph. Test counts and typechecks are evidence of specific checks, not a security certification.

Build before packing. Both publishable packages have a `prepack` hook; preparation also builds Blueprint before SMB. Inspect tarballs for compiled code, declaration files, license, README, changelog and valid export targets. Packed dependencies must have neither unresolved `workspace:` references nor machine-specific paths.

## Prepare another local kit

After the two root installations, run the helper from Blueprint. Use a new output directory for a new candidate:

```sh
node scripts/prepare-local-release.mjs --output /absolute/path/to/release-kit
cd /absolute/path/to/release-kit/quickstart
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The helper builds and packs the two libraries, verifies packed dependencies and export targets, copies the examples and documentation, and records source revisions and artifact hashes. It refuses to replace an existing tarball with different bytes under the same version. The npm commands create the consumer lockfile and test a fresh installation. Record the source-suite, public-export, loader-graph and clean-install results before distributing the kit. This process does not publish packages.

From a clean extraction of the complete kit, follow [the quickstart](QUICKSTART.md) with `npm ci --ignore-scripts`, both examples and `npm test`. Verify recorded hashes before accepting the artifacts.

## Publication for a later authorized release

Publication is a separate maintainer action. Inspect current registry metadata, package-name ownership, authentication, versions, repository state and the candidate's validation record first. These are unscoped package names; the new design does not require an `@footprint` organization. Confirm that the maintainer can publish both names. Review and commit the release source, then publish the exact reviewed tarballs rather than rebuilding during publication.

Publish in dependency order:

1. `footprint-blueprint@0.4.0`.
2. `smallbusiness-footprint@0.3.0`.

Verify registry availability, version and exact dependency metadata after the first package before proceeding to SMB. Package metadata declares public access. An approved artifact can be published with `npm publish <reviewed-package.tgz> --access public --registry=https://registry.npmjs.org`; preparation executes no publication commands.

If a version already exists, compare it with the reviewed candidate. Do not overwrite it or substitute another version's validation. Inspect registry state before resuming a partially failed publication. After publication, verify a clean registry-only consumer installation and both examples, then update application references and the release record to those verified artifacts and source revisions.

## Application and runtime limits

The full booking app retains its pure-helper backport for Node 22.13 and existing SchoolFootprint APIs. This release does not replace that SDK. Charming Cherubs' authoritative publication port owns durable compare-and-swap, guards and transactions; the quickstart models its boundary with local fixtures. Charming's full-app inner workflow retains a redacted v3 trace projection, whereas the reduced publication example uses two actual modern Platform actions.

Effects are host-reported facts with explicit phases. Receipts do not prove complete database causality, authenticity, private model reasoning or a durable retry guarantee. Hosts own authentication, storage transactions, idempotency, providers, transport and recovery. This release adds no agent, model, hosting resources or deployment.
