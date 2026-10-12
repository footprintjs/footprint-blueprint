import { it, expect, vi } from 'vitest';
import { createAdapterRegistry } from '../../adapterRegistry.js';
import { createServiceBridge } from '../../serviceBridge.js';
const capabilities = [{ id: 'pay', name: 'Pay', domain: 'checkout', description: 'Process payment' }, { id: 'email', name: 'Email', domain: 'comms', description: 'Send mail' }];
it('rejects mismatched capability routing before execution', () => {
  const write = vi.fn(async () => 'sent');
  const registry = createAdapterRegistry({ capabilities, adapters: [{ id: 'mailer', name: 'Mailer', capabilityId: 'email', execute: write }], mappings: [{ capabilityId: 'pay', profileAdapters: { shop: 'mailer' }, defaultAdapterId: 'mailer' }] });
  expect(registry.validate().join()).toContain('another capability'); expect(registry.resolve('pay', 'shop')).toBeUndefined();
  expect(() => createServiceBridge(registry)).toThrow('Invalid adapter registry'); expect(write).not.toHaveBeenCalled();
});
it('captures immutable routing/ports and ignores inherited profile mappings', async () => {
  const execute = vi.fn(async () => 'charged');
  const adapter = { id: 'stripe', name: 'Stripe', capabilityId: 'pay', execute };
  const mapping = { capabilityId: 'pay', profileAdapters: { shop: 'stripe' } };
  const registry = createAdapterRegistry({ capabilities, adapters: [adapter], mappings: [mapping] });
  adapter.execute = vi.fn(async () => 'replaced'); adapter.capabilityId = 'email'; mapping.profileAdapters.shop = 'mailer';
  expect(registry.resolve('pay', 'shop')?.id).toBe('stripe'); expect(Object.isFrozen(registry.getAdapter('stripe'))).toBe(true);
  expect(registry.resolve('pay', 'toString')).toBeUndefined();
  const result = await createServiceBridge(registry).execute('pay', {}, { profileType: 'shop', tenantId: 't1', unitId: 's1', actionId: 'checkout' });
  expect(result.result).toBe('charged'); expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ tenantId: 't1', actionId: 'checkout' });
});
it('preserves typed provider failures without enumerable original Error objects', async () => {
  const cause = Object.assign(new Error('Payment declined'), { code: 'PAYMENT_DECLINED', status: 402, traceRunId: 'p1' });
  const registry = createAdapterRegistry({ capabilities, adapters: [{ id: 'stripe', name: 'Stripe', capabilityId: 'pay', execute: async () => { throw cause; } }], mappings: [{ capabilityId: 'pay', profileAdapters: { shop: 'stripe' } }] });
  const result = await createServiceBridge(registry).execute('pay', {}, { profileType: 'shop', unitId: 's1' });
  expect(result).toMatchObject({ status: 'error', errorCode: 'PAYMENT_DECLINED', httpStatus: 402, traceRunId: 'p1' });
  expect(result.cause).toBe(cause); expect(Object.keys(result)).not.toContain('cause');
});
