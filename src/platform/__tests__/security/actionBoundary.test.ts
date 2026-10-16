import { it, expect, vi } from 'vitest';
import { createPlatform } from '../../platform.js';
import { createTenantContext, createMemoryProfileStore } from '../../../tenancy/index.js';
import { createActionRegistry } from '../../../actions/index.js';
import { createTestRegistry, createTestProfileStore, createTestActionRegistry, createTestAdapterRegistry, enrollStudentAction } from '../fixtures.js';
const context = createTenantContext({ tenantId: 't1', unitId: 'k12-school-1', userId: 'admin' });
const config = () => ({ registry: createTestRegistry(), profileStore: createTestProfileStore(), actionRegistry: createTestActionRegistry(), adapterRegistry: createTestAdapterRegistry() });
it('requires trusted policy for discovery and writes', async () => {
  const platform = createPlatform(config());
  expect(await platform.getAvailableActions(context)).toEqual([]);
  expect((await platform.executeAction(context, 'enroll-student', { studentName: 'Alice' })).errorCode).toBe('ACTION_FORBIDDEN');
  await expect(platform.prepareAction(context, 'enroll-student', { studentName: 'Alice' })).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
});
it('advertises non-capability actions only when they have an authorized registered handler', async () => {
  const withoutHandler = createPlatform({ ...config(), authorizer: () => true });
  expect((await withoutHandler.getAvailableActions(context)).map(tool => tool.name)).toEqual(['enroll-student', 'schedule-class']);
  const grade = vi.fn(async () => 'graded');
  const platform = createPlatform({ ...config(), authorizer: ({ action }) => action.id === 'grade-student', handlers: { 'grade-student': grade } });
  expect((await platform.getAvailableActions(context)).map(tool => tool.name)).toEqual(['grade-student']);
  expect((await platform.executeAction(context, 'grade-student', { studentId: 's1', grade: 'A' })).result).toBe('graded'); expect(grade).toHaveBeenCalledOnce();
});
it('uses exact action handler instead of a shared capability and resolves one revision once', async () => {
  const store = createTestProfileStore(); const getBinding = vi.fn(store.getBinding);
  const handler = vi.fn(async () => 'host-publication');
  const authorizer = vi.fn(() => true);
  const platform = createPlatform({ ...config(), profileStore: { getBinding }, authorizer, handlers: { 'enroll-student': handler } });
  const result = await platform.executeAction(context, 'enroll-student', { studentName: 'Alice' });
  expect(result.result).toBe('host-publication'); expect(handler).toHaveBeenCalledOnce(); expect(authorizer).toHaveBeenCalledOnce(); expect(getBinding).toHaveBeenCalledOnce();
  expect(handler.mock.calls[0]?.[2]).toMatchObject({ tenantId: 't1', unitId: 'k12-school-1', userId: 'admin', profileType: 'k12' });
});
it('prepares host workflow input once with captured schema, scope and policy', async () => {
  const input = { studentName: 'Alice' }; const authorizer = vi.fn(() => true);
  const platform = createPlatform({ ...config(), authorizer });
  const prepared = await platform.prepareAction(context, 'enroll-student', input);
  input.studentName = 'changed'; expect(prepared.input).toEqual({ studentName: 'Alice' }); expect(Object.isFrozen(prepared.input)).toBe(true);
  expect(prepared.context).toMatchObject({ tenantId: 't1', unitId: 'k12-school-1', profileType: 'k12' }); expect(authorizer).toHaveBeenCalledOnce();
  await expect(platform.prepareAction(context, 'enroll-student', { studentName: 42 })).rejects.toMatchObject({ code: 'ACTION_INPUT_INVALID', status: 400 });
});
it('fails startup validation for unknown modules, invalid handlers or miswired adapters', () => {
  expect(() => createPlatform({ ...config(), actionRegistry: createActionRegistry({ actions: [{ ...enrollStudentAction, requiredModules: ['typo'] }] }) })).toThrow('unknown module');
  expect(() => createPlatform({ ...config(), handlers: { absent: async () => {} } })).toThrow('Invalid handler');
});
it('profile scope and authoritative revision checks remain active with cache options and invalidation', async () => {
  const store = createMemoryProfileStore([{ tenantId: 't1', revision: 0, unitId: 'same', profileType: 'dance', createdAt: '2024-01-01' }, { tenantId: 't2', revision: 0, unitId: 'same', profileType: 'k12', createdAt: '2024-01-01' }]);
  const platform = createPlatform({ ...config(), profileStore: store, authorizer: () => true, handlers: { 'grade-student': async () => true }, resolverOptions: { cacheTtlMs: 500, maxCacheEntries: 2 } });
  const scope1 = createTenantContext({ tenantId: 't1', unitId: 'same' }); const scope2 = createTenantContext({ tenantId: 't2', unitId: 'same' });
  expect((await platform.getAvailableActions(scope1)).map(tool => tool.name)).not.toContain('grade-student');
  expect((await platform.getAvailableActions(scope2)).map(tool => tool.name)).toContain('grade-student');
  store.updateBinding({ tenantId: 't1', revision: 1, unitId: 'same', profileType: 'k12', createdAt: '2024-01-01' }, 0);
  platform.invalidateProfile(scope1); expect((await platform.getAvailableActions(scope1)).map(tool => tool.name)).toContain('grade-student');
  platform.clearProfileCache(); expect((await platform.resolveUnit(scope2)).profileType).toBe('k12');
});
it('captures all request scopes before a deferred binding read, including execution and discovery identities', async () => {
  const original = { tenantId: 'tenant-old', campusId: 'campus-old', unitId: 'unit-old', userId: 'admin-old' };
  for (const method of ['resolveUnit', 'setupUnit', 'gateCheck', 'getTermResolver', 'getAvailableActions', 'prepareAction', 'executeAction'] as const) {
    let release!: (binding: any) => void;
    const binding = new Promise<any>(resolve => { release = resolve; });
    let readStarted!: () => void;
    const started = new Promise<void>(resolve => { readStarted = resolve; });
    const getBinding = vi.fn(async () => { readStarted(); return binding; });
    const authorizer = vi.fn(() => true);
    const handler = vi.fn(async (_id, _input, ctx) => ({ tenantId: ctx.tenantId, campusId: ctx.campusId, unitId: ctx.unitId, userId: ctx.userId }));
    const record = vi.fn(async () => {});
    const platform = createPlatform({ ...config(), profileStore: { getBinding }, authorizer, handlers: { 'enroll-student': handler }, traceRecorder: { record } });
    const mutable = { ...original };
    let pending: Promise<any>;
    if (method === 'gateCheck') pending = platform.gateCheck(mutable, ['nonexistent']);
    else if (method === 'prepareAction' || method === 'executeAction') pending = platform[method](mutable, 'enroll-student', { studentName: 'Alice' });
    else pending = platform[method](mutable);
    await started;
    Object.assign(mutable, { tenantId: 'tenant-new', campusId: 'campus-new', unitId: 'unit-new', userId: 'admin-new' });
    release({ tenantId: original.tenantId, campusId: original.campusId, unitId: original.unitId, revision: 0, profileType: 'k12', createdAt: '2026-10-11' });
    const result = await pending;
    expect(getBinding).toHaveBeenCalledOnce();
    expect(getBinding.mock.calls[0]?.[0]).toMatchObject({ tenantId: original.tenantId, campusId: original.campusId, unitId: original.unitId });
    if (method === 'resolveUnit' || method === 'setupUnit') expect(result.unitId).toBe(original.unitId);
    if (method === 'setupUnit') expect(result.seedPlan.unitId).toBe(original.unitId);
    if (method === 'gateCheck') expect(result.denied[0].unitId).toBe(original.unitId);
    if (method === 'prepareAction') expect(result.context).toMatchObject({ ...original, profileType: 'k12' });
    if (method === 'getAvailableActions' || method === 'prepareAction' || method === 'executeAction') {
      for (const [request] of authorizer.mock.calls) expect(request.context).toMatchObject({ ...original, profileType: 'k12' });
    }
    if (method === 'executeAction') {
      expect(result.status).toBe('success'); expect(result.result).toEqual(original);
      expect(result.trace).toMatchObject({ tenantId: original.tenantId, campusId: original.campusId, unitId: original.unitId });
      expect(record.mock.calls[0]?.[1]).toMatchObject({ tenantId: original.tenantId, campusId: original.campusId, unitId: original.unitId });
      expect(record.mock.calls[0]?.[1]).not.toHaveProperty('userId');
    }
  }
});
