import { Module } from '@nestjs/common';
import { BenchmarkService } from './benchmark.service';
import { BenchmarkController } from './benchmark.controller';
import { DissectAgentService } from '../agentos/dissect-agent.service';
import { DissectContextAssembler } from '../agentos/dissect-context-assembler.service';
import { checkpointerProvider } from '../agentos/checkpointer.provider';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * 对标拆解模块:
 *  - BenchmarkService:对标书 CRUD + 拆解条目写入;
 *  - DissectAgentService:拆解 agent(后台异步,绑定 bookId,EventEmitter 推活动帧);
 *  - DissectContextAssembler:拆解 context prompt 组装;
 *  - checkpointerProvider:LangGraph checkpointer(token = CHECKPOINTER 字符串,
 *    Provider 形式而非 class —— 直接放进 providers 数组,与 AgentosModule 同注册方式)。
 *
 * SettingsModule 提供 ModelConfigService + AgentModelOverrideService(DissectAgentService
 * 解析 per-user / per-agent 模型)。PrismaModule @Global。
 *
 * 注意:checkpointer provider 在 AgentosModule 也注册了一份 —— NestJS 容器里两个模块
 * 各自持有一份 useFactory 实例(同 DATABASE_URL → 同一 PostgresSaver.setup() 行为,
 * 表已存在则幂等)。当前架构允许这份冗余;若未来要全局单例,把 checkpointerProvider
 * 提到一个 @Global 模块即可。
 */
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [BenchmarkController],
  providers: [
    BenchmarkService,
    DissectAgentService,
    DissectContextAssembler,
    checkpointerProvider,
  ],
  exports: [BenchmarkService],
})
export class BenchmarkModule {}
