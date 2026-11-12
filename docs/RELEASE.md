# Source candidate and release runbook

Blueprint 1.0.0 and Smallbusiness 1.0.0 adopt FootPrint 12.0.0 and Foottrace 1.15.0. Keep prior published archives intact. The workflow binds publication to the exact archive identity in `scripts/release/reviewed.json`; prior approval records remain in version control and as separately named files. A version label or passing source check alone does not establish npm publication.

| Package | Version | Exact runtime dependency declarations |
| --- | --- | --- |
| `footprint-blueprint` | 1.0.0 | `footprintjs@12.0.0`, `foottrace@1.15.0`, `ajv@8.20.0`, `ajv-formats@3.0.1` |
| `smallbusiness-footprint` | 1.0.0 | `footprint-blueprint@1.0.0`, `footprintjs@12.0.0`, `foottrace@1.15.0`, `zod@4.6.5` |

Use Node 24.15–24.x, npm 11.19.0 and pnpm 12.11.2. Each repository is its own package. For the Smallbusiness release, point its development-only pnpm override to the final `vendor/footprint-blueprint-1.0.0-release.tgz` release archive; its public manifest keeps the exact portable `1.0.0` dependency. The local archive allows consumer verification before Blueprint is published; it is not registry publication or immutable release approval. Freeze its exact source identity and integrity in the verification receipt. The packed archive must not include that development override or vendor archive.

## Verify source and build

Run these commands from each repository root, Blueprint first and then Smallbusiness:

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run typecheck
npm test
npm run build
node --test scripts/release/guards.test.mjs
```

Blueprint also runs `npm run test:release`. Smallbusiness runs its seven synthetic quickstart scenarios with `npm run quickstart:booking` and `npm run quickstart:publication`. These commands use local fixture providers; do not supply live payment, shipping, cloud or model credentials.

Diagnostics must preserve genuine native run, stage and physical attempt identity, explicit retry decisions, missing evidence and unknown side effects. Test custom non-commerce labels and alternate brands, not just one storefront. Verify that Blueprint does not import commerce or provider code, and that normal commerce runtime entries cannot reach Smallbusiness's explicit `/testing` entry.

## Source CI does not approve a release

Ordinary pull requests, main pushes and non-publishing manual runs pack the current source and run `node scripts/release/check-candidate.mjs release/package.tgz`. This checks the complete packed/source manifest, trusted package and publisher identity, a stable source version, exact portable stable dependencies, archive containment, required documentation and all declared main/type/export targets. A new source version or dependency version can pass these source checks without changing the historical immutable release approval. Local pnpm candidate preparation reuses the same archive-file validator alongside its existing identity/runtime checks; pnpm’s development-manifest normalization does not relax the complete-manifest comparison used by npm source CI. The result is a checked source candidate, not immutable release approval; the workflow artifact is named `checked-source-package`.

An explicit publication still runs the unchanged immutable archive verifier and registry preflight before uploading its artifact. The main-only publication job independently checks the same reviewed hashes, package, registry dependencies and OIDC authorization again. A changed README or metadata can pass source CI while publication remains refused until a fresh archive receives its separate exact-byte review. Source CI never updates `scripts/release/reviewed.json` or selects a new version.

## Pack source candidates

Build first. The CI verification step uses the already checked build and disables lifecycle hooks while packing:

```sh
npm pack --ignore-scripts --pack-destination release
```

The resulting files are `footprint-blueprint-1.0.0.tgz` and `smallbusiness-footprint-1.0.0.tgz`. Record SHA-256 and SHA-512 integrity, inspect public manifests and all exported runtime/type files, and compare them with the reviewed source. Do not change the historical `scripts/release/reviewed.json` to make source checks pass. A separate authorized release review records the new archive identity; source validation alone cannot approve it.

Following that separate release approval, run the built-in-only verifier for each approved archive:

```sh
node scripts/release/run.mjs archive /absolute/path/to/reviewed-package.tgz
```

The workflow checks pinned tools, frozen dependencies, source tests, build and current-source packaging on every run, and checks the exact reviewed archive hashes before any explicit publication. It does not accept an arbitrary archive just because its version matches. A source or byte change requires fresh review and validation before updating the recorded identity.

## Verify consumers before application rollout

Install or extract the exact packed archives into a fresh isolated consumer, then verify focused public imports and their TypeScript declarations. A fresh install may need registry access for pinned third-party dependencies. The diagnostic runner itself needs no network, model, cloud account or API key.

In an application consumer, pin both archives in each runtime and tooling manifest; regenerate locks and update the reviewed artifact manifest. Run the footprint artifact verifier, library boundary tests, local failure matrix, backend checkout/publication regressions and frontend checks. Keep the app-owned admin preview and `en.json` separate from library code. Confirm the production bundle excludes testing fixtures and the development preview. Preserve shared runtime identity rather than accepting a hidden duplicate Footprint installation with the same version.

## Publication is a separate action

Publish Blueprint before Smallbusiness, after independent exact-byte review and green source checks. Publication requires explicit owner authorization. The explicit GitHub workflow publication job requires the owning repository, main branch, manual dispatch and OIDC. It checks registry identity and exact dependency integrity before publishing the reviewed archive; it does not rebuild during publication.

If a version already exists, verify it is byte-identical. Never overwrite it or treat an uncertain publish result as permission to resend. After publication, verify a fresh registry-only consumer and the existing quickstart examples. A local tarball test must not be reported as npm publication, and local validation must complete before any application rollout.

Hosts retain authentication, authorization, storage transactions, durable records, retention, idempotency and provider reconciliation. A trace shape or correlation link does not prove authenticity, an upstream outage or a final payment outcome. Native unknown effects remain unknown even when a sidecar omits or contradicts them. No scheduler, model, mail sender or live fault endpoint is created by this release.
