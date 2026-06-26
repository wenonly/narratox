import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { VoiceProfileService } from './voice-profile.service';
import { PutVoiceProfileDto } from './dto/put-voice-profile.dto';
import { GenerateVoiceProfileDto } from './dto/generate-voice-profile.dto';

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

  @Post('generate')
  generate(
    @CurrentUser() user: RequestUser,
    @Body() dto: GenerateVoiceProfileDto,
  ) {
    return this.voice.generate(user.id, dto.samples);
  }
}
