import { Module } from '@nestjs/common';
import { AgentosModule } from './agentos/agentos.module';
import { AuthModule } from './auth/auth.module';
import { NovelModule } from './novel/novel.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, AgentosModule, NovelModule],
})
export class AppModule {}
