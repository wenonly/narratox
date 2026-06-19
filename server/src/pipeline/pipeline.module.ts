import { Module } from '@nestjs/common';
import { Composer } from './composer';
import { WriterAgent } from './writer.agent';
import { SettlerAgent } from './settler.agent';
import { PipelineRunner } from './pipeline-runner';
import { ConversationalAgentService } from './conversational.agent';
import { checkpointerProvider } from '../agentos/checkpointer.provider';
import { NovelModule } from '../novel/novel.module';
import { MemoryModule } from '../memory/memory.module';

/**
 * 流水线运行时模块(v2 基石)。提供会话 agent + 无状态专家 + Composer + Runner。
 * checkpointer provider 从 AgentosModule 迁来(原属 swarm,现归会话 agent)。
 * NovelModule/MemoryModule 导出专家所需服务;PrismaService 全局。
 */
@Module({
  imports: [NovelModule, MemoryModule],
  providers: [
    Composer,
    WriterAgent,
    SettlerAgent,
    PipelineRunner,
    ConversationalAgentService,
    checkpointerProvider,
  ],
  exports: [
    ConversationalAgentService,
    PipelineRunner,
    Composer,
    WriterAgent,
    SettlerAgent,
  ],
})
export class PipelineModule {}
