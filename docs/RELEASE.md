# Local candidate and release runbook

The current locally prepared candidates are Blueprint 0.5.0 and Smallbusiness 0.5.0. Local validation and packing do not establish npm publication or a Gamma deployment. Keep the prior published release available until the new archives have been reviewed and their consumers verified.

| Package | Candidate | Exact runtime dependencies |
| --- | --- | --- |
| `footprint-blueprint` | 0.5.0 | `footprintjs@10.1.0`, `ajv@8.20.0`, `ajv-formats@3.0.1` |
| `smallbusiness-footprint` | 0.5.0 | `footprint-blueprint@0.5.0`, `footprintjs@10.1.0`, `zod@4.6.5` |

Use Node 24.15–24.x, npm 11.19.0 and pnpm 12.11.2. Each repository is its own package. Smallbusiness's development-only pnpm override points to the reviewed `vendor/footprint-blueprint-0.5.0.tgz`; its public manifest keeps the exact numeric dependency. The packed archive must not include that development override or vendor archive.

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

## Pack the reviewed candidates

Build first. The CI verification step uses the already checked build and disables lifecycle hooks while packing:

```sh
npm pack --ignore-scripts --pack-destination release
```

The resulting files are `footprint-blueprint-0.5.0.tgz` and `smallbusiness-footprint-0.5.0.tgz`. Record SHA-256 and SHA-512 integrity, inspect public manifests and all exported runtime/type files, and compare them with the reviewed source. Store exact identities in `scripts/release/reviewed.json`. Updating review metadata does not publish a package.

For each archive, run the built-in-only verifier:

```sh
node scripts/release/run.mjs archive /absolute/path/to/reviewed-package.tgz
```

The workflow checks the pinned npm version, frozen dependencies, source tests, build and exact archive hashes. It does not accept an arbitrary archive just because its version matches. A source or byte change requires fresh review and validation before updating the recorded identity.

## Verify consumers before Gamma

Install or extract the exact packed archives into a fresh isolated consumer, then verify focused public imports and their TypeScript declarations. A fresh install may need registry access for pinned third-party dependencies. The diagnostic runner itself needs no network, model, cloud account or API key.

In Charming Cherubs, pin both archives in the root, backend, frontend and investigator manifests; regenerate locks and update the reviewed artifact manifest. Run the footprint artifact verifier, library boundary tests, local failure matrix, backend checkout/publication regressions and frontend checks. Keep the app-owned admin preview and `en.json` separate from library code. Confirm the production bundle excludes testing fixtures and the development preview. Preserve shared runtime identity rather than accepting a hidden duplicate Footprint installation with the same version.

## Publication is a separate action

Publish only when authorized, in dependency order: Blueprint 0.5.0 first, then Smallbusiness 0.5.0. The explicit GitHub workflow publication job requires the owning repository, main branch, manual dispatch and OIDC. It checks registry identity and exact dependency integrity before publishing the reviewed archive; it does not rebuild during publication.

If a version already exists, verify it is byte-identical. Never overwrite it or treat an uncertain publish result as permission to resend. After publication, verify a fresh registry-only consumer and the existing quickstart examples. A local tarball test must not be reported as npm publication, and local validation must complete before any Gamma rollout.

Hosts retain authentication, authorization, storage transactions, durable records, retention, idempotency and provider reconciliation. A trace shape or correlation link does not prove authenticity, an upstream outage or a final payment outcome. Native unknown effects remain unknown even when a sidecar omits or contradicts them. No scheduler, model, mail sender or live fault endpoint is created by this release.
