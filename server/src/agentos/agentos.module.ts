import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { DeepAgentService } from './deep-agent.service';
import { StreamAdapter } from './stream-adapter';

@Module({
  controllers: [AgentosController],
  providers: [DeepAgentService, StreamAdapter],
})
export class AgentosModule {}
