import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AgentosModule } from './agentos/agentos.module';
import { AuthModule } from './auth/auth.module';
import { pinoLoggerOptions } from './logging/logging.config';
import { NovelModule } from './novel/novel.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // First so nestjs-pino captures the other modules' init logs.
    LoggerModule.forRoot(pinoLoggerOptions),
    PrismaModule,
    AuthModule,
    AgentosModule,
    NovelModule,
  ],
})
export class AppModule {}
