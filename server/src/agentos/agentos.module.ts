import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { checkpointerProvider } from './checkpointer.provider';
import { CreationAgentService } from './creation-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter } from './stream-adapter';
import { WorkspaceSwarmService } from './workspace-swarm.service';
import { NovelModule } from '../novel/novel.module';

@Module({
  imports: [NovelModule],
  controllers: [AgentosController],
  providers: [
    CreationAgentService,
    WorkspaceSwarmService,
    StreamAdapter,
    SessionsService,
    ContextAssembler,
    checkpointerProvider,
  ],
})
export class AgentosModule {}
