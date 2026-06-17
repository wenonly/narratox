import { ResourceRegistry } from './resource-registry';
import type { ResourceHandler, ResourceMutation } from './mutation.types';

describe('ResourceRegistry', () => {
  it('dispatches a mutation to the registered handler', async () => {
    const registry = new ResourceRegistry();
    const apply = jest.fn().mockResolvedValue(undefined);
    const handler: ResourceHandler = { resource: 'chapter', apply };
    registry.register(handler);

    const mutation: ResourceMutation = {
      resource: 'chapter',
      targetId: 'c1',
      op: 'append',
      content: 'hi',
    };
    await registry.dispatch('u1', mutation);

    expect(apply).toHaveBeenCalledWith('u1', mutation);
  });

  it('throws on an unknown resource (no handler registered)', async () => {
    const registry = new ResourceRegistry();
    await expect(
      registry.dispatch('u1', {
        resource: 'chapter',
        targetId: 'c1',
        op: 'set',
        content: 'x',
      }),
    ).rejects.toThrow(/No handler for resource: chapter/);
  });

  it('throws when a handler for the same resource is already registered', () => {
    const registry = new ResourceRegistry();
    const handler: ResourceHandler = {
      resource: 'chapter',
      apply: jest.fn(),
    };
    registry.register(handler);
    expect(() => registry.register(handler)).toThrow(
      /Duplicate handler for resource: chapter/,
    );
  });
});
