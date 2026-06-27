import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { VoiceProfileService } from './voice-profile.service';
import {
  CreateVoiceProfileDto,
  GenerateVoiceProfileDto,
  UpdateVoiceProfileDto,
} from './dto/voice-profile.dto';

@Controller('settings/voice-profiles')
export class VoiceProfileController {
  constructor(private readonly voice: VoiceProfileService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.voice.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateVoiceProfileDto) {
    return this.voice.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVoiceProfileDto,
  ) {
    return this.voice.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.voice.remove(user.id, id);
  }

  @Post('generate')
  generate(
    @CurrentUser() user: RequestUser,
    @Body() dto: GenerateVoiceProfileDto,
  ) {
    return this.voice.generate(user.id, dto.samples);
  }
}
