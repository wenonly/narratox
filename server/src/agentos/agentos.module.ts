import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { checkpointerProvider } from './checkpointer.provider';
import { SessionsService } from './sessions.service';
import { WorkspaceSwarmService } from './workspace-swarm.service';
import { NovelModule } from '../novel/novel.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [NovelModule, MemoryModule],
  controllers: [AgentosController],
  providers: [
    WorkspaceSwarmService,
    SessionsService,
    ContextAssembler,
    checkpointerProvider,
  ],
})
export class AgentosModule {}
