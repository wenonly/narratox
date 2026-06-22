import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AgentosModule } from './agentos/agentos.module';
import { AuthModule } from './auth/auth.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { LoggingModule } from './logging/logging.module';
import { pinoLoggerOptions } from './logging/logging.config';
import { NovelModule } from './novel/novel.module';
import { PrismaModule } from './prisma/prisma.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    // First so nestjs-pino captures the other modules' init logs.
    LoggerModule.forRoot(pinoLoggerOptions),
    // @Global — AgentLoggerService 可注入任意模块,无需 per-module 导入。
    LoggingModule,
    PrismaModule,
    AuthModule,
    AgentosModule,
    NovelModule,
    SettingsModule,
    KnowledgeModule,
  ],
})
export class AppModule {}
