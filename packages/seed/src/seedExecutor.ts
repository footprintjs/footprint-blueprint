import { immutableValue } from '@footprint/features';
import type { SeedPlan, SeedApplier, SeedApplyResult, SeedExecutionResult, SeedExecutionOptions } from './types.js';

/** Sequential, non-atomic writes. Default stops after failure; partial mode skips dependent branches. */
export async function executeSeedPlan(plan: SeedPlan, applier: SeedApplier, options: SeedExecutionOptions = {}): Promise<SeedExecutionResult> {
  const failureMode = options.failureMode ?? 'stop';
  if (failureMode !== 'stop' && failureMode !== 'partial') throw new Error('Unknown seed failure mode');
  const captured = immutableValue(plan);
  const moduleIds = new Set<string>();
  for (const entry of captured.entries) {
    if (moduleIds.has(entry.moduleId)) throw new Error(`Duplicate seed entry ${entry.moduleId}`);
    if (!Array.isArray(entry.requires)) throw new Error(`Seed entry ${entry.moduleId} requires dependency metadata`);
    for (const requirement of entry.requires) if (!moduleIds.has(requirement)) throw new Error(`Seed prerequisite ${requirement} must precede ${entry.moduleId}`);
    moduleIds.add(entry.moduleId);
  }
  const start = Date.now();
  const results: SeedApplyResult[] = [];
  const blueprints: Record<string, unknown> = Object.create(null);
  for (const entry of captured.entries) blueprints[entry.moduleId] = entry.blueprint;
  const generated: Record<string, unknown> = Object.create(null);
  const outcomes = new Map<string, SeedApplyResult['status']>();
  let stopped = false;
  for (const entry of captured.entries) {
    const missing = entry.requires.filter((id) => outcomes.get(id) !== 'success');
    if (stopped || missing.length) {
      const result: SeedApplyResult = { moduleId: entry.moduleId, status: 'skipped', reason: stopped ? 'Stopped after an earlier seed failure' : `Prerequisites did not succeed: ${missing.join(', ')}` };
      results.push(Object.freeze(result)); outcomes.set(entry.moduleId, 'skipped');
      continue;
    }
    const context = Object.freeze({ profileType: captured.profileType, unitId: captured.unitId, blueprints: immutableValue(blueprints), generated: immutableValue(generated) });
    let result: SeedApplyResult;
    try {
      const acknowledged = await applier.apply(entry, context);
      if (acknowledged.moduleId !== entry.moduleId || !['success', 'skipped', 'error'].includes(acknowledged.status)) throw new Error('Seed applier returned an invalid receipt');
      result = immutableValue(acknowledged);
    } catch (error) {
      result = Object.freeze({ moduleId: entry.moduleId, status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    results.push(result); outcomes.set(entry.moduleId, result.status);
    if (result.status === 'success') generated[entry.moduleId] = entry.transformed ?? entry.blueprint;
    else if (failureMode === 'stop') stopped = true;
  }
  const hasErrors = results.some((result) => result.status === 'error');
  const successful = results.some((result) => result.status === 'success');
  return Object.freeze({ plan: captured, results: Object.freeze(results), status: hasErrors ? successful ? 'partial' : 'error' : results.some((result) => result.status === 'skipped') ? 'partial' : 'success', duration: Date.now() - start });
}
