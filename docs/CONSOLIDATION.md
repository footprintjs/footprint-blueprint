# Historical packaging consolidation

This page records the earlier 0.4/0.5 packaging preparation. Use the current [release runbook](RELEASE.md) and [migration guide](MIGRATION-1.0.md) for 1.0.0 versions, dependencies and publication instructions.

The framework consolidated six modules into one `footprint-blueprint` package with focused public entry points. The optional `smallbusiness-footprint` package adds commerce contracts and workflows. Source is organized under `src/<module>` with guides under `docs/<module>.md`; the earlier multi-artifact kit remains a historical reference.

## Consumer compatibility

Older application workspaces retained their own runtime and API contracts. Replacing those dependencies requires a separate explicit consumer migration; this consolidation does not update applications, authentication or durable storage. Reduced booking and publication examples demonstrate host-owned boundaries with local fixtures, rather than packaging complete applications.

## Artifact provenance

Release records identify source commits, package versions, archive hashes and validation results. Development-only overrides can test a real reviewed archive before publication. Public packed manifests retain portable numeric dependencies and exclude local vendor trees. Preserve old archives and compare their identities before installation.

pnpm 12 lockfiles contain an environment YAML document followed by the project dependency document. Inspect the full file and verify with a clean frozen installation; the first document alone is not the application dependency graph.
