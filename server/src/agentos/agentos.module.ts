import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { SessionsService } from './sessions.service';
import { DeepAgentService } from './deep-agent.service';
import { checkpointerProvider } from './checkpointer.provider';
import { NovelModule } from '../novel/novel.module';
import { MemoryModule } from '../memory/memory.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * 会话 agent 由 DeepAgentService(createDeepAgent,主 + writer/settler/validator)提供。
 * 模型由 SettingsModule(ModelConfigService)按用户活动配置注入。ContextAssembler(状态感知
 * prompt)+ SessionsService 仍由本模块提供。
 */
@Module({
  imports: [NovelModule, MemoryModule, SettingsModule],
  controllers: [AgentosController],
  providers: [
    SessionsService,
    ContextAssembler,
    DeepAgentService,
    checkpointerProvider,
  ],
})
export class AgentosModule {}
