# @footprint/actions

Defines immutable action metadata and executes actions through trusted handlers or profile adapters, with real FootprintJS 10 traces.

## Execution boundary

```ts
const registry = createActionRegistry({ actions: [{
  id: 'publish-content', name: 'Publish content', description: 'Publish approved content',
  domain: 'content', category: 'workflow', requiredModules: ['editor'],
  requiredPermissions: ['content:publish'], parameters: [],
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['expectedRevision'],
    properties: { expectedRevision: { type: 'integer', minimum: 0 } },
  },
}] });
const executor = createActionExecutor(registry, bridge, {
  // Derive permissions from verified server authentication and durable policy.
  // Never infer permissions from tool input, raw headers, or user-supplied roles.
  authorizer: ({ action, context, purpose }) => trustedPolicy.can(context.userId, action.id, purpose),
  handlers: { 'publish-content': async (_id, input, context) => publication.publish(input, context) },
  traceRecorder,
  onTraceError: error => internalDiagnostics.report(error),
});
const result = await executor.execute('publish-content', { expectedRevision: 4 }, {
  tenantId: 'verified-store', unitId: 'verified-store', profileType: 'retail', userId: session.userId,
});
```

Missing authorization denies access. Only an exact `true` grants access. `requiredPermissions` is a declaration consumed by the injected policy; the library has no built-in identity provider. Hosts retain CSRF, transaction, revision, idempotency and durable authorization checks.

A registered `handlers[actionId]` takes precedence over capability routing. A capability action without an adapter cannot fall through to an unrelated per-call handler. Non-capability actions may use the trusted executor caller's handler. Use `@footprint/platform` to enforce resolved profile/module gates in addition to authorization.

`inputSchema` is a strict draft-07 JSON Schema with object input. AJV validates without coercion, defaults or removal of extra properties; formats include email/URI/date-time. Registration rejects invalid schemas. When omitted, a schema is derived from parameters with `additionalProperties:false`. Parameters support string, number, integer, boolean, object and array, with an optional `schema` for constraints/items. `validateActionInput(action,input)` is a synchronous reusable check; `ActionInputError` exposes code `ACTION_INPUT_INVALID`, status 400 and value-free issue locations.

## Discovery and exports

```ts
const discovery = {
  enabledModules: resolved.enabledModules,
  context: trustedExecutionContext,
  authorizer,
  hasImplementation: action => availableHandlerOrAdapter(action),
};
const tools = await registry.toMCPTools(discovery);
const paths = await registry.exportActions(discovery, createOpenAPIExporter());
```

Discovery requires enabled modules, an available implementation and trusted authorization for purpose `discover`. Authorization failures deny disclosure. An application must recheck execution authorization for every invocation.

`exportMetadata(enabledModules, exporter)` only formats schemas for static documentation. MCP/OpenAPI exports are descriptors; this package does not implement an MCP server, network transport, session authentication or LLM orchestration. Do not use metadata formatting as an access boundary.

Registry lookups: `getAction`, `allActions`, `forDomain`, `forModule`. Definitions and schemas are captured and deeply frozen, so later mutations of caller objects cannot change routing or validation.

## Traces and errors

Execution context is captured and deeply frozen synchronously before running the SDK. Recorder scope and `ActionTrace` use that same captured profile/tenant/campus/unit; they omit user identity and arbitrary context metadata.

Every known-action invocation creates a fresh FootprintJS 10.0.0 executor and runs `AuthorizeAction → ValidateInput → ExecuteAction → AcknowledgeAction`. `executionTrace` includes the SDK snapshot, run ID and actual stage timing. Input, context identity, provider output and original error messages stay in private closures, outside SDK state, arguments and output. Default traces show stages without storing customer payloads, and cannot replay private requests.

`traceRecorder.record` is awaited after the run. Recorder and `onTraceError` failures are nonfatal; SDK observer/snapshot failures after handler success cannot convert an acknowledged write into failure. Recorders should be bounded in latency by the host.

`ActionResult` retains provider `errorCode`, `httpStatus`, `traceRunId` and a nonenumerable original `cause`. `executionTrace` receives generic failure text. Response errors may contain the provider's original message; the HTTP transport must apply its normal public-error policy before serializing responses. Retry policy remains with the host/provider, especially after uncertain writes.

## Shared execution evidence

Introduced in the local 0.3.0 series; the prepared release is 0.3.2. Use the release-kit quickstart until the packages are published.

`ExecutionEvidence` is a version-1 immutable, provider-neutral receipt. It carries
run and optional engine identities, action, optionally projected actor/request,
observations, effect phases, links and capture coverage. It supplements the
original FootPrint recording; it does not reconstruct hidden provider work or
certify a database commit. Related runs are correlations unless the host has
observed a stronger relationship.

Every known action execution returns `result.evidence` and attaches the same
receipt to `result.executionTrace.evidence` when a native trace is available.
Unknown actions, invalid execution contexts and platform profile/module
preflight rejections can return without a receipt because no workflow began.
A missing snapshot gets a separate receipt UUID and no invented engine ID.

Request and actor values are omitted by default. `projectEvidenceRequest` and
`projectEvidenceActor` are trusted synchronous callbacks, used only after
successful authorization and input validation. `evidenceOptions.project`
chooses which request/observation/effect values may be stored. Returning
undefined omits values; malformed values and projection failures are dropped
with value-free counters. No callback is taken from action input or context
metadata.

```ts
const executor = createActionExecutor(registry, undefined, {
  authorizer: verifiedPolicy,
  evidenceOptions: { project: (_kind, value) => value as JsonValue },
  projectEvidenceRequest: input => ({ expectedRevision: input.expectedRevision }),
  handlers: {
    'publish-content': async (_id, input, context, evidence) => {
      const result = await publication.publish(input, context);
      evidence?.effect({ kind: 'content.publication', operation: 'publish-content',
        phase: 'committed', count: 1, recordIds: [result.documentId],
        data: { revision: result.revision } });
      evidence?.link({ relation: 'calls', runId: result.traceRunId });
      return result;
    },
  },
});
```

Only use `committed` when the authoritative host port confirms its transaction.
`applied`, `acknowledged`, `prepared`, `rolled-back` and `unknown` describe
other phases. Handler success alone does not create an inferred database effect.
The handler's fourth argument is a frozen `EvidenceReporter` with
`observe/effect/link/report`; it cannot finalize or replace native run identity.
Reporting and recorder/diagnostic failures never turn acknowledged success into
failure. Callbacks are synchronous; accidentally returned native promises are
omitted and their rejections contained.

For host-owned workflows, import `createEvidenceCollector` and
`validateExecutionEvidence` from `@footprint/actions/evidence`. This entry point
is pure ES2022 and does not load the executor, provider adapters or cloud SDKs.
Use `finalize` with the actual run identity and outcome. Validation returns
`{valid:true,evidence}` or `{valid:false,reason:'invalid-evidence'}`; it is not an
authenticity assertion.

Default budgets are 64 observations, 64 effects, 32 links, data depth 6 and
64 KiB UTF-8; the maximum receipt budget is 256 KiB. JSON is detached and deeply
frozen. Getters, serialization hooks, cycles, prototype keys and nonfinite
numbers are rejected. Metadata identifiers exclude email-shaped/control-text
values; this is not a guarantee of anonymity. Host projections must still
select safe business fields. Dropped entries and missing coverage are explicit.

Applications own durable storage, authorization, import provenance and recovery.
An unsigned receipt can be edited by an administrator; a stored or imported
receipt is not cryptographic proof or model reasoning.
