import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { AgentosModule } from './agentos/agentos.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, AgentModule, AgentosModule],
})
export class AppModule {}
