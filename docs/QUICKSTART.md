# Run a workflow and inspect its evidence

Use the prepared release kit to try two small examples derived from real applications: booking decisions and storefront publication. You need Node.js 24.15 or newer within the 24.x release line, and npm. The prepared `footprint-blueprint@0.5.0` and optional `smallbusiness-footprint@0.5.0` candidates install from the kit’s two included tarballs; npm publication is pending.

## Start

Extract the release kit. Open a terminal in the extracted directory, then run:

```sh
cd quickstart
npm ci --ignore-scripts
npm run booking
npm run publication
npm test
```

The first install downloads pinned third-party npm dependencies unless they are already cached. Both library tarballs are included locally. `footprintjs@10.1.0` remains a separate pinned npm dependency. The examples run with sample data and in-memory storage; they need no hosting account, API key or model. Each command prints JSON to standard output and writes no result files. The publication SDK prints expected failure diagnostics to standard error for the rejection scenarios; a successful assertion result and exit status 0 indicate that the example passed.

## Import only the entry you need

```js
import { defineModule } from 'footprint-blueprint/features';
import { createEvidenceCollector } from 'footprint-blueprint/evidence';
import { createPlatform } from 'footprint-blueprint/platform';

const { createActionRegistry } = await import('footprint-blueprint/actions');
```

The first two focused entries avoid loading the executor graph. Static imports load their dependency graph immediately; dynamic `import()` defers loading until executed. The root entry loads Platform and its layers. Installation downloads all ordinary package dependencies regardless of which entry you later import. SMB is optional for commerce-specific ports; its main entry is for backend execution and `smallbusiness-footprint/metadata` is the browser metadata entry.

## Booking example

The booking example uses actual FootPrint.js stages and an in-memory SQLite database, adding the pure `footprint-blueprint/evidence` collector around its host-owned workflow. It shows an accepted booking, an overlap rejection and a cancellation. Follow each result into its receipt:

- Observations describe the application checks that were actually reported.
- An `applied` effect is added only after SQLite reports the actual changed row count, before the enclosing transaction commits. The receipt does not promote that observation to a `committed` phase.
- The overlap rejection reports no booking write.
- Cancellation links to the recorded creation run when that relationship is available.

A related-run link identifies a correlation. It does not establish complete causality. Each example receipt carries its actual engine run ID and a separate application audit ID. The collector does not create an engine recording by itself.

The overlap branch completes its native workflow normally while reporting a rejected business outcome. A completed engine run is therefore not the same as an accepted booking. The reduced workflow does not implement application authentication; the full app's trusted request boundary remains separate.

The full booking app also stores its native recording and older evidence envelope, supports imported records and provides a receipt viewer. This reduced example teaches the same integration pattern without installing the full app or its SchoolFootprint workspace. The existing full booking app keeps Node 22.13 support through an exact pure-helper backport; this release-kit quickstart uses the canonical Node 24 SDK.

## Publication example

The publication example follows Charming Cherubs' application boundary: an authorized, schema-validated action invokes an authoritative publication port. It uses two actual Platform actions connected through SMB's typed publication port. A current request succeeds and reports a committed publication effect. Repeating its captured version/revision guards fails with no additional commit. A current publication version paired with an old source revision also fails, and an unauthorized caller is rejected before an inner call.

The application reports what its publication port confirms; the SDK does not infer a transaction from a successful return. Each `calls` link targets an actual recorded inner action. `committed` here describes the acknowledged in-memory port operation; it is not proof of durable database storage. The example uses local fixtures and reduced application patterns. The complete Charming Cherubs workflow and its source audit are available in the separate conference demo kit.

| Scenario in output | Shared outcome | Writes |
| --- | --- | --- |
| `booking-created` | succeeded | one applied booking insert |
| `overlap-rejected` | rejected | none |
| `booking-cancelled` | succeeded | one applied cancellation |
| `publication-committed` | succeeded | one authoritative in-memory commit |
| `exact-stale-request-failed` | failed | none |
| `stale-source-failed` | failed | none |
| `unauthorized-request-rejected` | rejected | none |

For stale publication, the action response retains the domain `PUBLICATION_CONFLICT` code while the privacy-preserving receipt uses the generic `ACTION_EXECUTION_FAILED` code. It is a failure inside execution, distinct from authorization rejection.

Charming's shared receipt is attached at its explicit `createPlatform` action boundary. `smallbusiness-footprint.executeServiceFlow` has its own native-recording result and does not automatically provide the same common receipt or effect reporting.

## Read the output

Each shared receipt uses `schemaVersion: 1` and includes a run ID, action ID, observations, effects, related runs, outcome, capture coverage and limitations. Native engine identity is optional and must come from an actual recording.

Default capture is metadata-only. Both examples leave request values, actor identity and observation/effect payloads unprojected in shared receipts. Metadata may still identify application scopes or records; it is not an anonymity guarantee. Reporting failures and dropped entries remain visible through coverage rather than changing an acknowledged business result. `validateExecutionEvidence` checks and detaches the JSON shape; it does not prove authenticity.

## Use the pattern in your app

1. Keep authentication, permission checks and storage transactions in the host application.
2. Use `createPlatform` for a registered action, or `createEvidenceCollector` for an existing host-owned workflow.
3. Report actual reads/checks and acknowledged write phases using safe identifiers and explicitly selected fields.
4. Persist the receipt beside the native recording, with the application's access controls and retention policy.
5. Inspect outcomes and limitations before deciding whether a retry or follow-up action is appropriate.

Another client can later invoke the same authenticated application boundary and read these results. Tool descriptors help describe the available actions; an agent, MCP server, transport, model or retry worker is not added by this quickstart.

See [the release runbook](RELEASE.md) for package versions and source verification, and the [Actions evidence guide](actions.md#shared-execution-evidence) for the API contract.
