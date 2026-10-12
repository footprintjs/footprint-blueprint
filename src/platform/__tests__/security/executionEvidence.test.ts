import { describe, expect, it, vi } from 'vitest';
import { createPlatform } from '../../platform.js';
import { createActionRegistry, validateExecutionEvidence } from '../../../actions/index.js';
import { createTestRegistry, createTestProfileStore } from '../fixtures.js';

const context = { tenantId: 't1', unitId: 'dance-studio-1', userId: 'private-user' };
const actions = createActionRegistry({ actions: [{ id: 'reserve', name: 'Reserve', description: 'Reserve a slot', domain: 'scheduling', category: 'workflow', requiredModules: ['scheduling'], parameters: [{ name: 'resourceId', type: 'string', required: true, description: 'Resource identity' }] }] });

describe('platform evidence configuration', () => {
  it('forwards trusted projection and collector settings through a real resolved action', async () => {
    const actorProjection = vi.fn(() => 'speaker-1');
    const platform = createPlatform({
      registry: createTestRegistry(), profileStore: createTestProfileStore(), actionRegistry: actions,
      authorizer: () => true,
      projectEvidenceActor: actorProjection,
      projectEvidenceRequest: value => ({ resourceId: (value as { resourceId: string }).resourceId }),
      evidenceOptions: { project: (_kind, value) => value as { resourceId: string }, maxObservations: 1 },
      handlers: { reserve: async (_id, input, scope, evidence) => {
        expect(scope.profileType).toBe('dance');
        evidence!.observe({ kind: 'database', operation: 'lookup', recordIds: [(input as { resourceId: string }).resourceId] });
        evidence!.effect({ kind: 'database', operation: 'reserve', phase: 'acknowledged', count: 1 });
        return 'saved';
      } },
    });
    const result = await platform.executeAction(context, 'reserve', { resourceId: 'resource-1' });
    expect(result.status).toBe('success');
    expect(result.evidence).toMatchObject({ actionId: 'reserve', actorId: 'speaker-1', scope: { tenantId: 't1', unitId: 'dance-studio-1', profileType: 'dance' }, request: { resourceId: 'resource-1' }, effects: [{ phase: 'acknowledged' }] });
    expect(actorProjection).toHaveBeenCalledOnce(); expect(validateExecutionEvidence(result.evidence).valid).toBe(true);
    expect(JSON.stringify(result.executionTrace)).not.toContain('private-user');
  });

  it('does not capture user input before profile/module resolution succeeds', async () => {
    const projectRequest = vi.fn(value => value);
    const platform = createPlatform({
      registry: createTestRegistry(), profileStore: createTestProfileStore(), actionRegistry: actions,
      authorizer: () => true, projectEvidenceRequest: projectRequest,
      handlers: { reserve: async () => 'saved' },
    });
    const result = await platform.executeAction({ tenantId: 'wrong-tenant', unitId: 'dance-studio-1' }, 'reserve', { resourceId: 'private-request' });
    expect(result.status).toBe('error'); expect(result.evidence).toBeUndefined();
    expect(result.executionTrace).toBeUndefined(); expect(projectRequest).not.toHaveBeenCalled();
  });
});
