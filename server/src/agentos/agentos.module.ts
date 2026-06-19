import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { SessionsService } from './sessions.service';
import { DeepAgentService } from './deep-agent.service';
import { checkpointerProvider } from './checkpointer.provider';
import { NovelModule } from '../novel/novel.module';
import { MemoryModule } from '../memory/memory.module';

/**
 * DeepAgents:会话 agent 由 DeepAgentService(createDeepAgent)提供,带自动压缩
 * (SummarizationMiddleware)——不再需要 trim/自愈。checkpointer provider 也在这里。
 * ContextAssembler(状态感知 prompt)+ SessionsService 仍由本模块提供。
 */
@Module({
  imports: [NovelModule, MemoryModule],
  controllers: [AgentosController],
  providers: [
    SessionsService,
    ContextAssembler,
    DeepAgentService,
    checkpointerProvider,
  ],
})
export class AgentosModule {}
