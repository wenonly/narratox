import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { VoiceProfileService } from './voice-profile.service';
import { PutVoiceProfileDto } from './dto/put-voice-profile.dto';

@Controller('settings/voice')
export class VoiceProfileController {
  constructor(private readonly voice: VoiceProfileService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.voice.get(user.id);
  }

  @Put()
  upsert(@CurrentUser() user: RequestUser, @Body() dto: PutVoiceProfileDto) {
    return this.voice.upsert(user.id, dto.profile);
  }
}
