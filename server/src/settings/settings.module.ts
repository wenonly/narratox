import { Module } from '@nestjs/common';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';

/** 导出 ModelConfigService 供 AgentosModule(DeepAgentService 工厂)注入。 */
@Module({
  controllers: [ModelConfigController],
  providers: [ModelConfigService],
  exports: [ModelConfigService],
})
export class SettingsModule {}
