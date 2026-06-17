/**
 * 统一写入层(mutation)。Phase 1 只实现 'chapter';Phase 2+ 加 'outline' | 'character'
 * | 'worldview' | 'status'。新增资源 = 注册一个 ResourceHandler,不改调用方。
 */
export type ResourceType = 'chapter';
export type MutationOp = 'set' | 'append' | 'patch';

export interface ResourceMutation {
  resource: ResourceType;
  targetId: string;
  op: MutationOp;
  content: string;
}

export interface ResourceHandler {
  readonly resource: ResourceType;
  apply(userId: string, mutation: ResourceMutation): Promise<void>;
}
