import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [AgentModule],
})
export class AppModule {}
