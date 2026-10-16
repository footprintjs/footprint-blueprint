# Platform — footprint-blueprint/platform

This module ships inside the single `footprint-blueprint@0.4.0` package. Use its focused public import path; see [the framework README](../README.md) and [release runbook](RELEASE.md).

Wires feature definitions, scoped profile resolution, seed planning, action authorization, handlers and adapters.

```ts
const store = createMemoryProfileStore([{
  tenantId: 'store-a', unitId: 'store-a', revision: 0,
  profileType: 'retail', createdAt: '2026-10-11T00:00:00Z',
}]);
const platform = createPlatform({
  registry, profileStore: store, actionRegistry, adapterRegistry,
  authorizer: ({ action, context, purpose }) => verifiedPolicy.can(context.userId, action.id, purpose),
  handlers: { 'publish-content': async (_id, input, context) => publication.publish(input, context) },
  traceRecorder,
  onTraceError: error => diagnostics.report(error),
  resolverOptions: { cacheTtlMs: 30_000, maxCacheEntries: 1000 },
});
// Construct from verified session/deployment state, not untrusted headers/tool input.
const ctx = createTenantContext({ tenantId: 'store-a', unitId: 'store-a', userId: session.userId });
const tools = await platform.getAvailableActions(ctx);
const result = await platform.executeAction(ctx, 'publish-content', { expectedRevision: 4 });
```

Missing authorization yields no discovered actions and denies execution. Discovery combines module gates, handler/adapter availability and trusted policy. Exact action handlers take precedence over shared capability adapters, allowing different operations to use the correct host implementation. Invalid registry dependencies, handler IDs, action module references or capability mappings fail startup validation.

Each action call strongly resolves its full tenant/campus/unit binding once, then uses that same resolved configuration for gates and routing. Every platform method captures and freezes tenant/campus/unit and user identity before asynchronous policy/data work, so a mutable caller object cannot mix a previously resolved profile with changed scope. `ProfileStore.getBinding(scope)` must strongly read the complete scope and return matching scope plus a monotonically increasing revision. The memory store supports guarded revision updates; production hosts supply durable transactions/CAS.

| Method | Behavior |
| --- | --- |
| `resolveUnit(ctx)` | Resolve scoped profile configuration |
| `setupUnit(ctx)` | Resolve configuration and generate a seed plan |
| `gateCheck(ctx,moduleIds)` | Check modules in the resolved profile |
| `getTermResolver(ctx)` | Resolve profile terminology |
| `getAvailableActions(ctx)` | Authorized MCP-compatible descriptors with actual implementations |
| `executeAction(ctx,id,input)` | Module gate, authorization, AJV validation, real Footprint 10 execution |
| `prepareAction(ctx,id,input)` | Same preflight for a trusted host-owned workflow; returns frozen `{action,context,input}` |
| `invalidateProfile(scope)` | Invalidate derived configuration for one complete scope |
| `clearProfileCache()` | Invalidate all derived configurations |

`prepareAction` is useful when a host already has a Footprint workflow. Execute the returned captured payload with a trusted registered operation; do not treat a stale prepared value as a reusable credential. It does not perform a write, start a transaction or replace final durable permissions/revision checks.

Profile cache options: `cacheTtlMs` defaults to 30 seconds, 0 disables derived caching; `maxCacheEntries` defaults to 1000. Every resolution still strongly reads the binding revision. Invalidations prevent an in-flight older resolution from refilling or returning stale cached configuration. Revision regression or same-revision configuration changes reject resolution. Bindings and caches are isolated by tenant/campus/unit scope.

Trace persistence is honored. Recorder/diagnostic failures after handler success preserve success. SDK traces contain real execution stages without default customer payloads. Provider failures retain code/status/run ID and nonenumerable cause. Hosts own authentication, CSRF, public error sanitization, provider availability, transaction/idempotency semantics and MCP transport. Exported tool descriptors do not start an MCP server.

## Shared evidence

The prepared `footprint-blueprint@0.4.0` release forwards `evidenceOptions`, `projectEvidenceActor` and
`projectEvidenceRequest` to the action executor. It re-exports the complete
receipt/reporting/validation API from `footprint-blueprint/actions`. See the
[shared evidence guide](actions.md#shared-execution-evidence) for privacy defaults, effect phases and bounds.

Registered handlers can use the optional fourth `EvidenceReporter` argument to
report actual adapter facts and inner run IDs. Profile/module failures that
occur before execution do not claim a native recording. This release starts no
agent or transport and provisions no hosting resources.
