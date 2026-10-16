> Historical record of the former standalone `@footprint/seed` package. Its versions and import paths below describe that earlier packaging. The current candidate ships this module inside `footprint-blueprint@0.4.0`; see [the current changelog](../../CHANGELOG.md).

# Changelog

## 0.2.1 — prepared release

- Added public publication and repository metadata, changelog packaging and a build-before-pack hook.
- Runtime source is unchanged from the tested local 0.2.0 migration baseline: profile seed plans and explicit host-owned application of seed data, stopping on failure by default.

The package is a local release candidate, not a published npm release. It depends on Features 0.2.1 and requires Node 24.15–24.x. Seed execution does not create an application publication transaction.
