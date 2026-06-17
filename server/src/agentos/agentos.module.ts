import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { checkpointerProvider } from './checkpointer.provider';
import { CreationAgentService } from './creation-agent.service';
import { DeepAgentService } from './deep-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter } from './stream-adapter';
import { NovelModule } from '../novel/novel.module';

@Module({
  imports: [NovelModule],
  controllers: [AgentosController],
  providers: [
    DeepAgentService,
    CreationAgentService,
    StreamAdapter,
    SessionsService,
    ContextAssembler,
    checkpointerProvider,
  ],
})
export class AgentosModule {}
