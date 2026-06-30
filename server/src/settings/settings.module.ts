import { Module } from '@nestjs/common';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';
import { VoiceProfileController } from './voice-profile.controller';
import { VoiceProfileService } from './voice-profile.service';
import { AgentModelController } from './agent-model.controller';
import { AgentModelOverrideService } from './agent-model-override.service';

/** 导出 ModelConfigService / VoiceProfileService / AgentModelOverrideService 供 AgentosModule 注入。 */
@Module({
  controllers: [ModelConfigController, VoiceProfileController, AgentModelController],
  providers: [ModelConfigService, VoiceProfileService, AgentModelOverrideService],
  exports: [ModelConfigService, VoiceProfileService, AgentModelOverrideService],
})
export class SettingsModule {}
