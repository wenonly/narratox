import { Module } from '@nestjs/common';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';
import { VoiceProfileController } from './voice-profile.controller';
import { VoiceProfileService } from './voice-profile.service';

/** 导出 ModelConfigService / VoiceProfileService 供 AgentosModule 注入。 */
@Module({
  controllers: [ModelConfigController, VoiceProfileController],
  providers: [ModelConfigService, VoiceProfileService],
  exports: [ModelConfigService, VoiceProfileService],
})
export class SettingsModule {}
