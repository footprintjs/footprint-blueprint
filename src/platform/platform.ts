import { createTermResolver, immutableValue } from '../features/index.js';
import { createProfileResolver, createGateMiddleware, createTenantContext } from '../tenancy/index.js';
import type { TenantContext } from '../tenancy/index.js';
import { generateSeedPlan } from '../seed/index.js';
import { createServiceBridge } from '../adapters/index.js';
import { createActionExecutor, ActionAccessError, validateActionInput } from '../actions/index.js';
import type { ActionDefinition, ActionExecutionContext } from '../actions/index.js';
import type { Platform, PlatformConfig, PreparedAction } from './types.js';
/** Wires immutable definitions to trusted app ports; every request resolves once. */
export function createPlatform(config: PlatformConfig): Platform {
  const registry = config.registry;
  const actions = config.actionRegistry;
  const handlers = Object.freeze({ ...config.handlers });
  const authorizer = config.authorizer;
  const validation = registry.validate();
  if (validation.length) throw new Error(`Invalid module registry: ${JSON.stringify(validation)}`);
  for (const id of Object.keys(handlers)) if (!actions?.getAction(id) || typeof handlers[id] !== 'function') throw new Error(`Invalid handler registration: ${id}`);
  for (const action of actions?.allActions() ?? []) {
    for (const id of action.requiredModules) if (!registry.getModule(id)) throw new Error(`Action "${action.id}" references unknown module "${id}"`);
    if (action.capabilityId && config.adapterRegistry && !config.adapterRegistry.getCapability(action.capabilityId)) throw new Error(`Action "${action.id}" references unknown capability "${action.capabilityId}"`);
  }
  const resolver = createProfileResolver(registry, config.profileStore, config.resolverOptions);
  const gateMiddleware = createGateMiddleware(resolver);
  const bridge = config.adapterRegistry ? createServiceBridge(config.adapterRegistry) : undefined;
  const executor = actions ? createActionExecutor(actions, bridge, {
    authorizer, handlers, traceRecorder: config.traceRecorder, onTraceError: config.onTraceError,
    evidenceOptions: config.evidenceOptions,
    projectEvidenceActor: config.projectEvidenceActor,
    projectEvidenceRequest: config.projectEvidenceRequest,
    executionOptions: config.executionOptions,
  }) : undefined;
  const hasImplementation = (action: ActionDefinition, profileType: string) => Object.hasOwn(handlers, action.id) || Boolean(action.capabilityId && bridge?.hasAdapter(action.capabilityId, profileType));
  const resolveAction = async (suppliedContext: TenantContext, actionId: string) => {
    const ctx = createTenantContext(suppliedContext);
    const action = actions?.getAction(actionId);
    if (!action) throw new ActionAccessError('ACTION_UNKNOWN', `Unknown action: "${actionId}"`, 404);
    const resolved = await resolver.resolve(ctx);
    if (!action.requiredModules.every(id => resolved.enabledModules.has(id))) throw new ActionAccessError('ACTION_MODULE_DISABLED', 'Action requires disabled modules');
    const context: ActionExecutionContext = immutableValue({ tenantId: ctx.tenantId, ...(ctx.campusId ? { campusId: ctx.campusId } : {}), unitId: ctx.unitId, ...(ctx.userId ? { userId: ctx.userId } : {}), profileType: resolved.profileType });
    if (!hasImplementation(action, resolved.profileType)) throw new ActionAccessError('ACTION_IMPLEMENTATION_UNAVAILABLE', 'Action implementation is unavailable', 503);
    return { action, context };
  };
  return Object.freeze({
    async resolveUnit(suppliedContext) { const ctx = createTenantContext(suppliedContext); const resolved = await resolver.resolve(ctx); return Object.freeze({ unitId: ctx.unitId, profileType: resolved.profileType, config: resolved }); },
    async setupUnit(suppliedContext) { const ctx = createTenantContext(suppliedContext); const resolved = await resolver.resolve(ctx); return Object.freeze({ unitId: ctx.unitId, profileType: resolved.profileType, config: resolved, seedPlan: generateSeedPlan(resolved, ctx.unitId) }); },
    async gateCheck(suppliedContext, requiredModules) { const ctx = createTenantContext(suppliedContext); return gateMiddleware(ctx, Object.freeze([...requiredModules])); },
    async getTermResolver(suppliedContext) { const ctx = createTenantContext(suppliedContext); return createTermResolver((await resolver.resolve(ctx)).terminology); },
    async getAvailableActions(suppliedContext) {
      const ctx = createTenantContext(suppliedContext);
      if (!actions || !authorizer) return Object.freeze([]);
      const resolved = await resolver.resolve(ctx);
      const context: ActionExecutionContext = immutableValue({ tenantId: ctx.tenantId, ...(ctx.campusId ? { campusId: ctx.campusId } : {}), unitId: ctx.unitId, ...(ctx.userId ? { userId: ctx.userId } : {}), profileType: resolved.profileType });
      return actions.toMCPTools({ enabledModules: resolved.enabledModules, context, authorizer, hasImplementation: action => hasImplementation(action, resolved.profileType) });
    },
    async prepareAction(ctx, actionId, input): Promise<PreparedAction> {
      const { action, context } = await resolveAction(ctx, actionId);
      if (!authorizer || await authorizer({ action, context, purpose: 'execute' }) !== true) throw new ActionAccessError('ACTION_FORBIDDEN', 'Action is not authorized');
      const captured = immutableValue(input);
      validateActionInput(action, captured);
      return Object.freeze({ action, context, input: captured });
    },
    async executeAction(ctx, actionId, input) {
      try {
        const { context } = await resolveAction(ctx, actionId);
        return await executor!.execute(actionId, input, context);
      } catch (cause) {
        const details = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {};
        const result = { actionId, status: 'error' as const, error: cause instanceof Error ? cause.message : 'Action execution rejected', errorCode: typeof details.code === 'string' ? details.code : 'ACTION_EXECUTION_FAILED', httpStatus: typeof details.status === 'number' ? details.status : 500, duration: 0 };
        Object.defineProperty(result, 'cause', { value: cause, enumerable: false });
        return Object.freeze(result);
      }
    },
    invalidateProfile: resolver.invalidate,
    clearProfileCache: resolver.clearCache,
  });
}
