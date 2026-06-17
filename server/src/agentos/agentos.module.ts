import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { checkpointerProvider } from './checkpointer.provider';
import { DeepAgentService } from './deep-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter } from './stream-adapter';

@Module({
  controllers: [AgentosController],
  providers: [
    DeepAgentService,
    StreamAdapter,
    SessionsService,
    ContextAssembler,
    checkpointerProvider,
  ],
})
export class AgentosModule {}
