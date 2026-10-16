> Historical record of the former standalone `@footprint/platform` package. Its versions and import paths below describe that earlier packaging. The current candidate ships this module inside `footprint-blueprint@0.4.0`; see [the current changelog](../../CHANGELOG.md).

# Changelog

## 0.3.2 — prepared release

- Added public publication and repository metadata, changelog packaging and a build-before-pack hook.
- Updated the release dependency matrix to Actions 0.3.2 and the four supporting packages at 0.2.1.
- Runtime source is unchanged from local 0.3.1. Retains trusted authorization, scoped profile resolution and the shared evidence API forwarded to the action executor.

The package is a local release candidate, not a published npm release. Node 24.15–24.x is required.
