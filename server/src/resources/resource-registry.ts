import { Injectable } from '@nestjs/common';
import type { ResourceHandler, ResourceMutation } from './mutation.types';

@Injectable()
export class ResourceRegistry {
  private readonly handlers = new Map<string, ResourceHandler>();

  register(handler: ResourceHandler): void {
    this.handlers.set(handler.resource, handler);
  }

  async dispatch(userId: string, mutation: ResourceMutation): Promise<void> {
    const handler = this.handlers.get(mutation.resource);
    if (!handler) {
      throw new Error(`No handler for resource: ${mutation.resource}`);
    }
    await handler.apply(userId, mutation);
  }
}
