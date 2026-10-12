# Consolidated release sources

The canonical release-preparation checkouts are:

| Repository | Local checkout | Preparation branch | Starting remote HEAD |
| --- | --- | --- | --- |
| `footprintjs/footprint-blueprint` | `/Users/sanjay/github/footprintjs/footprint-blueprint` | `codex/prepare-evidence-release` | `49b4d1a989555e7795ca26bd963d36362e1107d5` |
| `footprintjs/smallbusiness-footprint` | `/Users/sanjay/github/footprintjs/smallbusiness-footprint` | `codex/prepare-evidence-release` | `4b1c5d7dfe3026b77cbbb3a0409b721a7431f8a1` |

The tested source came from the earlier `reuse-reviews` staging checkouts. Those copies remain archived references, rather than the destination for ongoing library release work. This preparation does not publish packages or update remote branches.

## Compatibility workspace

The school workspace under `/Users/sanjay/vs-code-workspaces/school-scheduling` is separate. Its `sis-platform` workspace links its older Blueprint and SchoolFootprint APIs. The booking app uses the exact pure evidence helper backported to Actions 0.1.2, while preserving Node 22.13 compatibility and the existing SchoolFootprint contracts.

The canonical Actions / Platform 0.3.2 SDK uses Node 24.15–24.x and the newer scoped profile-store and authorization APIs. Replacing all school packages with this release would be a separate migration. Existing school work, recordings and unrelated application changes are retained.

## Application references

Charming Cherubs currently uses verified local Blueprint and SMB tarballs. Its publication action reports explicit shared evidence around the authoritative application publisher, and its inner workflow retains its redacted v3 trace projection. Replacing those application tarballs with the prepared release is an explicit consumer update; old artifacts remain identifiable by their versions and hashes.

The release-kit quickstart consists of reduced examples derived from the booking and publication patterns. It does not claim to package the complete production applications. The separate conference demo kit supplies the fuller local workflow demonstration and Charming source audit.

## Provenance checks

The release kit records package versions, source provenance, tarball hashes and validation results. Compare those records before installing an artifact. Workspace dependencies are expected in source manifests; packed package manifests must contain exact package versions and no unresolved `workspace:` references.

pnpm 12 lockfiles here contain an environment YAML document followed by the project dependency document. Inspect the full file and verify with a clean frozen installation; the first document alone is not the application's dependency graph.
