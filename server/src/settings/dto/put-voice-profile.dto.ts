import { IsString, MaxLength } from 'class-validator';

export class PutVoiceProfileDto {
  @IsString()
  @MaxLength(8000)
  profile!: string;
}
