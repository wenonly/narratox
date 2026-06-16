import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { AgentosModule } from './agentos/agentos.module';

@Module({
  imports: [AgentModule, AgentosModule],
})
export class AppModule {}
