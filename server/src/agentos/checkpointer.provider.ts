import type { Provider } from '@nestjs/common';

/**
 * DI token for the LangGraph checkpointer injected into WorkspaceSwarmService.
 * String token (not the abstract BaseCheckpointSaver class) so the swarm
 * service can keep a type-only import of BaseCheckpointSaver and stay free
 * of any static import of the checkpoint package (keeps Jest collection clean).
 */
export const CHECKPOINTER = 'CHECKPOINTER';

/**
 * 构建一个 Postgres-backed checkpointer：
 * - 动态 import @langchain/langgraph-checkpoint-postgres，避免静态加载仅-ESM 的
 *   传递依赖导致 Jest 在收集阶段崩溃（本文件仅运行时加载，单测不 import 它）。
 * - setup() 建 checkpoints / checkpoint_blobs / checkpoint_writes 三张表。
 * 该 provider 仅在真实运行时实例化；WorkspaceSwarmService 在测试里用 @Optional() 注入，
 * 缺省走 checkpointer=false（无持久化）。
 */
export const checkpointerProvider: Provider = {
  provide: CHECKPOINTER,
  useFactory: async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Add it to server/.env (see server/.env.example).',
      );
    }
    const { PostgresSaver } =
      await import('@langchain/langgraph-checkpoint-postgres');
    // fromConnString 在已发布版本里是同步的（返回实例）。若安装到的版本将其改为 async，
    // Task 7 启动会报 saver.setup is not a function —— 届时改成 await 即可：
    // PostgresSaver 的 checkpoint 表放在独立的 `agent_memory` schema：
    // - Prisma 只管理 `public` schema，二者互不可见，彻底消除 migration drift。
    // - setup() 会执行 `CREATE SCHEMA IF NOT EXISTS agent_memory` 并在其中建表。
    const saver = PostgresSaver.fromConnString(url, { schema: 'agent_memory' });
    await saver.setup();
    return saver;
  },
};
