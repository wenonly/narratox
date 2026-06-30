import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { ModelController } from './model.controller';
import { ModelService } from './model.service';
import { ModelConfigService } from './model-config.service';
import { VoiceProfileController } from './voice-profile.controller';
import { VoiceProfileService } from './voice-profile.service';
import { AgentModelController } from './agent-model.controller';
import { AgentModelOverrideService } from './agent-model-override.service';

/** 导出 ModelConfigService / VoiceProfileService / AgentModelOverrideService 供 AgentosModule 注入。 */
@Module({
  controllers: [
    VendorController,
    ModelController,
    VoiceProfileController,
    AgentModelController,
  ],
  providers: [
    VendorService,
    ModelService,
    ModelConfigService,
    VoiceProfileService,
    AgentModelOverrideService,
  ],
  exports: [ModelConfigService, VoiceProfileService, AgentModelOverrideService],
})
export class SettingsModule {}
